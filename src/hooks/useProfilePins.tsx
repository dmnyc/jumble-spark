import { useCallback, useEffect, useState } from 'react'
import { Event } from 'nostr-tools'
import { FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import logger from '@/lib/logger'
import { normalizeUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { queryService, replaceableEventService } from '@/services/client.service'

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
    .map((tag) => tag[1])
    .reverse()

  for (const id of eIds) {
    const ev = eventsById.get(id)
    if (ev && !seen.has(ev.id)) {
      ordered.push(ev)
      seen.add(ev.id)
    }
  }

  const aTags = pinList.tags.filter((tag) => tag[0] === 'a' && tag[1]).map((tag) => tag[1])
  for (const coord of aTags) {
    const ev = [...eventsById.values()].find((e) => {
      const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
      return `${e.kind}:${e.pubkey}:${d}` === coord
    })
    if (ev && !seen.has(ev.id)) {
      ordered.push(ev)
      seen.add(ev.id)
    }
  }

  for (const ev of eventsById.values()) {
    if (!seen.has(ev.id)) {
      ordered.push(ev)
      seen.add(ev.id)
    }
  }

  return ordered
}

export function useProfilePins(pubkey: string | undefined) {
  const { pubkey: myPubkey } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const [pinEvents, setPinEvents] = useState<Event[]>([])
  const [loadingPins, setLoadingPins] = useState(false)

  const buildComprehensiveRelayList = useCallback(async () => {
    const myRelayList = myPubkey ? await client.fetchRelayList(myPubkey) : { write: [], read: [] }
    const allRelays = [
      ...(myRelayList.read || []),
      ...(myRelayList.write || []),
      ...(favoriteRelays || []),
      ...FAST_READ_RELAY_URLS,
      ...FAST_WRITE_RELAY_URLS
    ]
    const normalized = allRelays.map((url) => normalizeUrl(url)).filter((url): url is string => !!url)
    return Array.from(new Set(normalized))
  }, [myPubkey, favoriteRelays])

  const loadPins = useCallback(
    async (forceRefresh = false) => {
      if (!pubkey) {
        setPinEvents([])
        return
      }
      const cacheKey = `${pubkey}-pins-profile`
      if (!forceRefresh) {
        const cached = pinsCache.get(cacheKey)
        if (cached && Date.now() - cached.lastUpdated < CACHE_DURATION) {
          setPinEvents(cached.events)
          cached.events.forEach((e) => client.addEventToCache(e))
          return
        }
      }

      setLoadingPins(true)
      try {
        const comprehensiveRelays = await buildComprehensiveRelayList()
        let pinList: Event | null = null
        try {
          const pinListEvents = await queryService.fetchEvents(comprehensiveRelays, {
            authors: [pubkey],
            kinds: [10001],
            limit: 1
          })
          pinList = pinListEvents[0] || null
        } catch {
          pinList = (await replaceableEventService.fetchReplaceableEvent(pubkey, 10001)) ?? null
        }

        if (!pinList?.tags?.length) {
          setPinEvents([])
          pinsCache.set(cacheKey, { events: [], lastUpdated: Date.now() })
          return
        }

        const eventIds = pinList.tags.filter((tag) => tag[0] === 'e' && tag[1]).map((tag) => tag[1])
        const aTags = pinList.tags.filter((tag) => tag[0] === 'a' && tag[1]).map((tag) => tag[1])

        const eventPromises: Promise<Event[]>[] = []
        if (eventIds.length > 0) {
          eventPromises.push(
            queryService.fetchEvents(comprehensiveRelays, { ids: eventIds, limit: 100 })
          )
        }
        if (aTags.length > 0) {
          const aTagFetches = aTags.map(async (aTag) => {
            const parts = aTag.split(':')
            if (parts.length < 2) return null
            const kind = parseInt(parts[0], 10)
            const author = parts[1]
            const d = parts[2] || ''
            const filter = d
              ? { authors: [author], kinds: [kind], limit: 1, '#d': [d] as [string] }
              : { authors: [author], kinds: [kind], limit: 1 }
            const events = await queryService.fetchEvents(comprehensiveRelays, [filter])
            return events[0] || null
          })
          eventPromises.push(
            Promise.all(aTagFetches).then((events) => events.filter((e): e is Event => e !== null))
          )
        }

        const eventArrays = await Promise.all(eventPromises)
        const flat = eventArrays.flat()
        flat.forEach((e) => client.addEventToCache(e))

        const byId = new Map<string, Event>()
        for (const e of flat) {
          byId.set(e.id, e)
        }

        const ordered = orderPinEvents(pinList, byId)
        setPinEvents(ordered)
        pinsCache.set(cacheKey, { events: ordered, lastUpdated: Date.now() })
      } catch (e) {
        logger.warn('[useProfilePins] Failed to load pins', e)
        setPinEvents([])
      } finally {
        setLoadingPins(false)
      }
    },
    [pubkey, buildComprehensiveRelayList]
  )

  useEffect(() => {
    if (!pubkey) {
      setPinEvents([])
      return
    }
    const t = setTimeout(() => void loadPins(false), 200)
    return () => clearTimeout(t)
  }, [pubkey, loadPins])

  const refreshPins = useCallback(() => {
    if (pubkey) {
      pinsCache.delete(`${pubkey}-pins-profile`)
    }
    void loadPins(true)
  }, [pubkey, loadPins])

  return { pinEvents, loadingPins, refreshPins }
}
