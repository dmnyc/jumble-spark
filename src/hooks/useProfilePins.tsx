import { Event } from 'nostr-tools'
import {
  buildAuthorInboxOutboxRelayUrls,
  buildProfileAugmentedReadRelayUrls,
  PROFILE_PAGE_PINS_RESOLVE_LIMIT
} from '@/lib/favorites-feed-relays'
import {
  METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
  METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS
} from '@/constants'
import { normalizeHexPubkey } from '@/lib/pubkey'
import { normalizeUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client, { eventService, queryService } from '@/services/client.service'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

const CACHE_DURATION = 5 * 60 * 1000

type PinsCacheEntry = {
  events: Event[]
  lastUpdated: number
}

const pinsCache = new Map<string, PinsCacheEntry>()

function orderPinEvents(pinList: Event, eventsById: Map<string, Event>): Event[] {
  const ordered: Event[] = []
  const seen = new Set<string>()

  const eIds = pinList.tags
    .filter((tag) => tag[0] === 'e' && tag[1])
    .map((tag) => tag[1]!.toLowerCase())
    .reverse()

  for (const id of eIds) {
    const ev = eventsById.get(id)
    if (ev) {
      const k = ev.id.toLowerCase()
      if (!seen.has(k)) {
        ordered.push(ev)
        seen.add(k)
      }
    }
  }

  const aTags = pinList.tags.filter((tag) => tag[0] === 'a' && tag[1]).map((tag) => tag[1]!)
  for (const coord of aTags) {
    const want = coord.toLowerCase()
    const ev = [...eventsById.values()].find((e) => {
      const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
      return `${e.kind}:${e.pubkey}:${d}`.toLowerCase() === want
    })
    if (ev) {
      const k = ev.id.toLowerCase()
      if (!seen.has(k)) {
        ordered.push(ev)
        seen.add(k)
      }
    }
  }

  for (const ev of eventsById.values()) {
    const k = ev.id.toLowerCase()
    if (!seen.has(k)) {
      ordered.push(ev)
      seen.add(k)
    }
  }

  return ordered
}

function blockedRelaysContentKey(blockedRelays: string[]): string {
  return [...blockedRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort().join('\u0001')
}

export function useProfilePins(pubkey: string | undefined) {
  const { blockedRelays } = useFavoriteRelays()
  const blockedKey = useMemo(() => blockedRelaysContentKey(blockedRelays), [blockedRelays])
  const [pinEvents, setPinEvents] = useState<Event[]>([])
  const [loadingPins, setLoadingPins] = useState(false)

  /** Same-tab paint: show cached pins before async relay work (matches timeline showing memory cache). */
  useLayoutEffect(() => {
    if (!pubkey) {
      setPinEvents([])
      return
    }
    const cacheKey = `${pubkey}-pins-profile`
    const cached = pinsCache.get(cacheKey)
    if (
      cached &&
      cached.events.length > 0 &&
      Date.now() - cached.lastUpdated < CACHE_DURATION
    ) {
      setPinEvents(cached.events)
      cached.events.forEach((e) => client.addEventToCache(e))
    } else {
      setPinEvents([])
    }
  }, [pubkey])

  const loadPins = useCallback(
    async (forceRefresh = false) => {
      if (!pubkey) {
        setPinEvents([])
        return
      }
      const cacheKey = `${pubkey}-pins-profile`
      if (!forceRefresh) {
        const cached = pinsCache.get(cacheKey)
        // Only reuse cache for non-empty pin rows. Empty was previously cached on transient relay
        // failures / races, which hid pins for CACHE_DURATION with no refetch.
        if (
          cached &&
          cached.events.length > 0 &&
          Date.now() - cached.lastUpdated < CACHE_DURATION
        ) {
          setPinEvents(cached.events)
          cached.events.forEach((e) => client.addEventToCache(e))
          return
        }
      }

      setLoadingPins(true)
      try {
        const pk = normalizeHexPubkey(pubkey)
        const [authorRl, pinListEarly] = await Promise.all([
          client.fetchRelayList(pk).catch(() => ({
            read: [] as string[],
            write: [] as string[]
          })),
          client.fetchPinListEvent(pk).catch(() => undefined)
        ])
        const authorRelays = buildAuthorInboxOutboxRelayUrls(authorRl, blockedRelays)
        const pinsResolveRelays = buildProfileAugmentedReadRelayUrls(authorRelays, blockedRelays)
        if (!pinsResolveRelays.length) {
          setPinEvents([])
          return
        }

        let pinList: Event | null = pinListEarly ?? null

        if (!pinList) {
          try {
            const rows = await queryService.fetchEvents(
              pinsResolveRelays,
              { authors: [pk], kinds: [10001], limit: 1 },
              {
                replaceableRace: true,
                eoseTimeout: METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
                globalTimeout: METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS
              }
            )
            pinList =
              rows.length > 0
                ? rows.reduce((best, e) => (e.created_at > best.created_at ? e : best))
                : null
          } catch {
            pinList = null
          }
        }

        if (!pinList) {
          setPinEvents([])
          return
        }

        if (!pinList.tags?.length) {
          setPinEvents([])
          return
        }

        const max = PROFILE_PAGE_PINS_RESOLVE_LIMIT
        const eventIds: string[] = []
        const aTags: string[] = []
        for (const tag of pinList.tags) {
          if (eventIds.length + aTags.length >= max) break
          if (tag[0] === 'e' && tag[1]) eventIds.push(tag[1].toLowerCase())
          else if (tag[0] === 'a' && tag[1]) aTags.push(tag[1])
        }

        const byId = new Map<string, Event>()
        if (eventIds.length > 0) {
          const sessionHits = await Promise.all(eventIds.map((id) => eventService.fetchEvent(id)))
          for (let i = 0; i < eventIds.length; i++) {
            const ev = sessionHits[i]
            if (ev) byId.set(ev.id.toLowerCase(), ev)
          }
          const missing = eventIds.filter((id) => !byId.has(id))
          if (missing.length > 0) {
            const rows = await queryService.fetchEvents(pinsResolveRelays, {
              ids: missing,
              limit: max
            })
            for (const e of rows) {
              byId.set(e.id.toLowerCase(), e)
            }
          }
        }

        const eventPromises: Promise<Event[]>[] = []
        if (aTags.length > 0) {
          const aTagFetches = aTags.map(async (aTagRaw) => {
            const parts = aTagRaw.trim().split(':')
            if (parts.length < 2) return null
            const kind = parseInt(parts[0], 10)
            const author = parts[1]?.trim().toLowerCase()
            if (!Number.isFinite(kind) || !author || !/^[0-9a-f]{64}$/.test(author)) return null
            const d = parts.slice(2).join(':')
            const filter = d
              ? { authors: [author], kinds: [kind], limit: 1, '#d': [d] as [string] }
              : { authors: [author], kinds: [kind], limit: 1 }
            const events = await queryService.fetchEvents(pinsResolveRelays, filter)
            return events[0] ?? null
          })
          eventPromises.push(
            Promise.all(aTagFetches).then((events) => events.filter((e): e is Event => e !== null))
          )
        }

        const eventArrays = await Promise.all(eventPromises)
        const flat = eventArrays.flat()
        flat.forEach((e) => client.addEventToCache(e))
        for (const e of flat) {
          byId.set(e.id.toLowerCase(), e)
        }

        const ordered = orderPinEvents(pinList, byId).slice(0, PROFILE_PAGE_PINS_RESOLVE_LIMIT)
        setPinEvents(ordered)
        if (ordered.length > 0) {
          pinsCache.set(cacheKey, { events: ordered, lastUpdated: Date.now() })
        }
      } catch {
        setPinEvents([])
      } finally {
        setLoadingPins(false)
      }
    },
    [pubkey, blockedKey, blockedRelays]
  )

  useEffect(() => {
    if (!pubkey) {
      setPinEvents([])
      return
    }
    void loadPins(false)
  }, [pubkey, loadPins])

  const refreshPins = useCallback(() => {
    if (pubkey) {
      pinsCache.delete(`${pubkey}-pins-profile`)
    }
    void loadPins(true)
  }, [pubkey, loadPins])

  return { pinEvents, loadingPins, refreshPins }
}
