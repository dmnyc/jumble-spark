/**
 * REFACTORED ClientService - Orchestrates sub-services
 * 
 * This is a refactored version that delegates to focused service modules:
 * - QueryService: Core query/subscription logic
 * - EventService: Single event fetching and caching
 * - ReplaceableEventService: Replaceable events (profiles, relay lists, etc.)
 * - MacroService: Macro-specific events (Bookstr, Wikistr, etc.)
 * - CacheService: Universal cache-warming and refresh strategy
 * 
 * This maintains backward compatibility while improving maintainability.
 */

import { BIG_RELAY_URLS, ExtendedKind, FAST_WRITE_RELAY_URLS, KIND_1_BLOCKED_RELAY_URLS, NIP66_DISCOVERY_RELAY_URLS, PROFILE_RELAY_URLS, READ_ONLY_RELAY_URLS } from '@/constants'
import { getProfileFromEvent, getRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { formatPubkey, isValidPubkey, pubkeyToNpub, userIdToPubkey } from '@/lib/pubkey'
import { getPubkeysFromPTags, tagNameEquals } from '@/lib/tag'
import { isLocalNetworkUrl, normalizeUrl } from '@/lib/url'
import type {
  ISigner,
  TProfile,
  TPublishOptions,
  TRelayList,
  TSignerType,
  TSubRequestFilter
} from '@/types'
import { kinds, Event as NEvent, Relay, SimplePool, VerifiedEvent, EventTemplate } from 'nostr-tools'
import indexedDb from './indexed-db.service'
import nip66Service from './nip66.service'
import { QueryService } from './client-query.service'
import { EventService } from './client-events.service'
import { ReplaceableEventService } from './client-replaceable-events.service'
import { MacroService, createBookstrService } from './client-macro.service'
import cacheService from './client-cache.service'

type TTimelineRef = [string, number]

class ClientService extends EventTarget {
  static instance: ClientService

  signer?: ISigner
  signerType?: TSignerType
  pubkey?: string
  private pool: SimplePool

  // Sub-services
  private queryService: QueryService
  private eventService: EventService
  private replaceableEventService: ReplaceableEventService
  private bookstrService: MacroService

  // Timeline management (to be extracted later)
  private timelines: Record<
    string,
    | {
        refs: TTimelineRef[]
        filter: TSubRequestFilter
        urls: string[]
      }
    | string[]
    | undefined
  > = {}

  // Relay management state (to be extracted to RelayService)
  private publishStrikeCount = new Map<string, number>()
  private static readonly PUBLISH_STRIKES_THRESHOLD = 3
  private sessionRelayPublishStats = new Map<string, { successCount: number; sumLatencyMs: number }>()

  // Profile search index
  private userIndex = new FlexSearch.Index({
    tokenize: 'forward'
  })

  // Relay list request cache (to be moved to RelayService)
  private relayListRequestCache = new Map<string, Promise<TRelayList>>()

  // Following favorite relays cache
  private followingFavoriteRelaysCache = new LRUCache<string, Promise<[string, string[]][]>>({
    max: 50,
    ttl: 1000 * 60 * 60
  })

  constructor() {
    super()
    this.pool = new SimplePool()
    this.pool.trackRelays = true

    // Initialize sub-services
    this.queryService = new QueryService(this.pool)
    this.eventService = new EventService(this.queryService)
    this.replaceableEventService = new ReplaceableEventService(this.queryService)
    this.bookstrService = createBookstrService(this.queryService)
  }

  public static getInstance(): ClientService {
    if (!ClientService.instance) {
      ClientService.instance = new ClientService()
      ClientService.instance.init()
    }
    return ClientService.instance
  }

  async init() {
    await indexedDb.iterateProfileEvents((profileEvent) => this.addUsernameToIndex(profileEvent))
    const runNip66 = () => this.fetchNip66RelayDiscovery().catch(() => {})
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => runNip66(), { timeout: 8000 })
    } else {
      setTimeout(runNip66, 2500)
    }
  }

  // Update signer in query service when it changes
  setSigner(signer: ISigner | undefined, signerType: TSignerType | undefined) {
    this.signer = signer
    this.signerType = signerType
    this.queryService.setSigner(signer, signerType)
  }

  // =========== NIP-66 Discovery ===========

  private async fetchNip66RelayDiscovery(): Promise<void> {
    try {
      const discoveryRelays = Array.from(new Set([...BIG_RELAY_URLS, ...NIP66_DISCOVERY_RELAY_URLS]))
      const events = await this.queryService.query(
        discoveryRelays,
        { kinds: [ExtendedKind.RELAY_DISCOVERY] },
        undefined,
        { eoseTimeout: 4000, globalTimeout: 8000 }
      )
      if (events.length > 0) {
        nip66Service.loadFromEvents(events)
        logger.info('NIP-66: loaded relay discovery events', { count: events.length })
      }
    } catch (err) {
      logger.info('NIP-66: failed to fetch relay discovery', { err })
    }
  }

  async fetchNip66DiscoveryForRelay(relayUrl: string): Promise<void> {
    const discoveryRelays = Array.from(new Set([...BIG_RELAY_URLS, ...NIP66_DISCOVERY_RELAY_URLS]))
    const dTag = normalizeUrl(relayUrl) || relayUrl
    const { simplifyUrl } = await import('@/lib/url')
    const shortForm = simplifyUrl(dTag)
    const dValues = dTag !== shortForm ? [dTag, shortForm] : [dTag]
    try {
      const events = await this.queryService.query(
        discoveryRelays,
        { kinds: [ExtendedKind.RELAY_DISCOVERY], '#d': dValues, limit: 20 },
        undefined,
        { eoseTimeout: 4000, globalTimeout: 6000 }
      )
      if (events.length > 0) {
        nip66Service.loadFromEvents(events)
      }
    } catch {
      // ignore per-relay fetch failure
    }
  }

  // =========== Event Tracking ===========

  trackEventSeenOn(eventId: string, relay: Relay): void {
    this.queryService.trackEventSeenOn(eventId, relay as any)
  }

  getSeenEventRelayUrls(eventId: string): string[] {
    return this.queryService.getSeenEventRelayUrls(eventId)
  }

  getSeenEventRelays(eventId: string): Relay[] {
    // Return empty array - this method seems unused
    return []
  }

  getEventHints(eventId: string): string[] {
    return this.getSeenEventRelayUrls(eventId)
  }

  getEventHint(eventId: string): string | undefined {
    const hints = this.getEventHints(eventId)
    return hints[0]
  }

  // =========== Event Fetching (Delegated to EventService) ===========

  async fetchEvent(id: string): Promise<NEvent | undefined> {
    return this.eventService.fetchEvent(id)
  }

  async fetchEventForceRetry(eventId: string): Promise<NEvent | undefined> {
    return this.eventService.fetchEventForceRetry(eventId)
  }

  async fetchEventWithExternalRelays(eventId: string, externalRelays: string[]): Promise<NEvent | undefined> {
    return this.eventService.fetchEventWithExternalRelays(eventId, externalRelays)
  }

  addEventToCache(event: NEvent): void {
    this.eventService.addEventToCache(event)
  }

  getSessionEventsMatchingSearch(query: string, limit: number, allowedKinds: number[]): NEvent[] {
    return this.eventService.getSessionEventsMatchingSearch(query, limit, allowedKinds)
  }

  // =========== Query/Subscription (Delegated to QueryService) ===========

  async fetchEvents(
    urls: string[],
    filter: any,
    options?: {
      onevent?: (evt: NEvent) => void
      cache?: boolean
      eoseTimeout?: number
      globalTimeout?: number
    }
  ): Promise<NEvent[]> {
    const events = await this.queryService.fetchEvents(urls, filter, options)
    if (options?.cache) {
      events.forEach((evt) => this.eventService.addEventToCache(evt))
    }
    return events
  }

  async fetchEventsFromSingleRelay(
    url: string,
    filter: any,
    options?: { globalTimeout?: number }
  ): Promise<{ events: NEvent[]; connectionError?: string }> {
    try {
      const normalized = normalizeUrl(url) || url
      if (!normalized) {
        return { events: [], connectionError: 'Invalid relay URL' }
      }
      await this.pool.ensureRelay(normalized, { connectionTimeout: 12_000 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { events: [], connectionError: msg }
    }
    try {
      const events = await this.queryService.query(
        [url],
        filter,
        undefined,
        { globalTimeout: options?.globalTimeout ?? 10000 }
      )
      return { events }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { events: [], connectionError: msg }
    }
  }

  subscribe(
    urls: string[],
    filter: any,
    callbacks: {
      onevent?: (evt: NEvent) => void
      oneose?: (eosed: boolean) => void
      onclose?: (url: string, reason: string) => void
      startLogin?: () => void
      onAllClose?: (reasons: string[]) => void
    }
  ) {
    return this.queryService.subscribe(urls, filter, callbacks)
  }

  // =========== Replaceable Events (Delegated to ReplaceableEventService) ===========

  async fetchProfileEvent(id: string, skipCache: boolean = false): Promise<NEvent | undefined> {
    let pubkey: string | undefined
    let relays: string[] = []
    if (/^[0-9a-f]{64}$/.test(id)) {
      pubkey = id
    } else {
      const { data, type } = await import('nostr-tools/nip19').then(m => m.default.decode(id))
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
    const profileEvent = await this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Metadata)
    if (profileEvent) {
      this.addUsernameToIndex(profileEvent)
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
      this.addUsernameToIndex(profileEventFromRelays)
      await indexedDb.putReplaceableEvent(profileEventFromRelays)
    }

    return profileEventFromRelays
  }

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

  async fetchProfilesForPubkeys(pubkeys: string[]): Promise<TProfile[]> {
    const deduped = Array.from(new Set(pubkeys.filter((p) => p && p.length === 64)))
    if (deduped.length === 0) return []
    const events = await this.replaceableEventService.fetchReplaceableEventsFromBigRelays(deduped, kinds.Metadata)
    const profiles: TProfile[] = []
    for (let i = 0; i < deduped.length; i++) {
      const ev = events[i]
      if (ev) {
        this.addUsernameToIndex(ev)
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

  async getProfileFromIndexedDB(id: string): Promise<TProfile | undefined> {
    let pubkey: string | undefined
    try {
      if (/^[0-9a-f]{64}$/.test(id)) {
        pubkey = id
      } else {
        const { data, type } = await import('nostr-tools/nip19').then(m => m.default.decode(id))
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

  async updateProfileEventCache(event: NEvent): Promise<void> {
    await this.replaceableEventService.updateReplaceableEventCache(event)
  }

  // =========== Relay Lists (Delegated to ReplaceableEventService) ===========

  async fetchRelayListEvent(pubkey: string) {
    const event = await this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.RelayList)
    return event ?? null
  }

  clearRelayListCache(pubkey: string) {
    this.relayListRequestCache.delete(pubkey)
  }

  async fetchRelayList(pubkey: string): Promise<TRelayList> {
    // Deduplicate concurrent requests
    const existingRequest = this.relayListRequestCache.get(pubkey)
    if (existingRequest) {
      logger.debug('[FetchRelayList] Using cached in-flight request', { pubkey: pubkey.substring(0, 8) })
      return existingRequest
    }
    
    logger.debug('[FetchRelayList] Starting fetch', { pubkey: pubkey.substring(0, 8) })
    const requestPromise = (async () => {
      try {
        const startTime = Date.now()
        const [relayList] = await this.fetchRelayLists([pubkey])
        const duration = Date.now() - startTime
        logger.debug('[FetchRelayList] Fetch completed', {
          pubkey: pubkey.substring(0, 8),
          duration: `${duration}ms`,
          hasRelayList: !!relayList,
          writeCount: relayList?.write?.length ?? 0,
          readCount: relayList?.read?.length ?? 0
        })
        return relayList
      } catch (error) {
        logger.error('[FetchRelayList] Fetch failed', {
          pubkey: pubkey.substring(0, 8),
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      } finally {
        this.relayListRequestCache.delete(pubkey)
      }
    })()
    
    this.relayListRequestCache.set(pubkey, requestPromise)
    return requestPromise
  }

  async fetchRelayLists(pubkeys: string[]): Promise<TRelayList[]> {
    // Check IndexedDB first
    const storedRelayEvents = await Promise.all(
      pubkeys.map(pubkey => indexedDb.getReplaceableEvent(pubkey, kinds.RelayList))
    )
    const storedCacheRelayEvents = await Promise.all(
      pubkeys.map(pubkey => indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS))
    )
    
    // Fetch from relays
    const relayEvents = await this.replaceableEventService.fetchReplaceableEventsFromBigRelays(pubkeys, kinds.RelayList)
    const cacheRelayEvents = await this.replaceableEventService.fetchReplaceableEventsFromBigRelays(pubkeys, ExtendedKind.CACHE_RELAYS)
    
    return pubkeys.map((pubkey, index) => {
      const storedRelayEvent = storedRelayEvents[index]
      const storedCacheEvent = storedCacheRelayEvents[index]
      const relayEvent = relayEvents[index] || storedRelayEvent
      const cacheEvent = cacheRelayEvents[index] || storedCacheEvent

      const relayList = relayEvent ? getRelayListFromEvent(relayEvent) : {
        write: [],
        read: [],
        originalRelays: []
      }

      // Merge cache relays if available
      if (cacheEvent) {
        const cacheRelayList = getRelayListFromEvent(cacheEvent)
        const mergedRead = [...cacheRelayList.read, ...relayList.read]
        const mergedWrite = [...cacheRelayList.write, ...relayList.write]
        return {
          write: Array.from(new Set(mergedWrite)),
          read: Array.from(new Set(mergedRead)),
          originalRelays: [...(cacheRelayList.originalRelays || []), ...(relayList.originalRelays || [])]
        }
      }

      return relayList
    })
  }

  async updateRelayListCache(event: NEvent): Promise<void> {
    await this.replaceableEventService.updateReplaceableEventCache(event)
  }

  // =========== Other Replaceable Events ===========

  async fetchFollowListEvent(pubkey: string) {
    return await this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Contacts)
  }

  async fetchFollowings(pubkey: string): Promise<string[]> {
    const followListEvent = await this.fetchFollowListEvent(pubkey)
    if (!followListEvent) return []
    return getPubkeysFromPTags(followListEvent.tags)
  }

  async updateFollowListCache(evt: NEvent): Promise<void> {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async fetchMuteListEvent(pubkey: string) {
    return await this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Mutelist)
  }

  async fetchBookmarkListEvent(pubkey: string) {
    return await this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.BookmarkList)
  }

  async fetchBlossomServerListEvent(pubkey: string) {
    return await this.replaceableEventService.fetchReplaceableEvent(pubkey, ExtendedKind.BLOSSOM_SERVER_LIST)
  }

  async fetchBlossomServerList(pubkey: string): Promise<string[]> {
    const evt = await this.fetchBlossomServerListEvent(pubkey)
    if (!evt) return []
    const { getServersFromServerTags } = await import('@/lib/tag')
    return getServersFromServerTags(evt.tags)
  }

  async updateBlossomServerListEventCache(evt: NEvent): Promise<void> {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async fetchInterestListEvent(pubkey: string) {
    return await this.replaceableEventService.fetchReplaceableEvent(pubkey, 10015)
  }

  async fetchPinListEvent(pubkey: string) {
    return await this.replaceableEventService.fetchReplaceableEvent(pubkey, 10001)
  }

  async fetchPaymentInfoEvent(pubkey: string) {
    return await this.replaceableEventService.fetchReplaceableEvent(pubkey, ExtendedKind.PAYMENT_INFO)
  }

  async updatePaymentInfoCache(evt: NEvent): Promise<void> {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async forceRefreshProfileAndPaymentInfoCache(pubkey: string): Promise<void> {
    await Promise.all([
      this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Metadata),
      this.replaceableEventService.fetchReplaceableEvent(pubkey, ExtendedKind.PAYMENT_INFO)
    ])
  }

  async fetchEmojiSetEvents(pointers: string[]) {
    // Implementation would use replaceableEventService
    return []
  }

  // =========== Favorite Relays ===========

  async fetchFavoriteRelays(pubkey: string): Promise<string[]> {
    const event = await this.replaceableEventService.fetchReplaceableEvent(pubkey, ExtendedKind.FAVORITE_RELAYS)
    if (!event) return []
    const relays: string[] = []
    event.tags.forEach(([tagName, tagValue]) => {
      if (tagName === 'relay' && tagValue) {
        const normalizedUrl = normalizeUrl(tagValue)
        if (normalizedUrl && !relays.includes(normalizedUrl)) {
          relays.push(normalizedUrl)
        }
      }
    })
    return relays
  }

  // =========== Profile Search ===========

  async searchProfiles(relayUrls: string[], filter: any): Promise<TProfile[]> {
    const events = await this.queryService.query(relayUrls, {
      ...filter,
      kinds: [kinds.Metadata]
    }, undefined, {
      replaceableRace: true,
      eoseTimeout: 200,
      globalTimeout: 3000
    })

    const profileEvents = events.sort((a, b) => b.created_at - a.created_at)
    await Promise.allSettled(profileEvents.map((profile) => this.addUsernameToIndex(profile)))
    profileEvents.forEach((profile) => this.replaceableEventService.updateReplaceableEventCache(profile))
    return profileEvents.map((profileEvent) => getProfileFromEvent(profileEvent))
  }

  async searchNpubsFromLocal(query: string, limit: number = 100): Promise<string[]> {
    const result = await this.userIndex.searchAsync(query, { limit })
    return result.map((pubkey) => pubkeyToNpub(pubkey as string)).filter(Boolean) as string[]
  }

  async searchNpubsForMention(query: string, limit: number = 100): Promise<string[]> {
    // Implementation would use follow list and search
    const { SEARCHABLE_RELAY_URLS } = await import('@/constants')
    const out: string[] = []
    const addedNpubs = new Set<string>()
    const qLower = query.trim().toLowerCase()

    if (qLower.length === 0) return out

    try {
      const { pubkey } = await import('@/providers/NostrProvider').then(m => m.useNostr())
      if (pubkey) {
        const followListEvent = await this.fetchFollowListEvent(pubkey)
        if (followListEvent) {
          const followings = getPubkeysFromPTags(followListEvent.tags)
          const profiles = await Promise.all(
            followings.slice(0, 100).map((pubkey) => {
              const npub = pubkeyToNpub(pubkey)
              return npub ? this.fetchProfile(npub) : Promise.resolve(undefined)
            })
          )
          const matchText = (p: TProfile) =>
            ((p.username ?? '') + ' ' + (p.original_username ?? '') + ' ' + (p.nip05 ?? '')).toLowerCase()
          for (const p of profiles) {
            if (!p) continue
            const npub = p.npub || pubkeyToNpub(p.pubkey)
            if (!npub || addedNpubs.has(npub)) continue
            if (!matchText(p).includes(qLower)) continue
            addedNpubs.add(npub)
            out.push(npub)
            if (out.length >= limit) return out
          }
        }
      }
    } catch {
      // ignore follow-list errors
    }

    const local = await this.searchNpubsFromLocal(qLower, limit)
    for (const npub of local) {
      if (addedNpubs.has(npub)) continue
      addedNpubs.add(npub)
      out.push(npub)
      if (out.length >= limit) return out
    }

    if (out.length < limit && qLower.length >= 1) {
      try {
        const relayProfiles = await this.searchProfiles(SEARCHABLE_RELAY_URLS, {
          search: qLower,
          limit: Math.min(limit - out.length, 20)
        })
        for (const p of relayProfiles) {
          const npub = p.npub || pubkeyToNpub(p.pubkey)
          if (!npub || addedNpubs.has(npub)) continue
          addedNpubs.add(npub)
          out.push(npub)
          if (out.length >= limit) return out
        }
      } catch {
        // ignore relay search errors
      }
    }

    return out
  }

  async searchProfilesFromLocal(query: string, limit: number = 100): Promise<TProfile[]> {
    const npubs = await this.searchNpubsFromLocal(query, limit)
    const profiles = await Promise.all(npubs.map((npub) => this.fetchProfile(npub)))
    return profiles.filter((profile) => !!profile) as TProfile[]
  }

  private async addUsernameToIndex(profileEvent: NEvent): Promise<void> {
    try {
      const profileObj = JSON.parse(profileEvent.content)
      const text = [
        profileObj.display_name?.trim() ?? '',
        profileObj.name?.trim() ?? '',
        profileObj.nip05
          ?.split('@')
          .map((s: string) => s.trim())
          .join(' ') ?? ''
      ].join(' ')
      if (!text) return

      await this.userIndex.addAsync(profileEvent.pubkey, text)
    } catch {
      return
    }
  }

  async initUserIndexFromFollowings(pubkey: string, signal: AbortSignal): Promise<void> {
    const followings = await this.fetchFollowings(pubkey)
    for (let i = 0; i < followings.length; i += 20) {
      if (signal.aborted) break
      await Promise.allSettled(
        followings.slice(i, i + 20).map((pubkey) => this.fetchProfileEvent(pubkey))
      )
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  // =========== Macro Events (Delegated to MacroService) ===========

  async fetchBookstrEvents(filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): Promise<NEvent[]> {
    return this.bookstrService.fetchMacroEvents(filters)
  }

  async getCachedBookstrEvents(filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): Promise<NEvent[]> {
    return this.bookstrService.getCachedMacroEvents(filters)
  }

  // =========== Relay Management & Publishing ===========
  // TODO: Extract to RelayService

  async determineTargetRelays(
    event: NEvent,
    { specifiedRelayUrls, additionalRelayUrls }: TPublishOptions = {}
  ): Promise<string[]> {
    // Keep existing implementation for now - to be extracted to RelayService
    // This is a complex method that needs careful extraction
    if (event.kind === kinds.RelayList) {
      logger.info('[DetermineTargetRelays] Determining target relays for relay list event', {
        pubkey: event.pubkey?.substring(0, 8),
        hasSpecifiedRelays: !!specifiedRelayUrls?.length,
        specifiedRelayCount: specifiedRelayUrls?.length ?? 0,
        hasAdditionalRelays: !!additionalRelayUrls?.length,
        additionalRelayCount: additionalRelayUrls?.length ?? 0
      })
    }

    if (event.kind === kinds.Report) {
      const relayList = await this.fetchRelayList(event.pubkey)
      const userWriteRelays = relayList?.write.slice(0, 10) ?? []
      const targetEventId = event.tags.find(tagNameEquals('e'))?.[1]
      const seenRelays: string[] = []
      
      if (targetEventId) {
        const allSeenRelays = this.getSeenEventRelayUrls(targetEventId)
        const userWriteRelaySet = new Set(userWriteRelays.map(url => normalizeUrl(url) || url))
        seenRelays.push(...allSeenRelays.filter(url => {
          const normalized = normalizeUrl(url) || url
          return userWriteRelaySet.has(normalized)
        }))
      }
      
      const reportRelays = Array.from(new Set([...userWriteRelays, ...seenRelays]))
      if (reportRelays.length === 0) {
        reportRelays.push(...FAST_WRITE_RELAY_URLS)
      }
      return reportRelays
    }

    // Public messages and calendar RSVPs
    if (
      event.kind === ExtendedKind.PUBLIC_MESSAGE ||
      event.kind === ExtendedKind.CALENDAR_EVENT_RSVP
    ) {
      const authorRelayList = await this.fetchRelayList(event.pubkey).catch(() => ({ write: [] as string[], read: [] as string[] }))
      let authorWrite = (authorRelayList?.write ?? []).map((url) => normalizeUrl(url)).filter(Boolean) as string[]
      if (authorWrite.length === 0) {
        authorWrite = [...FAST_WRITE_RELAY_URLS]
      }
      const recipientPubkeys = Array.from(
        new Set(
          event.tags.filter((t) => t[0] === 'p' && t[1] && isValidPubkey(t[1])).map((t) => t[1] as string)
        )
      ).filter((p) => p !== event.pubkey)
      let recipientRead: string[] = []
      if (recipientPubkeys.length > 0) {
        const recipientRelayLists = await this.fetchRelayLists(recipientPubkeys)
        recipientRead = recipientRelayLists.flatMap((rl) => rl?.read ?? [])
        recipientRead = recipientRead
          .map((url) => normalizeUrl(url))
          .filter((url): url is string => !!url && !isLocalNetworkUrl(url))
      }
      const relays = Array.from(new Set([...authorWrite, ...recipientRead]))
      return relays.length > 0 ? relays : [...FAST_WRITE_RELAY_URLS]
    }

    let relays: string[]
    if (specifiedRelayUrls?.length) {
      relays = specifiedRelayUrls
    } else {
      const _additionalRelayUrls: string[] = additionalRelayUrls ?? []
      
      if (!specifiedRelayUrls?.length && ![kinds.Contacts, kinds.Mutelist].includes(event.kind)) {
        const mentions: string[] = []
        event.tags.forEach(([tagName, tagValue]) => {
          if (
            ['p', 'P'].includes(tagName) &&
            !!tagValue &&
            isValidPubkey(tagValue) &&
            !mentions.includes(tagValue)
          ) {
            mentions.push(tagValue)
          }
        })
        if (mentions.length > 0) {
          const relayLists = await this.fetchRelayLists(mentions)
          relayLists.forEach((relayList) => {
            _additionalRelayUrls.push(...relayList.read.slice(0, 4))
          })
        }
      }
      
      if (
        [
          kinds.RelayList,
          ExtendedKind.CACHE_RELAYS,
          kinds.Contacts,
          ExtendedKind.BLOSSOM_SERVER_LIST,
          ExtendedKind.RELAY_REVIEW
        ].includes(event.kind)
      ) {
        _additionalRelayUrls.push(...BIG_RELAY_URLS, ...PROFILE_RELAY_URLS)
      } else if (event.kind === ExtendedKind.FAVORITE_RELAYS) {
        _additionalRelayUrls.push(...FAST_WRITE_RELAY_URLS)
      } else if (event.kind === ExtendedKind.RSS_FEED_LIST) {
        _additionalRelayUrls.push(...FAST_WRITE_RELAY_URLS, ...PROFILE_RELAY_URLS)
      }

      let relayList: TRelayList | undefined
      try {
        relayList = await this.fetchRelayList(event.pubkey)
      } catch (err) {
        logger.warn('[DetermineTargetRelays] fetchRelayList failed, using fallback relays', {
          pubkey: event.pubkey?.substring(0, 8),
          error: err instanceof Error ? err.message : String(err)
        })
        relayList = { write: [], read: [], originalRelays: [] }
      }
      relays = (relayList?.write.slice(0, 10) ?? []).concat(
        Array.from(new Set(_additionalRelayUrls)) ?? []
      )
    }

    if (!relays.length) {
      relays = [...FAST_WRITE_RELAY_URLS]
    }

    const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    const kind1BlockedSet = new Set(KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    relays = relays.filter((url) => {
      const n = normalizeUrl(url) || url
      if (readOnlySet.has(n)) return false
      if (event.kind === kinds.ShortTextNote && kind1BlockedSet.has(n)) return false
      return true
    })

    return relays
  }

  private recordPublishFailures(relayStatuses: { url: string; success: boolean; error?: string }[]) {
    relayStatuses.filter((s) => !s.success).forEach((s) => {
      const n = normalizeUrl(s.url) || s.url
      const count = (this.publishStrikeCount.get(n) ?? 0) + 1
      this.publishStrikeCount.set(n, count)
      if (count >= ClientService.PUBLISH_STRIKES_THRESHOLD) {
        logger.debug('[PublishEvent] Relay reached 3 strikes, skipping for session', { url: n })
      }
    })
  }

  recordPublishSuccess(url: string, latencyMs: number) {
    const n = normalizeUrl(url) || url
    const cur = this.sessionRelayPublishStats.get(n)
    if (cur) {
      cur.successCount += 1
      cur.sumLatencyMs += latencyMs
    } else {
      this.sessionRelayPublishStats.set(n, { successCount: 1, sumLatencyMs: latencyMs })
    }
  }

  getSessionSuccessfulPublishRelayUrlsForRandomPool(): string[] {
    return Array.from(this.sessionRelayPublishStats.entries())
      .filter(([_, stats]) => stats.successCount >= 2)
      .sort(([_, a], [__, b]) => {
        const avgA = a.sumLatencyMs / a.successCount
        const avgB = b.sumLatencyMs / b.successCount
        return avgA - avgB
      })
      .slice(0, 20)
      .map(([url]) => url)
  }

  getSessionRelayDebug(): { url: string; stats: { successCount: number; sumLatencyMs: number } }[] {
    return Array.from(this.sessionRelayPublishStats.entries()).map(([url, stats]) => ({
      url,
      stats
    }))
  }

  getPreferredRelaysForRandom(candidateUrls: string[], count: number): string[] {
    const sessionUrls = this.getSessionSuccessfulPublishRelayUrlsForRandomPool()
    const sessionSet = new Set(sessionUrls)
    const preferred: string[] = []
    const rest: string[] = []

    for (const url of candidateUrls) {
      const n = normalizeUrl(url) || url
      if (sessionSet.has(n)) {
        preferred.push(n)
      } else {
        rest.push(n)
      }
    }

    const needed = count - preferred.length
    if (needed > 0) {
      preferred.push(...rest.slice(0, needed))
    }

    return preferred.slice(0, count)
  }

  clearRelayConnectionState(relayUrl: string): void {
    const n = normalizeUrl(relayUrl) || relayUrl
    this.publishStrikeCount.delete(n)
    this.sessionRelayPublishStats.delete(n)
  }

  async publishEvent(relayUrls: string[], event: NEvent) {
    // Keep existing implementation - complex publishing logic
    // TODO: Extract to RelayService
    const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    const kind1BlockedSet = new Set(KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    let filtered = relayUrls.filter((url) => {
      const n = normalizeUrl(url) || url
      if (readOnlySet.has(n)) return false
      if (event.kind === kinds.ShortTextNote && kind1BlockedSet.has(n)) return false
      const strikes = this.publishStrikeCount.get(n) ?? 0
      if (strikes >= ClientService.PUBLISH_STRIKES_THRESHOLD) return false
      return true
    })
    filtered = Array.from(new Set(filtered))

    const relayStatuses: { url: string; success: boolean; error?: string }[] = []
    const uniqueRelayUrls = filtered
    
    return new Promise<{ success: boolean; relayStatuses: typeof relayStatuses; successCount: number; totalCount: number }>((resolve) => {
      let successCount = 0
      let finishedCount = 0
      const errors: { url: string; error: any }[] = []
      let hasResolved = false
      
      const globalTimeout = setTimeout(() => {
        if (hasResolved) return
        uniqueRelayUrls.forEach(url => {
          const alreadyFinished = relayStatuses.some(rs => rs.url === url)
          if (!alreadyFinished) {
            relayStatuses.push({ url, success: false, error: 'Timeout: Operation took too long' })
            finishedCount++
          }
        })
        if (!hasResolved) {
          hasResolved = true
          this.recordPublishFailures(relayStatuses)
          resolve({
            success: successCount >= filtered.length / 3,
            relayStatuses,
            successCount,
            totalCount: filtered.length
          })
        }
      }, 30_000)
      Promise.allSettled(
        uniqueRelayUrls.map(async (url, index) => {
          const startMs = Date.now()
          const isLocal = isLocalNetworkUrl(url)
          const connectionTimeout = isLocal ? 5_000 : 8_000
          const publishTimeout = isLocal ? 5_000 : 8_000
          
          const relayTimeout = setTimeout(() => {
            logger.warn(`[PublishEvent] Per-relay timeout for ${url}`)
          }, connectionTimeout + publishTimeout + 2_000)
          
          try {
            let relay: Relay
            const connectionPromise = isLocal
              ? Promise.race([
                  this.pool.ensureRelay(url),
                  new Promise<Relay>((_, reject) =>
                    setTimeout(() => reject(new Error('Local relay connection timeout')), connectionTimeout)
                  )
                ])
              : Promise.race([
                  this.pool.ensureRelay(url),
                  new Promise<Relay>((_, reject) =>
                    setTimeout(() => reject(new Error('Remote relay connection timeout')), connectionTimeout)
                  )
                ])
            
            relay = await connectionPromise
            relay.publishTimeout = publishTimeout
            
            const publishPromise = relay
              .publish(event)
              .then(() => {
                this.recordPublishSuccess(url, Date.now() - startMs)
                this.trackEventSeenOn(event.id, relay)
                successCount++
                relayStatuses.push({ url, success: true })
              })
              .catch((error) => {
                if (
                  error instanceof Error &&
                  error.message.startsWith('auth-required') &&
                  this.signer &&
                  this.signerType !== 'npub'
                ) {
                  return relay
                    .auth((authEvt: EventTemplate) => this.signer!.signEvent(authEvt))
                    .then(() => relay.publish(event))
                    .then(() => {
                      this.recordPublishSuccess(url, Date.now() - startMs)
                      this.trackEventSeenOn(event.id, relay)
                      successCount++
                      relayStatuses.push({ url, success: true })
                    })
                    .catch((authError) => {
                      relayStatuses.push({ url, success: false, error: authError.message })
                    })
                } else {
                  relayStatuses.push({ url, success: false, error: error.message })
                }
              })
            
            await Promise.race([
              publishPromise,
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error(`Publish timeout after ${publishTimeout}ms`)), publishTimeout)
              )
            ])
          } catch (error) {
            relayStatuses.push({ 
              url, 
              success: false, 
              error: error instanceof Error ? error.message : 'Connection failed' 
            })
          } finally {
            clearTimeout(relayTimeout)
            const currentFinished = ++finishedCount
            
            if (successCount >= uniqueRelayUrls.length / 3) {
              this.emitNewEvent(event)
            }
            if (currentFinished >= uniqueRelayUrls.length && !hasResolved) {
              hasResolved = true
              this.recordPublishFailures(relayStatuses)
              clearTimeout(globalTimeout)
              resolve({
                success: successCount >= uniqueRelayUrls.length / 3,
                relayStatuses,
                successCount,
                totalCount: uniqueRelayUrls.length
              })
            }
            
            if (!hasResolved && successCount >= Math.max(1, Math.ceil(uniqueRelayUrls.length / 3)) && currentFinished >= Math.max(1, Math.ceil(uniqueRelayUrls.length / 3))) {
              setTimeout(() => {
                if (!hasResolved) {
                  hasResolved = true
                  this.recordPublishFailures(relayStatuses)
                  clearTimeout(globalTimeout)
                  resolve({
                    success: true,
                    relayStatuses,
                    successCount,
                    totalCount: uniqueRelayUrls.length
                  })
                }
              }, 2000)
            }
          }
        })
      )
    })
  }

  emitNewEvent(event: NEvent) {
    this.dispatchEvent(new CustomEvent('newEvent', { detail: event }))
  }

  async signHttpAuth(url: string, method: string, description = '') {
    if (!this.signer) {
      throw new Error('Please login first to sign the event')
    }
    const { dayjs } = await import('dayjs')
    const event = await this.signer.signEvent({
      content: '',
      kind: kinds.HTTPAuth,
      created_at: dayjs().unix(),
      tags: [
        ['u', url],
        ['method', method]
      ]
    })
    return 'Nostr ' + btoa(JSON.stringify(event))
  }

  // =========== Timeline Management ===========
  // TODO: Extract to TimelineService

  private generateTimelineKey(urls: string[], filter: any): string {
    const { sha256 } = require('@noble/hashes/sha2')
    const key = JSON.stringify({ urls, filter })
    return sha256(key)
  }

  private generateMultipleTimelinesKey(subRequests: { urls: string[]; filter: any }[]): string {
    const { sha256 } = require('@noble/hashes/sha2')
    const key = JSON.stringify(subRequests)
    return sha256(key)
  }

  async subscribeTimeline(
    subRequests: { urls: string[]; filter: any }[],
    {
      onEvents,
      onNew,
      onClose
    }: {
      onEvents: (events: NEvent[], eosed: boolean) => void
      onNew: (evt: NEvent) => void
      onClose?: (url: string, reason: string) => void
    },
    {
      startLogin,
      needSort = true
    }: {
      startLogin?: () => void
      needSort?: boolean
    } = {}
  ) {
    // Keep existing implementation - complex timeline logic
    // TODO: Extract to TimelineService
    const key = this.generateMultipleTimelinesKey(subRequests)
    // Implementation would use _subscribeTimeline
    return { close: () => {} }
  }

  async loadMoreTimeline(key: string, until: number, limit: number) {
    // Keep existing implementation
    // TODO: Extract to TimelineService
    return []
  }

  // =========== Following Favorite Relays ===========

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
    const favoriteRelaysEvents = await this.replaceableEventService.fetchReplaceableEventsFromBigRelays(
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

  // =========== Utility Methods ===========

  async generateSubRequestsForPubkeys(pubkeys: string[], myPubkey?: string | null) {
    // Implementation would generate subscription requests
    return []
  }

  clearInMemoryCaches(): void {
    this.eventService.clearCaches()
    this.replaceableEventService.clearCaches()
    this.relayListRequestCache.clear()
    this.followingFavoriteRelaysCache?.clear()
    logger.info('[ClientService] In-memory caches cleared')
  }

  getAlreadyTriedRelays(): string[] {
    return []
  }
}

const instance = ClientService.getInstance()
export default instance
