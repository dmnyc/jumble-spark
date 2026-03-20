import { BIG_RELAY_URLS } from '@/constants'
import logger from '@/lib/logger'
import type { Event as NEvent, Filter } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import DataLoader from 'dataloader'
import { LRUCache } from 'lru-cache'
import indexedDb from './indexed-db.service'
import type { QueryService } from './client-query.service'

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
        return cached
      }
    }

    // Try big relays first
    if (filter.ids?.length) {
      const event = await this.fetchEventFromBigRelaysDataloader.load(filter.ids[0])
      if (event) {
        this.addEventToCache(event)
        return event
      }
    }

    // Try harder with specified relays or author relays
    if (filter.ids?.length && relays.length) {
      const event = await this.tryHarderToFetchEvent(relays, filter, true)
      if (event) {
        this.addEventToCache(event)
        return event
      }
    } else if (filter.authors?.length) {
      const event = await this.tryHarderToFetchEvent(relays, filter, false)
      if (event) {
        this.addEventToCache(event)
        return event
      }
    }

    return undefined
  }

  /**
   * Private: Try harder to fetch event from relays
   */
  private async tryHarderToFetchEvent(
    relayUrls: string[],
    filter: Filter,
    alreadyFetchedFromBigRelays = false
  ): Promise<NEvent | undefined> {
    if (!relayUrls.length && filter.authors?.length) {
      // Would need relay list service - for now use big relays
      relayUrls = BIG_RELAY_URLS
    } else if (!relayUrls.length && !alreadyFetchedFromBigRelays) {
      relayUrls = BIG_RELAY_URLS
    }
    if (!relayUrls.length) return undefined

    const isSingleEventById = filter.ids && filter.ids.length === 1 && filter.limit === 1
    const events = await this.queryService.query(relayUrls, filter, undefined, {
      immediateReturn: isSingleEventById,
      eoseTimeout: isSingleEventById ? 100 : 500,
      globalTimeout: isSingleEventById ? 3000 : 10000
    })
    return events.sort((a, b) => b.created_at - a.created_at)[0]
  }

  /**
   * Private: Fetch events from big relays (batch)
   */
  private async fetchEventsFromBigRelays(ids: readonly string[]): Promise<(NEvent | undefined)[]> {
    const initialRelays = BIG_RELAY_URLS
    const relayUrls = initialRelays.length > 0 ? initialRelays : BIG_RELAY_URLS

    const isSingleEventFetch = ids.length === 1
    const events = await this.queryService.query(relayUrls, {
      ids: Array.from(new Set(ids)),
      limit: ids.length
    }, undefined, {
      immediateReturn: isSingleEventFetch,
      eoseTimeout: isSingleEventFetch ? 100 : 500,
      globalTimeout: isSingleEventFetch ? 3000 : 10000
    })
    
    const eventsMap = new Map<string, NEvent>()
    for (const event of events) {
      eventsMap.set(event.id, event)
    }

    return ids.map((id) => eventsMap.get(id))
  }
}
