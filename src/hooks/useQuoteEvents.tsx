import {
  E_TAG_FILTER_BLOCKED_RELAY_URLS,
  ExtendedKind,
  FAST_READ_RELAY_URLS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { normalizeUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import dayjs from 'dayjs'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'

const LIMIT = 100
const INITIAL_QUOTE_LOAD_TIMEOUT_MS = 12_000

/** Kinds that reference the OP via #e / #a in the quote shard (with highlights). */
const QUOTE_STREAM_REFERENCE_KINDS: number[] = [
  kinds.Highlights,
  kinds.LongFormArticle,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  ExtendedKind.PUBLICATION_CONTENT
]

/** Fetches events that quote or reference the given event (#q, #e, #a tags). */
export function useQuoteEvents(event: Event | null, enabled: boolean) {
  const { relayList: userRelayList } = useNostr()
  const { relayUrls: browsingRelayUrls } = useCurrentRelays()
  const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const receivedAnyQuotesRef = useRef(false)
  const lastSubscribedEventIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!event || !enabled) {
      setEvents([])
      setLoading(false)
      setHasMore(false)
      lastSubscribedEventIdRef.current = null
      return
    }

    const ev = event
    let cancelled = false
    let loadTimeoutId: ReturnType<typeof setTimeout> | undefined

    async function init() {
      const noteRowId = ev.id
      const isNewTarget = lastSubscribedEventIdRef.current !== noteRowId
      lastSubscribedEventIdRef.current = noteRowId

      setLoading(true)
      if (isNewTarget) {
        setEvents([])
        receivedAnyQuotesRef.current = false
      }
      setHasMore(true)

      loadTimeoutId = setTimeout(() => {
        if (cancelled) return
        setLoading(false)
        if (!receivedAnyQuotesRef.current) {
          setHasMore(false)
        }
      }, INITIAL_QUOTE_LOAD_TIMEOUT_MS)

      const userRelays = userRelayList?.read || []
      const fromFeed = browsingRelayUrls.map((u) => normalizeUrl(u) || u).filter(Boolean)
      const seenOn = client.getSeenEventRelayUrls(ev.id)
      const eTagBlockedSet = new Set(
        E_TAG_FILTER_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u)
      )
      const finalRelayUrls = Array.from(
        new Set([
          ...fromFeed,
          ...userRelays.map((url) => normalizeUrl(url) || url),
          ...seenOn,
          ...SEARCHABLE_RELAY_URLS.map((url) => normalizeUrl(url) || url),
          ...FAST_READ_RELAY_URLS.map((url) => normalizeUrl(url) || url)
        ])
      )
        .filter(Boolean)
        .filter((u) => !eTagBlockedSet.has(normalizeUrl(u) || u))

      const filterQeId = isReplaceableEvent(ev.kind)
        ? getReplaceableCoordinateFromEvent(ev)
        : ev.id
      const eventCoordinate = isReplaceableEvent(ev.kind)
        ? getReplaceableCoordinateFromEvent(ev)
        : `${ev.kind}:${ev.pubkey}:${ev.id}`

      const { closer, timelineKey } = await client.subscribeTimeline(
        [
          {
            urls: finalRelayUrls,
            filter: { '#q': [filterQeId], kinds: [kinds.ShortTextNote], limit: LIMIT }
          },
          {
            urls: finalRelayUrls,
            filter: {
              '#e': [filterQeId],
              kinds: [...QUOTE_STREAM_REFERENCE_KINDS],
              limit: LIMIT
            }
          },
          {
            urls: finalRelayUrls,
            filter: {
              '#a': [eventCoordinate],
              kinds: [...QUOTE_STREAM_REFERENCE_KINDS],
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
  }, [event, enabled, browsingRelayUrls, userRelayList?.read])

  const loadMore = async () => {
    if (!timelineKey || loading || !hasMore) return
    setLoading(true)
    try {
      const newEvents = await client.loadMoreTimeline(
        timelineKey,
        events.length ? events[events.length - 1].created_at - 1 : dayjs().unix(),
        LIMIT
      )
      if (newEvents.length === 0) {
        const until = events.length ? events[events.length - 1].created_at - 1 : dayjs().unix()
        const hasMoreCached = client.hasMoreTimelineEvents?.(timelineKey, until) ?? false
        if (!hasMoreCached) setHasMore(false)
      } else {
        setEvents((old) => [...old, ...newEvents])
      }
    } catch {
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }

  return { quoteEvents: events, quoteLoading: loading, quoteHasMore: hasMore, loadMoreQuotes: loadMore }
}
