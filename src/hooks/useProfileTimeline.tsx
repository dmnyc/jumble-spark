import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import client from '@/services/client.service'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Event } from 'nostr-tools'
import { CALENDAR_EVENT_KINDS, ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'

type ProfileTimelineCacheEntry = {
  events: Event[]
  lastUpdated: number
}

const timelineCache = new Map<string, ProfileTimelineCacheEntry>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes - cache is considered fresh for this long
const relayGroupCache = new Map<string, string[][]>()

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

async function getRelayGroups(pubkey: string): Promise<string[][]> {
  const cached = relayGroupCache.get(pubkey)
  if (cached) {
    return cached
  }

  const [relayList, favoriteRelays] = await Promise.all([
    client.fetchRelayList(pubkey).catch(() => ({ read: [], write: [] })),
    client.fetchFavoriteRelays(pubkey).catch(() => [])
  ])

  const groups: string[][] = []

  const normalizeList = (urls?: string[]) =>
    Array.from(
      new Set(
        (urls || [])
          .map((url) => normalizeUrl(url))
          .filter((value): value is string => !!value)
      )
    )

  const readRelays = normalizeList(relayList.read)
  if (readRelays.length) {
    groups.push(readRelays)
  }

  const writeRelays = normalizeList(relayList.write)
  if (writeRelays.length) {
    groups.push(writeRelays)
  }

  const favoriteRelayList = normalizeList(favoriteRelays)
  if (favoriteRelayList.length) {
    groups.push(favoriteRelayList)
  }

  const fastReadRelays = normalizeList(FAST_READ_RELAY_URLS)
  if (fastReadRelays.length) {
    groups.push(fastReadRelays)
  }

  if (!groups.length) {
    relayGroupCache.set(pubkey, [fastReadRelays])
    return [fastReadRelays]
  }

  relayGroupCache.set(pubkey, groups)
  return groups
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
  if (filterPredicate) {
    events = events.filter(filterPredicate)
  }
  events.sort((a, b) => b.created_at - a.created_at)
  return events.slice(0, limit)
}

export function useProfileTimeline({
  pubkey,
  cacheKey,
  kinds,
  limit = 200,
  filterPredicate
}: UseProfileTimelineOptions): UseProfileTimelineResult {
  const { isEventDeleted, tombstoneEpoch } = useDeletedEvent()
  const isEventDeletedRef = useRef(isEventDeleted)
  isEventDeletedRef.current = isEventDeleted

  const cachedEntry = useMemo(() => timelineCache.get(cacheKey), [cacheKey])
  const [events, setEvents] = useState<Event[]>(cachedEntry?.events ?? [])
  const [isLoading, setIsLoading] = useState(!cachedEntry)
  const [refreshToken, setRefreshToken] = useState(0)
  const subscriptionRef = useRef<() => void>(() => {})

  useEffect(() => {
    setEvents((prev) => {
      const next = prev.filter((e) => !isEventDeletedRef.current(e))
      if (next.length === prev.length) return prev
      const cached = timelineCache.get(cacheKey)
      if (cached) {
        timelineCache.set(cacheKey, { events: next, lastUpdated: cached.lastUpdated })
      }
      return next
    })
  }, [tombstoneEpoch, cacheKey])

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
        // This ensures we get new events without disrupting the UI
      } else {
        // Cache is stale or missing - show loading and fetch
        setIsLoading(!cachedEntry)
      }
      
      try {
        const relayGroups = await getRelayGroups(pubkey)
        if (cancelled) {
          return
        }

        const hasCalendarKinds = kinds.some((k) => CALENDAR_EVENT_KINDS.includes(k))
        const authorRequests = relayGroups
          .map((urls) => ({
            urls,
            filter: {
              authors: [pubkey],
              kinds,
              limit
            } as any
          }))
          .filter((request) => request.urls.length)
        // When profile includes calendar event kinds, also subscribe to events where this user is an invitee (#p tag)
        const calendarInviteRequests = hasCalendarKinds
          ? relayGroups
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
        const subRequests = [...authorRequests, ...calendarInviteRequests]

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
              const processed = postProcessEvents(
                fetchedEvents as Event[],
                filterPredicate,
                limit,
                isEventDeletedRef.current
              )
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
                const processed = postProcessEvents(
                  combined,
                  filterPredicate,
                  limit,
                  isEventDeletedRef.current
                )
                timelineCache.set(cacheKey, {
                  events: processed,
                  lastUpdated: Date.now()
                })
                return processed
              })
            }
          },
          { needSort: true, useCache: false } // NO CACHING - stream raw from relays
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
  }, [])

  return {
    events,
    isLoading,
    refresh
  }
}

