import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
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
   * Always checks in-memory cache FIRST (instant), then IndexedDB, then fetches from relays
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
    // 1. Check IndexedDB (async but faster than network)
    try {
      const indexedDbCached = await indexedDb.getReplaceableEvent(pubkey, kind, d)
      if (indexedDbCached) {
        // Check tombstone in background (non-blocking)
        const tombstoneKey = isReplaceableEvent(kind) 
          ? getReplaceableCoordinateFromEvent(indexedDbCached)
          : indexedDbCached.id
        indexedDb.isTombstoned(tombstoneKey).then(isTombstoned => {
          if (isTombstoned) {
            // Event is tombstoned - will be handled by IndexedDB cleanup
            logger.debug('[ReplaceableEventService] Event is tombstoned', {
              pubkey: formatPubkey(pubkey),
              kind
            })
          }
        }).catch(() => {
          // If tombstone check fails, keep it in cache (better to show stale than nothing)
        })
        
        // Fetch in background to update cache if newer version exists
        this.refreshInBackground(pubkey, kind, d).catch(() => {})
        return indexedDbCached
      }
    } catch (error) {
      // IndexedDB error - continue to network fetch
      logger.warn('[ReplaceableEventService] IndexedDB error', { 
        pubkey: formatPubkey(pubkey), 
        kind, 
        error: error instanceof Error ? error.message : String(error) 
      })
    }
    
    // 2. Not in cache, fetch from network
    // Note: DataLoader will use comprehensive relay list from batch load function
    // For profiles: if we have containingEventRelays (from fetchProfileEvent), include them
    // Profiles are often on the same relays where the author publishes their events
    try {
      // If we have containing event relays and this is a profile, we need to use a custom relay list
      // Otherwise, use DataLoader (which uses comprehensive relay list)
      let event: NEvent | undefined
      if (containingEventRelays.length > 0 && kind === kinds.Metadata && !d) {
        // For profiles with containing event relays (author's relay list), build custom relay list and query directly
        const relayUrls = await this.buildComprehensiveRelayListForAuthor(pubkey, kind, containingEventRelays, [])
        const events = await this.queryService.query(relayUrls, {
          authors: [pubkey],
          kinds: [kind]
        }, undefined, {
          replaceableRace: true,
          eoseTimeout: 200,
          globalTimeout: 3000
        })
        const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
        event = sortedEvents.length > 0 ? sortedEvents[0] : undefined
      } else {
        // Use DataLoader for batching
        const loadedEvent = d
          ? await this.replaceableEventDataLoader.load({ pubkey, kind, d })
          : await this.replaceableEventFromBigRelaysDataloader.load({ pubkey, kind })
        event = loadedEvent || undefined
      }
      
      if (event) {
        // Extract relay hints from the found event (for future related fetches)
        const eventRelayHints = this.extractRelayHintsFromEvent(event)
        
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
          pubkey: formatPubkey(pubkey)
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
        // For profiles/metadata: includes user's own relays (read/write/local) + PROFILE_FETCH_RELAY_URLS
        // For each pubkey, build comprehensive relay list
        const relayUrlSets = await Promise.all(
          pubkeys.map(async (pubkey) => {
            // Build comprehensive relay list for this author
            return await this.buildComprehensiveRelayListForAuthor(pubkey, kind, [], [])
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
          const key = `${event.pubkey}:${event.kind}`
          const existing = eventsMap.get(key)
          if (!existing || existing.created_at < event.created_at) {
            eventsMap.set(key, event)
          }
        }
      })
    )

    return params.map(({ pubkey, kind }) => {
      const key = `${pubkey}:${kind}`
      const event = eventsMap.get(key)
      if (event) {
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
    
    // For profiles: get author's relay list (from cache if available) and use those relays
    // Profiles are often on the same relays where the author publishes their events
    let authorRelayList: { read?: string[]; write?: string[] } | null = null
    try {
      authorRelayList = await client.fetchRelayList(pubkey)
      // Use author's outboxes (write relays) and inboxes (read relays) - profiles are often there
      const authorRelays = [
        ...(authorRelayList.write || []).slice(0, 10),
        ...(authorRelayList.read || []).slice(0, 10)
      ]
      relays = [...new Set([...relays, ...authorRelays])]
      logger.debug('[ReplaceableEventService] Using author relay list for profile fetch', {
        pubkey: formatPubkey(pubkey),
        authorRelayCount: authorRelays.length,
        totalRelayCount: relays.length
      })
    } catch (error) {
      logger.debug('[ReplaceableEventService] Failed to fetch author relay list for profile', { 
        pubkey: formatPubkey(pubkey),
        error 
      })
    }
    
    // Use fetchReplaceableEvent which checks IndexedDB then network
    const profileEvent = await this.fetchReplaceableEvent(pubkey, kinds.Metadata, undefined, relays)
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
