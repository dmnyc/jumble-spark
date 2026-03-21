import { FAST_READ_RELAY_URLS } from '@/constants'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { normalizeUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import client from '@/services/client.service'
import dayjs from 'dayjs'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import NoteCard, { NoteCardLoadingSkeleton } from '../NoteCard'

const LIMIT = 100
const SHOW_COUNT = 10
/** Multi-filter quote subs only set `eosed` after every sub EOSEs; one stuck relay would otherwise leave the UI loading forever. */
const INITIAL_QUOTE_LOAD_TIMEOUT_MS = 12_000

export default function QuoteList({
  event,
  className,
  embedded = false
}: {
  event: Event
  className?: string
  /** When true, compact layout for use below the replies feed (no full-tab min-height). */
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const { relayList: userRelayList } = useNostr()
  const { relayUrls: browsingRelayUrls } = useCurrentRelays()
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
  const [events, setEvents] = useState<Event[]>([])
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const receivedAnyQuotesRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let loadTimeoutId: ReturnType<typeof setTimeout> | undefined

    async function init() {
      setLoading(true)
      setEvents([])
      setHasMore(true)
      receivedAnyQuotesRef.current = false

      loadTimeoutId = setTimeout(() => {
        if (cancelled) return
        setLoading(false)
        if (!receivedAnyQuotesRef.current) {
          setHasMore(false)
        }
      }, INITIAL_QUOTE_LOAD_TIMEOUT_MS)

      const userRelays = userRelayList?.read || []
      const fromFeed = browsingRelayUrls.map((u) => normalizeUrl(u) || u).filter(Boolean)
      const finalRelayUrls = Array.from(
        new Set([
          ...fromFeed,
          ...userRelays.map((url) => normalizeUrl(url) || url),
          ...FAST_READ_RELAY_URLS.map((url) => normalizeUrl(url) || url)
        ])
      )

      const eventId = isReplaceableEvent(event.kind) ? getReplaceableCoordinateFromEvent(event) : event.id
      const eventCoordinate = isReplaceableEvent(event.kind) ? getReplaceableCoordinateFromEvent(event) : `${event.kind}:${event.pubkey}:${event.id}`

      const { closer, timelineKey } = await client.subscribeTimeline(
        [
          {
            urls: finalRelayUrls,
            filter: {
              '#q': [eventId],
              kinds: [
                kinds.ShortTextNote
              ],
              limit: LIMIT
            }
          },
          {
            urls: finalRelayUrls,
            filter: {
              '#e': [eventId],
              kinds: [
                kinds.Highlights,
                kinds.LongFormArticle
              ],
              limit: LIMIT
            }
          },
          {
            urls: finalRelayUrls,
            filter: {
              '#a': [eventCoordinate],
              kinds: [
                kinds.Highlights,
                kinds.LongFormArticle
              ],
              limit: LIMIT
            }
          }
        ],
        {
          onEvents: (batch, eosed) => {
            if (cancelled) return
            if (batch.length > 0) {
              receivedAnyQuotesRef.current = true
              setEvents(batch)
            }
            if (batch.length > 0 || eosed) {
              setLoading(false)
              if (loadTimeoutId) {
                clearTimeout(loadTimeoutId)
                loadTimeoutId = undefined
              }
            }
            if (eosed) {
              setHasMore(batch.length > 0)
            }
          },
          onNew: (newEvt) => {
            if (cancelled) return
            receivedAnyQuotesRef.current = true
            setLoading(false)
            if (loadTimeoutId) {
              clearTimeout(loadTimeoutId)
              loadTimeoutId = undefined
            }
            setHasMore(true)
            setEvents((oldEvents) =>
              [newEvt, ...oldEvents].sort((a, b) => b.created_at - a.created_at)
            )
          }
        },
        {
          useCache: false // NO CACHING - stream raw from relays
        }
      )
      if (cancelled) {
        closer()
        return undefined
      }
      setTimelineKey(timelineKey)
      return closer
    }

    const promise = init()
    return () => {
      cancelled = true
      if (loadTimeoutId) clearTimeout(loadTimeoutId)
      promise.then((closer) => closer?.())
    }
  }, [event, browsingRelayUrls, userRelayList?.read])

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 0.1
    }

    const loadMore = async () => {
      if (showCount < events.length) {
        setShowCount((prev) => prev + SHOW_COUNT)
        // preload more
        if (events.length - showCount > LIMIT / 2) {
          return
        }
      }

      if (!timelineKey || loading || !hasMore) return
      setLoading(true)
      try {
        const newEvents = await client.loadMoreTimeline(
          timelineKey,
          events.length ? events[events.length - 1].created_at - 1 : dayjs().unix(),
          LIMIT
        )
        
        // CRITICAL FIX: Be more conservative about stopping
        // Check if timeline has more cached refs that we haven't loaded yet
        if (newEvents.length === 0) {
          const until = events.length ? events[events.length - 1].created_at - 1 : dayjs().unix()
          const hasMoreCached = client.hasMoreTimelineEvents?.(timelineKey, until) ?? false
          
          if (hasMoreCached) {
            // There are more cached events, keep hasMore true and try again
            setLoading(false)
            setTimeout(() => {
              if (hasMore && !loading) {
                loadMore()
              }
            }, 300)
            return
          }
          
          // No more events available, stop loading
          setHasMore(false)
        } else {
          setEvents((oldEvents) => [...oldEvents, ...newEvents])
        }
      } catch (error) {
        // On error, don't set hasMore to false - might be temporary network issue
        console.error('[QuoteList] Error loading more events', error)
      } finally {
        setLoading(false)
      }
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore) {
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
  }, [timelineKey, loading, hasMore, events, showCount])

  return (
    <div className={cn(className, embedded && 'mt-6 border-t border-border pt-4')}>
      {embedded && (
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 px-4">{t('Quotes')}</h3>
      )}
      <div className={embedded ? undefined : 'min-h-[80vh]'}>
        <div>
          {events.slice(0, showCount).map((event) => {
            if (hideUntrustedInteractions && !isUserTrusted(event.pubkey)) {
              return null
            }
            return <NoteCard key={event.id} className="w-full" event={event} />
          })}
        </div>
        {hasMore || loading ? (
          <div ref={bottomRef}>
            <NoteCardLoadingSkeleton />
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground mt-2">{t('no more notes')}</div>
        )}
      </div>
      {!embedded && <div className="h-40" />}
      {embedded && <div className="pb-8" />}
    </div>
  )
}
