import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { buildATag, buildETag, createBookmarkDraftEvent } from '@/lib/draft-event'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import {
  bookmarkListTagsAfterRemovingRef,
  decodePersonalListBech32Ref
} from '@/lib/personal-list-mutations'
import { fetchLatestReplaceableListEvent } from '@/lib/replaceable-list-latest'
import logger from '@/lib/logger'
import client from '@/services/client.service'
import { Event, kinds } from 'nostr-tools'
import { useCallback } from 'react'
import { BookmarksContext } from '@/providers/bookmarks-context'
import { useNostr } from './NostrProvider'
import { useFavoriteRelays } from './FavoriteRelaysProvider'

export function BookmarksProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: accountPubkey, publish, updateBookmarkListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()

  const buildComprehensiveRelayList = useCallback(async () => {
    if (!accountPubkey) return [] as string[]
    return buildAccountListRelayUrlsForMerge({
      accountPubkey,
      favoriteRelays: favoriteRelays ?? [],
      blockedRelays
    })
  }, [accountPubkey, favoriteRelays, blockedRelays])

  const addBookmark = async (event: Event) => {
    if (!accountPubkey) return

    const comprehensiveRelays = await buildComprehensiveRelayList()
    let bookmarkListEvent =
      (await fetchLatestReplaceableListEvent(accountPubkey, kinds.BookmarkList, comprehensiveRelays)) ?? null
    if (!bookmarkListEvent) {
      bookmarkListEvent = (await client.fetchBookmarkListEvent(accountPubkey)) ?? null
    }
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

    logger.component('BookmarksProvider', 'Publishing to comprehensive relays', { count: comprehensiveRelays.length })

    const newBookmarkEvent = await publish(newBookmarkDraftEvent, {
      specifiedRelayUrls: comprehensiveRelays
    })
    await updateBookmarkListEvent(newBookmarkEvent)
  }

  const removeBookmark = async (event: Event): Promise<boolean> => {
    if (!accountPubkey) return false

    const comprehensiveRelays = await buildComprehensiveRelayList()
    let bookmarkListEvent =
      (await fetchLatestReplaceableListEvent(accountPubkey, kinds.BookmarkList, comprehensiveRelays)) ?? null
    if (!bookmarkListEvent) {
      bookmarkListEvent = (await client.fetchBookmarkListEvent(accountPubkey)) ?? null
    }
    if (!bookmarkListEvent) return false

    const isReplaceable = isReplaceableEvent(event.kind)
    const eventKey = isReplaceable ? getReplaceableCoordinateFromEvent(event) : event.id

    const newTags = bookmarkListEvent.tags.filter((tag) =>
      isReplaceable ? tag[0] !== 'a' || tag[1] !== eventKey : tag[0] !== 'e' || tag[1] !== eventKey
    )
    if (newTags.length === bookmarkListEvent.tags.length) return false

    const newBookmarkDraftEvent = createBookmarkDraftEvent(newTags, bookmarkListEvent.content)

    logger.component('BookmarksProvider', 'Publishing to comprehensive relays', { count: comprehensiveRelays.length })

    const newBookmarkEvent = await publish(newBookmarkDraftEvent, {
      specifiedRelayUrls: comprehensiveRelays
    })
    await updateBookmarkListEvent(newBookmarkEvent)
    return true
  }

  const removeBookmarkByBech32 = async (bech32Id: string): Promise<boolean> => {
    if (!accountPubkey) return false

    const ref = decodePersonalListBech32Ref(bech32Id)
    if (!ref) return false

    const comprehensiveRelays = await buildComprehensiveRelayList()
    let bookmarkListEvent =
      (await fetchLatestReplaceableListEvent(accountPubkey, kinds.BookmarkList, comprehensiveRelays)) ?? null
    if (!bookmarkListEvent) {
      bookmarkListEvent = (await client.fetchBookmarkListEvent(accountPubkey)) ?? null
    }
    if (!bookmarkListEvent) return false

    const newTags = bookmarkListTagsAfterRemovingRef(bookmarkListEvent.tags, ref)
    if (!newTags) return false

    const newBookmarkDraftEvent = createBookmarkDraftEvent(newTags, bookmarkListEvent.content)

    logger.component('BookmarksProvider', 'Publishing bookmark list update (remove by bech32)', {
      count: comprehensiveRelays.length
    })

    const newBookmarkEvent = await publish(newBookmarkDraftEvent, {
      specifiedRelayUrls: comprehensiveRelays
    })
    await updateBookmarkListEvent(newBookmarkEvent)
    return true
  }

  return (
    <BookmarksContext.Provider
      value={{
        addBookmark,
        removeBookmark,
        removeBookmarkByBech32
      }}
    >
      {children}
    </BookmarksContext.Provider>
  )
}
