import { DEFAULT_FAVORITE_RELAYS } from '@/constants'
import { getRelaySetFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { isWebsocketUrl, normalizeUrl } from '@/lib/url'
import indexedDb from '@/services/indexed-db.service'
import storage from '@/services/local-storage.service'
import { TFeedInfo, TFeedType } from '@/types'
import { kinds } from 'nostr-tools'
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import { useNostr } from './NostrProvider'

type TFeedContext = {
  feedInfo: TFeedInfo
  relayUrls: string[]
  isReady: boolean
  switchFeed: (
    feedType: TFeedType,
    options?: { activeRelaySetId?: string; pubkey?: string; relay?: string | null }
  ) => Promise<void>
}

const FeedContext = createContext<TFeedContext | undefined>(undefined)

export const useFeed = () => {
  const context = useContext(FeedContext)
  if (!context) {
    throw new Error('useFeed must be used within a FeedProvider')
  }
  return context
}

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, isInitialized } = useNostr()
  const { relaySets, favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [relayUrls, setRelayUrls] = useState<string[]>([])
  const [isReady, setIsReady] = useState(false)
  const [feedInfo, setFeedInfo] = useState<TFeedInfo>({
    feedType: 'relay',
    id: DEFAULT_FAVORITE_RELAYS[0]
  })
  const feedInfoRef = useRef<TFeedInfo>(feedInfo)

  const switchFeed = useCallback(async (
    feedType: TFeedType,
    options: {
      activeRelaySetId?: string | null
      pubkey?: string | null
      relay?: string | null
    } = {}
  ) => {
    logger.debug('switchFeed called:', { feedType, options })
    setIsReady(false)
    if (feedType === 'relay') {
      const normalizedUrl = normalizeUrl(options.relay ?? '')
      logger.debug('Relay switchFeed:', { normalizedUrl, isWebsocketUrl: isWebsocketUrl(normalizedUrl), blockedRelays })
      
      if (!normalizedUrl || !isWebsocketUrl(normalizedUrl)) {
        logger.debug('Invalid relay URL, setting isReady to true')
        setIsReady(true)
        return
      }
      
      // Don't allow selecting a blocked relay as feed
      if (blockedRelays.includes(normalizedUrl)) {
        logger.warn('Cannot select blocked relay as feed:', normalizedUrl)
        setIsReady(true)
        return
      }

      const newFeedInfo = { feedType, id: normalizedUrl }
      logger.component('FeedProvider', 'Setting relay feed info', newFeedInfo)
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      setRelayUrls([normalizedUrl])
      logger.component('FeedProvider', 'Set relayUrls', { relayUrls: [normalizedUrl] })
      storage.setFeedInfo(newFeedInfo, pubkey)
      // Reset note list mode to 'posts' when switching to relay feed to ensure main content is shown
      storage.setNoteListMode('posts')
      setIsReady(true)
      logger.component('FeedProvider', 'Relay feed setup complete, isReady set to true')
      return
    }
    if (feedType === 'relays') {
      const relaySetId = options.activeRelaySetId ?? (relaySets.length > 0 ? relaySets[0].id : null)
      if (!relaySetId || !pubkey) {
        setIsReady(true)
        return
      }

      let relaySet =
        relaySets.find((set) => set.id === relaySetId) ??
        (relaySets.length > 0 ? relaySets[0] : null)
      if (!relaySet) {
        const storedRelaySetEvent = await indexedDb.getReplaceableEvent(
          pubkey,
          kinds.Relaysets,
          relaySetId
        )
        if (storedRelaySetEvent) {
          relaySet = getRelaySetFromEvent(storedRelaySetEvent, blockedRelays)
        }
      }
      if (relaySet) {
        const newFeedInfo = { feedType, id: relaySet.id }
        setFeedInfo(newFeedInfo)
        feedInfoRef.current = newFeedInfo
        setRelayUrls(relaySet.relayUrls)
        storage.setFeedInfo(newFeedInfo, pubkey)
        // Reset note list mode to 'posts' when switching to relay set to ensure main content is shown
        storage.setNoteListMode('posts')
        setIsReady(true)
      }
      setIsReady(true)
      return
    }
    if (feedType === 'following') {
      if (!options.pubkey) {
        setIsReady(true)
        return
      }
      const newFeedInfo = { feedType }
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      storage.setFeedInfo(newFeedInfo, pubkey)

      setRelayUrls([])
      setIsReady(true)
      return
    }
    if (feedType === 'all-favorites') {
      // Filter out blocked relays
      const visibleRelays = favoriteRelays.filter(relay => !blockedRelays.includes(relay))
      
      // If no visible relays, fall back to default favorite relays
      const finalRelays = visibleRelays.length > 0 ? visibleRelays : DEFAULT_FAVORITE_RELAYS
      
      logger.debug('Switching to all-favorites, favoriteRelays:', visibleRelays, 'finalRelays:', finalRelays)
      const newFeedInfo = { feedType }
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      setRelayUrls(finalRelays)
      storage.setFeedInfo(newFeedInfo, pubkey)
      // Reset note list mode to 'posts' when switching to all-favorites to ensure main content is shown
      storage.setNoteListMode('posts')
      setIsReady(true)
      return
    }
    if (feedType === 'bookmarks') {
      if (!options.pubkey) {
        setIsReady(true)
        return
      }

      const newFeedInfo = { feedType }
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      storage.setFeedInfo(newFeedInfo, pubkey)

      setRelayUrls([])
      setIsReady(true)
      return
    }
    setIsReady(true)
  }, [pubkey, favoriteRelays, blockedRelays, relaySets])

  useEffect(() => {
    const init = async () => {
      logger.debug('FeedProvider init:', { isInitialized, pubkey, favoriteRelays: favoriteRelays.length, blockedRelays: blockedRelays.length })
      if (!isInitialized) {
        return
      }

      // Wait for favoriteRelays to be initialized (should have at least default relays)
      // If favoriteRelays is empty, it might not be initialized yet, so wait
      if (favoriteRelays.length === 0 && !pubkey) {
        // For anonymous users, favoriteRelays should be initialized from FAST_READ_RELAY_URLS
        // If it's still empty, something is wrong, but we'll use defaults
        logger.debug('FeedProvider: favoriteRelays is empty, using defaults')
      }

      // Get first visible (non-blocked) favorite relay as default
      const visibleRelays = favoriteRelays.filter(relay => !blockedRelays.includes(relay))
      let feedInfo: TFeedInfo = {
        feedType: 'relay',
        id: visibleRelays[0] ?? DEFAULT_FAVORITE_RELAYS[0]
      }
      
      // Ensure we always have a valid relay ID
      if (!feedInfo.id) {
        feedInfo.id = DEFAULT_FAVORITE_RELAYS[0]
      }
      logger.debug('Initial feedInfo setup:', { visibleRelays, favoriteRelays, blockedRelays, feedInfo })
      
      if (pubkey) {
        const storedFeedInfo = storage.getFeedInfo(pubkey)
        logger.debug('Stored feed info:', storedFeedInfo)
        if (storedFeedInfo) {
          feedInfo = storedFeedInfo
        }
      }

      if (feedInfo.feedType === 'relays') {
        return await switchFeed('relays', { activeRelaySetId: feedInfo.id })
      }

      if (feedInfo.feedType === 'relay') {
        // Check if the stored relay is blocked, if so use first visible relay instead
        if (feedInfo.id && blockedRelays.includes(feedInfo.id)) {
          logger.component('FeedProvider', 'Stored relay is blocked, using first visible relay instead')
          feedInfo.id = visibleRelays[0] ?? DEFAULT_FAVORITE_RELAYS[0]
        }
        logger.component('FeedProvider', 'Initial relay setup, calling switchFeed', { relayId: feedInfo.id })
        return await switchFeed('relay', { relay: feedInfo.id })
      }

      // update following feed if pubkey changes
      if (feedInfo.feedType === 'following' && pubkey) {
        return await switchFeed('following', { pubkey })
      }

      if (feedInfo.feedType === 'bookmarks' && pubkey) {
        return await switchFeed('bookmarks', { pubkey })
      }

      if (feedInfo.feedType === 'all-favorites') {
        logger.debug('Initializing all-favorites feed')
        return await switchFeed('all-favorites')
      }
    }

    init()
  }, [pubkey, isInitialized, favoriteRelays, blockedRelays, switchFeed])

  // Update relay URLs when favoriteRelays change and we're in all-favorites mode
  useEffect(() => {
    if (feedInfo.feedType === 'all-favorites') {
      // Filter out blocked relays
      const visibleRelays = favoriteRelays.filter(relay => !blockedRelays.includes(relay))
      logger.debug('Updating relay URLs for all-favorites:', visibleRelays)
      setRelayUrls(visibleRelays)
    }
  }, [pubkey, isInitialized, favoriteRelays, blockedRelays, relaySets])

  return (
    <FeedContext.Provider
      value={{
        feedInfo,
        relayUrls,
        isReady,
        switchFeed
      }}
    >
      {children}
    </FeedContext.Provider>
  )
}
