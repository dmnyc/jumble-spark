/**
 * Navigation Event Store
 * Temporarily stores events when navigating to avoid re-fetching
 */
import { getNoteBech32Id } from '@/lib/event'
import { Event, nip19 } from 'nostr-tools'

/** URL paths use bech32 (nevent1…, naddr1…); lookups must match the `id` passed to `useFetchEvent`. */
function candidateKeysForNoteUrlId(eventId: string): string[] {
  const keys = [eventId]
  if (/^[a-f0-9]{64}$/i.test(eventId)) return keys
  try {
    const decoded = nip19.decode(eventId)
    if (decoded.type === 'nevent') {
      keys.push(decoded.data.id)
    } else if (decoded.type === 'note') {
      keys.push(decoded.data)
    }
  } catch {
    /* not bech32 */
  }
  return keys
}

class NavigationEventStore {
  private eventMap = new Map<string, Event>()

  private removeEventFromAllKeys(event: Event): void {
    this.eventMap.delete(event.id)
    try {
      const urlId = getNoteBech32Id(event)
      if (urlId !== event.id) {
        this.eventMap.delete(urlId)
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Store an event for navigation (hex id + same bech32 form as {@link toNote} / the URL).
   */
  setEvent(event: Event): void {
    this.eventMap.set(event.id, event)
    try {
      const urlId = getNoteBech32Id(event)
      if (urlId !== event.id) {
        this.eventMap.set(urlId, event)
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Get an event by ID (removes it after retrieval to prevent memory leaks)
   */
  getEvent(eventId: string): Event | undefined {
    for (const key of candidateKeysForNoteUrlId(eventId)) {
      const event = this.eventMap.get(key)
      if (event) {
        this.removeEventFromAllKeys(event)
        return event
      }
    }
    return undefined
  }

  /**
   * Check if an event exists without removing it
   */
  hasEvent(eventId: string): boolean {
    return candidateKeysForNoteUrlId(eventId).some((k) => this.eventMap.has(k))
  }

  /**
   * Clear all stored events (cleanup)
   */
  clear(): void {
    this.eventMap.clear()
  }
}

export const navigationEventStore = new NavigationEventStore()
