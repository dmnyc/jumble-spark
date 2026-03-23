import RelayReviewCard from '@/components/RelayInfo/RelayReviewCard'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind, FIRST_RELAY_RESULT_GRACE_MS } from '@/constants'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { getRelayUrlFromRelayReviewEvent } from '@/lib/event-metadata'
import { getRelayUrlsWithFavoritesFastReadAndInbox } from '@/lib/favorites-feed-relays'
import { appendCuratedReadOnlyRelays } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { Loader2 } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const REVIEW_QUERY_LIMIT = 100
const SHOW_COUNT = 20
/** Fewer sockets + faster aggregate EOSE than full inbox stack; read-only mirrors still appended then capped. */
const EXPLORE_REVIEWS_MAX_RELAYS = 12
/** After all relays EOSE, wait longer than default so slow mirrors can flush events (default query eose is 500ms). */
const EXPLORE_REVIEWS_EOSE_TAIL_MS = 4500

function dedupeRelayReviewsNewestFirst(events: Event[]): Event[] {
  const sorted = [...events].sort((a, b) => b.created_at - a.created_at)
  const seen = new Set<string>()
  const out: Event[] = []
  for (const evt of sorted) {
    const key = isReplaceableEvent(evt.kind) ? getReplaceableCoordinateFromEvent(evt) : evt.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(evt)
  }
  return out
}

export default function ExploreRelayReviews() {
  const { t } = useTranslation()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { relayList } = useNostr()

  const relayUrls = useMemo(() => {
    const stacked = appendCuratedReadOnlyRelays(
      getRelayUrlsWithFavoritesFastReadAndInbox(
        favoriteRelays,
        blockedRelays,
        relayList?.read ?? [],
        {
          userWriteRelays: relayList?.write ?? [],
          maxRelays: EXPLORE_REVIEWS_MAX_RELAYS,
          applyKind1BlockedFilter: false
        }
      ),
      blockedRelays
    )
    return stacked.slice(0, EXPLORE_REVIEWS_MAX_RELAYS)
  }, [favoriteRelays, blockedRelays, relayList])

  const relayUrlsKey = useMemo(() => relayUrls.join('|'), [relayUrls])

  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<Event[]>([])
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fetchGenRef = useRef(0)

  useEffect(() => {
    const gen = ++fetchGenRef.current
    let cancelled = false
    setLoading(true)
    setEvents([])
    setShowCount(SHOW_COUNT)

    void (async () => {
      try {
        const raw = await client.fetchEvents(
          relayUrls,
          { kinds: [ExtendedKind.RELAY_REVIEW], limit: REVIEW_QUERY_LIMIT },
          {
            onevent: (e) => {
              if (cancelled || fetchGenRef.current !== gen) return
              if (e.kind === ExtendedKind.RELAY_REVIEW && getRelayUrlFromRelayReviewEvent(e)) {
                setEvents((prev) => dedupeRelayReviewsNewestFirst([...prev, e]))
              }
            },
            firstRelayResultGraceMs: FIRST_RELAY_RESULT_GRACE_MS,
            globalTimeout: 12_000,
            eoseTimeout: EXPLORE_REVIEWS_EOSE_TAIL_MS,
            cache: true
          }
        )
        if (cancelled || fetchGenRef.current !== gen) return
        const withRelay = raw.filter(
          (e) => e.kind === ExtendedKind.RELAY_REVIEW && getRelayUrlFromRelayReviewEvent(e)
        )
        setEvents((prev) => dedupeRelayReviewsNewestFirst([...prev, ...withRelay]))
      } catch {
        if (!cancelled && fetchGenRef.current === gen) setEvents([])
      } finally {
        if (!cancelled && fetchGenRef.current === gen) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [relayUrlsKey])

  useEffect(() => {
    const options = { root: null, rootMargin: '120px', threshold: 0 }
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && showCount < events.length) {
        setShowCount((prev) => prev + SHOW_COUNT)
      }
    }, options)
    const el = bottomRef.current
    if (el) observer.observe(el)
    return () => {
      if (el) observer.unobserve(el)
    }
  }, [showCount, events.length])

  const visible = events.slice(0, showCount)
  const showInitialSkeleton = loading && events.length === 0
  const showEmptyAfterLoad = !loading && events.length === 0

  return (
    <div className="min-w-0 pt-1 pb-8">
      {showInitialSkeleton ? (
        <div className="grid min-w-0 md:px-4 md:grid-cols-2 md:gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg border md:border" />
          ))}
        </div>
      ) : showEmptyAfterLoad ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('no relays found')}</p>
      ) : (
        <>
          <div className="grid min-w-0 md:px-4 md:grid-cols-2 md:gap-3">
            {visible.map((event) => (
              <RelayReviewCard key={event.id} event={event} className="border-b md:border md:border-border" />
            ))}
          </div>
          {loading ? (
            <div
              className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"
              aria-busy="true"
              aria-live="polite"
            >
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              {t('Loading...')}
            </div>
          ) : null}
          {showCount < events.length ? <div ref={bottomRef} className="h-4" aria-hidden /> : null}
          {!loading && showCount >= events.length ? (
            <p className="mt-3 text-center text-sm text-muted-foreground">{t('no more relays')}</p>
          ) : null}
        </>
      )}
    </div>
  )
}
