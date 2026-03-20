import { FAST_READ_RELAY_URLS, ExtendedKind, PROFILE_FETCH_RELAY_URLS } from '@/constants'
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

export class ReplaceableEventService {
  private queryService: QueryService
  private onProfileIndexed?: (profileEvent: NEvent) => void | Promise<void>
  private followingFavoriteRelaysCache = new LRUCache<string, Promise<[string, string[]][]>>({
    max: 50,
    ttl: 1000 * 60 * 60
  })
  // In-memory cache for profiles - instant access, no IndexedDB blocking
  private profileMemoryCache = new LRUCache<string, NEvent>({
    max: 1000, // Cache up to 1000 profiles in memory
    ttl: 1000 * 60 * 30, // 30 minutes TTL
    updateAgeOnGet: true // Refresh TTL on access
  })
  // In-memory cache for all replaceable events - fast access
  private replaceableEventMemoryCache = new LRUCache<string, NEvent>({
    max: 2000, // Cache up to 2000 events in memory
    ttl: 1000 * 60 * 30, // 30 minutes TTL
    updateAgeOnGet: true
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
        batchScheduleFn: (callback) => setTimeout(callback, 50),
        maxBatchSize: 500,
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
   * Extract relay hints from event tags (e, a, q tags - 3rd position)
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
   * Build comprehensive relay list: author's outboxes + user's inboxes + relay hints + defaults
   */
  private async buildComprehensiveRelayListForAuthor(
    authorPubkey: string,
    kind: number,
    relayHints: string[] = []
  ): Promise<string[]> {
    const relayUrls = new Set<string>()
    
    // 1. Add relay hints (highest priority - these are explicit hints)
    relayHints.forEach(url => {
      const normalized = normalizeUrl(url)
      if (normalized) relayUrls.add(normalized)
    })
    
    // 2. Add author's outboxes (write relays) - where they publish
    try {
      const authorRelayList = await client.fetchRelayList(authorPubkey)
      const authorOutboxes = (authorRelayList.write || []).slice(0, 10)
      authorOutboxes.forEach(url => {
        const normalized = normalizeUrl(url)
        if (normalized) relayUrls.add(normalized)
      })
      logger.debug('[ReplaceableEventService] Added author outboxes', {
        author: authorPubkey.substring(0, 8),
        count: authorOutboxes.length
      })
    } catch (error) {
      logger.debug('[ReplaceableEventService] Failed to fetch author relay list', { error })
    }
    
    // 3. Add logged-in user's inboxes (read relays) - where they receive events
    const userPubkey = client.pubkey
    if (userPubkey) {
      try {
        const userRelayList = await client.fetchRelayList(userPubkey)
        const userInboxes = (userRelayList.read || []).slice(0, 10)
        userInboxes.forEach(url => {
          const normalized = normalizeUrl(url)
          if (normalized) relayUrls.add(normalized)
        })
        logger.debug('[ReplaceableEventService] Added user inboxes', {
          count: userInboxes.length
        })
      } catch (error) {
        logger.debug('[ReplaceableEventService] Failed to fetch user relay list', { error })
      }
    }
    
    // 4. Add default fast read relays as fallback
    FAST_READ_RELAY_URLS.forEach(url => {
      const normalized = normalizeUrl(url)
      if (normalized) relayUrls.add(normalized)
    })
    
    // 5. Add profile fetch relays for profiles
    if (kind === kinds.Metadata) {
      PROFILE_FETCH_RELAY_URLS.forEach(url => {
        const normalized = normalizeUrl(url)
        if (normalized) relayUrls.add(normalized)
      })
    }
    
    return Array.from(relayUrls)
  }

  /**
   * Fetch replaceable event (profile, relay list, etc.)
   * Always checks in-memory cache FIRST (instant), then IndexedDB, then fetches from relays
   * ALWAYS uses: author's outboxes + user's inboxes + relay hints + defaults
   */
  async fetchReplaceableEvent(pubkey: string, kind: number, d?: string): Promise<NEvent | undefined> {
    const cacheKey = d ? `${kind}:${pubkey}:${d}` : `${kind}:${pubkey}`
    
    // 1. Check in-memory cache FIRST - instant return, no async overhead
    const memoryCached = this.replaceableEventMemoryCache.get(cacheKey)
    if (memoryCached) {
      // Check tombstone in background (non-blocking)
      this.checkTombstoneAndUpdateCache(memoryCached, kind).catch(() => {})
      // Fetch in background to update cache if newer version exists
      this.refreshInBackground(pubkey, kind, d).catch(() => {})
      return memoryCached
    }
    
    // 2. Check IndexedDB (async but faster than network)
    try {
      const indexedDbCached = await indexedDb.getReplaceableEvent(pubkey, kind, d)
      if (indexedDbCached) {
        // Check tombstone (non-blocking - check in background)
        const tombstoneKey = isReplaceableEvent(kind) 
          ? getReplaceableCoordinateFromEvent(indexedDbCached)
          : indexedDbCached.id
        // Check tombstone in background, don't block
        indexedDb.isTombstoned(tombstoneKey).then(isTombstoned => {
          if (isTombstoned) {
            // Remove from caches if tombstoned
            this.replaceableEventMemoryCache.delete(cacheKey)
          } else {
            // Add to memory cache for next time
            this.replaceableEventMemoryCache.set(cacheKey, indexedDbCached)
          }
        }).catch(() => {})
        
        // Fetch in background to update cache if newer version exists
        this.refreshInBackground(pubkey, kind, d).catch(() => {})
        return indexedDbCached
      }
    } catch (error) {
      // IndexedDB error - continue to network fetch
    }
    
    // 3. Not in cache, fetch from network
    // Note: DataLoader will use comprehensive relay list from batch load function
    try {
      const event = d
        ? await this.replaceableEventDataLoader.load({ pubkey, kind, d })
        : await this.replaceableEventFromBigRelaysDataloader.load({ pubkey, kind })
      
      if (event) {
        // Extract relay hints from the found event (for future related fetches)
        const eventRelayHints = this.extractRelayHintsFromEvent(event)
        
        // Add to memory cache for instant access next time
        this.replaceableEventMemoryCache.set(cacheKey, event)
        if (kind === kinds.Metadata) {
          this.profileMemoryCache.set(pubkey, event)
        }
        
        // If we found relay hints, log them (they're already used in the batch load function)
        if (eventRelayHints.length > 0) {
          logger.debug('[ReplaceableEventService] Found relay hints in event', {
            pubkey: formatPubkey(pubkey),
            hintCount: eventRelayHints.length
          })
        }
        
        return event
      }
      
      // Log when no event is found (helps debug relay failures)
      if (kind === kinds.Metadata) {
        logger.debug('[ReplaceableEventService] No profile found for pubkey', { 
          pubkey: formatPubkey(pubkey),
          cacheKey
        })
      }
    } catch (error) {
      // Log errors but don't throw - return undefined so UI can show fallback
      if (kind === kinds.Metadata) {
        logger.warn('[ReplaceableEventService] Error fetching profile', { 
          pubkey: formatPubkey(pubkey),
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    
    return undefined
  }
  
  /**
   * Check tombstone and update cache (non-blocking background operation)
   */
  private async checkTombstoneAndUpdateCache(event: NEvent, kind: number): Promise<void> {
    const tombstoneKey = isReplaceableEvent(kind) 
      ? getReplaceableCoordinateFromEvent(event)
      : event.id
    const isTombstoned = await indexedDb.isTombstoned(tombstoneKey)
    if (isTombstoned) {
      const cacheKey = isReplaceableEvent(kind)
        ? `${kind}:${event.pubkey}`
        : `${kind}:${event.pubkey}:${event.id}`
      this.replaceableEventMemoryCache.delete(cacheKey)
    }
  }
  
  /**
   * Refresh event in background (non-blocking)
   */
  private async refreshInBackground(pubkey: string, kind: number, d?: string): Promise<void> {
    try {
      if (d) {
        await this.replaceableEventDataLoader.load({ pubkey, kind, d })
      } else {
        const event = await this.replaceableEventFromBigRelaysDataloader.load({ pubkey, kind })
        if (event) {
          const cacheKey = `${kind}:${pubkey}`
          this.replaceableEventMemoryCache.set(cacheKey, event)
        }
      }
    } catch {
      // Ignore errors in background refresh
    }
  }

  /**
   * Batch fetch replaceable events from profile fetch relays
   * Optimized: checks memory cache first (instant), then IndexedDB, then network
   */
  async fetchReplaceableEventsFromProfileFetchRelays(pubkeys: string[], kind: number): Promise<(NEvent | undefined)[]> {
    // First check memory cache (instant)
    const memoryCached: (NEvent | undefined)[] = []
    const memoryMisses: { pubkey: string; index: number }[] = []
    
    pubkeys.forEach((pubkey, i) => {
      const cacheKey = `${kind}:${pubkey}`
      const cached = this.replaceableEventMemoryCache.get(cacheKey)
      if (cached) {
        memoryCached[i] = cached
      } else {
        memoryMisses.push({ pubkey, index: i })
      }
    })
    
    // For memory misses, check IndexedDB in parallel
    const indexedDbPromises = memoryMisses.map(async ({ pubkey, index }) => {
      try {
        const event = await indexedDb.getReplaceableEvent(pubkey, kind)
        if (event) {
          // Add to memory cache
          const cacheKey = `${kind}:${pubkey}`
          this.replaceableEventMemoryCache.set(cacheKey, event)
          if (kind === kinds.Metadata) {
            this.profileMemoryCache.set(pubkey, event)
          }
          memoryCached[index] = event
          return { index, event }
        }
      } catch {
        // Ignore errors
      }
      return null
    })
    
    await Promise.allSettled(indexedDbPromises)
    
    // Find what's still missing and fetch from network
    const stillMissing = memoryMisses.filter(({ index }) => memoryCached[index] === undefined)
    if (stillMissing.length > 0) {
      const newEvents = await this.replaceableEventFromBigRelaysDataloader.loadMany(
        stillMissing.map(({ pubkey }) => ({ pubkey, kind }))
      )
      newEvents.forEach((event, idx) => {
        if (event && !(event instanceof Error)) {
          const { index } = stillMissing[idx]!
          if (index !== undefined) {
            memoryCached[index] = event ?? undefined
            // Add to memory cache
            if (event) {
              const cacheKey = `${kind}:${stillMissing[idx]!.pubkey}`
              this.replaceableEventMemoryCache.set(cacheKey, event)
              if (kind === kinds.Metadata) {
                this.profileMemoryCache.set(stillMissing[idx]!.pubkey, event)
              }
            }
          }
        }
      })
    }
    
    return memoryCached
  }

  /**
   * Update replaceable event cache
   */
  async updateReplaceableEventCache(event: NEvent): Promise<void> {
    await this.updateReplaceableEventFromBigRelaysCache(event)
  }

  /**
   * Clear replaceable event caches
   */
  clearCaches(): void {
    this.replaceableEventFromBigRelaysDataloader.clearAll()
    this.replaceableEventDataLoader.clearAll()
    this.replaceableEventMemoryCache.clear()
    this.profileMemoryCache.clear()
  }
  
  /**
   * Pre-load profiles into memory cache for instant access
   */
  async preloadProfiles(pubkeys: string[]): Promise<void> {
    // Load from IndexedDB in parallel
    const promises = pubkeys.map(async (pubkey) => {
      try {
        const event = await indexedDb.getReplaceableEvent(pubkey, kinds.Metadata)
        if (event) {
          const cacheKey = `${kinds.Metadata}:${pubkey}`
          this.replaceableEventMemoryCache.set(cacheKey, event)
          this.profileMemoryCache.set(pubkey, event)
        }
      } catch {
        // Ignore errors
      }
    })
    await Promise.allSettled(promises)
  }

  /**
   * Private: Batch load function for replaceable events from big relays
   */
  private async replaceableEventFromBigRelaysBatchLoadFn(
    params: readonly { pubkey: string; kind: number }[]
  ): Promise<(NEvent | null)[]> {
    const groups = new Map<number, string[]>()
    params.forEach(({ pubkey, kind }) => {
      if (!groups.has(kind)) {
        groups.set(kind, [])
      }
      groups.get(kind)!.push(pubkey)
    })

    const eventsMap = new Map<string, NEvent>()
    await Promise.allSettled(
      Array.from(groups.entries()).map(async ([kind, pubkeys]) => {
        // ALWAYS use comprehensive relay list: author's outboxes + user's inboxes + defaults
        // For each pubkey, build comprehensive relay list
        const relayUrlSets = await Promise.all(
          pubkeys.map(async (pubkey) => {
            // Build comprehensive relay list for this author
            return await this.buildComprehensiveRelayListForAuthor(pubkey, kind, [])
          })
        )
        
        // Merge all relay sets
        const mergedRelays = new Set<string>()
        relayUrlSets.forEach(relayList => {
          relayList.forEach(url => mergedRelays.add(url))
        })
        
        const relayUrls = Array.from(mergedRelays)
        logger.debug('[ReplaceableEventService] Using comprehensive relay list', {
          pubkeyCount: pubkeys.length,
          totalRelayCount: relayUrls.length,
          kind
        })
        
        // Use all relays in parallel - browsers can handle many concurrent subscriptions
        // The QueryService manages per-relay concurrency limits to avoid overloading individual relays
        
        const events = await this.queryService.query(relayUrls, {
          authors: pubkeys,
          kinds: [kind]
        }, undefined, {
          replaceableRace: true,
          eoseTimeout: 200,
          globalTimeout: 3000
        })
        
        // Log when no events are found (helps debug relay failures)
        if (kind === kinds.Metadata && events.length === 0 && pubkeys.length > 0) {
          logger.debug('[ReplaceableEventService] No profile events found from relays', {
            pubkeyCount: pubkeys.length,
            relayCount: relayUrls.length,
            relays: relayUrls.slice(0, 3) // Show first 3 for brevity
          })
        }

        for (const event of events) {
          // Check tombstone in background (non-blocking)
          const tombstoneKey = isReplaceableEvent(event.kind)
            ? getReplaceableCoordinateFromEvent(event)
            : event.id
          // Don't block on tombstone check - do it in background
          indexedDb.isTombstoned(tombstoneKey).then(isTombstoned => {
            if (isTombstoned) {
              const cacheKey = `${event.kind}:${event.pubkey}`
              this.replaceableEventMemoryCache.delete(cacheKey)
            }
          }).catch(() => {})
          
          const key = `${event.pubkey}:${event.kind}`
          const existing = eventsMap.get(key)
          if (!existing || existing.created_at < event.created_at) {
            eventsMap.set(key, event)
            // Add to memory cache
            const cacheKey = `${event.kind}:${event.pubkey}`
            this.replaceableEventMemoryCache.set(cacheKey, event)
          }
        }
      })
    )

    return params.map(({ pubkey, kind }) => {
      const key = `${pubkey}:${kind}`
      const event = eventsMap.get(key)
      if (event) {
        // Add to memory cache for instant access
        const cacheKey = `${kind}:${pubkey}`
        this.replaceableEventMemoryCache.set(cacheKey, event)
        if (kind === kinds.Metadata) {
          this.profileMemoryCache.set(pubkey, event)
        }
        indexedDb.putReplaceableEvent(event)
        return event
      } else {
        indexedDb.putNullReplaceableEvent(pubkey, kind)
        return null
      }
    })
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
          eoseTimeout: 200,
          globalTimeout: 3000
        })

        for (const event of events) {
          // Check tombstone in background (non-blocking)
          const tombstoneKey = isReplaceableEvent(event.kind)
            ? getReplaceableCoordinateFromEvent(event)
            : event.id
          // Don't block on tombstone check - do it in background
          indexedDb.isTombstoned(tombstoneKey).then(isTombstoned => {
            if (isTombstoned) {
              const cacheKey = `${event.kind}:${event.pubkey}:${d ?? ''}`
              this.replaceableEventMemoryCache.delete(cacheKey)
            }
          }).catch(() => {})
          
          const eventKey = `${event.pubkey}:${event.kind}:${d ?? ''}`
          const existing = eventsMap.get(eventKey)
          if (!existing || existing.created_at < event.created_at) {
            eventsMap.set(eventKey, event)
            // Add to memory cache
            const cacheKey = `${event.kind}:${event.pubkey}:${d ?? ''}`
            this.replaceableEventMemoryCache.set(cacheKey, event)
          }
        }
      })
    )

    return params.map(({ pubkey, kind, d }) => {
      const eventKey = `${pubkey}:${kind}:${d ?? ''}`
      const event = eventsMap.get(eventKey)
      if (event) {
        // Add to memory cache for instant access
        const cacheKey = `${kind}:${pubkey}:${d ?? ''}`
        this.replaceableEventMemoryCache.set(cacheKey, event)
        if (kind === kinds.Metadata) {
          this.profileMemoryCache.set(pubkey, event)
        }
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
    await indexedDb.putReplaceableEvent(event)
  }

  /**
   * =========== Profile Methods ===========
   */

  /**
   * Fetch profile event by id (hex, npub, nprofile)
   */
  async fetchProfileEvent(id: string, skipCache: boolean = false): Promise<NEvent | undefined> {
    let pubkey: string | undefined
    let relays: string[] = []
    if (/^[0-9a-f]{64}$/.test(id)) {
      pubkey = id
    } else {
      const { data, type } = nip19.decode(id)
      switch (type) {
        case 'npub':
          pubkey = data
          break
        case 'nprofile':
          pubkey = data.pubkey
          if (data.relays) relays = data.relays
          break
      }
    }

    if (!pubkey) {
      throw new Error('Invalid id')
    }
    if (!skipCache) {
      const localProfile = await indexedDb.getReplaceableEvent(pubkey, kinds.Metadata)
      if (localProfile) {
        return localProfile
      }
    }
    const profileEvent = await this.fetchReplaceableEvent(pubkey, kinds.Metadata)
    if (profileEvent) {
      await this.indexProfile(profileEvent)
      return profileEvent
    }

    if (!relays.length) {
      return undefined
    }

    // Try harder with specified relays
    const events = await this.queryService.query(
      relays,
      {
        authors: [pubkey],
        kinds: [kinds.Metadata],
        limit: 1
      },
      undefined,
      {
        replaceableRace: true,
        eoseTimeout: 200,
        globalTimeout: 3000
      }
    )

    const profileEventFromRelays = events[0]
    if (profileEventFromRelays) {
      await this.indexProfile(profileEventFromRelays)
      await indexedDb.putReplaceableEvent(profileEventFromRelays)
    }

    return profileEventFromRelays
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
  async fetchFollowingFavoriteRelays(pubkey: string): Promise<[string, string[]][]> {
    const cached = this.followingFavoriteRelaysCache.get(pubkey)
    if (cached) {
      return cached
    }
    const promise = this._fetchFollowingFavoriteRelays(pubkey)
    this.followingFavoriteRelaysCache.set(pubkey, promise)
    return promise
  }

  private async _fetchFollowingFavoriteRelays(pubkey: string): Promise<[string, string[]][]> {
    const followings = await this.fetchFollowings(pubkey)
    const favoriteRelaysEvents = await this.fetchReplaceableEventsFromProfileFetchRelays(
      followings.slice(0, 100),
      ExtendedKind.FAVORITE_RELAYS
    )
    const result: [string, string[]][] = []
    for (let i = 0; i < followings.length && i < favoriteRelaysEvents.length; i++) {
      const event = favoriteRelaysEvents[i]
      if (event) {
        const relays: string[] = []
        event.tags.forEach(([tagName, tagValue]) => {
          if (tagName === 'relay' && tagValue) {
            const normalizedUrl = normalizeUrl(tagValue)
            if (normalizedUrl && !relays.includes(normalizedUrl)) {
              relays.push(normalizedUrl)
            }
          }
        })
        if (relays.length > 0) {
          result.push([followings[i]!, relays])
        }
      }
    }
    return result
  }
}
