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

function mergeRsvp(prev: Event[], evt: Event): Event[] {
  const next = prev.filter((e) => e.id !== evt.id)
  const samePubkey = next.find((e) => e.pubkey === evt.pubkey)
  if (samePubkey && samePubkey.created_at >= evt.created_at) return next
  const withoutSamePubkey = samePubkey ? next.filter((e) => e.pubkey !== evt.pubkey) : next
  return [...withoutSamePubkey, evt].sort((a, b) => b.created_at - a.created_at)
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

  // When we publish an RSVP, NostrProvider calls client.emitNewEvent(event). Merge it into rsvps so the UI updates immediately.
  useEffect(() => {
    if (!calendarEvent || !isCalendarEventKind(calendarEvent.kind)) return

    const coordinate = getReplaceableCoordinateFromEvent(calendarEvent)
    const handler = (e: CustomEvent<Event>) => {
      const evt = e.detail
      if (evt.kind !== ExtendedKind.CALENDAR_EVENT_RSVP) return
      const aTag = evt.tags.find(tagNameEquals('a'))
      if (aTag?.[1] !== coordinate) return
      setRsvps((prev) => mergeRsvp(prev, evt))
    }

    client.addEventListener('newEvent', handler as EventListener)
    return () => client.removeEventListener('newEvent', handler as EventListener)
  }, [calendarEvent?.id, calendarEvent?.kind])

  return {
    rsvps,
    isFetching,
    getRsvpStatus
  }
}
