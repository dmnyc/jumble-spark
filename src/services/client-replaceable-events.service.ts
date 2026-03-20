import { BIG_RELAY_URLS, ExtendedKind, PROFILE_FETCH_RELAY_URLS } from '@/constants'
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
   * Fetch replaceable event (profile, relay list, etc.)
   */
  async fetchReplaceableEvent(pubkey: string, kind: number, d?: string): Promise<NEvent | undefined> {
    if (d) {
      const event = await this.replaceableEventDataLoader.load({ pubkey, kind, d })
      return event || undefined
    }
    const event = await this.replaceableEventFromBigRelaysDataloader.load({ pubkey, kind })
    return event || undefined
  }

  /**
   * Batch fetch replaceable events from big relays
   */
  async fetchReplaceableEventsFromBigRelays(pubkeys: string[], kind: number): Promise<(NEvent | undefined)[]> {
    const events = await indexedDb.getManyReplaceableEvents(pubkeys, kind)
    const nonExistingPubkeyIndexMap = new Map<string, number>()
    pubkeys.forEach((pubkey, i) => {
      if (events[i] === undefined) {
        nonExistingPubkeyIndexMap.set(pubkey, i)
      }
    })
    const newEvents = await this.replaceableEventFromBigRelaysDataloader.loadMany(
      Array.from(nonExistingPubkeyIndexMap.keys()).map((pubkey) => ({ pubkey, kind }))
    )
    newEvents.forEach((event, idx) => {
      if (event && !(event instanceof Error)) {
        const pubkey = Array.from(nonExistingPubkeyIndexMap.keys())[idx]
        if (pubkey) {
          const index = nonExistingPubkeyIndexMap.get(pubkey)
          if (index !== undefined) {
            events[index] = event ?? undefined
          }
        }
      }
    })
    return events.map(e => e ?? undefined)
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
        let relayUrls: string[]
        if (kind === kinds.Metadata || kind === kinds.RelayList) {
          const base = Array.from(new Set([...BIG_RELAY_URLS, ...PROFILE_FETCH_RELAY_URLS]))
          // TODO: Inject relay list service to get user's relays
          relayUrls = base
        } else {
          relayUrls = BIG_RELAY_URLS
        }
        
        const events = await this.queryService.query(relayUrls, {
          authors: pubkeys,
          kinds: [kind]
        }, undefined, {
          replaceableRace: true,
          eoseTimeout: 200,
          globalTimeout: 3000
        })

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
        const relayUrls = BIG_RELAY_URLS

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
    const events = await this.fetchReplaceableEventsFromBigRelays(deduped, kinds.Metadata)
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
    const favoriteRelaysEvents = await this.fetchReplaceableEventsFromBigRelays(
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
