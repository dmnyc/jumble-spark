import LoginDialog from '@/components/LoginDialog'
import { ApplicationDataKey, BIG_RELAY_URLS, ExtendedKind, FAST_WRITE_RELAY_URLS, PROFILE_FETCH_RELAY_URLS, PROFILE_RELAY_URLS } from '@/constants'
import {
  createDeletionRequestDraftEvent,
  createFollowListDraftEvent,
  createMuteListDraftEvent,
  createRelayListDraftEvent,
  createSeenNotificationsAtDraftEvent
} from '@/lib/draft-event'
import {
  getLatestEvent,
  getReplaceableEventIdentifier,
  minePow
} from '@/lib/event'
import { getProfileFromEvent, getRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { normalizeUrl } from '@/lib/url'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import client from '@/services/client.service'
import customEmojiService from '@/services/custom-emoji.service'
import indexedDb from '@/services/indexed-db.service'
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
import { createContext, useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BunkerSigner } from './bunker.signer'
import { Nip07Signer } from './nip-07.signer'
import { NostrConnectionSigner } from './nostrConnection.signer'
import { NpubSigner } from './npub.signer'
import { NsecSigner } from './nsec.signer'

type TNostrContext = {
  isInitialized: boolean
  pubkey: string | null
  profile: TProfile | null
  profileEvent: Event | null
  relayList: TRelayList | null
  cacheRelayListEvent: Event | null
  followListEvent: Event | null
  muteListEvent: Event | null
  bookmarkListEvent: Event | null
  interestListEvent: Event | null
  favoriteRelaysEvent: Event | null
  blockedRelaysEvent: Event | null
  userEmojiListEvent: Event | null
  rssFeedListEvent: Event | null
  notificationsSeenAt: number
  account: TAccountPointer | null
  accounts: TAccountPointer[]
  nsec: string | null
  ncryptsec: string | null
  switchAccount: (account: TAccountPointer | null) => Promise<void>
  nsecLogin: (nsec: string, password?: string, needSetup?: boolean) => Promise<string>
  ncryptsecLogin: (ncryptsec: string) => Promise<string>
  nip07Login: () => Promise<string>
  bunkerLogin: (bunker: string) => Promise<string>
  nostrConnectionLogin: (clientSecretKey: Uint8Array, connectionString: string) => Promise<string>
  npubLogin(npub: string): Promise<string>
  removeAccount: (account: TAccountPointer) => void
  /**
   * Default publish the event to current relays, user's write relays and additional relays
   */
  publish: (draftEvent: TDraftEvent, options?: TPublishOptions) => Promise<Event>
  attemptDelete: (targetEvent: Event) => Promise<void>
  signHttpAuth: (url: string, method: string) => Promise<string>
  signEvent: (draftEvent: TDraftEvent) => Promise<VerifiedEvent>
  nip04Encrypt: (pubkey: string, plainText: string) => Promise<string>
  nip04Decrypt: (pubkey: string, cipherText: string) => Promise<string>
  startLogin: () => void
  checkLogin: <T>(cb?: () => T) => Promise<T | void>
  updateRelayListEvent: (relayListEvent: Event) => Promise<void>
  updateCacheRelayListEvent: (cacheRelayListEvent: Event) => Promise<void>
  updateProfileEvent: (profileEvent: Event) => Promise<void>
  updateFollowListEvent: (followListEvent: Event) => Promise<void>
  updateMuteListEvent: (muteListEvent: Event, privateTags: string[][]) => Promise<void>
  updateBookmarkListEvent: (bookmarkListEvent: Event) => Promise<void>
  updateInterestListEvent: (interestListEvent: Event) => Promise<void>
  updateFavoriteRelaysEvent: (favoriteRelaysEvent: Event) => Promise<void>
  updateBlockedRelaysEvent: (blockedRelaysEvent: Event) => Promise<void>
  updateRssFeedListEvent: (rssFeedListEvent: Event) => Promise<void>
  updateNotificationsSeenAt: (skipPublish?: boolean) => Promise<void>
}

const NostrContext = createContext<TNostrContext | undefined>(undefined)

const lastPublishedSeenNotificationsAtEventAtMap = new Map<string, number>()

export const useNostr = () => {
  const context = useContext(NostrContext)
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider')
  }
  return context
}

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  // Note: Deletion event handling moved to individual components
  const [accounts, setAccounts] = useState<TAccountPointer[]>(
    storage.getAccounts().map((act) => ({ pubkey: act.pubkey, signerType: act.signerType }))
  )
  const [account, setAccount] = useState<TAccountPointer | null>(null)
  const [nsec, setNsec] = useState<string | null>(null)
  const [ncryptsec, setNcryptsec] = useState<string | null>(null)
  const [signer, setSigner] = useState<ISigner | null>(null)
  const [openLoginDialog, setOpenLoginDialog] = useState(false)
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
  const [followListEvent, setFollowListEvent] = useState<Event | null>(null)
  const [muteListEvent, setMuteListEvent] = useState<Event | null>(null)
  const [bookmarkListEvent, setBookmarkListEvent] = useState<Event | null>(null)
  const [interestListEvent, setInterestListEvent] = useState<Event | null>(null)
  const [favoriteRelaysEvent, setFavoriteRelaysEvent] = useState<Event | null>(null)
  const [blockedRelaysEvent, setBlockedRelaysEvent] = useState<Event | null>(null)
  const [userEmojiListEvent, setUserEmojiListEvent] = useState<Event | null>(null)
  const [rssFeedListEvent, setRssFeedListEvent] = useState<Event | null>(null)
  const [notificationsSeenAt, setNotificationsSeenAt] = useState(-1)
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    const init = async () => {
      if (hasNostrLoginHash()) {
        return await loginByNostrLoginHash()
      }

      const accounts = storage.getAccounts()
      const act = storage.getCurrentAccount() ?? accounts[0] // auto login the first account
      if (!act) return

      await loginWithAccountPointer(act)
    }
    init().then(() => {
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

  useEffect(() => {
    const init = async () => {
      setRelayList(null)
      setProfile(null)
      setProfileEvent(null)
      setNsec(null)
      setFavoriteRelaysEvent(null)
      setFollowListEvent(null)
      setMuteListEvent(null)
      setBookmarkListEvent(null)
      setRssFeedListEvent(null)
      setNotificationsSeenAt(-1)
      if (!account) {
        return
      }

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

      const storedNotificationsSeenAt = storage.getLastReadNotificationTime(account.pubkey)

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
        storedRssFeedListEvent
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
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.RSS_FEED_LIST)
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
        setBlockedRelaysEvent(storedBlockedRelaysEvent)
      }
      
      // Set initial relay list from stored events (will be updated with merged list later)
      // Merge cache relays even at initial load so cache relays are available immediately
      if (storedRelayListEvent || storedCacheRelayListEvent) {
        const baseRelayList = storedRelayListEvent 
          ? getRelayListFromEvent(storedRelayListEvent, blockedRelays)
          : { write: [], read: [], originalRelays: [] }
        
        // Merge cache relays if available
        if (storedCacheRelayListEvent) {
          const cacheRelayList = getRelayListFromEvent(storedCacheRelayListEvent)
          
          // Merge read relays - cache relays first, then others (for offline priority)
          const mergedRead = [...cacheRelayList.read, ...baseRelayList.read]
          const mergedWrite = [...cacheRelayList.write, ...baseRelayList.write]
          const mergedOriginalRelays = new Map<string, TMailboxRelay>()
          
          // Add cache relay original relays first (prioritized)
          cacheRelayList.originalRelays.forEach(relay => {
            mergedOriginalRelays.set(relay.url, relay)
          })
          // Then add regular relay original relays
          baseRelayList.originalRelays.forEach(relay => {
            if (!mergedOriginalRelays.has(relay.url)) {
              mergedOriginalRelays.set(relay.url, relay)
            }
          })
          
          setRelayList({
            write: Array.from(new Set(mergedWrite)),
            read: Array.from(new Set(mergedRead)),
            originalRelays: Array.from(mergedOriginalRelays.values())
          })
        } else {
          setRelayList(baseRelayList)
        }
      }
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
        logger.info('[NostrProvider] Loaded RSS feed list event from cache', {
          eventId: storedRssFeedListEvent.id,
          created_at: storedRssFeedListEvent.created_at
        })
      }

      // Fetch RSS feed list from relays if cache is missing or stale (older than 1 hour)
      const rssFeedListStale = !storedRssFeedListEvent || 
        (dayjs().unix() - storedRssFeedListEvent.created_at > 3600) // 1 hour
      
      if (rssFeedListStale) {
        logger.info('[NostrProvider] RSS feed list cache is missing or stale, fetching from relays', {
          hasCache: !!storedRssFeedListEvent,
          cacheAge: storedRssFeedListEvent ? dayjs().unix() - storedRssFeedListEvent.created_at : 'N/A'
        })
        
        // Fetch in background - don't block initialization
        client.fetchEvents(FAST_WRITE_RELAY_URLS.concat(PROFILE_RELAY_URLS), {
          kinds: [ExtendedKind.RSS_FEED_LIST],
          authors: [account.pubkey],
          limit: 1
        }).then(events => {
          const latestEvent = getLatestEvent(events)
          if (latestEvent) {
            // Only update if the fetched event is newer than cached
            if (!storedRssFeedListEvent || latestEvent.created_at > storedRssFeedListEvent.created_at) {
              logger.info('[NostrProvider] Found newer RSS feed list event from relays', {
                eventId: latestEvent.id,
                created_at: latestEvent.created_at,
                wasCached: !!storedRssFeedListEvent
              })
              indexedDb.putReplaceableEvent(latestEvent).then(() => {
                setRssFeedListEvent(latestEvent)
                logger.info('[NostrProvider] Updated RSS feed list event in cache and state')
              }).catch(err => {
                logger.error('[NostrProvider] Failed to cache RSS feed list event', { error: err })
              })
            } else {
              logger.info('[NostrProvider] Cached RSS feed list event is up to date', {
                cachedCreatedAt: storedRssFeedListEvent.created_at,
                fetchedCreatedAt: latestEvent.created_at
              })
            }
          } else if (!storedRssFeedListEvent) {
            logger.info('[NostrProvider] No RSS feed list event found on relays (user may not have created one yet)')
          }
        }).catch(err => {
          logger.error('[NostrProvider] Failed to fetch RSS feed list from relays', { error: err })
          // Don't clear cache on fetch error - use cached value
        })
      } else {
        logger.info('[NostrProvider] RSS feed list cache is fresh, using cached value')
      }

      const [relayListEvents, cacheRelayListEvents] = await Promise.all([
        client.fetchEvents(BIG_RELAY_URLS, {
          kinds: [kinds.RelayList],
          authors: [account.pubkey]
        }),
        client.fetchEvents(BIG_RELAY_URLS, {
          kinds: [ExtendedKind.CACHE_RELAYS],
          authors: [account.pubkey]
        })
      ])
      const relayListEvent = getLatestEvent(relayListEvents) ?? storedRelayListEvent
      const cacheRelayListEvent = getLatestEvent(cacheRelayListEvents) ?? storedCacheRelayListEvent
      const relayList = getRelayListFromEvent(relayListEvent, blockedRelays)
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
      // Fetch updated relay list (which merges both 10002 and 10432)
      const mergedRelayList = await client.fetchRelayList(account.pubkey)
      setRelayList(mergedRelayList)

      // Note: Deletion event fetching is now handled locally by individual components
      // for better performance and accuracy

      const normalizedRelays = [
        ...relayList.write.map((url: string) => normalizeUrl(url) || url),
        ...PROFILE_FETCH_RELAY_URLS.map((url: string) => normalizeUrl(url) || url)
      ]
      const fetchRelays = Array.from(new Set(normalizedRelays)).slice(0, 8)
      const events = await client.fetchEvents(fetchRelays, [
        {
          kinds: [
            kinds.Metadata,
            kinds.Contacts,
            kinds.Mutelist,
            kinds.BookmarkList,
            10015, // Interest list
            ExtendedKind.FAVORITE_RELAYS,
            ExtendedKind.BLOCKED_RELAYS,
            ExtendedKind.BLOSSOM_SERVER_LIST,
            kinds.UserEmojiList
          ],
          authors: [account.pubkey]
        },
        {
          kinds: [kinds.Application],
          authors: [account.pubkey],
          '#d': [ApplicationDataKey.NOTIFICATIONS_SEEN_AT]
        }
      ])
      const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
      const profileEvent = sortedEvents.find((e) => e.kind === kinds.Metadata)
      const followListEvent = sortedEvents.find((e) => e.kind === kinds.Contacts)
      const muteListEvent = sortedEvents.find((e) => e.kind === kinds.Mutelist)
      const bookmarkListEvent = sortedEvents.find((e) => e.kind === kinds.BookmarkList)
      const interestListEvent = sortedEvents.find((e) => e.kind === 10015)
      const favoriteRelaysEvent = sortedEvents.find((e) => e.kind === ExtendedKind.FAVORITE_RELAYS)
      const blockedRelaysEvent = sortedEvents.find((e) => e.kind === ExtendedKind.BLOCKED_RELAYS)
      const blossomServerListEvent = sortedEvents.find(
        (e) => e.kind === ExtendedKind.BLOSSOM_SERVER_LIST
      )
      const userEmojiListEvent = sortedEvents.find((e) => e.kind === kinds.UserEmojiList)
      const notificationsSeenAtEvent = sortedEvents.find(
        (e) =>
          e.kind === kinds.Application &&
          getReplaceableEventIdentifier(e) === ApplicationDataKey.NOTIFICATIONS_SEEN_AT
      )
      if (profileEvent) {
        const updatedProfileEvent = await indexedDb.putReplaceableEvent(profileEvent)
        if (updatedProfileEvent.id === profileEvent.id) {
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

      const notificationsSeenAt = Math.max(
        notificationsSeenAtEvent?.created_at ?? 0,
        storedNotificationsSeenAt
      )
      setNotificationsSeenAt(notificationsSeenAt)
      storage.setLastReadNotificationTime(account.pubkey, notificationsSeenAt)

      client.initUserIndexFromFollowings(account.pubkey, controller.signal)
      return controller
    }
    const promise = init()
    return () => {
      promise.then((controller) => {
        controller?.abort()
      })
    }
  }, [account])

  useEffect(() => {
    if (!account) return

    const initInteractions = async () => {
      const pubkey = account.pubkey
      const relayList = await client.fetchRelayList(pubkey)
      const events = await client.fetchEvents(relayList.write.slice(0, 4), [
        {
          authors: [pubkey],
          kinds: [kinds.Reaction, kinds.Repost],
          limit: 100
        },
        {
          '#P': [pubkey],
          kinds: [kinds.Zap],
          limit: 100
        }
      ])
      noteStatsService.updateNoteStatsByEvents(events)
    }
    initInteractions()
  }, [account])

  useEffect(() => {
    if (signer) {
      client.signer = signer
    } else {
      client.signer = undefined
    }
  }, [signer])

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

  const switchAccount = async (act: TAccountPointer | null) => {
    if (!act) {
      storage.switchAccount(null)
      setAccount(null)
      setSigner(null)
      return
    }
    await loginWithAccountPointer(act)
  }

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
    const password = prompt(t('Enter the password to decrypt your ncryptsec'))
    if (!password) {
      throw new Error('Password is required')
    }
    const privkey = nip49.decrypt(ncryptsec, password)
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
    let account = storage.findAccount(act)
    if (!account) {
      return null
    }
    if (account.signerType === 'nsec' || account.signerType === 'browser-nsec') {
      if (account.nsec) {
        const browserNsecSigner = new NsecSigner()
        browserNsecSigner.login(account.nsec)
        // Migrate to nsec
        if (account.signerType === 'browser-nsec') {
          storage.removeAccount(account)
          account = { ...account, signerType: 'nsec' }
          storage.addAccount(account)
        }
        return login(browserNsecSigner, account)
      }
    } else if (account.signerType === 'ncryptsec') {
      if (account.ncryptsec) {
        const password = prompt(t('Enter the password to decrypt your ncryptsec'))
        if (!password) {
          return null
        }
        const privkey = nip49.decrypt(account.ncryptsec, password)
        const browserNsecSigner = new NsecSigner()
        browserNsecSigner.login(privkey)
        return login(browserNsecSigner, account)
      }
    } else if (account.signerType === 'nip-07') {
      const nip07Signer = new Nip07Signer()
      await nip07Signer.init()
      return login(nip07Signer, account)
    } else if (account.signerType === 'bunker') {
      if (account.bunker && account.bunkerClientSecretKey) {
        const bunkerSigner = new BunkerSigner(account.bunkerClientSecretKey)
        const pubkey = await bunkerSigner.login(account.bunker, false)
        if (!pubkey) {
          storage.removeAccount(account)
          return null
        }
        if (pubkey !== account.pubkey) {
          storage.removeAccount(account)
          account = { ...account, pubkey }
          storage.addAccount(account)
        }
        return login(bunkerSigner, account)
      }
    } else if (account.signerType === 'npub' && account.npub) {
      const npubSigner = new NpubSigner()
      const pubkey = npubSigner.login(account.npub)
      if (!pubkey) {
        storage.removeAccount(account)
        return null
      }
      if (pubkey !== account.pubkey) {
        storage.removeAccount(account)
        account = { ...account, pubkey }
        storage.addAccount(account)
      }
      return login(npubSigner, account)
    }
    storage.removeAccount(account)
    return null
  }

  const setupNewUser = async (signer: ISigner) => {
    await Promise.allSettled([
      client.publishEvent(BIG_RELAY_URLS, await signer.signEvent(createFollowListDraftEvent([]))),
      client.publishEvent(BIG_RELAY_URLS, await signer.signEvent(createMuteListDraftEvent([]))),
      client.publishEvent(
        BIG_RELAY_URLS,
        await signer.signEvent(
          createRelayListDraftEvent(BIG_RELAY_URLS.map((url) => ({ url, scope: 'both' })))
        )
      )
    ])
  }

  const signEvent = async (draftEvent: TDraftEvent) => {
    // Add timeout to prevent hanging
    const signEventWithTimeout = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Signing request timed out. Your Nostr extension may be waiting for authorization. Try closing this tab and restarting your browser to surface any pending authorization requests from your extension.'))
      }, 30000) // 30 second timeout
      
      signer?.signEvent(draftEvent)
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

    const draft = JSON.parse(JSON.stringify(draftEvent)) as TDraftEvent
    let event: VerifiedEvent
    if (minPow > 0) {
      const unsignedEvent = await minePow({ ...draft, pubkey: account.pubkey }, minPow)
      event = await signEvent(unsignedEvent)
    } else {
      event = await signEvent(draft)
    }

    if (event.kind !== kinds.Application && event.pubkey !== account.pubkey) {
      const eventAuthor = await client.fetchProfile(event.pubkey)
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
    const relays = await client.determineTargetRelays(event, options)
    logger.debug('[Publish] Target relays determined', { relayCount: relays.length, relays: relays.slice(0, 5) })

    try {
      logger.debug('[Publish] Calling client.publishEvent()...', { relayCount: relays.length, eventId: event.id?.substring(0, 8) })
      const publishResult = await client.publishEvent(relays, event)
      logger.debug('[Publish] publishEvent completed', {
        success: publishResult.success,
        successCount: publishResult.successCount,
        totalCount: publishResult.totalCount,
        relayStatuses: publishResult.relayStatuses
      })
      
      // Store relay status temporarily for display (but don't persist it on the event)
      // This metadata is only for logging/feedback, not part of the actual event
      const relayStatuses = publishResult.relayStatuses.length > 0 ? publishResult.relayStatuses : undefined
      
      // If publishing failed completely, throw an error so the form doesn't close
      if (!publishResult.success) {
        logger.error('[Publish] Publishing failed to all relays!', {
          relayStatuses: publishResult.relayStatuses
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
      
      logger.debug('[Publish] Publishing successful, attaching relayStatuses to event')
      // Attach relayStatuses only temporarily for UI feedback, then remove it
      // This prevents it from being included in the event when serialized
      // Use a longer delay to ensure UI components can read it before deletion
      if (relayStatuses) {
        (event as any).relayStatuses = relayStatuses
        // Remove it after a delay to allow UI components to read it
        // Components should read it immediately after publish() returns
        setTimeout(() => {
          delete (event as any).relayStatuses
        }, 100)
      }
      
      // Emit newEvent immediately after publishing so UI components can react
      // This ensures replies appear immediately in the note view
      client.emitNewEvent(event)
      
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
    const relays = await client.determineTargetRelays(targetEvent)

    const result = await client.publishEvent(relays, deletionRequest)

    // Note: We don't need to add the deleted event to the provider here
    // since it's being published as a kind 5 event and will be fetched later
    
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
    return signer?.nip04Decrypt(pubkey, cipherText) ?? ''
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

  const updateProfileEvent = async (profileEvent: Event) => {
    const newProfileEvent = await indexedDb.putReplaceableEvent(profileEvent)
    setProfileEvent(newProfileEvent)
    setProfile(getProfileFromEvent(newProfileEvent))
  }

  const updateFollowListEvent = async (followListEvent: Event) => {
    const newFollowListEvent = await indexedDb.putReplaceableEvent(followListEvent)
    if (newFollowListEvent.id !== followListEvent.id) return

    setFollowListEvent(newFollowListEvent)
    await client.updateFollowListCache(newFollowListEvent)
  }

  const updateMuteListEvent = async (muteListEvent: Event, privateTags: string[][]) => {
    const newMuteListEvent = await indexedDb.putReplaceableEvent(muteListEvent)
    if (newMuteListEvent.id !== muteListEvent.id) return

    await indexedDb.putMuteDecryptedTags(muteListEvent.id, privateTags)
    setMuteListEvent(muteListEvent)
  }

  const updateBookmarkListEvent = async (bookmarkListEvent: Event) => {
    const newBookmarkListEvent = await indexedDb.putReplaceableEvent(bookmarkListEvent)
    if (newBookmarkListEvent.id !== bookmarkListEvent.id) return

    setBookmarkListEvent(newBookmarkListEvent)
  }

  const updateInterestListEvent = async (interestListEvent: Event) => {
    const newInterestListEvent = await indexedDb.putReplaceableEvent(interestListEvent)
    if (newInterestListEvent.id !== interestListEvent.id) return

    setInterestListEvent(newInterestListEvent)
  }

  const updateFavoriteRelaysEvent = async (favoriteRelaysEvent: Event) => {
    const newFavoriteRelaysEvent = await indexedDb.putReplaceableEvent(favoriteRelaysEvent)
    if (newFavoriteRelaysEvent.id !== favoriteRelaysEvent.id) return

    setFavoriteRelaysEvent(newFavoriteRelaysEvent)
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

  const updateNotificationsSeenAt = async (skipPublish = false) => {
    if (!account) return

    const now = dayjs().unix()
    storage.setLastReadNotificationTime(account.pubkey, now)
    setTimeout(() => {
      setNotificationsSeenAt(now)
    }, 5_000)

    // Prevent too frequent requests for signing seen notifications events
    const lastPublishedSeenNotificationsAtEventAt =
      lastPublishedSeenNotificationsAtEventAtMap.get(account.pubkey) ?? -1
    if (
      !skipPublish &&
      (lastPublishedSeenNotificationsAtEventAt < 0 ||
        now - lastPublishedSeenNotificationsAtEventAt > 10 * 60) // 10 minutes
    ) {
      await publish(createSeenNotificationsAtDraftEvent())
      lastPublishedSeenNotificationsAtEventAtMap.set(account.pubkey, now)
    }
  }

  return (
    <NostrContext.Provider
      value={{
        isInitialized,
        pubkey: account?.pubkey ?? null,
        profile,
        profileEvent,
        relayList,
        cacheRelayListEvent,
        followListEvent,
        muteListEvent,
        bookmarkListEvent,
        interestListEvent,
        favoriteRelaysEvent,
        blockedRelaysEvent,
        userEmojiListEvent,
        rssFeedListEvent,
        notificationsSeenAt,
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
        updateProfileEvent,
        updateFollowListEvent,
        updateMuteListEvent,
        updateBookmarkListEvent,
        updateInterestListEvent,
        updateFavoriteRelaysEvent,
        updateBlockedRelaysEvent,
        updateRssFeedListEvent,
        updateNotificationsSeenAt
      }}
    >
      {children}
      <LoginDialog open={openLoginDialog} setOpen={setOpenLoginDialog} />
    </NostrContext.Provider>
  )
}
