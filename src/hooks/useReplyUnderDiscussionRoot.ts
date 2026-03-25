import { ExtendedKind } from '@/constants'
import { getRootEventHexId } from '@/lib/event'
import { eventService } from '@/services/client.service'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'

/**
 * True when `event` is kind 1111 (COMMENT) whose thread root is a kind 11 discussion.
 */
export function useReplyUnderDiscussionRoot(event: Event): boolean {
  const [isReply, setIsReply] = useState(false)

  useEffect(() => {
    if (event.kind !== ExtendedKind.COMMENT) {
      setIsReply(false)
      return
    }
    const rootEventId = getRootEventHexId(event)
    if (!rootEventId) {
      setIsReply(false)
      return
    }
    let cancelled = false
    eventService
      .fetchEvent(rootEventId)
      .then((rootEvent) => {
        if (cancelled) return
        setIsReply(!!(rootEvent && rootEvent.kind === ExtendedKind.DISCUSSION))
      })
      .catch(() => {
        if (!cancelled) setIsReply(false)
      })
    return () => {
      cancelled = true
    }
  }, [event.id, event.kind])

  return isReply
}
