import RelayIcon from '@/components/RelayIcon'
import RelayReviewCard from '@/components/RelayInfo/RelayReviewCard'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { useFetchRelayInfo } from '@/hooks'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { getRelayUrlFromRelayReviewEvent } from '@/lib/event-metadata'
import {
  getRelayUrlsWithFavoritesFastReadAndInbox,
  userReadRelaysWithHttp
} from '@/lib/favorites-feed-relays'
import { toRelay } from '@/lib/link'
import { appendCuratedReadOnlyRelays } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { useSmartRelayNavigation } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import indexedDb, { StoreNames } from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

function RelayGroupHeader({ url, reviewCount }: { url: string; reviewCount: number }) {
  const { navigateToRelay } = useSmartRelayNavigation()
  const { relayInfo } = useFetchRelayInfo(url)
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-2 px-4 md:px-4 pt-4 pb-2 border-b text-left hover:opacity-75 transition-opacity"
      onClick={() => navigateToRelay(toRelay(url))}
    >
      <RelayIcon url={url} className="h-8 w-8 shrink-0 rounded-sm" iconSize={16} />
      <div className="min-w-0 flex-1">
        {relayInfo?.name && (
          <div className="truncate font-semibold text-sm leading-tight">{relayInfo.name}</div>
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="truncate font-mono text-xs text-muted-foreground leading-tight">{url}</div>
          <span className="shrink-0 text-xs text-muted-foreground">
            · {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
          </span>
        </div>
      </div>
    </button>
  )
}

const REVIEW_QUERY_LIMIT = 100
const SHOW_COUNT = 20
/** Fewer sockets + faster aggregate EOSE than full inbox stack; read-only mirrors prepended then capped. */
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

async function loadCachedRelayReviews(limit: number): Promise<Event[]> {
  const fromSession = client
    .getSessionEventsMatchingSearch('', Math.max(limit * 2, 200), [ExtendedKind.RELAY_REVIEW])
    .filter((e) => e.kind === ExtendedKind.RELAY_REVIEW && !!getRelayUrlFromRelayReviewEvent(e))
  if (fromSession.length >= limit) {
    return dedupeRelayReviewsNewestFirst(fromSession).slice(0, limit)
  }

  try {
    const archiveRows = await indexedDb.getStoreItems(StoreNames.EVENT_ARCHIVE)
    const fromArchive = archiveRows
      .map((row) => row?.value as Event | undefined)
      .filter(
        (e): e is Event =>
          !!e && e.kind === ExtendedKind.RELAY_REVIEW && !!getRelayUrlFromRelayReviewEvent(e)
      )
    return dedupeRelayReviewsNewestFirst([...fromSession, ...fromArchive]).slice(0, limit)
  } catch {
    return dedupeRelayReviewsNewestFirst(fromSession).slice(0, limit)
  }
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
        userReadRelaysWithHttp(relayList),
        {
          userWriteRelays: relayList?.write ?? [],
          maxRelays: EXPLORE_REVIEWS_MAX_RELAYS,
          applySocialKindBlockedFilter: false
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
      const cached = await loadCachedRelayReviews(REVIEW_QUERY_LIMIT)
      if (!cancelled && fetchGenRef.current === gen && cached.length > 0) {
        setEvents(cached)
      }
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
            firstRelayResultGraceMs: false,
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

  const groupedVisible = useMemo(() => {
    const groups = new Map<string, Event[]>()
    for (const event of visible) {
      const url = getRelayUrlFromRelayReviewEvent(event)
      if (!url) continue
      if (!groups.has(url)) groups.set(url, [])
      groups.get(url)!.push(event)
    }
    return Array.from(groups.entries())
  }, [visible])

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
          {groupedVisible.map(([relayUrl, relayEvents]) => (
            <div key={relayUrl} className="mb-4">
              <RelayGroupHeader url={relayUrl} reviewCount={relayEvents.length} />
              <div className="grid min-w-0 md:px-4 md:grid-cols-2 md:gap-3 mt-2">
                {relayEvents.map((event) => (
                  <RelayReviewCard
                    key={event.id}
                    event={event}
                    showRelayInfo={false}
                    className="border-b md:border md:border-border"
                  />
                ))}
              </div>
            </div>
          ))}
          {loading ? (
            <div
              className="mt-4 grid min-w-0 gap-3 md:grid-cols-2 md:px-4"
              aria-busy="true"
              aria-live="polite"
            >
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg border md:border" />
              ))}
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
