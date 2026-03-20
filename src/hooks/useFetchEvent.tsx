import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useReply } from '@/providers/ReplyProvider'
import { eventService } from '@/services/client.service'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'

export function useFetchEvent(eventId?: string) {
  const { isEventDeleted } = useDeletedEvent()
  const { addReplies } = useReply()
  const [error, setError] = useState<Error | null>(null)
  const [event, setEvent] = useState<Event | undefined>(undefined)
  const [isFetching, setIsFetching] = useState(true)

  useEffect(() => {
    if (!eventId) {
      setIsFetching(false)
      setError(new Error('No id provided'))
      return
    }

    setIsFetching(true)

    const fetchEvent = async () => {
      try {
        // fetchEvent uses DataLoader which handles caching automatically
        const fetchedEvent = await eventService.fetchEvent(eventId)
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
  }, [eventId, isEventDeleted, addReplies])

  useEffect(() => {
    if (event && isEventDeleted(event)) {
      setEvent(undefined)
    }
  }, [isEventDeleted, event])

  return { isFetching, error, event }
}
