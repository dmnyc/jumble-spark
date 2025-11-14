import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useReply } from '@/providers/ReplyProvider'
import client from '@/services/client.service'
import { Event } from 'nostr-tools'
import { useEffect, useState, useRef } from 'react'

export function useFetchEvent(eventId?: string) {
  const { isEventDeleted } = useDeletedEvent()
  const { addReplies } = useReply()
  const [error, setError] = useState<Error | null>(null)
  const [event, setEvent] = useState<Event | undefined>(undefined)
  const cachedEventResolvedRef = useRef(false)
  const [isFetching, setIsFetching] = useState(true)

  useEffect(() => {
    if (!eventId) {
      setIsFetching(false)
      setError(new Error('No id provided'))
      return
    }

    cachedEventResolvedRef.current = false
    setIsFetching(true)

    // Check if event is in cache by trying to access the cache map
    const cacheMap = (client as any).eventCacheMap
    const cachedPromise = cacheMap?.get(eventId)
    
    // If we have a cached promise, try to resolve it immediately
    if (cachedPromise) {
      // Try to resolve quickly - if it resolves in < 50ms, it was likely already resolved (cached)
      const startTime = Date.now()
      cachedPromise
        .then((cachedEvent: Event | undefined) => {
          const resolveTime = Date.now() - startTime
          // If resolves quickly (< 50ms), it was likely already resolved (cached)
          if (resolveTime < 50 && cachedEvent && !isEventDeleted(cachedEvent)) {
            cachedEventResolvedRef.current = true
            setEvent(cachedEvent)
            addReplies([cachedEvent])
            setIsFetching(false) // Show cached event immediately
          }
        })
        .catch(() => {
          // Cache promise rejected, will fetch below
        })
    }

    // Always fetch to ensure we have the latest, but don't show loading if we got cached data
    const fetchEvent = async () => {
      // Only show loading if we don't have cached data yet
      if (!cachedEventResolvedRef.current && !event) {
        setIsFetching(true)
      }

      try {
        // fetchEvent will use cache if available (via DataLoader), or fetch if not
        const fetchedEvent = await client.fetchEvent(eventId)
        if (fetchedEvent && !isEventDeleted(fetchedEvent)) {
          setEvent(fetchedEvent)
          addReplies([fetchedEvent])
        }
      } catch (error) {
        setError(error as Error)
      } finally {
        setIsFetching(false)
      }
    }

    // Small delay to let cached promise resolve first if it exists
    const timeoutId = setTimeout(() => {
      fetchEvent().catch((err) => {
        setError(err as Error)
        setIsFetching(false)
      })
    }, cachedPromise ? 10 : 0) // Small delay if we're checking cache

    return () => {
      clearTimeout(timeoutId)
    }
  }, [eventId, isEventDeleted, addReplies])

  useEffect(() => {
    if (event && isEventDeleted(event)) {
      setEvent(undefined)
    }
  }, [isEventDeleted])

  return { isFetching, error, event }
}
