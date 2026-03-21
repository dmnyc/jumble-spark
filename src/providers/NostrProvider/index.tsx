import LoginDialog from '@/components/LoginDialog'
import { FAST_READ_RELAY_URLS, ExtendedKind, FAST_WRITE_RELAY_URLS, PROFILE_FETCH_RELAY_URLS, PROFILE_RELAY_URLS } from '@/constants'
import {
  buildAltTag,
  buildClientTag,
  createDeletionRequestDraftEvent,
  createFollowListDraftEvent,
  createMuteListDraftEvent,
  createRelayListDraftEvent
} from '@/lib/draft-event'
import { getLatestEvent, minePow } from '@/lib/event'
import { getProfileFromEvent, getRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { normalizeUrl } from '@/lib/url'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import client from '@/services/client.service'
import { queryService, replaceableEventService } from '@/services/client.service'
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
import { NostrContext } from '@/providers/nostr-context'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BunkerSigner } from './bunker.signer'
import { Nip07Signer } from './nip-07.signer'
import { NostrConnectionSigner } from './nostrConnection.signer'
import { NpubSigner } from './npub.signer'
import { NsecSigner } from './nsec.signer'

export { useNostr } from '@/providers/nostr-context'
export type { TNostrContext } from '@/providers/nostr-context'

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
        logger.debug('[NostrProvider] Loaded RSS feed list event from cache', {
          eventId: storedRssFeedListEvent.id,
          created_at: storedRssFeedListEvent.created_at
        })
      }

      // Fetch RSS feed list from relays if cache is missing or stale (older than 1 hour)
      const rssFeedListStale = !storedRssFeedListEvent || 
        (dayjs().unix() - storedRssFeedListEvent.created_at > 3600) // 1 hour
      
      if (rssFeedListStale) {
        logger.debug('[NostrProvider] RSS feed list cache is missing or stale, fetching from relays', {
          hasCache: !!storedRssFeedListEvent,
          cacheAge: storedRssFeedListEvent ? dayjs().unix() - storedRssFeedListEvent.created_at : 'N/A'
        })
        
        // Fetch in background - don't block initialization
        queryService.fetchEvents(FAST_WRITE_RELAY_URLS.concat(PROFILE_RELAY_URLS), {
          kinds: [ExtendedKind.RSS_FEED_LIST],
          authors: [account.pubkey],
          limit: 1
        }).then(events => {
          const latestEvent = getLatestEvent(events)
          if (latestEvent) {
            // Only update if the fetched event is newer than cached
            if (!storedRssFeedListEvent || latestEvent.created_at > storedRssFeedListEvent.created_at) {
              logger.debug('[NostrProvider] Found newer RSS feed list event from relays', {
                eventId: latestEvent.id,
                created_at: latestEvent.created_at,
                wasCached: !!storedRssFeedListEvent
              })
              indexedDb.putReplaceableEvent(latestEvent).then(() => {
                setRssFeedListEvent(latestEvent)
                logger.debug('[NostrProvider] Updated RSS feed list event in cache and state')
              }).catch(err => {
                logger.error('[NostrProvider] Failed to cache RSS feed list event', { error: err })
              })
            } else {
              logger.debug('[NostrProvider] Cached RSS feed list event is up to date', {
                cachedCreatedAt: storedRssFeedListEvent.created_at,
                fetchedCreatedAt: latestEvent.created_at
              })
            }
          } else if (!storedRssFeedListEvent) {
            logger.debug('[NostrProvider] No RSS feed list event found on relays (user may not have created one yet)')
          }
        }).catch(err => {
          logger.error('[NostrProvider] Failed to fetch RSS feed list from relays', { error: err })
          // Don't clear cache on fetch error - use cached value
        })
      } else {
        logger.debug('[NostrProvider] RSS feed list cache is fresh, using cached value')
      }

      const [relayListEvents, cacheRelayListEvents] = await Promise.all([
        queryService.fetchEvents(FAST_READ_RELAY_URLS, {
          kinds: [kinds.RelayList],
          authors: [account.pubkey]
        }),
        queryService.fetchEvents(FAST_READ_RELAY_URLS, {
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
      const mergedRelayList = await client.fetchRelayList(account.pubkey) // Keep using client for relay list merging
      setRelayList(mergedRelayList)

      const deletionRelayUrls = Array.from(
        new Set([
          ...mergedRelayList.write.map((url: string) => normalizeUrl(url) || url),
          ...mergedRelayList.read.slice(0, 8).map((url: string) => normalizeUrl(url) || url),
          ...PROFILE_FETCH_RELAY_URLS.map((url: string) => normalizeUrl(url) || url),
        ])
      ).slice(0, 20)

      client.fetchDeletionEvents(deletionRelayUrls, account.pubkey).catch((err) =>
        logger.warn('[NostrProvider] Failed to sync deletion events / tombstones', { error: err })
      )

      const normalizedRelays = [
        ...relayList.write.map((url: string) => normalizeUrl(url) || url),
        ...PROFILE_FETCH_RELAY_URLS.map((url: string) => normalizeUrl(url) || url)
      ]
      const fetchRelays = Array.from(new Set(normalizedRelays)).slice(0, 8)
      const events = await queryService.fetchEvents(fetchRelays, [
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
      const events = await queryService.fetchEvents(relayList.write.slice(0, 4), [
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
    client.signerType = account?.signerType
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
      client.publishEvent(FAST_READ_RELAY_URLS, await signer.signEvent(createFollowListDraftEvent([]))),
      client.publishEvent(FAST_READ_RELAY_URLS, await signer.signEvent(createMuteListDraftEvent([]))),
      client.publishEvent(
        FAST_READ_RELAY_URLS,
        await signer.signEvent(
          createRelayListDraftEvent(FAST_READ_RELAY_URLS.map((url) => ({ url, scope: 'both' })))
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
    // 1) Remove any existing "client" tag so we control the only one
    if (draft.tags?.length) {
      draft.tags = draft.tags.filter((tag) => Array.isArray(tag) && tag[0] !== 'client')
    }
    // 2) If user has allowed adding a client tag, add our own
    const addClientTag =
      typeof options.addClientTag === 'boolean'
        ? options.addClientTag
        : (typeof window !== 'undefined' && storage.getAddClientTag())
    if (addClientTag) {
      draft.tags = draft.tags ?? []
      draft.tags.push(buildClientTag(), buildAltTag())
    }
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
      
      // If at least one relay accepted, cache and emit immediately so UI shows the event without waiting
      if (publishResult.successCount >= 1) {
        client.addEventToCache(event)
        client.emitNewEvent(event)
      }

      // If publishing failed completely, throw an error so the form doesn't close
      if (!publishResult.success) {
        logger.error('[Publish] Publishing failed to all relays!', {
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
        if (publishResult.successCount >= 1) (error as any).event = event
        throw error
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
    const relays = await client.determineTargetRelays(targetEvent)

    const result = await client.publishEvent(relays, deletionRequest)

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
        updateRssFeedListEvent
      }}
    >
      {children}
      <LoginDialog open={openLoginDialog} setOpen={setOpenLoginDialog} />
    </NostrContext.Provider>
  )
}
