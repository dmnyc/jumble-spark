import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useReply } from '@/providers/ReplyProvider'
import { eventService } from '@/services/client.service'
import { navigationEventStore } from '@/services/navigation-event-store'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'

export function useFetchEvent(eventId?: string, initialEvent?: Event) {
  const { isEventDeleted } = useDeletedEvent()
  const { addReplies } = useReply()
  const [error, setError] = useState<Error | null>(null)
  const [event, setEvent] = useState<Event | undefined>(initialEvent)
  const [isFetching, setIsFetching] = useState(!initialEvent)
  const [refetchToken, setRefetchToken] = useState(0)

  const refetch = useCallback(() => {
    setRefetchToken((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!eventId) {
      setIsFetching(false)
      setError(new Error('No id provided'))
      return
    }

    const skipShortcuts = refetchToken > 0

    // If we have an initial event that matches the eventId, use it and skip fetching
    if (
      !skipShortcuts &&
      initialEvent &&
      (initialEvent.id === eventId || eventId.includes(initialEvent.id))
    ) {
      if (!isEventDeleted(initialEvent)) {
        setEvent(initialEvent)
        addReplies([initialEvent])
        setIsFetching(false)
      }
      return
    }

    // Check navigation event store first (events passed through navigation)
    if (!skipShortcuts) {
      const navigationEvent = navigationEventStore.getEvent(eventId)
      if (navigationEvent && !isEventDeleted(navigationEvent)) {
        setEvent(navigationEvent)
        addReplies([navigationEvent])
        setIsFetching(false)
        return
      }
    }

    setIsFetching(true)

    const fetchEvent = async () => {
      try {
        // First load: DataLoader dedupes. Refetches (incl. session-waiter) clear a prior undefined so
        // timeline-cached events resolve after the embed mounted first.
        const fetchedEvent =
          skipShortcuts
            ? await eventService.fetchEventForceRetry(eventId)
            : await eventService.fetchEvent(eventId)
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

    fetchEvent()
  }, [eventId, initialEvent, isEventDeleted, addReplies, refetchToken])

  useEffect(() => {
    if (event && isEventDeleted(event)) {
      setEvent(undefined)
    }
  }, [isEventDeleted, event])

  // Parent notes often render before the embedded event arrives from the same timeline; refetch when it hits session cache.
  useEffect(() => {
    if (!eventId || event !== undefined) return undefined
    return eventService.subscribeWhenSessionHasEvent(eventId, refetch)
  }, [eventId, event, refetch])

  return { isFetching, error, event, refetch }
}
