import { ExtendedKind } from '@/constants'
import { getNoteBech32Id, isProtectedEvent, getRootEventHexId } from '@/lib/event'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNjump } from '@/lib/link'
import logger from '@/lib/logger'
import { pubkeyToNpub } from '@/lib/pubkey'
import { normalizeUrl, simplifyUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { BIG_RELAY_URLS, FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import client from '@/services/client.service'
import { Bell, BellOff, Code, Copy, Link, SatelliteDish, Trash2, TriangleAlert, Pin, FileDown, Globe, BookOpen, Highlighter } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import RelayIcon from '../RelayIcon'

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
  openHighlightEditor?: (highlightData: import('../PostEditor/HighlightEditor').HighlightData, eventContent?: string) => void
}

export function useMenuActions({
  event,
  closeDrawer,
  showSubMenuActions,
  setIsRawEventDialogOpen,
  setIsReportDialogOpen,
  isSmallScreen,
  openHighlightEditor
}: UseMenuActionsProps) {
  const { t } = useTranslation()
  const { pubkey, attemptDelete, publish } = useNostr()
  const { relayUrls: currentBrowsingRelayUrls } = useCurrentRelays()
  const { relaySets, favoriteRelays } = useFavoriteRelays()
  const relayUrls = useMemo(() => {
    return Array.from(new Set([
      ...currentBrowsingRelayUrls.map(url => normalizeUrl(url) || url),
      ...favoriteRelays.map(url => normalizeUrl(url) || url)
    ]))
  }, [currentBrowsingRelayUrls, favoriteRelays])
  const { mutePubkeyPublicly, mutePubkeyPrivately, unmutePubkey, mutePubkeySet } = useMuteList()
  const isMuted = useMemo(() => mutePubkeySet.has(event.pubkey), [mutePubkeySet, event])
  
  // Check if event is pinned
  const [isPinned, setIsPinned] = useState(false)
  
  useEffect(() => {
    const checkIfPinned = async () => {
      if (!pubkey) {
        setIsPinned(false)
        return
      }
      try {
        // Build comprehensive relay list for pin status check
        const allRelays = [
          ...(currentBrowsingRelayUrls || []),
          ...(favoriteRelays || []),
          ...BIG_RELAY_URLS,
          ...FAST_READ_RELAY_URLS,
          ...FAST_WRITE_RELAY_URLS
        ]
        
        const normalizedRelays = allRelays
          .map(url => normalizeUrl(url))
          .filter((url): url is string => !!url)
        
        const comprehensiveRelays = Array.from(new Set(normalizedRelays))
        
        // Try to fetch pin list event from comprehensive relay list first
        let pinListEvent = null
        try {
          const pinListEvents = await client.fetchEvents(comprehensiveRelays, {
            authors: [pubkey],
            kinds: [10001], // Pin list kind
            limit: 1
          })
          pinListEvent = pinListEvents[0] || null
        } catch (error) {
          logger.component('PinStatus', 'Error fetching pin list from comprehensive relays, falling back to default method', { error: (error as Error).message })
          pinListEvent = await client.fetchPinListEvent(pubkey)
        }
        
        if (pinListEvent) {
          const isEventPinned = pinListEvent.tags.some(tag => tag[0] === 'e' && tag[1] === event.id)
          setIsPinned(isEventPinned)
        }
      } catch (error) {
        logger.component('PinStatus', 'Error checking pin status', { error: (error as Error).message })
      }
    }
    checkIfPinned()
  }, [pubkey, event.id, currentBrowsingRelayUrls, favoriteRelays])
  
  const handlePinNote = async () => {
    if (!pubkey) return
    
    try {
      // Build comprehensive relay list for pin list fetching
      const allRelays = [
        ...(currentBrowsingRelayUrls || []),
        ...(favoriteRelays || []),
        ...BIG_RELAY_URLS,
        ...FAST_READ_RELAY_URLS,
        ...FAST_WRITE_RELAY_URLS
      ]
      
      const normalizedRelays = allRelays
        .map(url => normalizeUrl(url))
        .filter((url): url is string => !!url)
      
      const comprehensiveRelays = Array.from(new Set(normalizedRelays))
      
      // Try to fetch pin list event from comprehensive relay list first
      let pinListEvent = null
      try {
        const pinListEvents = await client.fetchEvents(comprehensiveRelays, {
          authors: [pubkey],
          kinds: [10001], // Pin list kind
          limit: 1
        })
        pinListEvent = pinListEvents[0] || null
      } catch (error) {
        logger.component('PinNote', 'Error fetching pin list from comprehensive relays, falling back to default method', { error: (error as Error).message })
        pinListEvent = await client.fetchPinListEvent(pubkey)
      }
      
      logger.component('PinNote', 'Current pin list event', { hasEvent: !!pinListEvent })
      
      // Get existing event IDs, excluding the one we're toggling
      const existingEventIds = (pinListEvent?.tags || [])
        .filter(tag => tag[0] === 'e' && tag[1])
        .map(tag => tag[1])
        .filter(id => id !== event.id)
      
      logger.component('PinNote', 'Existing event IDs (excluding current)', { count: existingEventIds.length })
      logger.component('PinNote', 'Current event ID', { eventId: event.id })
      logger.component('PinNote', 'Is currently pinned', { isPinned })
      
      let newTags: string[][]
      let successMessage: string
      
      if (isPinned) {
        // Unpin: just keep the existing tags without this event
        newTags = existingEventIds.map(id => ['e', id])
        successMessage = t('Note unpinned')
        logger.component('PinNote', 'Unpinning - new tags', { count: newTags.length })
      } else {
        // Pin: add this event to the existing list
        newTags = [...existingEventIds.map(id => ['e', id]), ['e', event.id]]
        successMessage = t('Note pinned')
        logger.component('PinNote', 'Pinning - new tags', { count: newTags.length })
      }
      
      // Create and publish the new pin list event
      logger.component('PinNote', 'Publishing new pin list event', { tagCount: newTags.length, relayCount: comprehensiveRelays.length })
      await publish({
        kind: 10001,
        tags: newTags,
        content: '',
        created_at: Math.floor(Date.now() / 1000)
      }, {
        specifiedRelayUrls: comprehensiveRelays
      })
      
      // Update local state - the publish will update the cache automatically
      setIsPinned(!isPinned)
      toast.success(successMessage)
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
      client.fetchEvent(rootEventId).then(rootEvent => {
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
    const items = []
    if (pubkey && event.pubkey === pubkey) {
      items.push({
        label: <div className="text-left"> {t('Write relays')}</div>,
        onClick: async () => {
          closeDrawer()
          const promise = async () => {
            const relays = await client.determineTargetRelays(event)
            if (relays?.length) {
              await client.publishEvent(relays, event)
            }
          }
          toast.promise(promise, {
            loading: t('Republishing...'),
            success: () => {
              return t('Successfully republish to your write relays')
            },
            error: (err) => {
              return t('Failed to republish to your write relays: {{error}}', {
                error: err.message
              })
            }
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
              const promise = client.publishEvent(set.relayUrls, event)
              toast.promise(promise, {
                loading: t('Republishing...'),
                success: () => {
                  return t('Successfully republish to relay set: {{name}}', { name: set.name })
                },
                error: (err) => {
                  return t('Failed to republish to relay set: {{name}}. Error: {{error}}', {
                    name: set.name,
                    error: err.message
                  })
                }
              })
            },
            separator: index === 0
          }))
      )
    }

    if (relayUrls.length) {
      items.push(
        ...relayUrls.map((relay, index) => ({
          label: (
            <div className="flex items-center gap-2 w-full">
              <RelayIcon url={relay} />
              <div className="flex-1 truncate text-left">{simplifyUrl(relay)}</div>
            </div>
          ),
          onClick: async () => {
            closeDrawer()
            const promise = client.publishEvent([relay], event)
            toast.promise(promise, {
              loading: t('Republishing...'),
              success: () => {
                return t('Successfully republish to relay: {{url}}', { url: simplifyUrl(relay) })
              },
              error: (err) => {
                return t('Failed to republish to relay: {{url}}. Error: {{error}}', {
                  url: simplifyUrl(relay),
                  error: err.message
                })
              }
            })
          },
          separator: index === 0
        }))
      )
    }

    return items
  }, [pubkey, relayUrls, relaySets])

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

  // Extract d-tag for Wikistr URL
  const dTag = useMemo(() => {
    if (!isArticleType) return ''
    return event.tags.find(tag => tag[0] === 'd')?.[1] || ''
  }, [isArticleType, event])

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

  // Check if this is an OP event that can be highlighted
  const isOPEvent = useMemo(() => {
    return (
      event.kind === kinds.ShortTextNote || // 1
      event.kind === kinds.LongFormArticle || // 30023
      event.kind === ExtendedKind.WIKI_ARTICLE || // 30818
      event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN || // 30817
      event.kind === ExtendedKind.PUBLICATION || // 30040
      event.kind === ExtendedKind.PUBLICATION_CONTENT || // 30041
      event.kind === ExtendedKind.DISCUSSION || // 11
      event.kind === ExtendedKind.COMMENT || // 1111
      (event.kind === kinds.Zap && (event.tags.some(tag => tag[0] === 'e') || event.tags.some(tag => tag[0] === 'a'))) // Zap receipt
    )
  }, [event.kind, event.tags])

  const menuActions: MenuAction[] = useMemo(() => {
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

    const exportAsAsciidoc = () => {
      if (!isArticleType) return
      
      try {
        const title = articleMetadata?.title || 'Article'
        const content = event.content
        const filename = `${title}.adoc`
        
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
    const handleViewOnWikistr = () => {
      if (!dTag) return
      closeDrawer()
      window.open(`https://wikistr.imwald.eu/${dTag}*${event.pubkey}`, '_blank', 'noopener,noreferrer')
    }

    const handleViewOnAlexandria = () => {
      if (!naddr) return
      closeDrawer()
      window.open(`https://next-alexandria.gitcitadel.eu/publication/naddr/${naddr}`, '_blank', 'noopener,noreferrer')
    }

    const handleViewOnDecentNewsroom = () => {
      if (!dTag) return
      closeDrawer()
      window.open(`https://decentnewsroom.com/article/d/${dTag}`, '_blank', 'noopener,noreferrer')
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
      {
        icon: Link,
        label: t('Copy share link'),
        onClick: () => {
          navigator.clipboard.writeText(toNjump(getNoteBech32Id(event)))
          closeDrawer()
        }
      }
    ]

    // Add "Create Highlight" action for OP events
    if (isOPEvent && openHighlightEditor) {
      actions.push({
        icon: Highlighter,
        label: t('Create Highlight'),
        onClick: () => {
          try {
            // Get selected text and paragraph context
            const selection = window.getSelection()
            let selectedText = ''
            let paragraphContext = ''
            
            if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
              // Get the selected text
              selectedText = selection.toString().trim()
              
              // Find the paragraph element containing the selection
              const range = selection.getRangeAt(0)
              let container = range.commonAncestorContainer
              
              // Walk up the DOM tree to find a paragraph element
              while (container && container.nodeType !== Node.ELEMENT_NODE) {
                container = container.parentNode
              }
              
              let paragraphElement: Element | null = null
              if (container) {
                let current: Element | null = container as Element
                while (current) {
                  // Check if it's a paragraph or a div that might contain paragraph content
                  const tagName = current.tagName?.toLowerCase()
                  // Look for paragraph tags, or divs/articles that contain the selection
                  // Also check for common markdown/article container classes
                  if (tagName === 'p') {
                    // Found a paragraph tag - this is ideal
                    if (current.contains(range.startContainer) && current.contains(range.endContainer)) {
                      paragraphElement = current
                      break
                    }
                  } else if (tagName === 'div' || tagName === 'article' || tagName === 'section') {
                    // Check if this div/article/section contains the selection
                    // and doesn't have nested paragraph-like structures
                    if (current.contains(range.startContainer) && current.contains(range.endContainer)) {
                      // Check if this element has direct paragraph children
                      const hasParagraphChildren = Array.from(current.children).some(
                        child => child.tagName?.toLowerCase() === 'p'
                      )
                      // If it doesn't have paragraph children, it might be a paragraph container itself
                      if (!hasParagraphChildren || !paragraphElement) {
                        paragraphElement = current
                        // Don't break here - continue looking for a p tag
                      }
                    }
                  }
                  current = current.parentElement
                }
              }
              
              // If we found a paragraph element, get its text content
              if (paragraphElement) {
                paragraphContext = paragraphElement.textContent?.trim() || ''
              } else {
                // Fallback: try to get text from a larger context around the selection
                // Clone the range and expand it to include surrounding text
                const expandedRange = range.cloneRange()
                const startContainer = range.startContainer
                const endContainer = range.endContainer
                
                // Try to expand backwards to find sentence/paragraph boundaries
                if (startContainer.nodeType === Node.TEXT_NODE && startContainer.textContent) {
                  const textBefore = startContainer.textContent.substring(0, range.startOffset)
                  // Look for paragraph breaks (double newlines) or sentence endings
                  const lastParagraphBreak = textBefore.lastIndexOf('\n\n')
                  const lastSentenceEnd = Math.max(
                    textBefore.lastIndexOf('. '),
                    textBefore.lastIndexOf('.\n'),
                    textBefore.lastIndexOf('! '),
                    textBefore.lastIndexOf('?\n')
                  )
                  if (lastParagraphBreak > 0) {
                    expandedRange.setStart(startContainer, lastParagraphBreak + 2)
                  } else if (lastSentenceEnd > 0) {
                    expandedRange.setStart(startContainer, lastSentenceEnd + 2)
                  } else {
                    expandedRange.setStart(startContainer, 0)
                  }
                }
                
                // Try to expand forwards
                if (endContainer.nodeType === Node.TEXT_NODE && endContainer.textContent) {
                  const textAfter = endContainer.textContent.substring(range.endOffset)
                  const nextParagraphBreak = textAfter.indexOf('\n\n')
                  const nextSentenceEnd = Math.min(
                    textAfter.indexOf('. ') !== -1 ? textAfter.indexOf('. ') + 2 : Infinity,
                    textAfter.indexOf('.\n') !== -1 ? textAfter.indexOf('.\n') + 2 : Infinity,
                    textAfter.indexOf('! ') !== -1 ? textAfter.indexOf('! ') + 2 : Infinity,
                    textAfter.indexOf('?\n') !== -1 ? textAfter.indexOf('?\n') + 2 : Infinity
                  )
                  if (nextParagraphBreak !== -1 && nextParagraphBreak < nextSentenceEnd) {
                    expandedRange.setEnd(endContainer, range.endOffset + nextParagraphBreak)
                  } else if (nextSentenceEnd < Infinity) {
                    expandedRange.setEnd(endContainer, range.endOffset + nextSentenceEnd)
                  } else {
                    expandedRange.setEnd(endContainer, endContainer.textContent.length)
                  }
                }
                
                paragraphContext = expandedRange.toString().trim()
              }
            }
            
            // For addressable events (publications, long-form articles with d-tag), use naddr
            // For regular events, use nevent
            let sourceValue: string
            let sourceHexId: string | undefined
            
            if (kinds.isAddressableKind(event.kind) || kinds.isReplaceableKind(event.kind)) {
              // Generate naddr for addressable/replaceable events
              const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || ''
              if (dTag) {
                const relays = event.tags
                  .filter(tag => tag[0] === 'relay')
                  .map(tag => tag[1])
                  .filter(Boolean)
                
                try {
                  sourceValue = nip19.naddrEncode({
                    kind: event.kind,
                    pubkey: event.pubkey,
                    identifier: dTag,
                    relays: relays.length > 0 ? relays : undefined
                  })
                  sourceHexId = undefined // naddr doesn't have a single hex ID
                } catch (error) {
                  logger.error('Error generating naddr for highlight', { error })
                  // Fallback to nevent
                  sourceValue = getNoteBech32Id(event)
                  sourceHexId = event.id
                }
              } else {
                // No d-tag, use nevent
                sourceValue = getNoteBech32Id(event)
                sourceHexId = event.id
              }
            } else {
              // Regular event, use nevent
              sourceValue = getNoteBech32Id(event)
              sourceHexId = event.id
            }
            
            const highlightData: import('../PostEditor/HighlightEditor').HighlightData = {
              sourceType: 'nostr',
              sourceValue,
              sourceHexId,
              context: paragraphContext || undefined
            }
            
            // Use selected text as content if available, otherwise use event content
            const content = selectedText || event.content
            openHighlightEditor(highlightData, content)
          } catch (error) {
            logger.error('Error creating highlight from event', { error, eventId: event.id })
            toast.error(t('Failed to create highlight'))
          }
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
        if (dTag) {
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
        // For 30041, 30040, 30818, 30817: Alexandria and Wikistr
        if (naddr) {
          actions.push({
            icon: BookOpen,
            label: t('View on Alexandria'),
            onClick: handleViewOnAlexandria
          })
        }
        if (dTag) {
          actions.push({
            icon: Globe,
            label: t('View on Wikistr'),
            onClick: handleViewOnWikistr
          })
        }
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

    // Delete functionality only available for own notes
    if (pubkey && event.pubkey === pubkey) {
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
    openHighlightEditor,
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
    naddr
  ])

  return menuActions
}
