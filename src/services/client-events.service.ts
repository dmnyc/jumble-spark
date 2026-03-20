import logger from '@/lib/logger'
import type { Event as NEvent, Filter } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import DataLoader from 'dataloader'
import { LRUCache } from 'lru-cache'
import indexedDb from './indexed-db.service'
import type { QueryService } from './client-query.service'
import client from './client.service'
import { isReplaceableEvent } from '@/lib/event'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'

/**
 * Build comprehensive relay list: author's outboxes + user's inboxes + relay hints + defaults
 * Uses the shared relay list builder utility
 */
async function buildComprehensiveRelayListForEvents(
  authorPubkey: string | undefined,
  relayHints: string[] = [],
  seenRelays: string[] = [],
  containingEventRelays: string[] = []
): Promise<string[]> {
  return buildComprehensiveRelayList({
    authorPubkey,
    userPubkey: client.pubkey,
    relayHints,
    seenRelays,
    containingEventRelays,
    includeFastReadRelays: true,
    includeLocalRelays: true
  })
}

export class EventService {
  private queryService: QueryService
  private eventCacheMap = new Map<string, Promise<NEvent | undefined>>()
  private sessionEventCache = new LRUCache<string, NEvent>({ max: 500, ttl: 1000 * 60 * 30 })
  private eventDataLoader: DataLoader<string, NEvent | undefined>
  private fetchEventFromBigRelaysDataloader: DataLoader<string, NEvent | undefined>

  constructor(queryService: QueryService) {
    this.queryService = queryService
    this.eventDataLoader = new DataLoader<string, NEvent | undefined>(
      (ids) => Promise.all(ids.map((id) => this._fetchEvent(id))),
      { cacheMap: this.eventCacheMap }
    )
    this.fetchEventFromBigRelaysDataloader = new DataLoader<string, NEvent | undefined>(
      this.fetchEventsFromBigRelays.bind(this),
      { cache: false, batchScheduleFn: (callback) => setTimeout(callback, 50) }
    )
  }

  /**
   * Fetch single event by ID (hex, note1, nevent1, naddr1)
   */
  async fetchEvent(id: string): Promise<NEvent | undefined> {
    let hexId: string | undefined
    if (/^[0-9a-f]{64}$/.test(id)) {
      hexId = id
    } else {
      const { type, data } = nip19.decode(id)
      switch (type) {
        case 'note':
          hexId = data
          break
        case 'nevent':
          hexId = data.id
          break
        case 'naddr':
          break
      }
    }
    if (hexId) {
      const fromSession = this.sessionEventCache.get(hexId)
      if (fromSession) return fromSession
      const cachedPromise = this.eventCacheMap.get(hexId)
      if (cachedPromise) return cachedPromise
    }
    return this.eventDataLoader.load(hexId ?? id)
  }

  /**
   * Force retry fetch event
   */
  async fetchEventForceRetry(eventId: string): Promise<NEvent | undefined> {
    return await this.fetchEvent(eventId)
  }

  /**
   * Fetch event with external relays
   */
  async fetchEventWithExternalRelays(eventId: string, externalRelays: string[]): Promise<NEvent | undefined> {
    if (!externalRelays || externalRelays.length === 0) {
      logger.warn('fetchEventWithExternalRelays: No external relays provided', { eventId })
      return undefined
    }

    logger.debug('fetchEventWithExternalRelays: Starting search', {
      eventId: eventId.substring(0, 8),
      relayCount: externalRelays.length,
      relays: externalRelays
    })

    const startTime = Date.now()
    const events = await this.queryService.query(
      externalRelays,
      { ids: [eventId], limit: 1 },
      undefined,
      {
        eoseTimeout: 10000,
        globalTimeout: 20000,
        immediateReturn: true
      }
    )
    const duration = Date.now() - startTime

    logger.debug('fetchEventWithExternalRelays: Search completed', {
      eventId: eventId.substring(0, 8),
      relayCount: externalRelays.length,
      eventsFound: events.length,
      durationMs: duration
    })

    return events[0]
  }

  /**
   * Add event to session cache
   */
  addEventToCache(event: NEvent): void {
    const cleanEvent = { ...event }
    delete (cleanEvent as any).relayStatuses
    this.sessionEventCache.set(event.id, cleanEvent)
  }

  /**
   * Get events from session cache matching search
   */
  getSessionEventsMatchingSearch(query: string, limit: number, allowedKinds?: number[]): NEvent[] {
    const results: NEvent[] = []
    const queryLower = query.toLowerCase()
    
    for (const [, event] of this.sessionEventCache.entries()) {
      if (allowedKinds && !allowedKinds.includes(event.kind)) continue
      
      const content = event.content.toLowerCase()
      if (content.includes(queryLower)) {
        results.push(event)
        if (results.length >= limit) break
      }
    }
    
    return results
  }

  /**
   * Extract relay hints from event tags
   * Relay hints are in the 3rd position (index 2) of e, a, q, etc. tags
   * Also checks for a dedicated "relays" tag
   */
  private extractRelayHintsFromEvent(event: NEvent | undefined): string[] {
    if (!event) return []
    const hints = new Set<string>()
    
    // Extract from e, a, q tags (relay hint is in position 2, index 2)
    const tagTypesWithRelayHints = ['e', 'a', 'q']
    for (const tag of event.tags) {
      if (tagTypesWithRelayHints.includes(tag[0]) && tag.length > 2 && typeof tag[2] === 'string') {
        const hint = tag[2]
        if (hint.startsWith('wss://') || hint.startsWith('ws://')) {
          hints.add(hint)
        }
      }
    }
    
    // Also check for dedicated "relays" tag
    const relaysTag = event.tags.find(tag => tag[0] === 'relays')
    if (relaysTag && relaysTag.length > 1) {
      relaysTag.slice(1).forEach(url => {
        if (typeof url === 'string' && (url.startsWith('wss://') || url.startsWith('ws://'))) {
          hints.add(url)
        }
      })
    }
    
    return Array.from(hints)
  }

  /**
   * Clear all in-memory event caches
   */
  clearCaches(): void {
    this.eventDataLoader.clearAll()
    this.sessionEventCache.clear()
    this.eventCacheMap.clear()
    this.fetchEventFromBigRelaysDataloader.clearAll()
    logger.info('[EventService] In-memory caches cleared')
  }

  /**
   * Private: Fetch event by ID (internal implementation)
   */
  private async _fetchEvent(id: string): Promise<NEvent | undefined> {
    let filter: Filter | undefined
    let relays: string[] = []
    
    if (/^[0-9a-f]{64}$/.test(id)) {
      filter = { ids: [id], limit: 1 }
    } else {
      const { type, data } = nip19.decode(id)
      switch (type) {
        case 'note':
          filter = { ids: [data], limit: 1 }
          break
        case 'nevent':
          filter = { ids: [data.id], limit: 1 }
          if (data.relays) relays = [...data.relays]
          break
        case 'naddr':
          filter = {
            authors: [data.pubkey],
            kinds: [data.kind],
            limit: 1
          }
          if (data.identifier) {
            filter['#d'] = [data.identifier]
          }
          if (data.relays) relays = [...data.relays]
          break
      }
    }

    if (!filter) return undefined

    // Try cache first
    if (filter.ids?.length) {
      const cached = await indexedDb.getEventFromPublicationStore(filter.ids[0])
      if (cached) {
        this.addEventToCache(cached)
        // Extract relay hints from cached event's tags (e, a, q tags)
        const eventRelayHints = this.extractRelayHintsFromEvent(cached)
        if (eventRelayHints.length > 0) {
          relays = [...new Set([...relays, ...eventRelayHints])]
        }
        return cached
      }
    }

    // Try big relays first (uses user's inboxes + defaults)
    if (filter.ids?.length) {
      const event = await this.fetchEventFromBigRelaysDataloader.load(filter.ids[0])
      if (event) {
        this.addEventToCache(event)
        // Extract relay hints from found event's tags (e, a, q tags)
        const eventRelayHints = this.extractRelayHintsFromEvent(event)
        if (eventRelayHints.length > 0) {
          relays = [...new Set([...relays, ...eventRelayHints])]
        }
        return event
      }
    }

    // Always try comprehensive relay list (author's outboxes + user's inboxes + hints + seen + defaults)
    const event = await this.tryHarderToFetchEvent(relays, filter, true)
    if (event) {
      this.addEventToCache(event)
      return event
    }

    return undefined
  }

  /**
   * Private: Try harder to fetch event from relays
   * ALWAYS uses: author's outboxes + user's inboxes + relay hints + seen relays + defaults
   */
  private async tryHarderToFetchEvent(
    relayHints: string[],
    filter: Filter,
    alreadyFetchedFromBigRelays = false
  ): Promise<NEvent | undefined> {
    // Get seen relays if we have an event ID
    const seenRelays = filter.ids?.length ? client.getSeenEventRelayUrls(filter.ids[0]) : []
    
    // Get author pubkey
    const authorPubkey = filter.authors?.length === 1 ? filter.authors[0] : undefined
    
    // Build comprehensive relay list
    const relayUrls = await buildComprehensiveRelayListForEvents(authorPubkey, relayHints, seenRelays, [])
    
    if (!relayUrls.length) {
      // Fallback to default relays if comprehensive list is empty
      if (!alreadyFetchedFromBigRelays) {
        return undefined
      }
      return undefined
    }

    logger.debug('[EventService] Using comprehensive relay list', {
      author: authorPubkey?.substring(0, 8),
      relayCount: relayUrls.length,
      hasHints: relayHints.length > 0,
      hasSeen: seenRelays.length > 0
    })

    const isSingleEventById = filter.ids && filter.ids.length === 1 && filter.limit === 1
    
    // For single-event fetches, always use immediateReturn to return ASAP
    // This is especially important for non-replaceable events (not in 10000-19999 or 30000-39999 ranges)
    const events = await this.queryService.query(relayUrls, filter, undefined, {
      immediateReturn: isSingleEventById, // Return immediately when found
      eoseTimeout: isSingleEventById ? 100 : 500,
      globalTimeout: isSingleEventById ? 3000 : 10000
    })
    
    const event = events.sort((a, b) => b.created_at - a.created_at)[0]
    
    // For non-replaceable events, we've already returned immediately via immediateReturn
    // But log it for debugging
    if (event && isSingleEventById && !isReplaceableEvent(event.kind)) {
      logger.debug('[EventService] Non-replaceable event returned immediately', {
        eventId: event.id.substring(0, 8),
        kind: event.kind
      })
    }
    
    return event
  }

  /**
   * Private: Fetch events from big relays (batch)
   * Uses comprehensive relay list: user's inboxes + defaults
   */
  private async fetchEventsFromBigRelays(ids: readonly string[]): Promise<(NEvent | undefined)[]> {
    // Build comprehensive relay list (user's inboxes + defaults)
    // Note: For batch fetches, we don't have author info, so we use user's inboxes + defaults
    const relayUrls = await buildComprehensiveRelayListForEvents(undefined, [], [], [])

    const isSingleEventFetch = ids.length === 1
    // For single-event fetches, always use immediateReturn to return ASAP
    // This is especially important for non-replaceable events (not in 10000-19999 or 30000-39999 ranges)
    const events = await this.queryService.query(relayUrls, {
      ids: Array.from(new Set(ids)),
      limit: ids.length
    }, undefined, {
      immediateReturn: isSingleEventFetch, // Return immediately when found
      eoseTimeout: isSingleEventFetch ? 100 : 500,
      globalTimeout: isSingleEventFetch ? 3000 : 10000
    })
    
    const eventsMap = new Map<string, NEvent>()
    for (const event of events) {
      eventsMap.set(event.id, event)
      // Note: We can't track which relay returned which event in batch queries,
      // but events are still cached and will be found in future queries
    }

    return ids.map((id) => eventsMap.get(id))
  }
}
