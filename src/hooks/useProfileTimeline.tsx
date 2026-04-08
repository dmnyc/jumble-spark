import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import client from '@/services/client.service'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Event } from 'nostr-tools'
import { CALENDAR_EVENT_KINDS, ExtendedKind, isSocialKindBlockedKind } from '@/constants'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import { normalizeAnyRelayUrl, subtractNormalizedRelayUrls } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'

type ProfileTimelineMemoryEntry = {
  events: Event[]
  lastUpdated: number
}

/** 5-minute in-memory cache for this hook only — not IndexedDB, not client timeline refs. */
const memoryTimelineByKey = new Map<string, ProfileTimelineMemoryEntry>()
const CACHE_DURATION = 5 * 60 * 1000

type UseProfileTimelineOptions = {
  pubkey: string
  cacheKey: string
  kinds: number[]
  limit?: number
  filterPredicate?: (event: Event) => boolean
}

type UseProfileTimelineResult = {
  events: Event[]
  isLoading: boolean
  refresh: () => void
}

function buildSubRequests(
  groups: string[][],
  pubkey: string,
  kindsArg: number[],
  limit: number,
  hasCalendarKinds: boolean
) {
  const authorRequests = groups
    .map((urls) => ({
      urls,
      filter: {
        authors: [pubkey],
        kinds: kindsArg,
        limit
      } as any
    }))
    .filter((request) => request.urls.length)
  const calendarInviteRequests = hasCalendarKinds
    ? groups
        .map((urls) => ({
          urls,
          filter: {
            kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
            '#p': [pubkey],
            limit: 100
          } as any
        }))
        .filter((request) => request.urls.length)
    : []
  return [...authorRequests, ...calendarInviteRequests]
}

function postProcessEvents(
  rawEvents: Event[],
  filterPredicate: ((event: Event) => boolean) | undefined,
  limit: number,
  isEventDeleted: (event: Event) => boolean
) {
  const dedupMap = new Map<string, Event>()
  rawEvents.forEach((evt) => {
    if (!dedupMap.has(evt.id)) {
      dedupMap.set(evt.id, evt)
    }
  })

  let events = Array.from(dedupMap.values()).filter((e) => !isEventDeleted(e))

  // Parameterized replaceable events (kinds 30000-39999) should be unique by pubkey+kind+d.
  // Keep only the latest version so profile feeds don't show multiple revisions of one article.
  const latestAddressableByKey = new Map<string, Event>()
  const nonAddressableEvents: Event[] = []
  events.forEach((evt) => {
    const isAddressable = evt.kind >= 30000 && evt.kind < 40000
    if (!isAddressable) {
      nonAddressableEvents.push(evt)
      return
    }
    const d = evt.tags.find((t) => t[0] === 'd')?.[1]?.trim()
    if (!d) {
      nonAddressableEvents.push(evt)
      return
    }
    const key = `${evt.pubkey}:${evt.kind}:${d}`
    const existing = latestAddressableByKey.get(key)
    if (
      !existing ||
      evt.created_at > existing.created_at ||
      (evt.created_at === existing.created_at && evt.id > existing.id)
    ) {
      latestAddressableByKey.set(key, evt)
    }
  })
  events = [...nonAddressableEvents, ...latestAddressableByKey.values()]

  if (filterPredicate) {
    events = events.filter(filterPredicate)
  }
  events.sort((a, b) => b.created_at - a.created_at)
  return events.slice(0, limit)
}

function relayListsContentKey(favoriteRelays: string[], blockedRelays: string[]): string {
  const fav = [...favoriteRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  const blk = [...blockedRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  return `${fav}\u0000${blk}`
}

export function useProfileTimeline({
  pubkey,
  cacheKey,
  kinds,
  limit = 200,
  filterPredicate
}: UseProfileTimelineOptions): UseProfileTimelineResult {
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const relayListsKey = useMemo(
    () => relayListsContentKey(favoriteRelays, blockedRelays),
    [favoriteRelays, blockedRelays]
  )
  const { isEventDeleted, tombstoneEpoch } = useDeletedEvent()
  const isEventDeletedRef = useRef(isEventDeleted)
  isEventDeletedRef.current = isEventDeleted

  const filterPredicateRef = useRef(filterPredicate)
  filterPredicateRef.current = filterPredicate
  const limitRef = useRef(limit)
  limitRef.current = limit

  const cachedEntry = useMemo(() => memoryTimelineByKey.get(cacheKey), [cacheKey])
  const [events, setEvents] = useState<Event[]>(cachedEntry?.events ?? [])
  const [isLoading, setIsLoading] = useState(!cachedEntry)
  const [refreshToken, setRefreshToken] = useState(0)
  const subscriptionRef = useRef<() => void>(() => {})

  useEffect(() => {
    setEvents((prev) => {
      const next = prev.filter((e) => !isEventDeletedRef.current(e))
      if (next.length === prev.length) return prev
      const cached = memoryTimelineByKey.get(cacheKey)
      if (cached) {
        memoryTimelineByKey.set(cacheKey, { events: next, lastUpdated: cached.lastUpdated })
      }
      return next
    })
  }, [tombstoneEpoch, cacheKey])

  useEffect(() => {
    let cancelled = false
    const closers: (() => void)[] = []
    const pool = new Map<string, Event>()

    const flushPool = () => {
      if (cancelled) return
      const processed = postProcessEvents(
        Array.from(pool.values()),
        filterPredicateRef.current,
        limitRef.current,
        isEventDeletedRef.current
      )
      memoryTimelineByKey.set(cacheKey, { events: processed, lastUpdated: Date.now() })
      setEvents(processed)
      setIsLoading(false)
    }

    subscriptionRef.current = () => {
      closers.forEach((c) => c())
      closers.length = 0
    }

    const registerCloser = (closer: () => void) => {
      if (cancelled) {
        closer()
        return
      }
      closers.push(closer)
    }

    const subscribe = async () => {
      const mem = memoryTimelineByKey.get(cacheKey)
      const cacheAge = mem ? Date.now() - mem.lastUpdated : Infinity
      const isCacheFresh = cacheAge < CACHE_DURATION

      pool.clear()
      if (isCacheFresh && mem) {
        setEvents(mem.events)
        setIsLoading(false)
        mem.events.forEach((e) => pool.set(e.id, e))
      } else {
        setIsLoading(!mem)
      }

      const hasCalendarKinds = kinds.some((k) => CALENDAR_EVENT_KINDS.includes(k))
      const socialKinds = kinds.some(isSocialKindBlockedKind)
      const emptyAuthor = { read: [] as string[], write: [] as string[] }
      const provisionalFeedUrls = buildProfilePageReadRelayUrls(
        favoriteRelays,
        blockedRelays,
        emptyAuthor,
        socialKinds
      )

      const startWave = async (subRequests: ReturnType<typeof buildSubRequests>) => {
        if (cancelled || subRequests.length === 0) return
        try {
          const { closer } = await client.subscribeTimeline(
            subRequests,
            {
              onEvents: (fetched) => {
                if (cancelled) return
                for (const e of fetched as Event[]) {
                  pool.set(e.id, e)
                }
                flushPool()
              },
              onNew: (evt) => {
                if (cancelled) return
                pool.set((evt as Event).id, evt as Event)
                flushPool()
              }
            },
            { needSort: true }
          )
          registerCloser(closer)
        } catch {
          if (!cancelled) setIsLoading(false)
        }
      }

      if (provisionalFeedUrls.length === 0) {
        if (!cancelled) setIsLoading(false)
        return
      }

      void startWave(
        buildSubRequests([provisionalFeedUrls], pubkey, kinds, limit, hasCalendarKinds)
      )

      void (async () => {
        const authorRl = await client.fetchRelayList(pubkey).catch(() => ({
          read: [] as string[],
          write: [] as string[],
          httpRead: [] as string[],
          httpWrite: [] as string[]
        }))
        if (cancelled) return
        const fullFeedUrls = buildProfilePageReadRelayUrls(
          favoriteRelays,
          blockedRelays,
          authorRl,
          socialKinds
        )
        const deltaUrls = subtractNormalizedRelayUrls(fullFeedUrls, provisionalFeedUrls)
        if (cancelled || deltaUrls.length === 0) return
        await startWave(buildSubRequests([deltaUrls], pubkey, kinds, limit, hasCalendarKinds))
      })()
    }

    void subscribe()

    return () => {
      cancelled = true
      subscriptionRef.current()
      subscriptionRef.current = () => {}
    }
  }, [pubkey, cacheKey, JSON.stringify(kinds), limit, refreshToken, relayListsKey])

  const refresh = useCallback(() => {
    subscriptionRef.current()
    subscriptionRef.current = () => {}
    memoryTimelineByKey.delete(cacheKey)
    setIsLoading(true)
    setRefreshToken((token) => token + 1)
  }, [cacheKey])

  return {
    events,
    isLoading,
    refresh
  }
}
