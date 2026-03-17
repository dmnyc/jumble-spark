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
    const baseUrls = new Set<string>([
      ...FAST_READ_RELAY_URLS.map((url) => normalizeUrl(url) || url),
      ...userRead.map((url) => normalizeUrl(url) || url)
    ].filter(Boolean) as string[])

    // Include organizer's relays so RSVPs are found when viewing an attendee's profile (RSVPs are often on organizer's outbox/inbox)
    const organizerPubkey = calendarEvent.pubkey
    client
      .fetchRelayList(organizerPubkey)
      .then((organizerRelays) => {
        if (cancelled) return
        organizerRelays?.read?.forEach((url) => {
          const u = normalizeUrl(url)
          if (u) baseUrls.add(u)
        })
        organizerRelays?.write?.forEach((url) => {
          const u = normalizeUrl(url)
          if (u) baseUrls.add(u)
        })
        return Array.from(baseUrls)
      })
      .catch(() => Array.from(baseUrls))
      .then((relayUrls: string[] | undefined) => {
        if (cancelled) return
        const urls = relayUrls?.length ? relayUrls : Array.from(baseUrls)
        return client.fetchEvents(urls, {
          kinds: [ExtendedKind.CALENDAR_EVENT_RSVP],
          '#a': [coordinate],
          limit: 200
        })
      })
      .then((events) => {
        if (cancelled) return
        setRsvps(events ?? [])
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false)
      })

    return () => {
      cancelled = true
    }
  }, [calendarEvent?.id, calendarEvent?.kind, calendarEvent?.pubkey, relayList?.read])

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
