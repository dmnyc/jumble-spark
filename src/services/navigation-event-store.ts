/**
 * Navigation Event Store
 * Temporarily stores events when navigating to avoid re-fetching
 */
import { Event } from 'nostr-tools'

class NavigationEventStore {
  private eventMap = new Map<string, Event>()

  /**
   * Store an event for navigation (keyed by event ID)
   */
  setEvent(event: Event): void {
    this.eventMap.set(event.id, event)
    // Also store by bech32 ID if available (for naddr/nevent)
    // This will be handled by the navigation system
  }

  /**
   * Get an event by ID (removes it after retrieval to prevent memory leaks)
   */
  getEvent(eventId: string): Event | undefined {
    const event = this.eventMap.get(eventId)
    if (event) {
      // Remove after retrieval to prevent memory leaks
      this.eventMap.delete(eventId)
    }
    return event
  }

  /**
   * Check if an event exists without removing it
   */
  hasEvent(eventId: string): boolean {
    return this.eventMap.has(eventId)
  }

  /**
   * Clear all stored events (cleanup)
   */
  clear(): void {
    this.eventMap.clear()
  }
}

export const navigationEventStore = new NavigationEventStore()
