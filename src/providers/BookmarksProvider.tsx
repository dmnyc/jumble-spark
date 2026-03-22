import { buildATag, buildETag, createBookmarkDraftEvent } from '@/lib/draft-event'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { buildPrioritizedReadRelayUrls, buildPrioritizedWriteRelayUrls } from '@/lib/relay-url-priority'
import logger from '@/lib/logger'
import client from '@/services/client.service'
import { replaceableEventService } from '@/services/client.service'
import { kinds } from 'nostr-tools'
import { Event } from 'nostr-tools'
import { createContext, useCallback, useContext } from 'react'
import { useNostr } from './NostrProvider'
import { useFavoriteRelays } from './FavoriteRelaysProvider'

type TBookmarksContext = {
  addBookmark: (event: Event) => Promise<void>
  removeBookmark: (event: Event) => Promise<void>
}

const BookmarksContext = createContext<TBookmarksContext | undefined>(undefined)

export const useBookmarks = () => {
  const context = useContext(BookmarksContext)
  if (!context) {
    throw new Error('useBookmarks must be used within a BookmarksProvider')
  }
  return context
}

export function BookmarksProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: accountPubkey, publish, updateBookmarkListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()

  // Build comprehensive relay list for publishing (same as ProfileFeed)
  const buildComprehensiveRelayList = useCallback(async () => {
    const myRelayList = accountPubkey ? await client.fetchRelayList(accountPubkey) : { write: [], read: [] }
    const favoritesTier = getFavoritesFeedRelayUrls(favoriteRelays ?? [], blockedRelays)
    const read = buildPrioritizedReadRelayUrls({
      userReadRelays: myRelayList.read ?? [],
      userWriteRelays: myRelayList.write ?? [],
      favoriteRelays: favoritesTier,
      blockedRelays,
      maxRelays: 100,
      applyKind1BlockedFilter: false
    })
    const write = buildPrioritizedWriteRelayUrls({
      userWriteRelays: myRelayList.write ?? [],
      favoriteRelays: favoritesTier,
      blockedRelays,
      maxRelays: 100,
      applyKind1BlockedFilter: false
    })
    return [...new Set([...read, ...write])]
  }, [accountPubkey, favoriteRelays, blockedRelays])

  const addBookmark = async (event: Event) => {
    if (!accountPubkey) return

    const bookmarkListEvent = await replaceableEventService.fetchReplaceableEvent(accountPubkey, kinds.BookmarkList) ?? null
    const currentTags = bookmarkListEvent?.tags || []
    const isReplaceable = isReplaceableEvent(event.kind)
    const eventKey = isReplaceable ? getReplaceableCoordinateFromEvent(event) : event.id

    if (
      currentTags.some((tag) =>
        isReplaceable
          ? tag[0] === 'a' && tag[1] === eventKey
          : tag[0] === 'e' && tag[1] === eventKey
      )
    ) {
      return
    }

    const newBookmarkDraftEvent = createBookmarkDraftEvent(
      [...currentTags, isReplaceable ? buildATag(event) : buildETag(event.id, event.pubkey)],
      bookmarkListEvent?.content
    )
    
    // Use the same comprehensive relay list as pins for publishing
    const comprehensiveRelays = await buildComprehensiveRelayList()
    logger.component('BookmarksProvider', 'Publishing to comprehensive relays', { count: comprehensiveRelays.length })
    
    const newBookmarkEvent = await publish(newBookmarkDraftEvent, {
      specifiedRelayUrls: comprehensiveRelays
    })
    await updateBookmarkListEvent(newBookmarkEvent)
  }

  const removeBookmark = async (event: Event) => {
    if (!accountPubkey) return

    const bookmarkListEvent = await replaceableEventService.fetchReplaceableEvent(accountPubkey, kinds.BookmarkList) ?? null
    if (!bookmarkListEvent) return

    const isReplaceable = isReplaceableEvent(event.kind)
    const eventKey = isReplaceable ? getReplaceableCoordinateFromEvent(event) : event.id

    const newTags = bookmarkListEvent.tags.filter((tag) =>
      isReplaceable ? tag[0] !== 'a' || tag[1] !== eventKey : tag[0] !== 'e' || tag[1] !== eventKey
    )
    if (newTags.length === bookmarkListEvent.tags.length) return

    const newBookmarkDraftEvent = createBookmarkDraftEvent(newTags, bookmarkListEvent.content)
    
    // Use the same comprehensive relay list as pins for publishing
    const comprehensiveRelays = await buildComprehensiveRelayList()
    logger.component('BookmarksProvider', 'Publishing to comprehensive relays', { count: comprehensiveRelays.length })
    
    const newBookmarkEvent = await publish(newBookmarkDraftEvent, {
      specifiedRelayUrls: comprehensiveRelays
    })
    await updateBookmarkListEvent(newBookmarkEvent)
  }

  return (
    <BookmarksContext.Provider
      value={{
        addBookmark,
        removeBookmark
      }}
    >
      {children}
    </BookmarksContext.Provider>
  )
}
