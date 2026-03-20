import { ExtendedKind, FAST_READ_RELAY_URLS, PROFILE_FETCH_RELAY_URLS } from '@/constants'
import { kinds, nip19 } from 'nostr-tools'
import type { Event as NEvent, Filter } from 'nostr-tools'
import DataLoader from 'dataloader'
import { normalizeUrl } from '@/lib/url'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { formatPubkey, pubkeyToNpub, userIdToPubkey } from '@/lib/pubkey'
import { getPubkeysFromPTags, getServersFromServerTags } from '@/lib/tag'
import { TProfile } from '@/types'
import { LRUCache } from 'lru-cache'
import indexedDb from './indexed-db.service'
import type { QueryService } from './client-query.service'
import { isReplaceableEvent, getReplaceableCoordinateFromEvent } from '@/lib/event'
import logger from '@/lib/logger'
import client from './client.service'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'

export class ReplaceableEventService {
  private queryService: QueryService
  private onProfileIndexed?: (profileEvent: NEvent) => void | Promise<void>
  private followingFavoriteRelaysCache = new LRUCache<string, Promise<[string, string[]][]>>({
    max: 50,
    ttl: 1000 * 60 * 60
  })
  private replaceableEventFromBigRelaysDataloader: DataLoader<
    { pubkey: string; kind: number },
    NEvent | null,
    string
  >
  private replaceableEventDataLoader: DataLoader<
    { pubkey: string; kind: number; d?: string },
    NEvent | null,
    string
  >

  constructor(queryService: QueryService, onProfileIndexed?: (profileEvent: NEvent) => void | Promise<void>) {
    this.queryService = queryService
    this.onProfileIndexed = onProfileIndexed
    this.replaceableEventFromBigRelaysDataloader = new DataLoader<
      { pubkey: string; kind: number },
      NEvent | null,
      string
    >(
      this.replaceableEventFromBigRelaysBatchLoadFn.bind(this),
      {
        batchScheduleFn: (callback) => setTimeout(callback, 100), // Increased from 50ms to 100ms to better batch rapid scrolling
        maxBatchSize: 200, // Reduced from 500 to prevent overwhelming the system during rapid scrolling
        cacheKeyFn: ({ pubkey, kind }) => `${pubkey}:${kind}`
      }
    )
    this.replaceableEventDataLoader = new DataLoader<
      { pubkey: string; kind: number; d?: string },
      NEvent | null,
      string
    >(
      this.replaceableEventBatchLoadFn.bind(this),
      {
        cacheKeyFn: ({ pubkey, kind, d }) => `${kind}:${pubkey}:${d ?? ''}`
      }
    )
  }


  /**
   * Build comprehensive relay list: author's outboxes + user's inboxes + relay hints + defaults
   * For profiles/metadata: includes user's own relays (read/write/local) + PROFILE_FETCH_RELAY_URLS
   */
  private async buildComprehensiveRelayListForAuthor(
    authorPubkey: string,
    kind: number,
    relayHints: string[] = [],
    containingEventRelays: string[] = []
  ): Promise<string[]> {
    const userPubkey = client.pubkey
    const isProfileOrMetadata = kind === kinds.Metadata || kind === kinds.RelayList
    
    // Use the comprehensive relay list builder
    return buildComprehensiveRelayList({
      authorPubkey,
      userPubkey,
      relayHints,
      containingEventRelays,
      includeUserOwnRelays: isProfileOrMetadata, // For profiles/metadata, include user's own relays
      includeProfileFetchRelays: isProfileOrMetadata, // For profiles/metadata, include PROFILE_FETCH_RELAY_URLS
      includeFastReadRelays: true,
      includeLocalRelays: true
    })
  }

  /**
   * Fetch replaceable event (profile, relay list, etc.)
   * Uses DataLoader to batch IndexedDB checks and network fetches
   * ALWAYS uses: author's outboxes + user's inboxes + relay hints + defaults
   * For profiles/metadata: includes user's own relays (read/write/local) + PROFILE_FETCH_RELAY_URLS
   * 
   * @param pubkey - Author's pubkey
   * @param kind - Event kind
   * @param d - Optional d-tag for parameterized replaceable events
   * @param containingEventRelays - Optional relays where a containing event was found (for profiles, might be on same relay as event)
   */
  async fetchReplaceableEvent(
    pubkey: string, 
    kind: number, 
    d?: string,
    containingEventRelays: string[] = []
  ): Promise<NEvent | undefined> {
    const cacheKey = d ? `${kind}:${pubkey}:${d}` : `${kind}:${pubkey}`
    logger.info('[ReplaceableEventService] fetchReplaceableEvent start', {
      pubkey,
      kind,
      d,
      cacheKey,
      containingEventRelays: containingEventRelays.length
    })
    
    try {
      // If we have containing event relays and this is a profile, we need to use a custom relay list
      // Otherwise, use DataLoader (which batches IndexedDB checks and network fetches)
      let event: NEvent | undefined
      if (containingEventRelays.length > 0 && kind === kinds.Metadata && !d) {
        // For profiles with containing event relays (author's relay list), check IndexedDB first, then query directly
        logger.info('[ReplaceableEventService] Checking IndexedDB for profile with containing relays', {
          pubkey,
          kind
        })
        try {
          const indexedDbCached = await indexedDb.getReplaceableEvent(pubkey, kind, d)
          if (indexedDbCached) {
            logger.info('[ReplaceableEventService] Found in IndexedDB', {
              pubkey,
              kind,
              eventId: indexedDbCached.id
            })
            // Refresh in background
            this.refreshInBackground(pubkey, kind, d).catch(() => {})
            return indexedDbCached
          }
        } catch (error) {
          logger.warn('[ReplaceableEventService] IndexedDB error', { 
            pubkey, 
            kind, 
            error: error instanceof Error ? error.message : String(error)
          })
        }
        
        // Not in IndexedDB, fetch from network with custom relay list
        logger.info('[ReplaceableEventService] Building relay list with containing event relays', {
          pubkey,
          containingRelayCount: containingEventRelays.length
        })
        const relayUrls = await this.buildComprehensiveRelayListForAuthor(pubkey, kind, containingEventRelays, [])
        logger.info('[ReplaceableEventService] Querying relays', {
          pubkey,
          relayCount: relayUrls.length,
          relays: relayUrls.slice(0, 5)
        })
        const startTime = Date.now()
        const events = await this.queryService.query(relayUrls, {
          authors: [pubkey],
          kinds: [kind]
        }, undefined, {
          replaceableRace: true,
          eoseTimeout: 100, // Reduced from 200ms for faster early returns
          globalTimeout: 2000 // Reduced from 3000ms to prevent long waits when many relays are slow
        })
        const queryTime = Date.now() - startTime
        logger.info('[ReplaceableEventService] Query completed', {
          pubkey,
          eventCount: events.length,
          queryTime: `${queryTime}ms`
        })
        const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
        event = sortedEvents.length > 0 ? sortedEvents[0] : undefined
      } else {
        // Use DataLoader for batching (IndexedDB checks and network fetches are batched)
        logger.info('[ReplaceableEventService] Using DataLoader (batches IndexedDB + network)', {
          pubkey,
          kind,
          d
        })
        const startTime = Date.now()
        const loadedEvent = d
          ? await this.replaceableEventDataLoader.load({ pubkey, kind, d })
          : await this.replaceableEventFromBigRelaysDataloader.load({ pubkey, kind })
        const loadTime = Date.now() - startTime
        logger.info('[ReplaceableEventService] DataLoader completed', {
          pubkey,
          found: !!loadedEvent,
          loadTime: `${loadTime}ms`
        })
        event = loadedEvent || undefined
      }
      
      if (event) {
        logger.info('[ReplaceableEventService] Event found', {
          pubkey,
          kind,
          eventId: event.id,
          created_at: event.created_at
        })
        return event
      }
      
      // Log when no event is found (helps debug relay failures)
      if (kind === kinds.Metadata) {
        logger.warn('[ReplaceableEventService] No profile found for pubkey', { 
          pubkey,
          cacheKey
        })
      }
    } catch (error) {
      // Log errors but don't throw - return undefined so UI can show fallback
      if (kind === kinds.Metadata) {
        logger.error('[ReplaceableEventService] Error fetching profile', { 
          pubkey,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
      } else {
        logger.warn('[ReplaceableEventService] Error fetching replaceable event', {
          pubkey,
          kind,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    
    logger.info('[ReplaceableEventService] fetchReplaceableEvent returning undefined', {
      pubkey,
      kind
    })
    return undefined
  }
  
  /**
   * Refresh event in background (non-blocking)
   */
  private async refreshInBackground(pubkey: string, kind: number, d?: string): Promise<void> {
    try {
      if (d) {
        await this.replaceableEventDataLoader.load({ pubkey, kind, d })
      } else {
        await this.replaceableEventFromBigRelaysDataloader.load({ pubkey, kind })
      }
    } catch {
      // Ignore errors in background refresh
    }
  }

  /**
   * Batch fetch replaceable events from profile fetch relays
   * Checks IndexedDB first, then network
   */
  async fetchReplaceableEventsFromProfileFetchRelays(pubkeys: string[], kind: number): Promise<(NEvent | undefined)[]> {
    const results: (NEvent | undefined)[] = []
    const misses: { pubkey: string; index: number }[] = []
    
    // Check IndexedDB in parallel
    const indexedDbPromises = pubkeys.map(async (pubkey, index) => {
      try {
        const event = await indexedDb.getReplaceableEvent(pubkey, kind)
        if (event) {
          results[index] = event
          return { index, event }
        }
      } catch {
        // Ignore errors
      }
      misses.push({ pubkey, index })
      return null
    })
    
    await Promise.allSettled(indexedDbPromises)
    
    // Find what's still missing and fetch from network
    const stillMissing = misses.filter(({ index }) => results[index] === undefined)
    if (stillMissing.length > 0) {
      const newEvents = await this.replaceableEventFromBigRelaysDataloader.loadMany(
        stillMissing.map(({ pubkey }) => ({ pubkey, kind }))
      )
      newEvents.forEach((event, idx) => {
        if (event && !(event instanceof Error)) {
          const { index } = stillMissing[idx]!
          if (index !== undefined) {
            results[index] = event ?? undefined
          }
        }
      })
    }
    
    return results
  }

  /**
   * Update replaceable event cache
   */
  async updateReplaceableEventCache(event: NEvent): Promise<void> {
    // Update DataLoader cache and IndexedDB
    await this.updateReplaceableEventFromBigRelaysCache(event)
  }

  /**
   * Clear replaceable event caches
   */
  clearCaches(): void {
    this.replaceableEventFromBigRelaysDataloader.clearAll()
    this.replaceableEventDataLoader.clearAll()
  }

  /**
   * Private: Batch load function for replaceable events from big relays
   * Batches IndexedDB checks first, then only fetches missing events from network
   */
  private async replaceableEventFromBigRelaysBatchLoadFn(
    params: readonly { pubkey: string; kind: number }[]
  ): Promise<(NEvent | null)[]> {
    // CRITICAL: Reduce logging during rapid scrolling - only log large batches
    if (params.length > 50) {
      logger.info('[ReplaceableEventService] Large batch load function called', {
        paramCount: params.length,
        kind: params[0]?.kind
      })
    } else {
      logger.debug('[ReplaceableEventService] Batch load function called', {
        paramCount: params.length,
        kind: params[0]?.kind
      })
    }
    
    // Step 1: Batch check IndexedDB for all requested events
    const groups = new Map<number, string[]>()
    params.forEach(({ pubkey, kind }) => {
      if (!groups.has(kind)) {
        groups.set(kind, [])
      }
      groups.get(kind)!.push(pubkey)
    })
    
    const results: (NEvent | null)[] = new Array(params.length).fill(null)
    const eventsMap = new Map<string, NEvent>()
    const missingParams: { pubkey: string; kind: number; index: number }[] = []
    
    // Batch IndexedDB checks by kind
    await Promise.allSettled(
      Array.from(groups.entries()).map(async ([kind, pubkeys]) => {
        try {
          // Use batched IndexedDB query
          const indexedDbEvents = await indexedDb.getManyReplaceableEvents(pubkeys, kind)
          // Only log at debug level to reduce noise during rapid scrolling
          logger.debug('[ReplaceableEventService] IndexedDB batch query completed', {
            kind,
            pubkeyCount: pubkeys.length,
            foundCount: indexedDbEvents.filter(e => e !== null && e !== undefined).length
          })
          
          // Map IndexedDB results back to params
          pubkeys.forEach((pubkey, idx) => {
            const paramIndex = params.findIndex(p => p.pubkey === pubkey && p.kind === kind)
            if (paramIndex >= 0) {
              const event = indexedDbEvents[idx]
              if (event && event !== null) {
                results[paramIndex] = event
                eventsMap.set(`${pubkey}:${kind}`, event)
                // Check tombstone in background (non-blocking)
                const tombstoneKey = isReplaceableEvent(kind) 
                  ? getReplaceableCoordinateFromEvent(event)
                  : event.id
                indexedDb.isTombstoned(tombstoneKey).catch(() => {})
                // Refresh in background
                this.refreshInBackground(pubkey, kind).catch(() => {})
              } else {
                missingParams.push({ pubkey, kind, index: paramIndex })
              }
            }
          })
        } catch (error) {
          logger.warn('[ReplaceableEventService] IndexedDB batch query error', {
            kind,
            error: error instanceof Error ? error.message : String(error)
          })
          // If IndexedDB fails, mark all as missing
          pubkeys.forEach((pubkey) => {
            const paramIndex = params.findIndex(p => p.pubkey === pubkey && p.kind === kind)
            if (paramIndex >= 0) {
              missingParams.push({ pubkey, kind, index: paramIndex })
            }
          })
        }
      })
    )
    
    // Step 2: Only fetch missing events from network
    if (missingParams.length === 0) {
      logger.debug('[ReplaceableEventService] All events found in IndexedDB, skipping network fetch', {
        totalCount: params.length
      })
      return results
    }
    
    // Only log at info level for large batches
    if (missingParams.length > 50) {
      logger.info('[ReplaceableEventService] Fetching missing events from network', {
        missingCount: missingParams.length,
        totalCount: params.length
      })
    } else {
      logger.debug('[ReplaceableEventService] Fetching missing events from network', {
        missingCount: missingParams.length,
        totalCount: params.length
      })
    }
    
    // Group missing params by kind for network fetch
    const missingGroups = new Map<number, { pubkey: string; index: number }[]>()
    missingParams.forEach(({ pubkey, kind, index }) => {
      if (!missingGroups.has(kind)) {
        missingGroups.set(kind, [])
      }
      missingGroups.get(kind)!.push({ pubkey, index })
    })
    
    await Promise.allSettled(
      Array.from(missingGroups.entries()).map(async ([kind, missingItems]) => {
        const pubkeys = missingItems.map(item => item.pubkey)
        // ALWAYS use comprehensive relay list: author's outboxes + user's inboxes + defaults
        // For profiles/metadata: includes user's own relays (read/write/local) + PROFILE_FETCH_RELAY_URLS
        // For each pubkey, build comprehensive relay list
        // CRITICAL FIX: For batch fetches, use default relays instead of fetching relay lists for each author
        // Fetching relay lists for hundreds of authors causes infinite loops and browser crashes
        // Use PROFILE_FETCH_RELAY_URLS + FAST_READ_RELAY_URLS for profiles, or FAST_READ_RELAY_URLS for other kinds
        const relayUrls = kind === kinds.Metadata
          ? Array.from(new Set([...PROFILE_FETCH_RELAY_URLS, ...FAST_READ_RELAY_URLS]))
          : [...FAST_READ_RELAY_URLS]
        
        // Only log at info level for large batches
        if (pubkeys.length > 50) {
          logger.info('[ReplaceableEventService] Starting query for large batch', {
            kind,
            pubkeyCount: pubkeys.length,
            relayCount: relayUrls.length
          })
        } else {
          logger.debug('[ReplaceableEventService] Starting query for batch', {
            kind,
            pubkeyCount: pubkeys.length,
            relayCount: relayUrls.length
          })
        }
        const events = await this.queryService.query(relayUrls, {
          authors: pubkeys,
          kinds: [kind]
        }, undefined, {
          replaceableRace: true,
          eoseTimeout: 100, // Reduced from 200ms for faster early returns
          globalTimeout: 2000 // Reduced from 3000ms to prevent long waits when many relays are slow
        })
        // Only log at info level for large batches or if many events found
        if (pubkeys.length > 50 || events.length > 100) {
          logger.info('[ReplaceableEventService] Query completed for batch', {
            kind,
            pubkeyCount: pubkeys.length,
            eventCount: events.length
          })
        } else {
          logger.debug('[ReplaceableEventService] Query completed for batch', {
            kind,
            pubkeyCount: pubkeys.length,
            eventCount: events.length
          })
        }
        
        // CRITICAL: Limit the number of events processed to prevent memory issues during rapid scrolling
        // If we have too many events, only process the most recent ones per pubkey
        if (events.length > 1000) {
          logger.warn('[ReplaceableEventService] Large batch detected, limiting processing', {
            kind,
            eventCount: events.length,
            pubkeyCount: pubkeys.length
          })
          // Group by pubkey and keep only the most recent event per pubkey
          const eventsByPubkey = new Map<string, NEvent>()
          for (const event of events) {
            const key = `${event.pubkey}:${event.kind}`
            const existing = eventsByPubkey.get(key)
            if (!existing || existing.created_at < event.created_at) {
              eventsByPubkey.set(key, event)
            }
          }
          // Convert back to array, but limit to reasonable size
          const limitedEvents = Array.from(eventsByPubkey.values()).slice(0, 500)
          logger.info('[ReplaceableEventService] Limited batch size', {
            originalCount: events.length,
            limitedCount: limitedEvents.length
          })
          // Use limited events for processing
          for (const event of limitedEvents) {
            const key = `${event.pubkey}:${event.kind}`
            const existing = eventsMap.get(key)
            if (!existing || existing.created_at < event.created_at) {
              eventsMap.set(key, event)
              // Update results array for this event
              const itemIndex = missingItems.findIndex(item => item.pubkey === event.pubkey)
              if (itemIndex >= 0) {
                const paramIndex = missingItems[itemIndex]!.index
                results[paramIndex] = event
              }
            }
          }
        } else {
          // Normal processing for smaller batches
          for (const event of events) {
            const key = `${event.pubkey}:${event.kind}`
            const existing = eventsMap.get(key)
            if (!existing || existing.created_at < event.created_at) {
              eventsMap.set(key, event)
              // Update results array for this event
              const itemIndex = missingItems.findIndex(item => item.pubkey === event.pubkey)
              if (itemIndex >= 0) {
                const paramIndex = missingItems[itemIndex]!.index
                results[paramIndex] = event
              }
            }
          }
        }
        
        // Log when no events are found (helps debug relay failures)
        if (kind === kinds.Metadata && events.length === 0 && pubkeys.length > 0) {
          logger.debug('[ReplaceableEventService] No profile events found from relays', {
            pubkeyCount: pubkeys.length,
            relayCount: relayUrls.length,
            relays: relayUrls.slice(0, 3) // Show first 3 for brevity
          })
        }

      })
    )
    
    // Step 3: Save network-fetched events to IndexedDB and mark missing ones as null
    await Promise.allSettled(
      missingParams.map(async ({ pubkey, kind }) => {
        const key = `${pubkey}:${kind}`
        const event = eventsMap.get(key)
        if (event) {
          await indexedDb.putReplaceableEvent(event)
        } else {
          await indexedDb.putNullReplaceableEvent(pubkey, kind)
        }
      })
    )
    
    // Only log at info level for large batches
    if (params.length > 50) {
      logger.info('[ReplaceableEventService] Batch load function completed', {
        paramCount: params.length,
        foundCount: results.filter(r => r !== null).length,
        indexedDbCount: params.length - missingParams.length,
        networkCount: missingParams.length
      })
    } else {
      logger.debug('[ReplaceableEventService] Batch load function completed', {
        paramCount: params.length,
        foundCount: results.filter(r => r !== null).length
      })
    }
    return results
  }

  /**
   * Private: Batch load function for replaceable events with d-tag
   */
  private async replaceableEventBatchLoadFn(
    params: readonly { pubkey: string; kind: number; d?: string }[]
  ): Promise<(NEvent | null)[]> {
    const groups = new Map<string, { pubkey: string; kind: number; d?: string }[]>()
    params.forEach(({ pubkey, kind, d }) => {
      const key = `${kind}:${d ?? ''}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push({ pubkey, kind, d })
    })

    const eventsMap = new Map<string, NEvent>()
    await Promise.allSettled(
      Array.from(groups.entries()).map(async ([, items]) => {
        const { kind, d } = items[0]!
        const pubkeys = items.map(item => item.pubkey)
        const relayUrls = FAST_READ_RELAY_URLS

        const filter: Filter = {
          authors: pubkeys,
          kinds: [kind]
        }
        if (d) {
          filter['#d'] = [d]
        }

        const events = await this.queryService.query(relayUrls, filter, undefined, {
          replaceableRace: true,
          eoseTimeout: 100, // Reduced from 200ms for faster early returns
          globalTimeout: 2000 // Reduced from 3000ms to prevent long waits when many relays are slow
        })

        for (const event of events) {
          const eventKey = `${event.pubkey}:${event.kind}:${d ?? ''}`
          const existing = eventsMap.get(eventKey)
          if (!existing || existing.created_at < event.created_at) {
            eventsMap.set(eventKey, event)
          }
        }
      })
    )

    return params.map(({ pubkey, kind, d }) => {
      const eventKey = `${pubkey}:${kind}:${d ?? ''}`
      const event = eventsMap.get(eventKey)
      if (event) {
        indexedDb.putReplaceableEvent(event)
        return event
      } else {
        indexedDb.putNullReplaceableEvent(pubkey, kind, d)
        return null
      }
    })
  }

  /**
   * Private: Update cache for replaceable event from big relays
   */
  private async updateReplaceableEventFromBigRelaysCache(event: NEvent): Promise<void> {
    this.replaceableEventFromBigRelaysDataloader.clear({ pubkey: event.pubkey, kind: event.kind })
    this.replaceableEventFromBigRelaysDataloader.prime(
      { pubkey: event.pubkey, kind: event.kind },
      Promise.resolve(event)
    )
    // Store in IndexedDB
    await indexedDb.putReplaceableEvent(event)
  }

  /**
   * =========== Profile Methods ===========
   */

  /**
   * Fetch profile event by id (hex, npub, nprofile)
   */
  async fetchProfileEvent(id: string, _skipCache: boolean = false): Promise<NEvent | undefined> {
    logger.info('[ReplaceableEventService] fetchProfileEvent start', { id })
    
    let pubkey: string | undefined
    let relays: string[] = []
    if (/^[0-9a-f]{64}$/.test(id)) {
      pubkey = id
      logger.info('[ReplaceableEventService] ID is hex pubkey', { pubkey })
    } else {
      try {
        const { data, type } = nip19.decode(id)
        logger.info('[ReplaceableEventService] Decoded bech32 ID', { type })
        switch (type) {
          case 'npub':
            pubkey = data
            break
          case 'nprofile':
            pubkey = data.pubkey
            if (data.relays) relays = data.relays
            logger.info('[ReplaceableEventService] nprofile has relay hints', { relayCount: relays.length })
            break
        }
      } catch (error) {
        logger.error('[ReplaceableEventService] Failed to decode bech32 ID', {
          id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (!pubkey) {
      logger.error('[ReplaceableEventService] Invalid id - no pubkey extracted', { id })
      throw new Error('Invalid id')
    }
    
    // CRITICAL: Always use relay hints from bech32 addresses (nprofile, naddr, nevent) when available
    // Relay hints should have highest priority and always be included
    const relayHints = relays.length > 0 ? [...relays] : []
    
    // Step 1: ALWAYS use DataLoader first (checks IndexedDB, then uses default relays)
    // CRITICAL: Do NOT pass relay hints here - passing any relays bypasses DataLoader and creates individual subscriptions
    // DataLoader already uses default relays internally and batches all profile fetches
    // We'll use relay hints in Step 2/3 only if Step 1 fails
    logger.info('[ReplaceableEventService] Step 1: Trying with DataLoader (checks cache first, uses default relays, batched)', {
      pubkey,
      relayHintCount: relayHints.length,
      hasRelayHints: relayHints.length > 0
    })
    
    // fetchReplaceableEvent uses DataLoader which checks IndexedDB first, then queries default relays
    // Passing empty array ensures DataLoader is used (batched) - this prevents individual subscriptions
    const profileEvent = await this.fetchReplaceableEvent(pubkey, kinds.Metadata, undefined, [])
    
    if (profileEvent) {
      logger.info('[ReplaceableEventService] Profile found with relay hints + default relays', {
        pubkey,
        eventId: profileEvent.id
      })
      await this.indexProfile(profileEvent)
      return profileEvent
    }
    
    // Step 2: Only fetch author's relay list as fallback if we have relay hints from bech32
    // This prevents creating many individual subscriptions when profiles aren't found
    // If we have relay hints, it's worth trying author relays. Otherwise, Step 1 should be sufficient.
    if (relayHints.length > 0) {
      logger.info('[ReplaceableEventService] Step 2: Profile not found, but we have relay hints - fetching author relay list as fallback', {
        pubkey,
        relayHintCount: relayHints.length
      })
      
      let authorRelayList: { read?: string[]; write?: string[] } | null = null
      try {
        const relayListStartTime = Date.now()
        // Add timeout to prevent hanging - 2 seconds max
        const relayListPromise = client.fetchRelayList(pubkey)
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => {
            logger.warn('[ReplaceableEventService] fetchRelayList timeout, giving up', {
              pubkey
            })
            resolve(null)
          }, 2000)
        })
        authorRelayList = await Promise.race([relayListPromise, timeoutPromise])
        const relayListTime = Date.now() - relayListStartTime
        logger.info('[ReplaceableEventService] Author relay list fetched', {
          pubkey,
          hasRelayList: !!authorRelayList,
          fetchTime: `${relayListTime}ms`
        })
      } catch (error) {
        logger.error('[ReplaceableEventService] Failed to fetch author relay list', { 
          pubkey,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      
      // Step 3: Try with relay hints + author's relays if we got them
      // CRITICAL: Always include relay hints first (highest priority), then author relays, then defaults
      if (authorRelayList) {
        const authorRelays = [
          ...(authorRelayList.write || []).slice(0, 10),
          ...(authorRelayList.read || []).slice(0, 10)
        ]
        // Relay hints first (highest priority), then author relays, then defaults
        const allRelays = [...new Set([
          ...relayHints,  // Relay hints from bech32 (highest priority)
          ...authorRelays, // Author's relays
          ...PROFILE_FETCH_RELAY_URLS, // Default profile relays
          ...FAST_READ_RELAY_URLS // Fast read relays
        ])]
        
        logger.info('[ReplaceableEventService] Step 3: Trying with relay hints + author relays', {
          pubkey,
          relayHintCount: relayHints.length,
          authorRelayCount: authorRelays.length,
          totalRelayCount: allRelays.length
        })
        
        // Use fetchReplaceableEvent with relay hints + author's relays
        const profileEventFromAuthorRelays = await this.fetchReplaceableEvent(
          pubkey, 
          kinds.Metadata, 
          undefined, 
          allRelays
        )
        
        if (profileEventFromAuthorRelays) {
          logger.info('[ReplaceableEventService] Profile found with relay hints + author relays', {
            pubkey,
            eventId: profileEventFromAuthorRelays.id
          })
          await this.indexProfile(profileEventFromAuthorRelays)
          return profileEventFromAuthorRelays
        }
      }
    } else {
      // No relay hints - Step 1 with default relays should be sufficient
      // Skip Step 2/3 to avoid creating individual subscriptions
      logger.debug('[ReplaceableEventService] Profile not found, but no relay hints - skipping author relay fallback to avoid individual subscriptions', {
        pubkey
      })
    }
    
    // Step 3: Comprehensive search across ALL available relays before giving up
    // OPTIMIZATION: Skip comprehensive search for batch profile fetches (when called from DataLoader)
    // Comprehensive search is expensive (10s timeout) and should only be used for individual profile fetches
    // when user explicitly navigates to a profile page. For feed rendering, missing profiles are acceptable.
    // Only run comprehensive search if we have relay hints (suggesting user intent to find this specific profile)
    if (relayHints.length > 0) {
      logger.info('[ReplaceableEventService] Step 3: Profile not found, trying comprehensive relay list (all available relays)', {
        pubkey,
        hasRelayHints: relayHints.length > 0
      })
      
      try {
        const userPubkey = client.pubkey
        const comprehensiveRelays = await buildComprehensiveRelayList({
          authorPubkey: pubkey,
          userPubkey: userPubkey || undefined,
          relayHints: relayHints.length > 0 ? relayHints : undefined,
          includeUserOwnRelays: true, // Include user's read/write relays
          includeFavoriteRelays: true, // Include user's favorite relays (kind 10012)
          includeProfileFetchRelays: true, // Include PROFILE_FETCH_RELAY_URLS
          includeFastReadRelays: true, // Include FAST_READ_RELAY_URLS
          includeFastWriteRelays: true, // Include FAST_WRITE_RELAY_URLS
          includeSearchableRelays: true, // Include SEARCHABLE_RELAY_URLS
          includeLocalRelays: true // Include local/cache relays
        })
        
        logger.info('[ReplaceableEventService] Comprehensive relay list built', {
          pubkey,
          relayCount: comprehensiveRelays.length,
          relays: comprehensiveRelays.slice(0, 10) // Log first 10 for debugging
        })
        
        if (comprehensiveRelays.length > 0) {
          // Query the comprehensive relay list with reduced timeout for faster failure
          const startTime = Date.now()
          const events = await this.queryService.query(comprehensiveRelays, {
            authors: [pubkey],
            kinds: [kinds.Metadata]
          }, undefined, {
            replaceableRace: true,
            eoseTimeout: 300, // Reduced from 500ms
            globalTimeout: 5000 // Reduced from 10000ms to prevent 10s waits
          })
          const queryTime = Date.now() - startTime
          
          logger.info('[ReplaceableEventService] Comprehensive search completed', {
            pubkey,
            eventCount: events.length,
            queryTime: `${queryTime}ms`,
            relayCount: comprehensiveRelays.length
          })
          
          if (events.length > 0) {
            const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
            const profileEvent = sortedEvents[0]
            logger.info('[ReplaceableEventService] Profile found via comprehensive search', {
              pubkey,
              eventId: profileEvent.id
            })
            await this.indexProfile(profileEvent)
            return profileEvent
          }
        }
      } catch (error) {
        logger.error('[ReplaceableEventService] Comprehensive search failed', {
          pubkey,
          error: error instanceof Error ? error.message : String(error)
        })
        // Continue to return undefined below
      }
    } else {
      logger.debug('[ReplaceableEventService] Skipping comprehensive search (no relay hints, likely batch fetch)', {
        pubkey
      })
    }
    
    logger.warn('[ReplaceableEventService] Profile not found after trying all relays (including comprehensive search)', {
      pubkey,
      triedRelayHints: relayHints.length > 0
    })
    return undefined
  }

  /**
   * Fetch profile by id (hex, npub, nprofile)
   */
  async fetchProfile(id: string, skipCache: boolean = false): Promise<TProfile | undefined> {
    const profileEvent = await this.fetchProfileEvent(id, skipCache)
    if (profileEvent) {
      return getProfileFromEvent(profileEvent)
    }

    try {
      const pubkey = userIdToPubkey(id)
      return { pubkey, npub: pubkeyToNpub(pubkey) ?? '', username: formatPubkey(pubkey) }
    } catch {
      return undefined
    }
  }

  /**
   * Get profile from IndexedDB only
   */
  async getProfileFromIndexedDB(id: string): Promise<TProfile | undefined> {
    let pubkey: string | undefined
    try {
      if (/^[0-9a-f]{64}$/.test(id)) {
        pubkey = id
      } else {
        const { data, type } = nip19.decode(id)
        if (type === 'npub') pubkey = data
        else if (type === 'nprofile') pubkey = data.pubkey
      }
    } catch {
      return undefined
    }
    if (!pubkey) return undefined
    const event = await indexedDb.getReplaceableEvent(pubkey, kinds.Metadata)
    if (!event || event === null) return undefined
    return getProfileFromEvent(event)
  }

  /**
   * Fetch profiles for multiple pubkeys
   */
  async fetchProfilesForPubkeys(pubkeys: string[]): Promise<TProfile[]> {
    const deduped = Array.from(new Set(pubkeys.filter((p) => p && p.length === 64)))
    if (deduped.length === 0) return []
    const events = await this.fetchReplaceableEventsFromProfileFetchRelays(deduped, kinds.Metadata)
    const profiles: TProfile[] = []
    for (let i = 0; i < deduped.length; i++) {
      const ev = events[i]
      if (ev) {
        await this.indexProfile(ev)
        profiles.push(getProfileFromEvent(ev))
      } else {
        const pubkey = deduped[i]!
        profiles.push({
          pubkey,
          npub: pubkeyToNpub(pubkey) ?? '',
          username: formatPubkey(pubkey)
        })
      }
    }
    return profiles
  }

  /**
   * Index profile for search (calls callback if provided)
   */
  private async indexProfile(profileEvent: NEvent): Promise<void> {
    if (this.onProfileIndexed) {
      await this.onProfileIndexed(profileEvent)
    }
  }

  /**
   * =========== Follow Methods ===========
   */

  /**
   * Fetch follow list event
   */
  async fetchFollowListEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, kinds.Contacts)
  }

  /**
   * Fetch followings (pubkeys from follow list)
   */
  async fetchFollowings(pubkey: string): Promise<string[]> {
    const followListEvent = await this.fetchFollowListEvent(pubkey)
    return followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
  }

  /**
   * =========== Specialized Replaceable Event Methods ===========
   */

  /**
   * Fetch mute list event
   */
  async fetchMuteListEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, kinds.Mutelist)
  }

  /**
   * Fetch bookmark list event
   */
  async fetchBookmarkListEvent(pubkey: string): Promise<NEvent | undefined> {
    return this.fetchReplaceableEvent(pubkey, kinds.BookmarkList)
  }

  /**
   * Fetch blossom server list event
   */
  async fetchBlossomServerListEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, ExtendedKind.BLOSSOM_SERVER_LIST)
  }

  /**
   * Fetch blossom server list (URLs)
   */
  async fetchBlossomServerList(pubkey: string): Promise<string[]> {
    const evt = await this.fetchBlossomServerListEvent(pubkey)
    if (!evt) return []
    return getServersFromServerTags(evt.tags)
  }

  /**
   * Fetch interest list event
   */
  async fetchInterestListEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, 10015)
  }

  /**
   * Fetch pin list event
   */
  async fetchPinListEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, 10001)
  }

  /**
   * Fetch payment info event
   */
  async fetchPaymentInfoEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, ExtendedKind.PAYMENT_INFO)
  }

  /**
   * Force refresh profile and payment info cache
   */
  async forceRefreshProfileAndPaymentInfoCache(pubkey: string): Promise<void> {
    await Promise.all([
      this.fetchReplaceableEvent(pubkey, kinds.Metadata),
      this.fetchReplaceableEvent(pubkey, ExtendedKind.PAYMENT_INFO)
    ])
  }

  /**
   * =========== Following Favorite Relays ===========
   */

  /**
   * Fetch following favorite relays
   */
  async fetchFollowingFavoriteRelays(pubkey: string, skipCache = false): Promise<[string, string[]][]> {
    if (!skipCache) {
      const cached = this.followingFavoriteRelaysCache.get(pubkey)
      if (cached) {
        return cached
      }
    }
    const promise = this._fetchFollowingFavoriteRelays(pubkey)
    this.followingFavoriteRelaysCache.set(pubkey, promise)
    return promise
  }

  private async _fetchFollowingFavoriteRelays(pubkey: string): Promise<[string, string[]][]> {
    const followings = await this.fetchFollowings(pubkey)
    const followingsToProcess = followings.slice(0, 100)
    const favoriteRelaysEvents = await this.fetchReplaceableEventsFromProfileFetchRelays(
      followingsToProcess,
      ExtendedKind.FAVORITE_RELAYS
    )
    // Group by relay URL: Map<relayUrl, Set<pubkey>>
    const relayToUsers = new Map<string, Set<string>>()
    
    // favoriteRelaysEvents[i] corresponds to followingsToProcess[i]
    for (let i = 0; i < followingsToProcess.length && i < favoriteRelaysEvents.length; i++) {
      const event = favoriteRelaysEvents[i]
      const followingPubkey = followingsToProcess[i]
      if (event && followingPubkey) {
        event.tags.forEach(([tagName, tagValue]) => {
          if (tagName === 'relay' && tagValue) {
            const normalizedUrl = normalizeUrl(tagValue)
            if (normalizedUrl) {
              if (!relayToUsers.has(normalizedUrl)) {
                relayToUsers.set(normalizedUrl, new Set())
              }
              relayToUsers.get(normalizedUrl)!.add(followingPubkey)
            }
          }
        })
      }
    }
    
    // Convert to array format: [relayUrl, pubkeys[]]
    const result: [string, string[]][] = []
    for (const [relayUrl, pubkeys] of relayToUsers.entries()) {
      result.push([relayUrl, Array.from(pubkeys)])
    }
    
    logger.debug('[ReplaceableEventService] fetchFollowingFavoriteRelays completed', {
      followingsCount: followings.length,
      processedCount: followingsToProcess.length,
      eventsFound: favoriteRelaysEvents.filter(e => e !== undefined).length,
      uniqueRelays: result.length,
      totalUsers: result.reduce((sum, [, users]) => sum + users.length, 0)
    })
    
    return result
  }
}
