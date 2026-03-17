import { ExtendedKind } from '@/constants'
import { getReplaceableCoordinateFromEvent } from '@/lib/event'
import { isCalendarEventKind } from '@/lib/calendar-event'
import client from '@/services/client.service'
import { useNostr } from '@/providers/NostrProvider'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { normalizeUrl } from '@/lib/url'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { tagNameEquals } from '@/lib/tag'

function getRsvpStatus(rsvp: Event): 'accepted' | 'tentative' | 'declined' | undefined {
  const status = rsvp.tags.find(tagNameEquals('status'))?.[1]
  if (status === 'accepted' || status === 'tentative' || status === 'declined') return status
  return undefined
}

export function useFetchCalendarRsvps(calendarEvent: Event | undefined) {
  const { relayList } = useNostr()
  const [rsvps, setRsvps] = useState<Event[]>([])
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    if (!calendarEvent || !isCalendarEventKind(calendarEvent.kind)) {
      setRsvps([])
      return
    }

    let cancelled = false
    setIsFetching(true)

    const coordinate = getReplaceableCoordinateFromEvent(calendarEvent)
    const userRead = relayList?.read ?? []
    const relayUrls = Array.from(
      new Set([
        ...FAST_READ_RELAY_URLS.map((url) => normalizeUrl(url) || url),
        ...userRead.map((url) => normalizeUrl(url) || url)
      ])
    ).filter(Boolean) as string[]

    client
      .fetchEvents(relayUrls, {
        kinds: [ExtendedKind.CALENDAR_EVENT_RSVP],
        '#a': [coordinate],
        limit: 200
      })
      .then((events) => {
        if (cancelled) return
        setRsvps(events)
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false)
      })

    return () => {
      cancelled = true
    }
  }, [calendarEvent?.id, calendarEvent?.kind, relayList?.read])

  return {
    rsvps,
    isFetching,
    getRsvpStatus
  }
}
