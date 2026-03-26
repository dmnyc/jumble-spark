import {
  ExtendedKind,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  MAX_CONCURRENT_RELAY_CONNECTIONS,
  METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
  METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS,
  PROFILE_FETCH_RELAY_URLS,
  READ_ONLY_RELAY_URLS
} from '@/constants'
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
import logger from '@/lib/logger'
import client from './client.service'
import { buildComprehensiveRelayList, buildExploreProfileAndUserRelayList } from '@/lib/relay-list-builder'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'

export class ReplaceableEventService {
  /** Limits parallel Step 2/3 profile network work (relay list + wide metadata REQ). */
  private static profileFallbackSlotsInUse = 0
  private static profileFallbackWaitQueue: Array<() => void> = []

  private static async acquireProfileFallbackNetworkSlot(): Promise<void> {
    if (ReplaceableEventService.profileFallbackSlotsInUse < MAX_CONCURRENT_RELAY_CONNECTIONS) {
      ReplaceableEventService.profileFallbackSlotsInUse++
      return
    }
    await new Promise<void>((resolve) => {
      ReplaceableEventService.profileFallbackWaitQueue.push(() => {
        ReplaceableEventService.profileFallbackSlotsInUse++
        resolve()
      })
    })
  }

  private static releaseProfileFallbackNetworkSlot(): void {
    ReplaceableEventService.profileFallbackSlotsInUse = Math.max(
      0,
      ReplaceableEventService.profileFallbackSlotsInUse - 1
    )
    const next = ReplaceableEventService.profileFallbackWaitQueue.shift()
    if (next) next()
  }

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
    logger.debug('[ReplaceableEventService] fetchReplaceableEvent start', {
      pubkey,
      kind,
      d,
      cacheKey,
      containingEventRelays: containingEventRelays.length
    })
    
    try {
      if (kind === kinds.Metadata && !d) {
        const sessionEv = client.eventService.getSessionMetadataForPubkey(pubkey)
        if (sessionEv && !shouldDropEventOnIngest(sessionEv)) {
          this.replaceableEventFromBigRelaysDataloader.prime(
            { pubkey, kind },
            Promise.resolve(sessionEv)
          )
          return sessionEv
        }
      }

      // If we have containing event relays and this is a profile, we need to use a custom relay list
      // Otherwise, use DataLoader (which batches IndexedDB checks and network fetches)
      let event: NEvent | undefined
      if (containingEventRelays.length > 0 && kind === kinds.Metadata && !d) {
        // For profiles with containing event relays (author's relay list), check IndexedDB first, then query directly
        logger.debug('[ReplaceableEventService] Checking IndexedDB for profile with containing relays', {
          pubkey,
          kind
        })
        try {
          const indexedDbCached = await indexedDb.getReplaceableEvent(pubkey, kind, d)
          if (indexedDbCached) {
            logger.debug('[ReplaceableEventService] Found in IndexedDB', {
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
        logger.debug('[ReplaceableEventService] Building relay list with containing event relays', {
          pubkey,
          containingRelayCount: containingEventRelays.length
        })
        const relayUrls = await this.buildComprehensiveRelayListForAuthor(pubkey, kind, containingEventRelays, [])
        logger.debug('[ReplaceableEventService] Querying relays', {
          pubkey,
          relayCount: relayUrls.length,
          relays: relayUrls.slice(0, 5)
        })
        const startTime = Date.now()
        const events = await this.queryService.query(
          relayUrls,
          {
            authors: [pubkey],
            kinds: [kind]
          },
          undefined,
          {
            replaceableRace: true,
            eoseTimeout: METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
            globalTimeout: METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS
          }
        )
        const queryTime = Date.now() - startTime
        logger.debug('[ReplaceableEventService] Query completed', {
          pubkey,
          eventCount: events.length,
          queryTime: `${queryTime}ms`
        })
        const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
        event = sortedEvents.length > 0 ? sortedEvents[0] : undefined
      } else {
        // Use DataLoader for batching (IndexedDB checks and network fetches are batched)
        logger.debug('[ReplaceableEventService] Using DataLoader (batches IndexedDB + network)', {
          pubkey,
          kind,
          d
        })
        const startTime = Date.now()
        const loadedEvent = d
          ? await this.replaceableEventDataLoader.load({ pubkey, kind, d })
          : await this.replaceableEventFromBigRelaysDataloader.load({ pubkey, kind })
        const loadTime = Date.now() - startTime
        logger.debug('[ReplaceableEventService] DataLoader completed', {
          pubkey,
          found: !!loadedEvent,
          loadTime: `${loadTime}ms`
        })
        event = loadedEvent || undefined
      }
      
      if (event) {
        logger.debug('[ReplaceableEventService] Event found', {
          pubkey,
          kind,
          eventId: event.id,
          created_at: event.created_at
        })
        return event
      }
      
      // Log when no event is found (helps debug relay failures)
      if (kind === kinds.Metadata) {
        logger.debug('[ReplaceableEventService] No profile found for pubkey', {
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
    
    logger.debug('[ReplaceableEventService] fetchReplaceableEvent returning undefined', {
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
    const results: (NEvent | undefined)[] = new Array(pubkeys.length)
    const needsIndexedDb: { pubkey: string; index: number }[] = []

    for (let index = 0; index < pubkeys.length; index++) {
      const pubkey = pubkeys[index]
      if (kind === kinds.Metadata) {
        const sessionEv = client.eventService.getSessionMetadataForPubkey(pubkey)
        if (sessionEv && !shouldDropEventOnIngest(sessionEv)) {
          results[index] = sessionEv
          this.replaceableEventFromBigRelaysDataloader.prime(
            { pubkey, kind },
            Promise.resolve(sessionEv)
          )
          continue
        }
      }
      needsIndexedDb.push({ pubkey, index })
    }

    await Promise.allSettled(
      needsIndexedDb.map(async ({ pubkey, index }) => {
        try {
          const event = await indexedDb.getReplaceableEvent(pubkey, kind)
          if (event) {
            results[index] = event
          }
        } catch {
          /* ignore */
        }
      })
    )

    const stillMissing = needsIndexedDb.filter(({ index }) => results[index] === undefined)
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
      logger.debug('[ReplaceableEventService] Large batch load function called', {
        paramCount: params.length,
        kind: params[0]?.kind
      })
    } else {
      logger.debug('[ReplaceableEventService] Batch load function called', {
        paramCount: params.length,
        kind: params[0]?.kind
      })
    }
    
    const results: (NEvent | null)[] = new Array(params.length).fill(null)
    const eventsMap = new Map<string, NEvent>()

    for (let i = 0; i < params.length; i++) {
      const { pubkey, kind } = params[i]
      if (kind !== kinds.Metadata) continue
      const sessionEv = client.eventService.getSessionMetadataForPubkey(pubkey)
      if (sessionEv && !shouldDropEventOnIngest(sessionEv)) {
        results[i] = sessionEv
        eventsMap.set(`${pubkey}:${kind}`, sessionEv)
        this.replaceableEventFromBigRelaysDataloader.prime(
          { pubkey, kind },
          Promise.resolve(sessionEv)
        )
      }
    }

    const idbByKind = new Map<number, { pubkey: string; index: number }[]>()
    params.forEach(({ pubkey, kind }, index) => {
      if (results[index] != null) return
      if (!idbByKind.has(kind)) {
        idbByKind.set(kind, [])
      }
      idbByKind.get(kind)!.push({ pubkey, index })
    })

    const missingParams: { pubkey: string; kind: number; index: number }[] = []

    await Promise.allSettled(
      Array.from(idbByKind.entries()).map(async ([kind, items]) => {
        const pubkeys = items.map((x) => x.pubkey)
        try {
          const indexedDbEvents = await indexedDb.getManyReplaceableEvents(pubkeys, kind)
          logger.debug('[ReplaceableEventService] IndexedDB batch query completed', {
            kind,
            pubkeyCount: pubkeys.length,
            foundCount: indexedDbEvents.filter((e) => e !== null && e !== undefined).length
          })

          items.forEach(({ pubkey, index }, idx) => {
            const event = indexedDbEvents[idx]
            if (event && event !== null) {
              results[index] = event
              eventsMap.set(`${pubkey}:${kind}`, event)
              this.refreshInBackground(pubkey, kind).catch(() => {})
            } else {
              missingParams.push({ pubkey, kind, index })
            }
          })
        } catch (error) {
          logger.warn('[ReplaceableEventService] IndexedDB batch query error', {
            kind,
            error: error instanceof Error ? error.message : String(error)
          })
          for (const { pubkey, index } of items) {
            missingParams.push({ pubkey, kind, index })
          }
        }
      })
    )
    
    // Step 2: Only fetch missing events from network
    if (missingParams.length === 0) {
      logger.debug('[ReplaceableEventService] All events resolved (session + IndexedDB), skipping network fetch', {
        totalCount: params.length
      })
      return results
    }

    const networkMissing: { pubkey: string; kind: number; index: number }[] = []
    for (const m of missingParams) {
      if (m.kind === kinds.Metadata) {
        const ev = client.eventService.getSessionMetadataForPubkey(m.pubkey)
        if (ev && !shouldDropEventOnIngest(ev)) {
          results[m.index] = ev
          eventsMap.set(`${m.pubkey}:${m.kind}`, ev)
          continue
        }
      }
      networkMissing.push(m)
    }

    if (networkMissing.length > 0) {
    // Only log at info level for large batches
    if (networkMissing.length > 50) {
      logger.debug('[ReplaceableEventService] Fetching missing events from network', {
        missingCount: networkMissing.length,
        totalCount: params.length
      })
    } else {
      logger.debug('[ReplaceableEventService] Fetching missing events from network', {
        missingCount: networkMissing.length,
        totalCount: params.length
      })
    }
    
    // Group missing params by kind for network fetch
    const missingGroups = new Map<number, { pubkey: string; index: number }[]>()
    networkMissing.forEach(({ pubkey, kind, index }) => {
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
        // Use PROFILE_FETCH_RELAY_URLS + FAST_READ_RELAY_URLS for profiles, or FAST_READ_RELAY_URLS for other kinds.
        // For metadata with a logged-in user, merge defaults with {@link buildComprehensiveRelayList}: inboxes (read),
        // local/cache relays (10432), favorite relays (10012), plus profile + fast read — same idea as favorites feed
        // / inbox-scoped discovery without per-author relay list fetches.
        // Following's Favorites (Explore): kind 10012 batch uses {@link buildExploreProfileAndUserRelayList}
        // (profile + FAST_READ + viewer read/write/local when logged in).
        let relayUrls: string[]
        if (kind === kinds.Metadata) {
          const userPk = client.pubkey
          if (userPk) {
            try {
              relayUrls = await buildComprehensiveRelayList({
                userPubkey: userPk,
                includeUserOwnRelays: false,
                includeProfileFetchRelays: true,
                includeFastReadRelays: true,
                includeFavoriteRelays: true,
                includeLocalRelays: true,
                includeFastWriteRelays: false,
                includeSearchableRelays: false
              })
            } catch {
              relayUrls = Array.from(new Set([...PROFILE_FETCH_RELAY_URLS, ...FAST_READ_RELAY_URLS]))
            }
          } else {
            relayUrls = Array.from(new Set([...PROFILE_FETCH_RELAY_URLS, ...FAST_READ_RELAY_URLS]))
          }
        } else if (kind === ExtendedKind.FAVORITE_RELAYS) {
          relayUrls = await buildExploreProfileAndUserRelayList(client.pubkey)
        } else if (kind === 10001) {
          // Pin lists (NIP-51): same pitfall as profile media — FAST_READ alone misses aggr / profile mirrors,
          // and 100ms EOSE loses the race when several relays are down.
          relayUrls = Array.from(
            new Set(
              [...READ_ONLY_RELAY_URLS, ...PROFILE_FETCH_RELAY_URLS, ...FAST_READ_RELAY_URLS].map(
                (u) => normalizeUrl(u) || u
              )
            )
          ).filter(Boolean)
        } else if (kind === kinds.Contacts) {
          // Contacts (follow list) are published to user's write relays; use write + read + profile relays
          relayUrls = Array.from(
            new Set(
              [...FAST_WRITE_RELAY_URLS, ...PROFILE_FETCH_RELAY_URLS, ...FAST_READ_RELAY_URLS].map(
                (u) => normalizeUrl(u) || u
              )
            )
          ).filter(Boolean)
        } else {
          relayUrls = [...FAST_READ_RELAY_URLS]
        }
        
        // Only log at info level for large batches
        if (pubkeys.length > 50) {
          logger.debug('[ReplaceableEventService] Starting query for large batch', {
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
        const isSlowReplaceableBatch = kind === kinds.Metadata || kind === 10001
        const events = await this.queryService.query(
          relayUrls,
          {
            authors: pubkeys,
            kinds: [kind]
          },
          undefined,
          {
            replaceableRace: true,
            eoseTimeout: isSlowReplaceableBatch ? METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS : 100,
            globalTimeout: isSlowReplaceableBatch ? METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS : 2000
          }
        )
        // Only log at info level for large batches or if many events found
        if (pubkeys.length > 50 || events.length > 100) {
          logger.debug('[ReplaceableEventService] Query completed for batch', {
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
          logger.debug('[ReplaceableEventService] Limited batch size', {
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
    } else {
      logger.debug('[ReplaceableEventService] All missing events resolved from session, skipping network fetch', {
        totalCount: params.length
      })
    }
    
    // Step 3: Persist hits only. Do not write negative cache rows (`value: null`) — optional kinds
    // (e.g. 10432 cache relays, 10001 pins) are missing for most pubkeys and would flood IndexedDB.
    await Promise.allSettled(
      missingParams.map(async ({ pubkey, kind }) => {
        const key = `${pubkey}:${kind}`
        const event = eventsMap.get(key)
        if (event) {
          await indexedDb.putReplaceableEvent(event)
        }
      })
    )
    
    // Only log at info level for large batches
    if (params.length > 50) {
      logger.debug('[ReplaceableEventService] Batch load function completed', {
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
        void indexedDb.putReplaceableEvent(event)
        return event
      }
      return null
    })
  }

  /**
   * Private: Update cache for replaceable event from big relays
   */
  private async updateReplaceableEventFromBigRelaysCache(event: NEvent): Promise<void> {
    if (!indexedDb.hasReplaceableEventStoreForKind(event.kind)) {
      return
    }
    const d = event.tags.find((t) => t[0] === 'd')?.[1]
    this.replaceableEventFromBigRelaysDataloader.clear({ pubkey: event.pubkey, kind: event.kind })
    this.replaceableEventFromBigRelaysDataloader.prime(
      { pubkey: event.pubkey, kind: event.kind },
      Promise.resolve(event)
    )
    this.replaceableEventDataLoader.clear({ pubkey: event.pubkey, kind: event.kind, d })
    this.replaceableEventDataLoader.prime(
      { pubkey: event.pubkey, kind: event.kind, d },
      Promise.resolve(event)
    )
    try {
      await indexedDb.putReplaceableEvent(event)
    } catch {
      // Tombstone or validation — in-memory loaders still primed for this session
    }
  }

  /**
   * =========== Profile Methods ===========
   */

  /**
   * Fetch profile event by id (hex, npub, nprofile)
   */
  async fetchProfileEvent(id: string, _skipCache: boolean = false): Promise<NEvent | undefined> {
    logger.debug('[ReplaceableEventService] fetchProfileEvent start', { id })
    
    let pubkey: string | undefined
    let relays: string[] = []
    if (/^[0-9a-f]{64}$/.test(id)) {
      pubkey = id
      logger.debug('[ReplaceableEventService] ID is hex pubkey', { pubkey })
    } else {
      try {
        const { data, type } = nip19.decode(id)
        logger.debug('[ReplaceableEventService] Decoded bech32 ID', { type })
        switch (type) {
          case 'npub':
            pubkey = data
            break
          case 'nprofile':
            pubkey = data.pubkey
            if (data.relays) relays = data.relays
            logger.debug('[ReplaceableEventService] nprofile has relay hints', { relayCount: relays.length })
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

    if (!_skipCache) {
      const sessionEv = client.eventService.getSessionMetadataForPubkey(pubkey)
      if (sessionEv && !shouldDropEventOnIngest(sessionEv)) {
        this.replaceableEventFromBigRelaysDataloader.prime(
          { pubkey, kind: kinds.Metadata },
          Promise.resolve(sessionEv)
        )
        await this.indexProfile(sessionEv)
        return sessionEv
      }
    }
    
    // CRITICAL: Always use relay hints from bech32 addresses (nprofile, naddr, nevent) when available
    // Relay hints should have highest priority and always be included
    const relayHints = relays.length > 0 ? [...relays] : []
    
    // Step 1: ALWAYS use DataLoader first (checks IndexedDB, then uses default relays)
    // CRITICAL: Do NOT pass relay hints here - passing any relays bypasses DataLoader and creates individual subscriptions
    // DataLoader already uses default relays internally and batches all profile fetches
    // We'll use relay hints in Step 2/3 only if Step 1 fails
    logger.debug('[ReplaceableEventService] Step 1: Trying with DataLoader (checks cache first, uses default relays, batched)', {
      pubkey,
      relayHintCount: relayHints.length,
      hasRelayHints: relayHints.length > 0
    })
    
    // fetchReplaceableEvent uses DataLoader which checks IndexedDB first, then queries default relays
    // Passing empty array ensures DataLoader is used (batched) - this prevents individual subscriptions
    const profileEvent = await this.fetchReplaceableEvent(pubkey, kinds.Metadata, undefined, [])
    
    if (profileEvent) {
      logger.debug('[ReplaceableEventService] Profile found via cache / default relays (DataLoader)', {
        pubkey,
        eventId: profileEvent.id
      })
      await this.indexProfile(profileEvent)
      return profileEvent
    }

    await ReplaceableEventService.acquireProfileFallbackNetworkSlot()
    try {
    // Step 2: Only after cache + default relays miss — NIP-65 relay list (timeout-capped), then hints + outbox/inbox + defaults.
    logger.debug('[ReplaceableEventService] Step 2: Fetching author relay list as fallback', {
      pubkey,
      relayHintCount: relayHints.length
    })

    let authorRelayList: { read?: string[]; write?: string[] } | null = null
    try {
      const relayListPromise = client.fetchRelayList(pubkey)
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => {
          logger.debug('[ReplaceableEventService] fetchRelayList timeout, giving up', { pubkey })
          resolve(null)
        }, 2000)
      })
      authorRelayList = await Promise.race([relayListPromise, timeoutPromise])
    } catch (error) {
      logger.error('[ReplaceableEventService] Failed to fetch author relay list', {
        pubkey,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    const authorRelays = authorRelayList
      ? [
          ...(authorRelayList.write || []).slice(0, 10),
          ...(authorRelayList.read || []).slice(0, 10)
        ]
      : []

    const expandedRelays = [
      ...new Set([
        ...relayHints,
        ...authorRelays,
        ...PROFILE_FETCH_RELAY_URLS,
        ...FAST_READ_RELAY_URLS
      ])
    ]

    const profileFromExpanded = await this.fetchReplaceableEvent(
      pubkey,
      kinds.Metadata,
      undefined,
      expandedRelays
    )
    if (profileFromExpanded) {
      logger.debug('[ReplaceableEventService] Profile found after relay-list fallback', {
        pubkey,
        eventId: profileFromExpanded.id
      })
      await this.indexProfile(profileFromExpanded)
      return profileFromExpanded
    }

    // Step 3: Last resort — broad relay query (timeout-bounded in query layer)
    logger.debug('[ReplaceableEventService] Step 3: Comprehensive relay query (last resort)', { pubkey })
    try {
      const userPubkey = client.pubkey
      const comprehensiveRelays = await buildComprehensiveRelayList({
        authorPubkey: pubkey,
        userPubkey: userPubkey || undefined,
        relayHints: relayHints.length > 0 ? relayHints : undefined,
        includeUserOwnRelays: true,
        includeFavoriteRelays: true,
        includeProfileFetchRelays: true,
        includeFastReadRelays: true,
        includeFastWriteRelays: true,
        includeSearchableRelays: true,
        includeLocalRelays: true
      })

      logger.debug('[ReplaceableEventService] Comprehensive relay list built', {
        pubkey,
        relayCount: comprehensiveRelays.length,
        relays: comprehensiveRelays.slice(0, 10)
      })

      if (comprehensiveRelays.length > 0) {
        const startTime = Date.now()
        const events = await this.queryService.query(
          comprehensiveRelays,
          {
            authors: [pubkey],
            kinds: [kinds.Metadata]
          },
          undefined,
          {
            replaceableRace: true,
            eoseTimeout: 300,
            globalTimeout: 5000
          }
        )
        const queryTime = Date.now() - startTime

        logger.debug('[ReplaceableEventService] Comprehensive search completed', {
          pubkey,
          eventCount: events.length,
          queryTime: `${queryTime}ms`,
          relayCount: comprehensiveRelays.length
        })

        if (events.length > 0) {
          const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
          const found = sortedEvents[0]!
          logger.debug('[ReplaceableEventService] Profile found via comprehensive search', {
            pubkey,
            eventId: found.id
          })
          await this.indexProfile(found)
          return found
        }
      }
    } catch (error) {
      logger.error('[ReplaceableEventService] Comprehensive search failed', {
        pubkey,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    } finally {
      ReplaceableEventService.releaseProfileFallbackNetworkSlot()
    }

    logger.debug('[ReplaceableEventService] Profile not found after cache, relay-list fallback, and comprehensive search', {
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
   * Fetch follow list event.
   * When relayUrls are provided (e.g. user write + search relays), queries those directly.
   * Otherwise uses the default relay set (FAST_WRITE + PROFILE_FETCH + FAST_READ).
   */
  async fetchFollowListEvent(pubkey: string, relayUrls?: string[]): Promise<NEvent | undefined> {
    if (relayUrls && relayUrls.length > 0) {
      const normalized = Array.from(
        new Set(relayUrls.map((u) => normalizeUrl(u) || u).filter(Boolean))
      )
      const events = await this.queryService.query(
        normalized,
        { authors: [pubkey], kinds: [kinds.Contacts], limit: 1 },
        undefined,
        { replaceableRace: true, eoseTimeout: 1500, globalTimeout: 8000 }
      )
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
      return latest
    }
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
