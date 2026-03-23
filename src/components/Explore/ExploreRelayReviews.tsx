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
import type { Event } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const REVIEW_QUERY_LIMIT = 100
const SHOW_COUNT = 20

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

  const relayUrls = useMemo(
    () =>
      appendCuratedReadOnlyRelays(
        getRelayUrlsWithFavoritesFastReadAndInbox(
          favoriteRelays,
          blockedRelays,
          relayList?.read ?? [],
          { userWriteRelays: relayList?.write ?? [] }
        ),
        blockedRelays
      ),
    [favoriteRelays, blockedRelays, relayList]
  )

  const relayUrlsKey = useMemo(() => relayUrls.join('|'), [relayUrls])

  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<Event[]>([])
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
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
              if (cancelled) return
              if (e.kind === ExtendedKind.RELAY_REVIEW && getRelayUrlFromRelayReviewEvent(e)) {
                setLoading(false)
                setEvents((prev) => dedupeRelayReviewsNewestFirst([...prev, e]))
              }
            },
            firstRelayResultGraceMs: FIRST_RELAY_RESULT_GRACE_MS,
            globalTimeout: 12_000,
            eoseTimeout: 800,
            cache: true
          }
        )
        if (cancelled) return
        const withRelay = raw.filter(
          (e) => e.kind === ExtendedKind.RELAY_REVIEW && getRelayUrlFromRelayReviewEvent(e)
        )
        setEvents(dedupeRelayReviewsNewestFirst(withRelay))
      } catch {
        if (!cancelled) setEvents([])
      } finally {
        if (!cancelled) setLoading(false)
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

  return (
    <div className="min-w-0 pt-1 pb-8">
      {loading ? (
        <div className="grid min-w-0 md:px-4 md:grid-cols-2 md:gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg border md:border" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('no relays found')}</p>
      ) : (
        <>
          <div className="grid min-w-0 md:px-4 md:grid-cols-2 md:gap-3">
            {visible.map((event) => (
              <RelayReviewCard key={event.id} event={event} className="border-b md:border md:border-border" />
            ))}
          </div>
          {showCount < events.length ? <div ref={bottomRef} className="h-4" aria-hidden /> : null}
          {showCount >= events.length ? (
            <p className="mt-3 text-center text-sm text-muted-foreground">{t('no more relays')}</p>
          ) : null}
        </>
      )}
    </div>
  )
}
