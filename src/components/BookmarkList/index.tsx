import { useFetchEvent } from '@/hooks'
import { PROFILE_FETCH_RELAY_URLS } from '@/constants'
import { getLatestEvent } from '@/lib/event'
import { generateBech32IdFromATag, generateBech32IdFromETag } from '@/lib/tag'
import { normalizeUrl } from '@/lib/url'
import { useNostr } from '@/providers/NostrProvider'
import { queryService } from '@/services/client.service'
import { kinds } from 'nostr-tools'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NoteCard, { NoteCardLoadingSkeleton } from '../NoteCard'

const SHOW_COUNT = 10

const BookmarkList = forwardRef(function BookmarkList(_, ref) {
  const { t } = useTranslation()
  const { bookmarkListEvent, pubkey, relayList, updateBookmarkListEvent } = useNostr()
  const eventIds = useMemo(() => {
    if (!bookmarkListEvent) return []

    return (
      bookmarkListEvent.tags
        .map((tag) =>
          tag[0] === 'e'
            ? generateBech32IdFromETag(tag)
            : tag[0] === 'a'
              ? generateBech32IdFromATag(tag)
              : null
        )
        .filter(Boolean) as (`nevent1${string}` | `naddr1${string}`)[]
    ).reverse()
  }, [bookmarkListEvent])
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      refresh: async () => {
        if (!pubkey) return
        const urls = Array.from(
          new Set(
            [
              ...PROFILE_FETCH_RELAY_URLS.map((u) => normalizeUrl(u) || u),
              ...(relayList?.write ?? []).map((u) => normalizeUrl(u) || u)
            ].filter(Boolean)
          )
        ).slice(0, 12)
        if (urls.length === 0) return
        try {
          const events = await queryService.fetchEvents(urls, {
            kinds: [kinds.BookmarkList],
            authors: [pubkey],
            limit: 5
          })
          const latest = getLatestEvent(events)
          if (latest) await updateBookmarkListEvent(latest)
        } catch {
          /* ignore */
        }
      }
    }),
    [pubkey, relayList, updateBookmarkListEvent]
  )

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 0.1
    }

    const loadMore = () => {
      if (showCount < eventIds.length) {
        setShowCount((prev) => prev + SHOW_COUNT)
      }
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore()
      }
    }, options)

    const currentBottomRef = bottomRef.current

    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [showCount, eventIds])

  if (eventIds.length === 0) {
    return (
      <div className="mt-2 text-sm text-center text-muted-foreground">
        {t('no bookmarks found')}
      </div>
    )
  }

  return (
    <div>
      {eventIds.slice(0, showCount).map((eventId) => (
        <BookmarkedNote key={eventId} eventId={eventId} />
      ))}

      {showCount < eventIds.length ? (
        <div ref={bottomRef}>
          <NoteCardLoadingSkeleton />
        </div>
      ) : (
        <div className="text-center text-sm text-muted-foreground mt-2">
          {t('no more bookmarks')}
        </div>
      )}
    </div>
  )
})

BookmarkList.displayName = 'BookmarkList'
export default BookmarkList

function BookmarkedNote({ eventId }: { eventId: string }) {
  const { event, isFetching } = useFetchEvent(eventId)

  if (isFetching) {
    return <NoteCardLoadingSkeleton />
  }

  if (!event) {
    return null
  }

  return <NoteCard event={event} className="w-full" />
}
