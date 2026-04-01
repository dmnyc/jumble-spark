import LoginDialog from '@/components/LoginDialog'
import NcryptsecPasswordPrompt from '@/components/NcryptsecPasswordPrompt'
import {
  ACCOUNT_SESSION_NETWORK_HYDRATE_MIN_INTERVAL_MS,
  DEFAULT_FAVORITE_RELAYS,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  ExtendedKind,
  PROFILE_FETCH_RELAY_URLS,
  PROFILE_RELAY_URLS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import {
  buildAltTag,
  buildClientTag,
  createDeletionRequestDraftEvent,
  createFollowListDraftEvent,
  createMuteListDraftEvent,
  createRelayListDraftEvent
} from '@/lib/draft-event'
import { getLatestEvent, minePow } from '@/lib/event'
import { getHttpRelayListFromEvent, getProfileFromEvent, getRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { normalizeHttpRelayUrl, normalizeUrl } from '@/lib/url'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import client from '@/services/client.service'
import { queryService, replaceableEventService } from '@/services/client.service'
import customEmojiService from '@/services/custom-emoji.service'
import indexedDb from '@/services/indexed-db.service'
import postEditorCache from '@/services/post-editor-cache.service'
import storage from '@/services/local-storage.service'
import noteStatsService from '@/services/note-stats.service'
import {
  ISigner,
  TAccount,
  TAccountPointer,
  TDraftEvent,
  TProfile,
  TPublishOptions,
  TRelayList,
  TMailboxRelay
} from '@/types'
import { hexToBytes } from '@noble/hashes/utils'
import dayjs from 'dayjs'
import { Event, kinds, VerifiedEvent, validateEvent } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import * as nip49 from 'nostr-tools/nip49'
import { NostrContext } from '@/providers/nostr-context'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BunkerSigner } from './bunker.signer'
import { Nip07Signer } from './nip-07.signer'
import { NostrConnectionSigner } from './nostrConnection.signer'
import { NpubSigner } from './npub.signer'
import { NsecSigner } from './nsec.signer'

export { useNostr } from '@/providers/nostr-context'
export type { TNostrContext } from '@/providers/nostr-context'

/** Kind 10012 `relay` tags for publish / target-relay prioritization. */
function favoriteRelayUrlsForPublish(favoriteRelaysEvent: Event | null, pubkey: string | null): string[] {
  if (!favoriteRelaysEvent) {
    return pubkey ? [...DEFAULT_FAVORITE_RELAYS] : []
  }
  const urls: string[] = []
  favoriteRelaysEvent.tags.forEach(([name, v]) => {
    if (name === 'relay' && v) {
      const n = normalizeUrl(v) || v
      if (n && !urls.includes(n)) urls.push(n)
    }
  })
  return urls.length > 0 ? urls : pubkey ? [...DEFAULT_FAVORITE_RELAYS] : []
}

function blockedRelayUrlsFromEvent(blockedRelaysEvent: Event | null): string[] {
  const out: string[] = []
  if (!blockedRelaysEvent) return out
  blockedRelaysEvent.tags.forEach(([tagName, tagValue]) => {
    if (tagName === 'relay' && tagValue) {
      const n = normalizeUrl(tagValue)
      if (n && !out.includes(n)) out.push(n)
    }
  })
  return out
}

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<TAccountPointer[]>(
    storage.getAccounts().map((act) => ({ pubkey: act.pubkey, signerType: act.signerType }))
  )
  const [account, setAccount] = useState<TAccountPointer | null>(null)
  const [nsec, setNsec] = useState<string | null>(null)
  const [ncryptsec, setNcryptsec] = useState<string | null>(null)
  const [signer, setSigner] = useState<ISigner | null>(null)
  const [openLoginDialog, setOpenLoginDialog] = useState(false)
  const [ncryptsecPasswordOpen, setNcryptsecPasswordOpen] = useState(false)
  const ncryptsecPasswordResolveRef = useRef<((value: string | null) => void) | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)

  // Cleanup on page unload to prevent extension UI issues
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Try to clean up any pending operations
      if (signer && 'disconnect' in signer) {
        try {
          (signer as any).disconnect()
        } catch (error) {
          logger.warn('Failed to disconnect signer:', error)
        }
      }
    }

    const handleUnload = () => {
      // Additional cleanup for extensions that might leave UI elements
      try {
        // Clear any pending timeouts or intervals
        if (window.nostr && typeof window.nostr === 'object') {
          // Some extensions might have cleanup methods
          if ('cleanup' in window.nostr && typeof window.nostr.cleanup === 'function') {
            window.nostr.cleanup()
          }
        }
      } catch (error) {
        logger.warn('Extension cleanup failed:', error)
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('unload', handleUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('unload', handleUnload)
    }
  }, [signer])
  const [profileEvent, setProfileEvent] = useState<Event | null>(null)
  const [relayList, setRelayList] = useState<TRelayList | null>(null)
  const [cacheRelayListEvent, setCacheRelayListEvent] = useState<Event | null>(null)
  const [httpRelayListEvent, setHttpRelayListEvent] = useState<Event | null | undefined>(undefined)
  const [followListEvent, setFollowListEvent] = useState<Event | null>(null)
  const [muteListEvent, setMuteListEvent] = useState<Event | null>(null)
  const [bookmarkListEvent, setBookmarkListEvent] = useState<Event | null>(null)
  const [interestListEvent, setInterestListEvent] = useState<Event | null>(null)
  const [favoriteRelaysEvent, setFavoriteRelaysEvent] = useState<Event | null>(null)
  const [blockedRelaysEvent, setBlockedRelaysEvent] = useState<Event | null>(null)
  const [userEmojiListEvent, setUserEmojiListEvent] = useState<Event | null>(null)
  const [rssFeedListEvent, setRssFeedListEvent] = useState<Event | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isAccountSessionHydrating, setIsAccountSessionHydrating] = useState(false)
  /** Bumps on each account hydration run so stale async completions cannot clear {@link isAccountSessionHydrating}. */
  const accountHydrationGenerationRef = useRef(0)
  /** When true, next hydrate run performs a full network merge without clearing UI state from IndexedDB first. */
  const forceNextAccountNetworkHydrateRef = useRef(false)
  const manualNetworkHydrateResolveRef = useRef<(() => void) | null>(null)
  const [accountNetworkHydrateBump, setAccountNetworkHydrateBump] = useState(0)

  useEffect(() => {
    const init = async () => {
      logger.info('[NostrProvider] Restoring session (login / first account)…')
      if (hasNostrLoginHash()) {
        return await loginByNostrLoginHash()
      }

      const accounts = storage.getAccounts()
      const act = storage.getCurrentAccount() ?? accounts[0] // auto login the first account
      if (!act) return

      await loginWithAccountPointer(act)
    }
    init()
      .then(() => {
        logger.info('[NostrProvider] Session restore finished; feeds and UI can initialize')
        setIsInitialized(true)
      })
      .catch((e) => {
        logger.error('[NostrProvider] Session restore failed', { error: e })
        setIsInitialized(true)
      })

    const handleHashChange = () => {
      if (hasNostrLoginHash()) {
        loginByNostrLoginHash()
      }
    }

    window.addEventListener('hashchange', handleHashChange)

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  /** Logged-out: run IndexedDB + NIP-66 prewarm once session gate opens (logged-in path includes this inside hydrate). */
  useEffect(() => {
    if (!isInitialized || account) return
    void client.runSessionPrewarm({ pubkey: null })
  }, [isInitialized, account])

  useEffect(() => {
    let hydrationGenForThisRun = -1
    const init = async () => {
      if (!account) {
        accountHydrationGenerationRef.current += 1
        setIsAccountSessionHydrating(false)
        forceNextAccountNetworkHydrateRef.current = false
        setRelayList(null)
        setProfile(null)
        setProfileEvent(null)
        setNsec(null)
        setFavoriteRelaysEvent(null)
        setFollowListEvent(null)
        setMuteListEvent(null)
        setBookmarkListEvent(null)
        setRssFeedListEvent(null)
        setCacheRelayListEvent(null)
        setHttpRelayListEvent(undefined)
        return undefined
      }

      const userForcedAccountNetworkHydrate = forceNextAccountNetworkHydrateRef.current
      if (userForcedAccountNetworkHydrate) {
        forceNextAccountNetworkHydrateRef.current = false
      }

      if (!userForcedAccountNetworkHydrate) {
        setRelayList(null)
        setProfile(null)
        setProfileEvent(null)
        setNsec(null)
        setFavoriteRelaysEvent(null)
        setFollowListEvent(null)
        setMuteListEvent(null)
        setBookmarkListEvent(null)
        setRssFeedListEvent(null)
        setHttpRelayListEvent(undefined)
      }

      hydrationGenForThisRun = accountHydrationGenerationRef.current += 1
      setIsAccountSessionHydrating(true)
      logger.info('[NostrProvider] Account session hydrate: loading cache and relays…', {
        pubkeySlice: account.pubkey.slice(0, 12),
        hydrationGen: hydrationGenForThisRun
      })
      const controller = new AbortController()
      const storedNsec = storage.getAccountNsec(account.pubkey)
      if (storedNsec) {
        setNsec(storedNsec)
      } else {
        setNsec(null)
      }
      const storedNcryptsec = storage.getAccountNcryptsec(account.pubkey)
      if (storedNcryptsec) {
        setNcryptsec(storedNcryptsec)
      } else {
        setNcryptsec(null)
      }

      const INTEREST_LIST_KIND = 10015

      const [
        storedRelayListEvent,
        storedCacheRelayListEvent,
        storedProfileEvent,
        storedFollowListEvent,
        storedMuteListEvent,
        storedBookmarkListEvent,
        storedFavoriteRelaysEvent,
        storedBlockedRelaysEvent,
        storedUserEmojiListEvent,
        storedRssFeedListEvent,
        storedInterestListEvent,
        storedBlossomServerListEvent,
        storedHttpRelayListEvent
      ] = await Promise.all([
        indexedDb.getReplaceableEvent(account.pubkey, kinds.RelayList),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.CACHE_RELAYS),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.Metadata),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.Contacts),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.Mutelist),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.BookmarkList),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.FAVORITE_RELAYS),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.BLOCKED_RELAYS),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.UserEmojiList),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.RSS_FEED_LIST),
        indexedDb.getReplaceableEvent(account.pubkey, INTEREST_LIST_KIND),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.BLOSSOM_SERVER_LIST),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.HTTP_RELAY_LIST)
      ])
      
      // Extract blocked relays from event
      const blockedRelays: string[] = []
      if (storedBlockedRelaysEvent) {
        storedBlockedRelaysEvent.tags.forEach(([tagName, tagValue]) => {
          if (tagName === 'relay' && tagValue) {
            const normalizedUrl = normalizeUrl(tagValue)
            if (normalizedUrl && !blockedRelays.includes(normalizedUrl)) {
              blockedRelays.push(normalizedUrl)
            }
          }
        })
        if (!userForcedAccountNetworkHydrate) {
          setBlockedRelaysEvent(storedBlockedRelaysEvent)
        }
      }
      
      // Set initial relay list from stored events (will be updated with merged list later)
      // Merge cache relays even at initial load so cache relays are available immediately
      if (
        !userForcedAccountNetworkHydrate &&
        (storedRelayListEvent || storedCacheRelayListEvent || storedHttpRelayListEvent)
      ) {
        const emptyHttp = {
          httpRead: [] as string[],
          httpWrite: [] as string[],
          httpOriginalRelays: [] as TMailboxRelay[]
        }
        let baseRelayList: TRelayList = storedRelayListEvent
          ? getRelayListFromEvent(storedRelayListEvent, blockedRelays)
          : { write: [], read: [], originalRelays: [], ...emptyHttp }
        const httpSlice = getHttpRelayListFromEvent(storedHttpRelayListEvent, blockedRelays)
        baseRelayList = {
          ...baseRelayList,
          httpRead: httpSlice.httpRead,
          httpWrite: httpSlice.httpWrite,
          httpOriginalRelays: httpSlice.httpOriginalRelays
        }

        if (storedCacheRelayListEvent) {
          const cacheRelayList = getRelayListFromEvent(storedCacheRelayListEvent)

          const mergedRead = [...cacheRelayList.read, ...baseRelayList.read]
          const mergedWrite = [...cacheRelayList.write, ...baseRelayList.write]
          const mergedOriginalRelays = new Map<string, TMailboxRelay>()

          cacheRelayList.originalRelays.forEach((relay) => {
            mergedOriginalRelays.set(relay.url, relay)
          })
          baseRelayList.originalRelays.forEach((relay) => {
            if (!mergedOriginalRelays.has(relay.url)) {
              mergedOriginalRelays.set(relay.url, relay)
            }
          })

          setRelayList({
            write: Array.from(new Set(mergedWrite)),
            read: Array.from(new Set(mergedRead)),
            originalRelays: Array.from(mergedOriginalRelays.values()),
            httpRead: baseRelayList.httpRead,
            httpWrite: baseRelayList.httpWrite,
            httpOriginalRelays: baseRelayList.httpOriginalRelays
          })
        } else {
          setRelayList(baseRelayList)
        }
      }
      if (!userForcedAccountNetworkHydrate) {
        if (storedProfileEvent) {
          setProfileEvent(storedProfileEvent)
          setProfile(getProfileFromEvent(storedProfileEvent))
        }
        if (storedFollowListEvent) {
          setFollowListEvent(storedFollowListEvent)
        }
        if (storedMuteListEvent) {
          setMuteListEvent(storedMuteListEvent)
        }
        if (storedBookmarkListEvent) {
          setBookmarkListEvent(storedBookmarkListEvent)
        }
        if (storedFavoriteRelaysEvent) {
          setFavoriteRelaysEvent(storedFavoriteRelaysEvent)
        }
        if (storedUserEmojiListEvent) {
          setUserEmojiListEvent(storedUserEmojiListEvent)
        }
        if (storedRssFeedListEvent) {
          setRssFeedListEvent(storedRssFeedListEvent)
          logger.debug('[NostrProvider] Loaded RSS feed list event from cache', {
            eventId: storedRssFeedListEvent.id,
            created_at: storedRssFeedListEvent.created_at
          })
        }
        if (storedInterestListEvent) {
          setInterestListEvent(storedInterestListEvent)
        }
        if (storedBlossomServerListEvent) {
          void client.updateBlossomServerListEventCache(storedBlossomServerListEvent)
        }
        setHttpRelayListEvent(storedHttpRelayListEvent ?? null)
      }

      const lastNetworkHydrateAt = storage.getAccountNetworkHydrateAt(account.pubkey)
      const hasLocalRelayAndProfile = !!storedRelayListEvent && !!storedProfileEvent
      const skipNetworkHydrate =
        !userForcedAccountNetworkHydrate &&
        hasLocalRelayAndProfile &&
        typeof lastNetworkHydrateAt === 'number' &&
        Date.now() - lastNetworkHydrateAt < ACCOUNT_SESSION_NETWORK_HYDRATE_MIN_INTERVAL_MS

      if (!skipNetworkHydrate) {
        // Fetch RSS feed list from relays if cache is missing or stale (older than 1 hour)
        const rssFeedListStale =
          !storedRssFeedListEvent ||
          dayjs().unix() - storedRssFeedListEvent.created_at > 3600 // 1 hour

        if (rssFeedListStale) {
          logger.debug('[NostrProvider] RSS feed list cache is missing or stale, fetching from relays', {
            hasCache: !!storedRssFeedListEvent,
            cacheAge: storedRssFeedListEvent ? dayjs().unix() - storedRssFeedListEvent.created_at : 'N/A'
          })

          queryService
            .fetchEvents(FAST_WRITE_RELAY_URLS.concat(PROFILE_RELAY_URLS), {
              kinds: [ExtendedKind.RSS_FEED_LIST],
              authors: [account.pubkey],
              limit: 1
            })
            .then((events) => {
              const latestEvent = getLatestEvent(events)
              if (latestEvent) {
                if (!storedRssFeedListEvent || latestEvent.created_at > storedRssFeedListEvent.created_at) {
                  logger.debug('[NostrProvider] Found newer RSS feed list event from relays', {
                    eventId: latestEvent.id,
                    created_at: latestEvent.created_at,
                    wasCached: !!storedRssFeedListEvent
                  })
                  indexedDb
                    .putReplaceableEvent(latestEvent)
                    .then(() => {
                      setRssFeedListEvent(latestEvent)
                      logger.debug('[NostrProvider] Updated RSS feed list event in cache and state')
                    })
                    .catch((err) => {
                      logger.error('[NostrProvider] Failed to cache RSS feed list event', { error: err })
                    })
                } else {
                  logger.debug('[NostrProvider] Cached RSS feed list event is up to date', {
                    cachedCreatedAt: storedRssFeedListEvent.created_at,
                    fetchedCreatedAt: latestEvent.created_at
                  })
                }
              } else if (!storedRssFeedListEvent) {
                logger.debug(
                  '[NostrProvider] No RSS feed list event found on relays (user may not have created one yet)'
                )
              }
            })
            .catch((err) => {
              logger.error('[NostrProvider] Failed to fetch RSS feed list from relays', { error: err })
            })
        } else {
          logger.debug('[NostrProvider] RSS feed list cache is fresh, using cached value')
        }

        const [relayListEvents, cacheRelayListEvents, httpRelayListEvents] = await Promise.all([
        queryService.fetchEvents(FAST_READ_RELAY_URLS, {
          kinds: [kinds.RelayList],
          authors: [account.pubkey]
        }),
        queryService.fetchEvents(FAST_READ_RELAY_URLS, {
          kinds: [ExtendedKind.CACHE_RELAYS],
          authors: [account.pubkey]
        }),
        queryService.fetchEvents(FAST_READ_RELAY_URLS, {
          kinds: [ExtendedKind.HTTP_RELAY_LIST],
          authors: [account.pubkey],
          limit: 1
        })
      ])
      const relayListEvent = getLatestEvent(relayListEvents) ?? storedRelayListEvent
      const cacheRelayListEvent = getLatestEvent(cacheRelayListEvents) ?? storedCacheRelayListEvent
      const httpRelayListEventFetched = getLatestEvent(httpRelayListEvents) ?? storedHttpRelayListEvent ?? null
      if (relayListEvent) {
        client.updateRelayListCache(relayListEvent)
        await indexedDb.putReplaceableEvent(relayListEvent)
      }
      if (cacheRelayListEvent) {
        await indexedDb.putReplaceableEvent(cacheRelayListEvent)
        setCacheRelayListEvent(cacheRelayListEvent)
      } else {
        setCacheRelayListEvent(null)
      }
      if (httpRelayListEventFetched) {
        await indexedDb.putReplaceableEvent(httpRelayListEventFetched)
        setHttpRelayListEvent(httpRelayListEventFetched)
      } else {
        setHttpRelayListEvent(null)
      }
      // Fetch updated relay list (merges 10002, 10432, 10243)
      const mergedRelayList = await client.fetchRelayList(account.pubkey) // Keep using client for relay list merging
      setRelayList(mergedRelayList)

      const normalizedRelays = [
        ...mergedRelayList.write.map((url: string) => normalizeUrl(url) || url),
        ...mergedRelayList.read.map((url: string) => normalizeUrl(url) || url),
        ...mergedRelayList.httpRead.map((url: string) => normalizeHttpRelayUrl(url) || url),
        ...mergedRelayList.httpWrite.map((url: string) => normalizeHttpRelayUrl(url) || url),
        ...FAST_WRITE_RELAY_URLS.map((url: string) => normalizeUrl(url) || url),
        ...PROFILE_FETCH_RELAY_URLS.map((url: string) => normalizeUrl(url) || url)
      ]
      const fetchRelays = Array.from(new Set(normalizedRelays)).slice(0, 16)
      const events = await queryService.fetchEvents(fetchRelays, [
        {
          kinds: [
            kinds.Metadata,
            kinds.Contacts,
            kinds.Mutelist,
            kinds.BookmarkList,
            INTEREST_LIST_KIND,
            ExtendedKind.FAVORITE_RELAYS,
            ExtendedKind.BLOCKED_RELAYS,
            ExtendedKind.BLOSSOM_SERVER_LIST,
            kinds.UserEmojiList
          ],
          authors: [account.pubkey]
        }
      ])
      const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
      const profileEvent = sortedEvents.find((e) => e.kind === kinds.Metadata)
      const followListEvent = sortedEvents.find((e) => e.kind === kinds.Contacts)
      const muteListEvent = sortedEvents.find((e) => e.kind === kinds.Mutelist)
      const bookmarkListEvent = sortedEvents.find((e) => e.kind === kinds.BookmarkList)
      const interestListEvent = sortedEvents.find((e) => e.kind === INTEREST_LIST_KIND)
      const favoriteRelaysEvent = sortedEvents.find((e) => e.kind === ExtendedKind.FAVORITE_RELAYS)
      const blockedRelaysEvent = sortedEvents.find((e) => e.kind === ExtendedKind.BLOCKED_RELAYS)
      const blossomServerListEvent = sortedEvents.find(
        (e) => e.kind === ExtendedKind.BLOSSOM_SERVER_LIST
      )
      const userEmojiListEvent = sortedEvents.find((e) => e.kind === kinds.UserEmojiList)
      if (profileEvent) {
        const updatedProfileEvent = await indexedDb.putReplaceableEvent(profileEvent)
        if (updatedProfileEvent.id === profileEvent.id) {
          // Update in-memory cache so it's immediately available
          await replaceableEventService.updateReplaceableEventCache(updatedProfileEvent)
          setProfileEvent(updatedProfileEvent)
          setProfile(getProfileFromEvent(updatedProfileEvent))
        }
      } else if (!storedProfileEvent) {
        setProfile({
          pubkey: account.pubkey,
          npub: pubkeyToNpub(account.pubkey) ?? '',
          username: formatPubkey(account.pubkey)
        })
      }
      if (followListEvent) {
        const updatedFollowListEvent = await indexedDb.putReplaceableEvent(followListEvent)
        if (updatedFollowListEvent.id === followListEvent.id) {
          setFollowListEvent(followListEvent)
        }
      } else {
        // Hydrate batch uses limited relays; fallback fetches from broader set (author relays, etc.)
        const trySetFollowList = (evt: Event) => {
          if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) return
          indexedDb
            .putReplaceableEvent(evt)
            .then(() => {
              if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                setFollowListEvent(evt)
                logger.info('[NostrProvider] Follow list loaded via fallback fetch')
              }
            })
            .catch(() => {
              if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                setFollowListEvent(evt)
              }
            })
        }
        const followListRelays = Array.from(
          new Set([
            ...mergedRelayList.write.map((u) => normalizeUrl(u) || u),
            ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u)
          ])
        ).filter(Boolean)
        queryService
          .fetchEvents(followListRelays, {
            authors: [account.pubkey],
            kinds: [kinds.Contacts],
            limit: 1
          })
          .then((evts) => {
            const evt = evts.sort((a, b) => b.created_at - a.created_at)[0]
            if (evt && hydrationGenForThisRun === accountHydrationGenerationRef.current) {
              trySetFollowList(evt)
              return
            }
            client.fetchFollowListEvent(account.pubkey, followListRelays).then((f) => {
              if (f) trySetFollowList(f)
            })
          })
          .catch(() => {
            client.fetchFollowListEvent(account.pubkey, followListRelays).then((f) => {
              if (f) trySetFollowList(f)
            })
          })
      }
      if (muteListEvent) {
        const updatedMuteListEvent = await indexedDb.putReplaceableEvent(muteListEvent)
        if (updatedMuteListEvent.id === muteListEvent.id) {
          setMuteListEvent(muteListEvent)
        }
      }
      if (bookmarkListEvent) {
        const updateBookmarkListEvent = await indexedDb.putReplaceableEvent(bookmarkListEvent)
        if (updateBookmarkListEvent.id === bookmarkListEvent.id) {
          setBookmarkListEvent(bookmarkListEvent)
        }
      }
      if (interestListEvent) {
        const updatedInterestListEvent = await indexedDb.putReplaceableEvent(interestListEvent)
        if (updatedInterestListEvent.id === interestListEvent.id) {
          setInterestListEvent(interestListEvent)
        }
      }
      if (favoriteRelaysEvent) {
        const updatedFavoriteRelaysEvent = await indexedDb.putReplaceableEvent(favoriteRelaysEvent)
        if (updatedFavoriteRelaysEvent.id === favoriteRelaysEvent.id) {
          setFavoriteRelaysEvent(updatedFavoriteRelaysEvent)
        }
      }
      if (blockedRelaysEvent) {
        const updatedBlockedRelaysEvent = await indexedDb.putReplaceableEvent(blockedRelaysEvent)
        if (updatedBlockedRelaysEvent.id === blockedRelaysEvent.id) {
          setBlockedRelaysEvent(updatedBlockedRelaysEvent)
          
          // Update blockedRelays array and re-filter relay list
          const newBlockedRelays: string[] = []
          updatedBlockedRelaysEvent.tags.forEach(([tagName, tagValue]) => {
            if (tagName === 'relay' && tagValue) {
              const normalizedUrl = normalizeUrl(tagValue)
              if (normalizedUrl && !newBlockedRelays.includes(normalizedUrl)) {
                newBlockedRelays.push(normalizedUrl)
              }
            }
          })
          
          // Re-filter relay list with updated blocked relays
          if (relayListEvent) {
            const updatedRelayList = getRelayListFromEvent(relayListEvent, newBlockedRelays)
            setRelayList(updatedRelayList)
          }
        }
      }
      if (blossomServerListEvent) {
        await client.updateBlossomServerListEventCache(blossomServerListEvent)
      }
      if (userEmojiListEvent) {
        const updatedUserEmojiListEvent = await indexedDb.putReplaceableEvent(userEmojiListEvent)
        if (updatedUserEmojiListEvent.id === userEmojiListEvent.id) {
          setUserEmojiListEvent(updatedUserEmojiListEvent)
        }
      }

        storage.setAccountNetworkHydrateAt(account.pubkey, Date.now())
        void client.runSessionPrewarm({ pubkey: account.pubkey, signal: controller.signal })
        logger.info('[NostrProvider] Account session hydrate: core relay/profile merge finished; client prewarm started (parallel)', {
          pubkeySlice: account.pubkey.slice(0, 12)
        })
      } else {
        logger.info('[NostrProvider] Skipped network hydrate (within min interval); IndexedDB cache only', {
          pubkeySlice: account.pubkey.slice(0, 12),
          lastNetworkHydrateAt,
          ageMs: Date.now() - (lastNetworkHydrateAt ?? 0)
        })
        if (storedRelayListEvent) {
          client.updateRelayListCache(storedRelayListEvent)
        }
        if (!storedFollowListEvent) {
          const trySetFollowListSkip = (evt: Event) => {
            if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) return
            indexedDb
              .putReplaceableEvent(evt)
              .then(() => {
                if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                  setFollowListEvent(evt)
                  logger.info('[NostrProvider] Follow list loaded via fallback (skip-network path)')
                }
              })
              .catch(() => {
                if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                  setFollowListEvent(evt)
                }
              })
          }
          const getFollowListRelays = async () => {
            const rl = storedRelayListEvent
              ? getRelayListFromEvent(storedRelayListEvent, blockedRelays)
              : { write: [] as string[], read: [] as string[] }
            const writes = rl.write.map((u) => normalizeUrl(u) || u).filter(Boolean)
            return Array.from(new Set([...writes, ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u)])).filter(Boolean)
          }
          getFollowListRelays().then((relays) =>
            client.fetchFollowListEvent(account.pubkey, relays.length > 0 ? relays : undefined).then((fallback) => {
              if (fallback) trySetFollowListSkip(fallback)
            })
          )
        }
      }
      return controller
    }
    const promise = init()
    void promise.finally(() => {
      const r = manualNetworkHydrateResolveRef.current
      manualNetworkHydrateResolveRef.current = null
      r?.()
    })
    const finishHydration = () => {
      if (
        hydrationGenForThisRun >= 0 &&
        accountHydrationGenerationRef.current === hydrationGenForThisRun
      ) {
        setIsAccountSessionHydrating(false)
      }
    }
    promise.then(finishHydration).catch((e) => {
      logger.error('[NostrProvider] Account session hydrate failed', { error: e })
      finishHydration()
    })
    return () => {
      promise
        .then((controller) => {
          controller?.abort()
        })
        .catch(() => {})
    }
  }, [account, accountNetworkHydrateBump])

  /** Clear persisted post draft when user logs out or switches accounts (not on initial load). */
  const prevAccountPubkeyRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const prev = prevAccountPubkeyRef.current
    const curr = account?.pubkey ?? null
    prevAccountPubkeyRef.current = curr
    if (prev != null && curr != null && prev !== curr) {
      postEditorCache.clearOnAccountChange()
    } else if (prev != null && curr === null) {
      postEditorCache.clearOnAccountChange()
    }
  }, [account?.pubkey])

  /** Recovery: if hydrate finished but follow list is still null, fetch using user write + search relays. */
  useEffect(() => {
    if (!account || followListEvent !== null || isAccountSessionHydrating) return
    let cancelled = false
    client
      .fetchRelayList(account.pubkey)
      .then((rl) => {
        const writes = rl.write.map((u) => normalizeUrl(u) || u).filter(Boolean)
        const relays = Array.from(new Set([...writes, ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u)])).filter(Boolean)
        return client.fetchFollowListEvent(account.pubkey, relays.length > 0 ? relays : undefined)
      })
      .then((evt) => {
        if (!cancelled && evt) setFollowListEvent(evt)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [account, followListEvent, isAccountSessionHydrating])

  useEffect(() => {
    if (!account) return

    const initInteractions = async () => {
      const pubkey = account.pubkey
      const relayList = await client.fetchRelayList(pubkey)
      const events = await queryService.fetchEvents(relayList.write.slice(0, 4), [
        {
          authors: [pubkey],
          kinds: [kinds.Reaction, ExtendedKind.EXTERNAL_REACTION, kinds.Repost, ExtendedKind.GENERIC_REPOST],
          limit: 100
        },
        {
          '#p': [pubkey],
          kinds: [kinds.Zap],
          limit: 100
        }
      ])
      noteStatsService.updateNoteStatsByEvents(events)
    }
    initInteractions()
  }, [account])

  useEffect(() => {
    /** Use `client.setSigner` so the client, QueryService, and scoped NIP-42 pool auth stay aligned. */
    client.setSigner(signer ?? undefined, account?.signerType)
  }, [signer, account?.signerType])

  useEffect(() => {
    if (account) {
      client.pubkey = account.pubkey
    } else {
      client.pubkey = undefined
    }
  }, [account])

  useEffect(() => {
    customEmojiService.init(userEmojiListEvent)
  }, [userEmojiListEvent])

  /**
   * If session restore temporarily fell back to read-only (`npub`) while the stored
   * account is still `nip-07`, periodically retry reconnecting the extension signer.
   */
  useEffect(() => {
    if (!account || account.signerType !== 'npub') return
    const preferred = storage.getCurrentAccount()
    if (!preferred || preferred.signerType !== 'nip-07') return
    if (preferred.pubkey !== account.pubkey) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    const maxAttempts = 6

    const schedule = (ms: number) => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void tryRecover()
      }, ms)
    }

    const tryRecover = async () => {
      if (cancelled || attempts >= maxAttempts) return
      attempts += 1
      try {
        const nip07Signer = new Nip07Signer()
        await nip07Signer.init()
        const pubkey = await nip07Signer.getPublicKey()
        if (pubkey.toLowerCase() !== preferred.pubkey.toLowerCase()) {
          throw new Error('Signer pubkey does not match current account')
        }
        login(nip07Signer, preferred)
        logger.info('[NostrProvider] Recovered NIP-07 signer from read-only fallback', {
          pubkeySlice: pubkey.slice(0, 12),
          attempts
        })
        return
      } catch (error) {
        logger.info('[NostrProvider] NIP-07 recovery retry failed', {
          pubkeySlice: preferred.pubkey.slice(0, 12),
          attempts,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      schedule(Math.min(10_000, attempts * 1_500))
    }

    schedule(1_200)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [account])

  const hasNostrLoginHash = () => {
    return window.location.hash && window.location.hash.startsWith('#nostr-login')
  }

  const loginByNostrLoginHash = async () => {
    const credential = window.location.hash.replace('#nostr-login=', '')
    const urlWithoutHash = window.location.href.split('#')[0]
    history.replaceState(null, '', urlWithoutHash)

    if (credential.startsWith('bunker://')) {
      return await bunkerLogin(credential)
    } else if (credential.startsWith('ncryptsec')) {
      return await ncryptsecLogin(credential)
    } else if (credential.startsWith('nsec')) {
      return await nsecLogin(credential)
    }
  }

  const login = (signer: ISigner, act: TAccount) => {
    const newAccounts = storage.addAccount(act)
    setAccounts(newAccounts)
    storage.switchAccount(act)
    setAccount({ pubkey: act.pubkey, signerType: act.signerType })
    setSigner(signer)
    return act.pubkey
  }

  const removeAccount = (act: TAccountPointer) => {
    const newAccounts = storage.removeAccount(act)
    setAccounts(newAccounts)
    if (account?.pubkey === act.pubkey) {
      setAccount(null)
      setSigner(null)
    }
  }

  const switchAccount = async (act: TAccountPointer | null): Promise<string | null> => {
    if (!act) {
      storage.switchAccount(null)
      setAccount(null)
      setSigner(null)
      return null
    }
    return await loginWithAccountPointer(act)
  }

  const finishNcryptsecPasswordPrompt = useCallback((password: string | null) => {
    const resolve = ncryptsecPasswordResolveRef.current
    if (!resolve) return
    ncryptsecPasswordResolveRef.current = null
    setNcryptsecPasswordOpen(false)
    resolve(password)
  }, [])

  const askNcryptsecPassword = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const prev = ncryptsecPasswordResolveRef.current
      if (prev) prev(null)
      ncryptsecPasswordResolveRef.current = resolve
      setNcryptsecPasswordOpen(true)
    })
  }, [])

  const nsecLogin = async (nsecOrHex: string, password?: string, needSetup?: boolean) => {
    const nsecSigner = new NsecSigner()
    let privkey: Uint8Array
    if (nsecOrHex.startsWith('nsec')) {
      const { type, data } = nip19.decode(nsecOrHex)
      if (type !== 'nsec') {
        throw new Error('invalid nsec or hex')
      }
      privkey = data
    } else if (/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
      privkey = hexToBytes(nsecOrHex)
    } else {
      throw new Error('invalid nsec or hex')
    }
    const pubkey = nsecSigner.login(privkey)
    if (password) {
      const ncryptsec = nip49.encrypt(privkey, password)
      login(nsecSigner, { pubkey, signerType: 'ncryptsec', ncryptsec })
    } else {
      login(nsecSigner, { pubkey, signerType: 'nsec', nsec: nip19.nsecEncode(privkey) })
    }
    if (needSetup) {
      setupNewUser(nsecSigner)
    }
    return pubkey
  }

  const ncryptsecLogin = async (ncryptsec: string) => {
    const password = await askNcryptsecPassword()
    if (!password) {
      throw new Error('Password is required')
    }
    let privkey: Uint8Array
    try {
      privkey = nip49.decrypt(ncryptsec, password)
    } catch (e) {
      toast.error(t('Login failed') + ': ' + (e as Error).message)
      throw e
    }
    const browserNsecSigner = new NsecSigner()
    const pubkey = browserNsecSigner.login(privkey)
    return login(browserNsecSigner, { pubkey, signerType: 'ncryptsec', ncryptsec })
  }

  const npubLogin = async (npub: string) => {
    const npubSigner = new NpubSigner()
    const pubkey = npubSigner.login(npub)
    return login(npubSigner, { pubkey, signerType: 'npub', npub })
  }

  const nip07Login = async () => {
    try {
      const nip07Signer = new Nip07Signer()
      await nip07Signer.init()
      const pubkey = await nip07Signer.getPublicKey()
      if (!pubkey) {
        throw new Error('You did not allow to access your pubkey')
      }
      return login(nip07Signer, { pubkey, signerType: 'nip-07' })
    } catch (err) {
      toast.error(t('Login failed') + ': ' + (err as Error).message)
      throw err
    }
  }

  const bunkerLogin = async (bunker: string) => {
    const bunkerSigner = new BunkerSigner()
    const pubkey = await bunkerSigner.login(bunker)
    if (!pubkey) {
      throw new Error('Invalid bunker')
    }
    const bunkerUrl = new URL(bunker)
    bunkerUrl.searchParams.delete('secret')
    return login(bunkerSigner, {
      pubkey,
      signerType: 'bunker',
      bunker: bunkerUrl.toString(),
      bunkerClientSecretKey: bunkerSigner.getClientSecretKey()
    })
  }

  const nostrConnectionLogin = async (clientSecretKey: Uint8Array, connectionString: string) => {
    const bunkerSigner = new NostrConnectionSigner(clientSecretKey, connectionString)
    const loginResult = await bunkerSigner.login()
    if (!loginResult.pubkey) {
      throw new Error('Invalid bunker')
    }
    const bunkerUrl = new URL(loginResult.bunkerString!)
    bunkerUrl.searchParams.delete('secret')
    return login(bunkerSigner, {
      pubkey: loginResult.pubkey,
      signerType: 'bunker',
      bunker: bunkerUrl.toString(),
      bunkerClientSecretKey: bunkerSigner.getClientSecretKey()
    })
  }

  const loginWithAccountPointer = async (act: TAccountPointer): Promise<string | null> => {
    const fallbackToReadOnlyNpub = (pubkey: string, reason?: unknown): string => {
      const npubSigner = new NpubSigner()
      const npub = nip19.npubEncode(pubkey)
      npubSigner.login(npub)
      // Keep this fallback in-memory only; do not rewrite stored account type.
      setAccount({ pubkey, signerType: 'npub' })
      setSigner(npubSigner)
      logger.warn('[NostrProvider] Signer unavailable during restore; using read-only session', {
        pubkeySlice: pubkey.slice(0, 12),
        reason: reason instanceof Error ? reason.message : String(reason ?? '')
      })
      return pubkey
    }
    const currentAccountState = account

    let storedAccount = storage.findAccount(act)
    if (!storedAccount) {
      return null
    }
    if (storedAccount.signerType === 'nsec' || storedAccount.signerType === 'browser-nsec') {
      if (storedAccount.nsec) {
        const browserNsecSigner = new NsecSigner()
        browserNsecSigner.login(storedAccount.nsec)
        // Migrate to nsec
        if (storedAccount.signerType === 'browser-nsec') {
          storage.removeAccount(storedAccount)
          storedAccount = { ...storedAccount, signerType: 'nsec' }
          storage.addAccount(storedAccount)
        }
        return login(browserNsecSigner, storedAccount)
      }
    } else if (storedAccount.signerType === 'ncryptsec') {
      if (storedAccount.ncryptsec) {
        const password = await askNcryptsecPassword()
        if (!password) {
          return null
        }
        let privkey: Uint8Array
        try {
          privkey = nip49.decrypt(storedAccount.ncryptsec, password)
        } catch (e) {
          toast.error(t('Login failed') + ': ' + (e as Error).message)
          return null
        }
        const browserNsecSigner = new NsecSigner()
        browserNsecSigner.login(privkey)
        return login(browserNsecSigner, storedAccount)
      }
    } else if (storedAccount.signerType === 'nip-07') {
      try {
        const nip07Signer = new Nip07Signer()
        await nip07Signer.init()
        const pubkey = await nip07Signer.getPublicKey()
        if (pubkey.toLowerCase() !== storedAccount.pubkey.toLowerCase()) {
          throw new Error('Signer pubkey does not match current account')
        }
        return login(nip07Signer, storedAccount)
      } catch (err) {
        // One short retry avoids transient extension injection races on reload.
        try {
          await new Promise((resolve) => setTimeout(resolve, 1200))
          const retrySigner = new Nip07Signer()
          await retrySigner.init()
          const retryPubkey = await retrySigner.getPublicKey()
          if (retryPubkey.toLowerCase() !== storedAccount.pubkey.toLowerCase()) {
            throw new Error('Signer pubkey does not match current account')
          }
          return login(retrySigner, storedAccount)
        } catch (retryErr) {
          // If this tab already has a working nip-07 signer for the same account, keep it.
          if (
            currentAccountState?.pubkey === storedAccount.pubkey &&
            currentAccountState.signerType === 'nip-07' &&
            signer
          ) {
            try {
              const currentPubkey = await signer.getPublicKey()
              if (currentPubkey.toLowerCase() === storedAccount.pubkey.toLowerCase()) {
                logger.info('[NostrProvider] Keeping existing NIP-07 signer after transient restore failure', {
                  pubkeySlice: storedAccount.pubkey.slice(0, 12)
                })
                return storedAccount.pubkey
              }
            } catch {
              // Ignore and fall through to read-only fallback.
            }
          }
        }
        return fallbackToReadOnlyNpub(storedAccount.pubkey, err)
      }
    } else if (storedAccount.signerType === 'bunker') {
      if (storedAccount.bunker && storedAccount.bunkerClientSecretKey) {
        const bunkerSigner = new BunkerSigner(storedAccount.bunkerClientSecretKey)
        const pubkey = await bunkerSigner.login(storedAccount.bunker, false)
        if (!pubkey) {
          storage.removeAccount(storedAccount)
          return null
        }
        if (pubkey !== storedAccount.pubkey) {
          storage.removeAccount(storedAccount)
          storedAccount = { ...storedAccount, pubkey }
          storage.addAccount(storedAccount)
        }
        return login(bunkerSigner, storedAccount)
      }
    } else if (storedAccount.signerType === 'npub' && storedAccount.npub) {
      const npubSigner = new NpubSigner()
      const pubkey = npubSigner.login(storedAccount.npub)
      if (!pubkey) {
        storage.removeAccount(storedAccount)
        return null
      }
      if (pubkey !== storedAccount.pubkey) {
        storage.removeAccount(storedAccount)
        storedAccount = { ...storedAccount, pubkey }
        storage.addAccount(storedAccount)
      }
      return login(npubSigner, storedAccount)
    }
    storage.removeAccount(storedAccount)
    return null
  }

  const normalizeDraftEventTags = (draftEvent: TDraftEvent): TDraftEvent => {
    const draft = JSON.parse(JSON.stringify(draftEvent)) as TDraftEvent
    const jumbleAttributionAlt = buildAltTag()[1]
    const existingTags = Array.isArray(draft.tags) ? draft.tags : []
    const sanitizedTags = existingTags.filter(
      (tag) =>
        Array.isArray(tag) &&
        tag[0] !== 'client' &&
        !(tag[0] === 'alt' && tag[1] === jumbleAttributionAlt)
    )
    draft.tags = [...sanitizedTags, buildClientTag(), buildAltTag()]
    return draft
  }

  const setupNewUser = async (signer: ISigner) => {
    await Promise.allSettled([
      client.publishEvent(
        FAST_READ_RELAY_URLS,
        await signer.signEvent(normalizeDraftEventTags(createFollowListDraftEvent([])))
      ),
      client.publishEvent(
        FAST_READ_RELAY_URLS,
        await signer.signEvent(normalizeDraftEventTags(createMuteListDraftEvent([])))
      ),
      client.publishEvent(
        FAST_READ_RELAY_URLS,
        await signer.signEvent(
          normalizeDraftEventTags(
            createRelayListDraftEvent(FAST_READ_RELAY_URLS.map((url) => ({ url, scope: 'both' })))
          )
        )
      )
    ])
  }

  const signEvent = async (draftEvent: TDraftEvent) => {
    const normalizedDraft = normalizeDraftEventTags(draftEvent)
    // Add timeout to prevent hanging
    const signEventWithTimeout = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Signing request timed out. Your Nostr extension may be waiting for authorization. Try closing this tab and restarting your browser to surface any pending authorization requests from your extension.'))
      }, 30000) // 30 second timeout
      
      signer?.signEvent(normalizedDraft)
        .then((event) => {
          clearTimeout(timeout)
          resolve(event)
        })
        .catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
    })
    
    const event = await signEventWithTimeout as VerifiedEvent
    if (!event) {
      throw new Error('sign event failed')
    }
    
    // Debug: Log the signed event
    logger.debug('Signed event:', {
      id: event.id,
      pubkey: event.pubkey,
      sig: event.sig,
      content: event.content.substring(0, 100) + '...',
      tags: event.tags,
      created_at: event.created_at
    })
    
    // Validate the event before publishing
    const isValid = validateEvent(event)
    if (!isValid) {
      logger.error('Event validation failed:', event)
      throw new Error('Event validation failed - invalid signature or format. Please try logging in again.')
    }
    
    return event as VerifiedEvent
  }

  const publish = async (
    draftEvent: TDraftEvent,
    { minPow = 0, ...options }: TPublishOptions = {}
  ) => {
    if (!account || !signer || account.signerType === 'npub') {
      throw new Error('You need to login first')
    }
    
    // Validate account state before publishing
    if (!account.pubkey || account.pubkey.length !== 64) {
      throw new Error('Invalid account state - pubkey is missing or invalid')
    }

    const draft = normalizeDraftEventTags(draftEvent)
    let event: VerifiedEvent
    if (minPow > 0) {
      const unsignedEvent = await minePow({ ...draft, pubkey: account.pubkey }, minPow)
      event = await signEvent(unsignedEvent)
    } else {
      event = await signEvent(draft)
    }

    if (event.kind !== kinds.Application && event.pubkey !== account.pubkey) {
      const profileEvent = await replaceableEventService.fetchReplaceableEvent(event.pubkey, kinds.Metadata)
      const eventAuthor = profileEvent ? getProfileFromEvent(profileEvent) : undefined
      const result = confirm(
        t(
          'You are about to publish an event signed by [{{eventAuthorName}}]. You are currently logged in as [{{currentUsername}}]. Are you sure?',
          { eventAuthorName: eventAuthor?.username, currentUsername: profile?.username }
        )
      )
      if (!result) {
        throw new Error(t('Cancelled'))
      }
    }

    logger.debug('[Publish] Determining target relays...', { kind: event.kind, pubkey: event.pubkey?.substring(0, 8) })
    const favoriteRelayUrls = favoriteRelayUrlsForPublish(favoriteRelaysEvent, account.pubkey)
    const relays = await client.determineTargetRelays(event, {
      ...options,
      favoriteRelayUrls,
      blockedRelayUrls: options.blockedRelayUrls ?? blockedRelayUrlsFromEvent(blockedRelaysEvent)
    })
    logger.debug('[Publish] Target relays determined', { relayCount: relays.length, relays: relays.slice(0, 5) })

    try {
      logger.debug('[Publish] Calling client.publishEvent()...', { relayCount: relays.length, eventId: event.id?.substring(0, 8) })
      const publishResult = await client.publishEvent(relays, event, { favoriteRelayUrls })
      logger.debug('[Publish] publishEvent completed', {
        success: publishResult.success,
        successCount: publishResult.successCount,
        totalCount: publishResult.totalCount,
        relayStatuses: publishResult.relayStatuses
      })
      
      // Store relay status temporarily for display (but don't persist it on the event)
      // This metadata is only for logging/feedback, not part of the actual event
      const relayStatuses = publishResult.relayStatuses.length > 0 ? publishResult.relayStatuses : undefined
      
      // If at least one relay accepted, cache and emit immediately so UI shows the event without waiting
      if (publishResult.successCount >= 1) {
        client.addEventToCache(event)
        client.emitNewEvent(event)
        // Replaceable list events (pins, cache relays, …) must hit IndexedDB + DataLoader, not only RAM
        void replaceableEventService.updateReplaceableEventCache(event).catch(() => {})
      }

      // Replaceable events and notes: cache above uses successCount >= 1. publishEvent still sets
      // success only when >=1/3 of relays OK (broad replication). Treat "zero accepts" as failure
      // so we don't throw when a few relays worked but many timed out (common with large outbox lists).
      if (publishResult.successCount < 1) {
        logger.error('[Publish] Publishing failed on every relay', {
          eventKind: event.kind,
          eventId: event.id?.substring(0, 8),
          relayStatuses: publishResult.relayStatuses,
          failedUrls: publishResult.relayStatuses.filter((s) => !s.success).map((s) => s.url)
        })
        const error = new AggregateError(
          publishResult.relayStatuses
            .filter(s => !s.success)
            .map(s => new Error(s.error || 'Failed')),
          'Failed to publish to any relay'
        )
        ;(error as any).relayStatuses = publishResult.relayStatuses
        throw error
      }
      if (!publishResult.success) {
        logger.warn('[Publish] Partial publish: some relays failed or timed out', {
          eventKind: event.kind,
          eventId: event.id?.substring(0, 8),
          successCount: publishResult.successCount,
          totalCount: publishResult.totalCount
        })
      }

      logger.debug('[Publish] Publishing successful, attaching relayStatuses to event')
      // Attach relayStatuses only temporarily for UI feedback, then remove it
      if (relayStatuses) {
        (event as any).relayStatuses = relayStatuses
        setTimeout(() => {
          delete (event as any).relayStatuses
        }, 100)
      }
      // Cache and emit already done above when successCount >= 1
      logger.debug('[Publish] Returning event', { eventId: event.id?.substring(0, 8), hasRelayStatuses: !!relayStatuses })
      return event
    } catch (error) {
      // Check for authentication-related errors
      if (error instanceof AggregateError && (error as any).relayStatuses) {
        // Attach relayStatuses temporarily for UI feedback
        const errorRelayStatuses = (error as any).relayStatuses as Array<{ url: string; success: boolean; error?: string }>
        
        // Attach to event temporarily for UI feedback
        (event as any).relayStatuses = errorRelayStatuses
        
        // Remove it after a brief delay to allow UI components to read it
        setTimeout(() => {
          delete (event as any).relayStatuses
        }, 100)
        
        // Check if any relay returned an "invalid key" error
        const invalidKeyErrors = errorRelayStatuses.filter(
          (status) => status.error && status.error.includes('invalid key')
        )
        
        if (invalidKeyErrors.length > 0) {
          throw new Error('Authentication failed - invalid key. Please try logging out and logging in again.')
        }
      }
      
      // Re-throw the error so the UI can handle it appropriately
      throw error
    }
  }

  const attemptDelete = async (targetEvent: Event) => {
    if (!signer) {
      throw new Error(t('You need to login first'))
    }
    if (account?.pubkey !== targetEvent.pubkey) {
      throw new Error(t('You can only delete your own notes'))
    }

    const deletionRequest = await signEvent(createDeletionRequestDraftEvent(targetEvent))

    // Privacy: Only use user's own relays, never connect to "seen on" relays
    const favUrls = favoriteRelayUrlsForPublish(favoriteRelaysEvent, account?.pubkey ?? null)
    const relays = await client.determineTargetRelays(targetEvent, {
      favoriteRelayUrls: favUrls,
      blockedRelayUrls: blockedRelayUrlsFromEvent(blockedRelaysEvent)
    })

    const result = await client.publishEvent(relays, deletionRequest, { favoriteRelayUrls: favUrls })

    await client.applyDeletionRequestToLocalCache(deletionRequest)

    // Show publishing feedback
    if (result.relayStatuses) {
      showPublishingFeedback(result, {
        message: t('Deletion request sent'),
        duration: 6000
      })
    } else {
      showSimplePublishSuccess(t('Deletion request sent'))
    }
  }

  const signHttpAuth = async (url: string, method: string, content = '') => {
    const event = await signEvent({
      content,
      kind: kinds.HTTPAuth,
      created_at: dayjs().unix(),
      tags: [
        ['u', url],
        ['method', method]
      ]
    })
    return 'Nostr ' + btoa(JSON.stringify(event))
  }

  const nip04Encrypt = async (pubkey: string, plainText: string) => {
    return signer?.nip04Encrypt(pubkey, plainText) ?? ''
  }

  const nip04Decrypt = async (pubkey: string, cipherText: string) => {
    if (!signer) return ''
    try {
      return (await signer.nip04Decrypt(pubkey, cipherText)) ?? ''
    } catch {
      // Extensions often throw (padding / wrong key) while nsec path returns ''; keep call sites simple.
      return ''
    }
  }

  const checkLogin = async <T,>(cb?: () => T): Promise<T | void> => {
    if (signer) {
      return cb && cb()
    }
    return setOpenLoginDialog(true)
  }

  const updateRelayListEvent = async (relayListEvent: Event) => {
    await indexedDb.putReplaceableEvent(relayListEvent)
    // Clear the relay list cache to force a fresh fetch
    if (account?.pubkey) {
      client.clearRelayListCache(account.pubkey)
    }
    // Fetch updated relay list (which merges both 10002 and 10432)
    const mergedRelayList = await client.fetchRelayList(account?.pubkey || '')
    setRelayList(mergedRelayList)
  }

  const updateCacheRelayListEvent = async (cacheRelayListEvent: Event) => {
    await indexedDb.putReplaceableEvent(cacheRelayListEvent)
    // Clear the relay list cache to ensure fresh fetches use the updated event
    if (account?.pubkey) {
      client.clearRelayListCache(account.pubkey)
    }
    // Set local state immediately with the event we just saved
    // This will trigger the component's useEffect to update the UI immediately
    setCacheRelayListEvent(cacheRelayListEvent)
    // Don't update relayList here - it's a computed merge of kind 10002 + 10432
    // The merged list will be computed on-the-fly when needed via fetchRelayList()
    // This ensures kind 10002 and 10432 remain separate and are only merged when publishing/using
  }

  const updateHttpRelayListEvent = async (httpRelayEvent: Event) => {
    await indexedDb.putReplaceableEvent(httpRelayEvent)
    if (account?.pubkey) {
      client.clearRelayListCache(account.pubkey)
    }
    setHttpRelayListEvent(httpRelayEvent)
    const mergedRelayList = await client.fetchRelayList(account?.pubkey || '')
    setRelayList(mergedRelayList)
  }

  const updateProfileEvent = async (profileEvent: Event) => {
    const newProfileEvent = await indexedDb.putReplaceableEvent(profileEvent)
    setProfileEvent(newProfileEvent)
    setProfile(getProfileFromEvent(newProfileEvent))
  }

  const updateFollowListEvent = async (followListEvent: Event) => {
    const stored = await indexedDb.putReplaceableEvent(followListEvent)
    /** Always sync follow list state/cache to the IndexedDB winner. */
    setFollowListEvent(stored)
    await client.updateFollowListCache(stored)
  }

  const updateMuteListEvent = async (muteListEvent: Event, privateTags: string[][]) => {
    const storedWinner = await indexedDb.putReplaceableEvent(muteListEvent)
    if (storedWinner.id === muteListEvent.id) {
      await indexedDb.putMuteDecryptedTags(muteListEvent.id, privateTags)
      setMuteListEvent(muteListEvent)
      return
    }
    // IndexedDB kept a different replaceable winner (e.g. higher created_at). Sync UI to storage
    // so feeds do not keep showing notes that should be hidden while state still pointed at the losing event.
    setMuteListEvent(storedWinner)
  }

  const updateBookmarkListEvent = async (bookmarkListEvent: Event) => {
    const stored = await indexedDb.putReplaceableEvent(bookmarkListEvent)
    /** Keep bookmark UI aligned with replaceable winner from storage. */
    setBookmarkListEvent(stored)
  }

  const updateInterestListEvent = async (interestListEvent: Event) => {
    const stored = await indexedDb.putReplaceableEvent(interestListEvent)
    /** Keep interests UI aligned with replaceable winner from storage. */
    setInterestListEvent(stored)
  }

  const updateFavoriteRelaysEvent = async (favoriteRelaysEvent: Event) => {
    const stored = await indexedDb.putReplaceableEvent(favoriteRelaysEvent)
    /** Always sync UI to IndexedDB winner (same-second updates must not leave stale list + relay sets). */
    setFavoriteRelaysEvent(stored)
  }

  const updateBlockedRelaysEvent = async (blockedRelaysEvent: Event) => {
    const newBlockedRelaysEvent = await indexedDb.putReplaceableEvent(blockedRelaysEvent)
    if (newBlockedRelaysEvent.id !== blockedRelaysEvent.id) return

    setBlockedRelaysEvent(newBlockedRelaysEvent)
  }

  const updateRssFeedListEvent = async (rssFeedListEvent: Event) => {
    const newRssFeedListEvent = await indexedDb.putReplaceableEvent(rssFeedListEvent)
    if (newRssFeedListEvent.id !== rssFeedListEvent.id) return

    setRssFeedListEvent(newRssFeedListEvent)
  }

  const requestAccountNetworkHydrate = useCallback(() => {
    if (!account) return Promise.resolve()
    forceNextAccountNetworkHydrateRef.current = true
    return new Promise<void>((resolve) => {
      manualNetworkHydrateResolveRef.current = resolve
      setAccountNetworkHydrateBump((n) => n + 1)
    })
  }, [account])

  return (
    <NostrContext.Provider
      value={{
        isInitialized,
        isAccountSessionHydrating,
        pubkey: account?.pubkey ?? null,
        profile,
        profileEvent,
        relayList,
        cacheRelayListEvent,
        httpRelayListEvent,
        followListEvent,
        muteListEvent,
        bookmarkListEvent,
        interestListEvent,
        favoriteRelaysEvent,
        blockedRelaysEvent,
        userEmojiListEvent,
        rssFeedListEvent,
        account,
        accounts,
        nsec,
        ncryptsec,
        switchAccount,
        nsecLogin,
        ncryptsecLogin,
        nip07Login,
        bunkerLogin,
        nostrConnectionLogin,
        npubLogin,
        removeAccount,
        publish,
        attemptDelete,
        signHttpAuth,
        nip04Encrypt,
        nip04Decrypt,
        startLogin: () => setOpenLoginDialog(true),
        checkLogin,
        signEvent,
        updateRelayListEvent,
        updateCacheRelayListEvent,
        updateHttpRelayListEvent,
        updateProfileEvent,
        updateFollowListEvent,
        updateMuteListEvent,
        updateBookmarkListEvent,
        updateInterestListEvent,
        updateFavoriteRelaysEvent,
        updateBlockedRelaysEvent,
        updateRssFeedListEvent,
        requestAccountNetworkHydrate
      }}
    >
      {children}
      <LoginDialog open={openLoginDialog} setOpen={setOpenLoginDialog} />
      <NcryptsecPasswordPrompt open={ncryptsecPasswordOpen} onResult={finishNcryptsecPasswordPrompt} />
    </NostrContext.Provider>
  )
}
