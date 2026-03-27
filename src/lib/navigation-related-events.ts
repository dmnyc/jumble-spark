import { getParentBech32Id, getRootBech32Id } from '@/lib/event'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'

/**
 * Parent / root events already in the session cache (e.g. from {@link ParentNotePreview} or the feed).
 * Passed into {@link navigateToNote} as `relatedEvents` so {@link NotePage} can render the thread strip
 * without a refetch — especially when the side panel mounts without `initialEvent`.
 */
export function getCachedThreadContextEvents(forEvent: Event): Event[] {
  const byId = new Map<string, Event>()
  const tryAdd = (bech32OrHex?: string) => {
    if (!bech32OrHex?.trim()) return
    const ev = client.peekSessionCachedEvent(bech32OrHex.trim())
    if (ev) byId.set(ev.id.toLowerCase(), ev)
  }
  tryAdd(getParentBech32Id(forEvent))
  tryAdd(getRootBech32Id(forEvent))
  return [...byId.values()]
}
