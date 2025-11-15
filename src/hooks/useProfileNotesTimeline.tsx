import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Event } from 'nostr-tools'
import client from '@/services/client.service'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { getPrivateRelayUrls } from '@/lib/private-relays'

type ProfileNotesTimelineCacheEntry = {
  events: Event[]
  lastUpdated: number
}

const timelineCache = new Map<string, ProfileNotesTimelineCacheEntry>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes - cache is considered fresh for this long

type UseProfileNotesTimelineOptions = {
  pubkey: string
  cacheKey: string
  kinds: number[]
  limit?: number
  filterPredicate?: (event: Event) => boolean
}

type UseProfileNotesTimelineResult = {
  events: Event[]
  isLoading: boolean
  refresh: () => void
}

function postProcessEvents(
  rawEvents: Event[],
  filterPredicate: ((event: Event) => boolean) | undefined,
  limit: number
) {
  const dedupMap = new Map<string, Event>()
  rawEvents.forEach((evt) => {
    if (!dedupMap.has(evt.id)) {
      dedupMap.set(evt.id, evt)
    }
  })

  let events = Array.from(dedupMap.values())
  if (filterPredicate) {
    events = events.filter(filterPredicate)
  }
  events.sort((a, b) => b.created_at - a.created_at)
  return events.slice(0, limit)
}

export function useProfileNotesTimeline({
  pubkey,
  cacheKey,
  kinds,
  limit = 200,
  filterPredicate
}: UseProfileNotesTimelineOptions): UseProfileNotesTimelineResult {
  const cachedEntry = useMemo(() => timelineCache.get(cacheKey), [cacheKey])
  const [events, setEvents] = useState<Event[]>(cachedEntry?.events ?? [])
  const [isLoading, setIsLoading] = useState(!cachedEntry)
  const [refreshToken, setRefreshToken] = useState(0)
  const subscriptionRef = useRef<() => void>(() => {})

  useEffect(() => {
    let cancelled = false

    const subscribe = async () => {
      // Check if we have fresh cached data
      const cachedEntry = timelineCache.get(cacheKey)
      const cacheAge = cachedEntry ? Date.now() - cachedEntry.lastUpdated : Infinity
      const isCacheFresh = cacheAge < CACHE_DURATION
      
      // If cache is fresh, show it immediately and skip subscribing
      if (isCacheFresh && cachedEntry) {
        setEvents(cachedEntry.events)
        setIsLoading(false)
        // Still subscribe in background to get updates, but don't show loading
      } else {
        // Cache is stale or missing - show loading and fetch
        setIsLoading(!cachedEntry)
      }
      
      try {
        // Get private relays (outbox + cache relays) for private notes
        const privateRelayUrls = await getPrivateRelayUrls(pubkey)
        const normalizedPrivateRelays = Array.from(
          new Set(
            privateRelayUrls
              .map((url) => normalizeUrl(url))
              .filter((value): value is string => !!value)
          )
        )

        // Also include fast read relays as fallback
        const fastReadRelays = Array.from(
          new Set(
            FAST_READ_RELAY_URLS.map((url) => normalizeUrl(url) || url)
          )
        )

        // Build relay groups: private relays first, then fast read relays
        const relayGroups: string[][] = []
        if (normalizedPrivateRelays.length > 0) {
          relayGroups.push(normalizedPrivateRelays)
        }
        if (fastReadRelays.length > 0) {
          relayGroups.push(fastReadRelays)
        }

        if (cancelled) {
          return
        }

        const subRequests = relayGroups
          .map((urls) => ({
            urls,
            filter: {
              authors: [pubkey],
              kinds,
              limit
            } as any
          }))
          .filter((request) => request.urls.length)

        if (!subRequests.length) {
          timelineCache.set(cacheKey, {
            events: [],
            lastUpdated: Date.now()
          })
          setEvents([])
          setIsLoading(false)
          return
        }

        const { closer } = await client.subscribeTimeline(
          subRequests,
          {
            onEvents: (fetchedEvents) => {
              if (cancelled) return
              const processed = postProcessEvents(fetchedEvents as Event[], filterPredicate, limit)
              timelineCache.set(cacheKey, {
                events: processed,
                lastUpdated: Date.now()
              })
              setEvents(processed)
              setIsLoading(false)
            },
            onNew: (evt) => {
              if (cancelled) return
              setEvents((prevEvents) => {
                const combined = [evt as Event, ...prevEvents]
                const processed = postProcessEvents(combined, filterPredicate, limit)
                timelineCache.set(cacheKey, {
                  events: processed,
                  lastUpdated: Date.now()
                })
                return processed
              })
            }
          },
          { needSort: true }
        )

        subscriptionRef.current = () => closer()
      } catch (error) {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    subscribe()

    return () => {
      cancelled = true
      subscriptionRef.current()
      subscriptionRef.current = () => {}
    }
  }, [pubkey, cacheKey, JSON.stringify(kinds), limit, filterPredicate, refreshToken])

  const refresh = useCallback(() => {
    subscriptionRef.current()
    subscriptionRef.current = () => {}
    timelineCache.delete(cacheKey)
    setIsLoading(true)
    setRefreshToken((token) => token + 1)
  }, [cacheKey])

  return {
    events,
    isLoading,
    refresh
  }
}

