import { ExtendedKind, READ_ALOUD_KINDS } from '@/constants'
import { getNoteBech32Id, isProtectedEvent, getRootEventHexId } from '@/lib/event'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { buildHiveTalkJoinUrl } from '@/lib/hivetalk'
import { toAlexandria } from '@/lib/link'
import logger from '@/lib/logger'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import {
  batchFetchPublicationSectionEvents,
  buildPublicationSectionRelayUrls,
  parsePublicationATagCoordinate,
  type PublicationSectionRef
} from '@/lib/publication-section-fetch'
import { normalizeAnyRelayUrl, normalizeHttpRelayUrl, simplifyUrl } from '@/lib/url'
import { speakNoteReadAloud } from '@/lib/read-aloud'
import {
  buildPinListTagsAfterToggle,
  fetchNewestPinListForPubkey,
  isEventInPinList
} from '@/lib/replaceable-list-latest'
import { generateBech32IdFromATag } from '@/lib/tag'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useNostr } from '@/providers/NostrProvider'
import { FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import client from '@/services/client.service'
import { eventService } from '@/services/client.service'
import { nip66Service } from '@/services/nip66.service'
import {
  Bell,
  BellOff,
  BookOpen,
  Code,
  Copy,
  FileDown,
  GitFork,
  Globe,
  Link,
  MessageCircle,
  PencilLine,
  Pin,
  SatelliteDish,
  Send,
  Trash2,
  TriangleAlert,
  Video,
  Volume2
} from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { useMemo, useState, useEffect, useRef, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import RelayIcon from '../RelayIcon'
import { PrimaryPageContext } from '@/contexts/primary-page-context'
import { showPublishingFeedback, toastPublishPromise } from '@/lib/publishing-feedback'
import type { TEditOrCloneMode } from './EditOrCloneEventDialog'

export interface SubMenuAction {
  label: React.ReactNode
  onClick: () => void
  className?: string
  separator?: boolean
}

export interface MenuAction {
  icon: React.ComponentType
  label: string
  onClick?: () => void
  className?: string
  separator?: boolean
  subMenu?: SubMenuAction[]
}

interface UseMenuActionsProps {
  event: Event
  closeDrawer: () => void
  showSubMenuActions: (subMenu: SubMenuAction[], title: string) => void
  setIsRawEventDialogOpen: (open: boolean) => void
  setIsReportDialogOpen: (open: boolean) => void
  isSmallScreen: boolean
  /** When provided, adds "Send public message" to open composer with this pubkey in the mention list. */
  onOpenPublicMessage?: (pubkey: string) => void
  /** When provided, adds "Send call invite" to open composer with the call URL as content. */
  onOpenCallInvite?: (url: string) => void
  /** Opens edit/clone dialog (signed-in accounts only, not read-only npub). */
  onOpenEditOrClone?: (mode: TEditOrCloneMode) => void
}

export function useMenuActions({
  event,
  closeDrawer,
  showSubMenuActions,
  setIsRawEventDialogOpen,
  setIsReportDialogOpen,
  isSmallScreen,
  onOpenPublicMessage,
  onOpenCallInvite,
  onOpenEditOrClone,
}: UseMenuActionsProps) {
  const { t } = useTranslation()
  // Use useContext directly to avoid error if provider is not available
  const primaryPageContext = useContext(PrimaryPageContext)
  const currentPrimaryPage = primaryPageContext?.current ?? null
  const { pubkey, profile, attemptDelete, publish, account, relayList } = useNostr()
  const canSignEvents = account != null && account.signerType !== 'npub'
  const { relayUrls: currentBrowsingRelayUrls } = useCurrentRelays()
  const { relaySets, favoriteRelays } = useFavoriteRelays()
  const httpWriteRelayUrls = useMemo(() => {
    return (relayList?.httpWrite ?? [])
      .map(url => normalizeHttpRelayUrl(url) || url)
      .filter(Boolean) as string[]
  }, [relayList?.httpWrite])
  const relayUrls = useMemo(() => {
    return Array.from(new Set([
      ...currentBrowsingRelayUrls.map(url => normalizeAnyRelayUrl(url) || url),
      ...favoriteRelays.map(url => normalizeAnyRelayUrl(url) || url)
    ]))
  }, [currentBrowsingRelayUrls, favoriteRelays])

  /** All available relays: current feed, favorites, relay sets, defaults (BIG, FAST_READ, FAST_WRITE). */
  const allAvailableRelayUrls = useMemo(() => {
    const urls = [
      ...currentBrowsingRelayUrls.map(url => normalizeAnyRelayUrl(url) || url),
      ...favoriteRelays.map(url => normalizeAnyRelayUrl(url) || url),
      ...relaySets.flatMap(set => set.relayUrls.map(url => normalizeAnyRelayUrl(url) || url)),
      ...FAST_READ_RELAY_URLS.map(url => normalizeAnyRelayUrl(url) || url),
      ...FAST_WRITE_RELAY_URLS.map(url => normalizeAnyRelayUrl(url) || url)
    ].filter(Boolean) as string[]
    return Array.from(new Set(urls))
  }, [currentBrowsingRelayUrls, favoriteRelays, relaySets])

  /** Number of relays in NIP-66 monitoring list (async); used for "All active relays" label. */
  const [monitoringListRelayCount, setMonitoringListRelayCount] = useState<number | null>(null)
  useEffect(() => {
    nip66Service.getPublicLivelyRelayUrls().then((urls) => {
      setMonitoringListRelayCount(urls?.length ?? 0)
    })
  }, [])
  const { mutePubkeyPublicly, mutePubkeyPrivately, unmutePubkey, mutePubkeySet } = useMuteList()
  const isMuted = useMemo(() => muteSetHas(mutePubkeySet, event.pubkey), [mutePubkeySet, event])
  
  // Check if event is pinned
  const [isPinned, setIsPinned] = useState(false)

  // Keep refs so the effect can read the latest relay lists without making them
  // part of the dependency array.  Including live array references as deps causes
  // an infinite loop: relay fetch → NoteList re-render → new array refs →
  // effect re-fires for every visible note → relay fetch → …
  const currentBrowsingRelayUrlsRef = useRef(currentBrowsingRelayUrls)
  currentBrowsingRelayUrlsRef.current = currentBrowsingRelayUrls
  const favoriteRelaysRef = useRef(favoriteRelays)
  favoriteRelaysRef.current = favoriteRelays

  useEffect(() => {
    const checkIfPinned = async () => {
      if (!pubkey) {
        setIsPinned(false)
        return
      }
      try {
        const allRelays = [
          ...(currentBrowsingRelayUrlsRef.current || []),
          ...(favoriteRelaysRef.current || []),
          ...FAST_READ_RELAY_URLS,
          ...FAST_WRITE_RELAY_URLS
        ]
        const comprehensiveRelays = Array.from(
          new Set(allRelays.map(url => normalizeAnyRelayUrl(url)).filter((url): url is string => !!url))
        )
        const pinListEvent = await fetchNewestPinListForPubkey(pubkey, comprehensiveRelays)
        if (pinListEvent) {
          setIsPinned(isEventInPinList(pinListEvent, event))
        } else {
          setIsPinned(false)
        }
      } catch (error) {
        logger.component('PinStatus', 'Error checking pin status', { error: (error as Error).message })
        setIsPinned(false)
      }
    }
    checkIfPinned()
    // Only re-run when the user or the specific event changes, not on relay list
    // reference churn (relay arrays are read via refs above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, event.id])
  
  const handlePinNote = async () => {
    if (!pubkey) return
    
    try {
      // Build comprehensive relay list for pin list fetching
      const allRelays = [
        ...(currentBrowsingRelayUrls || []),
        ...(favoriteRelays || []),
        ...FAST_READ_RELAY_URLS,
        ...FAST_READ_RELAY_URLS,
        ...FAST_WRITE_RELAY_URLS
      ]
      
      const normalizedRelays = allRelays
        .map(url => normalizeAnyRelayUrl(url))
        .filter((url): url is string => !!url)
      
      const comprehensiveRelays = Array.from(new Set(normalizedRelays))

      const latestPinList = await fetchNewestPinListForPubkey(pubkey, comprehensiveRelays)

      logger.component('PinNote', 'Current pin list event', { hasEvent: !!latestPinList })

      const newTags = buildPinListTagsAfterToggle(latestPinList ?? null, event, !isPinned)
      const successMessage = isPinned ? t('Note unpinned') : t('Note pinned')
      logger.component('PinNote', 'Pin list tag count after merge', { count: newTags.length })
      
      // Create and publish the new pin list event
      logger.component('PinNote', 'Publishing new pin list event', { tagCount: newTags.length, relayCount: comprehensiveRelays.length })
      const publishedEvent = await publish({
        kind: 10001,
        tags: newTags,
        content: '',
        created_at: Math.floor(Date.now() / 1000)
      }, {
        specifiedRelayUrls: comprehensiveRelays
      })
      
      // Show publishing feedback with relay messages
      if ((publishedEvent as any)?.relayStatuses) {
        showPublishingFeedback({
          success: true,
          relayStatuses: (publishedEvent as any).relayStatuses,
          successCount: (publishedEvent as any).relayStatuses.filter((s: any) => s.success).length,
          totalCount: (publishedEvent as any).relayStatuses.length
        }, {
          message: successMessage,
          duration: 4000
        })
      } else {
        toast.success(successMessage)
      }
      
      // Update local state - the publish will update the cache automatically
      setIsPinned(!isPinned)
      closeDrawer()
    } catch (error) {
      logger.component('PinNote', 'Error pinning/unpinning note', { error: (error as Error).message })
      toast.error(t('Failed to pin note'))
    }
  }
  
  // Check if this is a reply to a discussion event
  const [isReplyToDiscussion, setIsReplyToDiscussion] = useState(false)
  
  useEffect(() => {
    const isDiscussion = event.kind === ExtendedKind.DISCUSSION
    if (isDiscussion) return // Already a discussion event
    
    const rootEventId = getRootEventHexId(event)
    if (rootEventId) {
      // Fetch the root event to check if it's a discussion
      eventService.fetchEvent(rootEventId).then(rootEvent => {
        if (rootEvent && rootEvent.kind === ExtendedKind.DISCUSSION) {
          setIsReplyToDiscussion(true)
        }
      }).catch(() => {
        // If we can't fetch the root event, assume it's not a discussion reply
        setIsReplyToDiscussion(false)
      })
    }
  }, [event.id, event.kind])

  const broadcastSubMenu: SubMenuAction[] = useMemo(() => {
    const items: SubMenuAction[] = []

    // All available relays (local, favorite, relay sets, default/fast) — success if at least 1 accepts
    if (allAvailableRelayUrls.length > 0) {
      items.push({
        label: <div className="text-left">{t('All available relays')} ({allAvailableRelayUrls.length})</div>,
        onClick: async () => {
          closeDrawer()
          const promise = client.publishEvent(allAvailableRelayUrls, event).then((result) => {
            if (result.successCount < 1) {
              throw new Error(t('No relay accepted the event'))
            }
            return result
          })
          toastPublishPromise(promise, {
            loading: t('Republishing...'),
            success: () => t('Successfully republish to all available relays'),
            error: (err) => t('Failed to republish to all available relays: {{error}}', { error: err.message })
          })
        }
      })
    }

    // All active relays (NIP-66 monitoring list); if none available, fallback to all available relays. Success: 5+ when using monitoring list, else 1+.
    const activeRelayCount =
      monitoringListRelayCount !== null
        ? (monitoringListRelayCount > 0 ? monitoringListRelayCount : allAvailableRelayUrls.length)
        : null
    items.push({
      label: (
        <div className="text-left">
          {t('All active relays (monitoring list)')}
          {activeRelayCount !== null && ` (${activeRelayCount})`}
        </div>
      ),
      onClick: async () => {
        closeDrawer()
        const promise = (async () => {
          let relays = await nip66Service.getPublicLivelyRelayUrls()
          const usedMonitoringList = !!relays?.length
          if (!relays?.length) {
            relays = allAvailableRelayUrls
          }
          if (!relays?.length) {
            throw new Error(t('No relays available'))
          }
          const result = await client.publishEvent(relays, event)
          const minRequired = usedMonitoringList ? 5 : 1
          if (result.successCount < minRequired) {
            throw new Error(
              usedMonitoringList
                ? t('Only {{count}} relay(s) accepted the event; at least 5 required for "all active relays".', { count: result.successCount })
                : t('No relay accepted the event')
            )
          }
          return result
        })()
        toastPublishPromise(promise, {
          loading: t('Republishing...'),
          success: () => t('Successfully republish to all active relays'),
          error: (err) => t('Failed to republish to all active relays: {{error}}', { error: err.message })
        })
      },
      separator: items.length > 0
    })

    if (pubkey && event.pubkey === pubkey) {
      items.push({
        label: <div className="text-left"> {t('Write relays')}</div>,
        separator: items.length > 0,
        onClick: async () => {
          closeDrawer()
          const promise = (async () => {
            const relays = await client.determineTargetRelays(event)
            if (!relays?.length) {
              throw new Error(t('No write relays configured'))
            }
            const result = await client.publishEvent(relays, event)
            if (result.successCount < 1) {
              throw new Error(t('No relay accepted the event'))
            }
            return result
          })()
          toastPublishPromise(promise, {
            loading: t('Republishing...'),
            success: () => t('Successfully republish to your write relays'),
            error: (err) => t('Failed to republish to your write relays: {{error}}', { error: err.message })
          })
        }
      })
    }

    if (relaySets.length) {
      items.push(
        ...relaySets
          .filter((set) => set.relayUrls.length)
          .map((set, index) => ({
            label: <div className="text-left truncate">{set.name}</div>,
            onClick: async () => {
              closeDrawer()
              const promise = client.publishEvent(set.relayUrls, event).then((result) => {
                if (result.successCount < 1) {
                  throw new Error(t('No relay accepted the event'))
                }
                return result
              })
              toastPublishPromise(promise, {
                loading: t('Republishing...'),
                success: () => t('Successfully republish to relay set: {{name}}', { name: set.name }),
                error: (err) => t('Failed to republish to relay set: {{name}}. Error: {{error}}', {
                  name: set.name,
                  error: err.message
                })
              })
            },
            separator: index === 0
          }))
      )
    }

    const wsAndHttpRelayUrls = Array.from(new Set([...relayUrls, ...httpWriteRelayUrls]))
    if (wsAndHttpRelayUrls.length) {
      items.push(
        ...wsAndHttpRelayUrls.map((relay, index) => ({
          label: (
            <div className="flex items-center gap-2 w-full">
              <RelayIcon url={relay} />
              <div className="flex-1 truncate text-left">{simplifyUrl(relay)}</div>
            </div>
          ),
          onClick: async () => {
            closeDrawer()
            const promise = client.publishEvent([relay], event).then((result) => {
              if (result.successCount < 1) {
                throw new Error(t('Relay did not accept the event'))
              }
              return result
            })
            toastPublishPromise(promise, {
              loading: t('Republishing...'),
              success: () => t('Successfully republish to relay: {{url}}', { url: simplifyUrl(relay) }),
              error: (err) => t('Failed to republish to relay: {{url}}. Error: {{error}}', {
                url: simplifyUrl(relay),
                error: err.message
              })
            })
          },
          separator: index === 0
        }))
      )
    }

    return items
  }, [pubkey, relayUrls, httpWriteRelayUrls, relaySets, allAvailableRelayUrls, monitoringListRelayCount, event, closeDrawer, t])

  // Check if this is an article-type event
  const isArticleType = useMemo(() => {
    return event.kind === kinds.LongFormArticle ||
           event.kind === ExtendedKind.WIKI_ARTICLE ||
           event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN ||
           event.kind === ExtendedKind.PUBLICATION ||
           event.kind === ExtendedKind.PUBLICATION_CONTENT
  }, [event.kind])

  // Get article metadata for export
  const articleMetadata = useMemo(() => {
    if (!isArticleType) return null
    return getLongFormArticleMetadataFromEvent(event)
  }, [isArticleType, event])

  const dTag = useMemo(() => {
    if (!isArticleType) return ''
    return event.tags.find(tag => tag[0] === 'd')?.[1] || ''
  }, [isArticleType, event])

  /** Decent Newsroom article URLs are scoped by author: /p/{npub}/d/{identifier} */
  const authorNpubForDecentNewsroom = useMemo(
    () => pubkeyToNpub(event.pubkey) ?? '',
    [event.pubkey]
  )

  // Generate naddr for Alexandria URL
  const naddr = useMemo(() => {
    if (!isArticleType || !dTag) return ''
    try {
      const relays = event.tags
        .filter(tag => tag[0] === 'relay')
        .map(tag => tag[1])
        .filter(Boolean)
      
      return nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
        relays: relays.length > 0 ? relays : undefined
      })
    } catch (error) {
      logger.error('Error generating naddr', { error })
      return ''
    }
  }, [isArticleType, event, dTag])

  const menuActions: MenuAction[] = useMemo(() => {
    const rebroadcastEntirePublication = (selectedRelayUrls: string[]) => {
      const rootPublication = event

      const promise = (async () => {
        if (rootPublication.kind !== ExtendedKind.PUBLICATION) {
          throw new Error(t('This action is only available for publications'))
        }
        if (selectedRelayUrls.length === 0) {
          throw new Error(t('No relays available'))
        }

        const MAX_NESTED_PUBLICATIONS = 128
        const MAX_TOTAL_REBROADCAST_EVENTS = 5000

        const collectedById = new Map<string, Event>()
        const visitedPublicationIds = new Set<string>()
        const queue: Event[] = [rootPublication]
        let traversedPublications = 0

        while (queue.length > 0) {
          const currentPublication = queue.shift()!
          if (visitedPublicationIds.has(currentPublication.id)) continue
          visitedPublicationIds.add(currentPublication.id)
          traversedPublications++
          collectedById.set(currentPublication.id, currentPublication)

          if (traversedPublications > MAX_NESTED_PUBLICATIONS) {
            logger.warn('[NoteOptions] Rebroadcast publication traversal capped', {
              rootId: rootPublication.id,
              cap: MAX_NESTED_PUBLICATIONS
            })
            break
          }

          const refs: PublicationSectionRef[] = []
          for (const tag of currentPublication.tags) {
            if (tag[0] === 'a' && tag[1]) {
              const parsed = parsePublicationATagCoordinate(tag[1])
              if (!parsed) continue
              refs.push({
                type: 'a',
                coordinate: parsed.coordinate,
                kind: parsed.kind,
                pubkey: parsed.pubkey,
                identifier: parsed.identifier,
                relay: tag[2]
              })
            } else if (tag[0] === 'e' && tag[1]) {
              refs.push({
                type: 'e',
                eventId: tag[1],
                relay: tag[2]
              })
            }
          }

          if (refs.length === 0) continue

          const primaryRelays = await buildPublicationSectionRelayUrls(currentPublication, refs, 40, false)
          const fallbackRelays = await buildPublicationSectionRelayUrls(currentPublication, refs, 80, true)
          const relays = [...new Set([...primaryRelays, ...fallbackRelays, ...selectedRelayUrls])]
          const resolved = await batchFetchPublicationSectionEvents(refs, relays)

          for (const ev of resolved.values()) {
            if (collectedById.size >= MAX_TOTAL_REBROADCAST_EVENTS) break
            collectedById.set(ev.id, ev)
            if (ev.kind === ExtendedKind.PUBLICATION && !visitedPublicationIds.has(ev.id)) {
              queue.push(ev)
            }
          }

          if (collectedById.size >= MAX_TOTAL_REBROADCAST_EVENTS) {
            logger.warn('[NoteOptions] Rebroadcast event collection capped', {
              rootId: rootPublication.id,
              cap: MAX_TOTAL_REBROADCAST_EVENTS
            })
            break
          }
        }

        const uniqueEvents = [...collectedById.values()]
        if (uniqueEvents.length === 0) {
          throw new Error(t('No publication events found for rebroadcast'))
        }

        const BATCH_SIZE = 6
        let acceptedEvents = 0
        let failedEvents = 0
        let acceptedRelayAcks = 0

        for (let i = 0; i < uniqueEvents.length; i += BATCH_SIZE) {
          const batch = uniqueEvents.slice(i, i + BATCH_SIZE)
          const batchResults = await Promise.allSettled(
            batch.map(async (ev) => {
              const result = await client.publishEvent(selectedRelayUrls, ev)
              if (result.successCount > 0) {
                acceptedEvents++
                acceptedRelayAcks += result.successCount
              } else {
                failedEvents++
              }
            })
          )
          for (const res of batchResults) {
            if (res.status === 'rejected') failedEvents++
          }
        }

        if (acceptedEvents < 1) {
          throw new Error(t('No publication events were accepted by any relay'))
        }

        return {
          acceptedEvents,
          failedEvents,
          totalEvents: uniqueEvents.length,
          acceptedRelayAcks,
          traversedPublications
        }
      })()

      toastPublishPromise(promise, {
        loading: t('Rebroadcasting entire publication...'),
        success: () => t('Rebroadcasted entire publication'),
        error: (err) => t('Failed to rebroadcast entire publication: {{error}}', { error: err.message })
      })
    }

    const publicationBroadcastSubMenu: SubMenuAction[] = []
    if (event.kind === ExtendedKind.PUBLICATION) {
      if (allAvailableRelayUrls.length > 0) {
        publicationBroadcastSubMenu.push({
          label: <div className="text-left">{t('All available relays')} ({allAvailableRelayUrls.length})</div>,
          onClick: () => {
            closeDrawer()
            rebroadcastEntirePublication(allAvailableRelayUrls)
          }
        })
      }

      const activeRelayCount =
        monitoringListRelayCount !== null
          ? (monitoringListRelayCount > 0 ? monitoringListRelayCount : allAvailableRelayUrls.length)
          : null
      publicationBroadcastSubMenu.push({
        label: (
          <div className="text-left">
            {t('All active relays (monitoring list)')}
            {activeRelayCount !== null && ` (${activeRelayCount})`}
          </div>
        ),
        separator: publicationBroadcastSubMenu.length > 0,
        onClick: () => {
          closeDrawer()
          const promise = (async () => {
            let relays = await nip66Service.getPublicLivelyRelayUrls()
            const usedMonitoringList = !!relays?.length
            if (!relays?.length) relays = allAvailableRelayUrls
            if (!relays?.length) throw new Error(t('No relays available'))
            rebroadcastEntirePublication(relays)
            return usedMonitoringList
          })()
          // Trigger async relay resolution immediately; rebroadcast handles its own toasts.
          void promise.catch((err) => {
            toast.error(t('Failed to rebroadcast entire publication: {{error}}', { error: err.message }))
          })
        }
      })

      if (pubkey && event.pubkey === pubkey) {
        publicationBroadcastSubMenu.push({
          label: <div className="text-left">{t('Write relays')}</div>,
          separator: publicationBroadcastSubMenu.length > 0,
          onClick: async () => {
            closeDrawer()
            try {
              const relays = await client.determineTargetRelays(event)
              if (!relays?.length) throw new Error(t('No write relays configured'))
              rebroadcastEntirePublication(relays)
            } catch (err) {
              toast.error(
                t('Failed to rebroadcast entire publication: {{error}}', {
                  error: (err as Error).message
                })
              )
            }
          }
        })
      }

      if (relaySets.length) {
        publicationBroadcastSubMenu.push(
          ...relaySets
            .filter((set) => set.relayUrls.length)
            .map((set, index) => ({
              label: <div className="text-left truncate">{set.name}</div>,
              separator: index === 0,
              onClick: () => {
                closeDrawer()
                rebroadcastEntirePublication(set.relayUrls)
              }
            }))
        )
      }

      if (relayUrls.length) {
        publicationBroadcastSubMenu.push(
          ...relayUrls.map((relay, index) => ({
            label: (
              <div className="flex items-center gap-2 w-full">
                <RelayIcon url={relay} />
                <div className="flex-1 truncate text-left">{simplifyUrl(relay)}</div>
              </div>
            ),
            separator: index === 0,
            onClick: () => {
              closeDrawer()
              rebroadcastEntirePublication([relay])
            }
          }))
        )
      }
    }

    // Export functions for articles
    const exportAsMarkdown = () => {
      if (!isArticleType) return
      
      try {
        const title = articleMetadata?.title || 'Article'
        const content = event.content
        const filename = `${title}.md`
        
        const blob = new Blob([content], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        logger.info('[NoteOptions] Exported article as Markdown')
        toast.success(t('Article exported as Markdown'))
      } catch (error) {
        logger.error('[NoteOptions] Error exporting article:', error)
        toast.error(t('Failed to export article'))
      }
    }

    const exportAsAsciidoc = async () => {
      if (!isArticleType) return
      
      try {
        const title = articleMetadata?.title || 'Article'
        let content = event.content
        let filename = `${title}.adoc`
        
        // For publications (30040), export all referenced sections
        if (event.kind === ExtendedKind.PUBLICATION) {
          const contentParts: string[] = []
          
          // Extract all 'a' tag references
          const aTags = event.tags.filter(tag => tag[0] === 'a' && tag[1])
          
          // Fetch all referenced events
          const fetchPromises = aTags.map(async (tag) => {
            try {
              const coordinate = tag[1]
              const [kindStr] = coordinate.split(':')
              const kind = parseInt(kindStr)
              
              if (isNaN(kind)) return null
              
              // Try to fetch the event
              const aTag = ['a', coordinate, tag[2] || '', tag[3] || '']
              const bech32Id = generateBech32IdFromATag(aTag)
              if (bech32Id) {
                const fetchedEvent = await eventService.fetchEvent(bech32Id)
                return fetchedEvent
              }
              return null
            } catch (error) {
              logger.warn('[NoteOptions] Error fetching referenced event for export:', error)
              return null
            }
          })
          
          const referencedEvents = (await Promise.all(fetchPromises)).filter((e): e is Event => e !== null)
          
          // Combine all events into one AsciiDoc document
          for (const refEvent of referencedEvents) {
            const refTitle = refEvent.tags.find(tag => tag[0] === 'title')?.[1] || 'Untitled'
            contentParts.push(`= ${refTitle}\n\n${refEvent.content}\n\n`)
          }
          
          if (contentParts.length > 0) {
            content = contentParts.join('\n')
          }
        }
        
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        logger.info('[NoteOptions] Exported article as AsciiDoc')
        toast.success(t('Article exported as AsciiDoc'))
      } catch (error) {
        logger.error('[NoteOptions] Error exporting article:', error)
        toast.error(t('Failed to export article'))
      }
    }

    // View on external sites functions
    const handleViewOnAlexandria = () => {
      if (!naddr) return
      closeDrawer()
      window.open(`https://next-alexandria.gitcitadel.eu/publication/naddr/${naddr}`, '_blank', 'noopener,noreferrer')
    }

    const handleViewOnDecentNewsroom = () => {
      if (!dTag || !authorNpubForDecentNewsroom) return
      closeDrawer()
      const p = encodeURIComponent(authorNpubForDecentNewsroom)
      const d = encodeURIComponent(dTag)
      window.open(`https://decentnewsroom.com/p/${p}/d/${d}`, '_blank', 'noopener,noreferrer')
    }
    const actions: MenuAction[] = [
      {
        icon: Copy,
        label: t('Copy event ID'),
        onClick: () => {
          navigator.clipboard.writeText(getNoteBech32Id(event))
          closeDrawer()
        }
      },
      {
        icon: Copy,
        label: t('Copy user ID'),
        onClick: () => {
          navigator.clipboard.writeText(pubkeyToNpub(event.pubkey) ?? '')
          closeDrawer()
        }
      },
      ...(READ_ALOUD_KINDS.includes(event.kind)
        ? [
            {
              icon: Volume2,
              label: t('Read this note aloud'),
              onClick: () => {
                closeDrawer()
                void speakNoteReadAloud(event).then((result) => {
                  if (result === 'unsupported') {
                    toast.error(t('Read-aloud is not supported in this browser'))
                  } else if (result === 'empty') {
                    toast.error(t('Nothing to read aloud'))
                  } else if (result === 'error') {
                    toast.error(t('Read-aloud failed'))
                  }
                })
              }
            } as MenuAction
          ]
        : []),
      ...(pubkey && event.pubkey !== pubkey && onOpenPublicMessage
        ? [
            {
              icon: MessageCircle,
              label: t('Send public message'),
              onClick: () => {
                closeDrawer()
                onOpenPublicMessage(event.pubkey)
              }
            } as MenuAction
          ]
        : []),
      {
        icon: Link,
        label: t('Share with Imwald'),
        onClick: () => {
          const noteId = getNoteBech32Id(event)
          // Contextual URL when on Spells (e.g. discussions faux-spell); plain /notes/{id} otherwise
          const path =
            currentPrimaryPage === 'spells'
              ? `/spells/notes/${noteId}`
              : currentPrimaryPage === 'rss'
                ? `/rss/notes/${noteId}`
                : currentPrimaryPage === 'follows-latest'
                  ? `/follows-latest/notes/${noteId}`
                  : `/notes/${noteId}`
          const appShareUrl = `https://jumble.imwald.eu${path}`
          navigator.clipboard.writeText(appShareUrl)
          closeDrawer()
        }
      },
      {
        icon: BookOpen,
        label: t('Share with Alexandria'),
        onClick: () => {
          navigator.clipboard.writeText(toAlexandria(getNoteBech32Id(event)))
          closeDrawer()
        }
      },
      {
        icon: Video,
        label: t('Start call about this'),
        separator: true,
        onClick: () => {
          closeDrawer()
          const roomId = `jumble-note-${event.id}`
          const displayName = pubkey ? (profile?.username ?? formatPubkey(pubkey)) : 'jumble'
          const url = buildHiveTalkJoinUrl({ room: roomId, name: displayName })
          window.open(url, '_blank', 'noopener,noreferrer')
        }
      },
      {
        icon: Copy,
        label: t('Copy call invite link'),
        onClick: () => {
          closeDrawer()
          const roomId = `jumble-note-${event.id}`
          const displayName = pubkey ? (profile?.username ?? formatPubkey(pubkey)) : 'jumble'
          const url = buildHiveTalkJoinUrl({ room: roomId, name: displayName })
          navigator.clipboard.writeText(url)
          toast.success(t('Copied to clipboard'))
        }
      },
      ...(onOpenCallInvite
        ? [
            {
              icon: Send,
              label: t('Send call invite'),
              onClick: () => {
                closeDrawer()
                const roomId = `jumble-note-${event.id}`
                const displayName = pubkey ? (profile?.username ?? formatPubkey(pubkey)) : 'jumble'
                const url = buildHiveTalkJoinUrl({ room: roomId, name: displayName })
                onOpenCallInvite(`${t('Join the video call')}: ${url}`)
              }
            } as MenuAction
          ]
        : [])
    ]

    // Add "View on Alexandria" menu item for public messages (PMs)
    if (event.kind === ExtendedKind.PUBLIC_MESSAGE) {
      actions.push({
        icon: Globe,
        label: t('View on Alexandria'),
        onClick: () => {
          closeDrawer()
          window.open('https://next-alexandria.gitcitadel.eu/profile/notifications', '_blank', 'noopener,noreferrer')
        },
        separator: true
      })
    }

    if (canSignEvents && pubkey && onOpenEditOrClone) {
      const isOwn = event.pubkey === pubkey
      actions.push({
        icon: isOwn ? PencilLine : GitFork,
        label: isOwn ? t('Edit this event') : t('Clone or fork this event'),
        onClick: () => {
          closeDrawer()
          onOpenEditOrClone(isOwn ? 'edit' : 'clone')
        },
        separator: true
      })
    }

    actions.push({
      icon: Code,
      label: t('View raw event'),
      onClick: () => {
        closeDrawer()
        setIsRawEventDialogOpen(true)
      },
      separator: true
    })

    // Add export options for article-type events
    if (isArticleType) {
      const isMarkdownFormat = event.kind === kinds.LongFormArticle || event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN
      const isAsciidocFormat = event.kind === ExtendedKind.WIKI_ARTICLE || event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT
      
      if (isMarkdownFormat) {
        actions.push({
          icon: FileDown,
          label: t('Export as Markdown'),
          onClick: () => {
            closeDrawer()
            exportAsMarkdown()
          },
          separator: true
        })
      }
      
      if (isAsciidocFormat) {
        actions.push({
          icon: FileDown,
          label: t('Export as AsciiDoc'),
          onClick: () => {
            closeDrawer()
            exportAsAsciidoc()
          },
          separator: true
        })
      }

      // Add view options based on event kind
      if (event.kind === kinds.LongFormArticle) {
        // For LongFormArticle (30023): Alexandria and DecentNewsroom
        if (naddr) {
          actions.push({
            icon: BookOpen,
            label: t('View on Alexandria'),
            onClick: handleViewOnAlexandria
          })
        }
        if (dTag && authorNpubForDecentNewsroom) {
          actions.push({
            icon: Globe,
            label: t('View on DecentNewsroom'),
            onClick: handleViewOnDecentNewsroom
          })
        }
      } else if (
        event.kind === ExtendedKind.PUBLICATION_CONTENT ||
        event.kind === ExtendedKind.PUBLICATION ||
        event.kind === ExtendedKind.WIKI_ARTICLE ||
        event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN
      ) {
        // For 30041, 30040, 30818, 30817: Alexandria
        if (naddr) {
          actions.push({
            icon: BookOpen,
            label: t('View on Alexandria'),
            onClick: handleViewOnAlexandria
          })
        }
      }

      if (event.kind === ExtendedKind.PUBLICATION) {
        actions.push({
          icon: SatelliteDish,
          label: t('Rebroadcast entire publication'),
          onClick: isSmallScreen
            ? () => showSubMenuActions(publicationBroadcastSubMenu, t('Rebroadcast entire publication to ...'))
            : undefined,
          subMenu: isSmallScreen ? undefined : publicationBroadcastSubMenu,
          separator: true
        })
      }
    }

    const isProtected = isProtectedEvent(event)
    const isDiscussion = event.kind === ExtendedKind.DISCUSSION
    if ((!isProtected || event.pubkey === pubkey) && !isDiscussion && !isReplyToDiscussion) {
      actions.push({
        icon: SatelliteDish,
        label: t('Republish to ...'),
        onClick: isSmallScreen
          ? () => showSubMenuActions(broadcastSubMenu, t('Republish to ...'))
          : undefined,
        subMenu: isSmallScreen ? undefined : broadcastSubMenu,
        separator: true
      })
    }

    if (pubkey && event.pubkey !== pubkey) {
      actions.push({
        icon: TriangleAlert,
        label: t('Report'),
        className: 'text-destructive focus:text-destructive',
        onClick: () => {
          closeDrawer()
          setIsReportDialogOpen(true)
        },
        separator: true
      })
    }

    if (pubkey && event.pubkey !== pubkey) {
      if (isMuted) {
        actions.push({
          icon: Bell,
          label: t('Unmute user'),
          onClick: () => {
            closeDrawer()
            unmutePubkey(event.pubkey)
          },
          className: 'text-destructive focus:text-destructive',
          separator: true
        })
      } else {
        actions.push(
          {
            icon: BellOff,
            label: t('Mute user privately'),
            onClick: () => {
              closeDrawer()
              mutePubkeyPrivately(event.pubkey)
            },
            className: 'text-destructive focus:text-destructive',
            separator: true
          },
          {
            icon: BellOff,
            label: t('Mute user publicly'),
            onClick: () => {
              closeDrawer()
              mutePubkeyPublicly(event.pubkey)
            },
            className: 'text-destructive focus:text-destructive'
          }
        )
      }
    }

    // Pin functionality available for any note (not just own notes)
    if (pubkey) {
      actions.push({
        icon: Pin,
        label: isPinned ? t('Unpin note') : t('Pin note'),
        onClick: () => {
          handlePinNote()
        },
        separator: true
      })
    }

    // Delete only when signed in as the author with a signing key (not read-only npub)
    if (canSignEvents && pubkey && event.pubkey === pubkey) {
      actions.push({
        icon: Trash2,
        label: t('Try deleting this note'),
        onClick: () => {
          closeDrawer()
          attemptDelete(event)
        },
        className: 'text-destructive focus:text-destructive'
      })
    }

    return actions
  }, [
    t,
    event,
    pubkey,
    isMuted,
    isSmallScreen,
    broadcastSubMenu,
    closeDrawer,
    showSubMenuActions,
    setIsRawEventDialogOpen,
    setIsReportDialogOpen,
    mutePubkeyPrivately,
    mutePubkeyPublicly,
    unmutePubkey,
    attemptDelete,
    isPinned,
    handlePinNote,
    isArticleType,
    articleMetadata,
    dTag,
    authorNpubForDecentNewsroom,
    naddr,
    onOpenPublicMessage,
    onOpenCallInvite,
    onOpenEditOrClone,
    canSignEvents,
    profile
  ])

  return menuActions
}
