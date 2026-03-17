import { ExtendedKind } from '@/constants'
import { tagNameEquals } from '@/lib/tag'
import { Event } from 'nostr-tools'

export interface CalendarEventMeta {
  title: string
  summary: string
  image: string
  /** Time-based: Unix seconds. Date-based: undefined. */
  start: number | undefined
  /** Time-based: Unix seconds. Date-based: undefined. */
  end: number | undefined
  /** Date-based: YYYY-MM-DD. Time-based: undefined. */
  startDate: string
  /** Date-based: YYYY-MM-DD (exclusive end). Time-based: undefined. */
  endDate: string
  isDateBased: boolean
  joinUrl: string
  topics: string[]
}

export function getCalendarEventMeta(event: Event): CalendarEventMeta {
  const title = event.tags.find(tagNameEquals('title'))?.[1] ?? ''
  const summary = event.tags.find(tagNameEquals('summary'))?.[1] ?? ''
  const image = event.tags.find(tagNameEquals('image'))?.[1] ?? ''
  const startStr = event.tags.find(tagNameEquals('start'))?.[1]
  const endStr = event.tags.find(tagNameEquals('end'))?.[1]
  const location = event.tags.find(tagNameEquals('location'))?.[1]
  const rTag = event.tags.find(tagNameEquals('r'))?.[1]
  const joinUrl = rTag || location || ''
  const topics = event.tags.filter(tagNameEquals('t')).map((t) => t[1]?.trim()).filter(Boolean)
  const isDateBased = event.kind === ExtendedKind.CALENDAR_EVENT_DATE
  if (isDateBased) {
    return {
      title,
      summary,
      image,
      start: undefined,
      end: undefined,
      startDate: startStr ?? '',
      endDate: endStr ?? '',
      isDateBased: true,
      joinUrl,
      topics
    }
  }
  const start = startStr ? parseInt(startStr, 10) : undefined
  const end = endStr ? parseInt(endStr, 10) : undefined
  return {
    title,
    summary,
    image,
    start,
    end,
    startDate: '',
    endDate: '',
    isDateBased: false,
    joinUrl,
    topics
  }
}

export function formatCalendarTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

/** Format a YYYY-MM-DD date string for display. */
export function formatCalendarDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { dateStyle: 'long' })
}

export function isCalendarEventKind(kind: number): boolean {
  return kind === ExtendedKind.CALENDAR_EVENT_DATE || kind === ExtendedKind.CALENDAR_EVENT_TIME
}
