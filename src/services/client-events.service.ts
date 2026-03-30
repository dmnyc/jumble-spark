import { ExtendedKind } from '@/constants'
import logger from '@/lib/logger'
import {
  getParentATag,
  getParentETag,
  getQuotedReferenceFromQTags,
  getRootATag,
  getRootETag,
  isNip25ReactionKind,
  isReplyNoteEvent,
  isReplaceableEvent,
  kind1QuotesThreadRoot
} from '@/lib/event'
import { getFirstHexEventIdFromETags } from '@/lib/tag'
import type { Event as NEvent, Filter } from 'nostr-tools'
import { kinds, nip19 } from 'nostr-tools'
import DataLoader from 'dataloader'
import { LRUCache } from 'lru-cache'
import indexedDb from './indexed-db.service'
import type { QueryService } from './client-query.service'
import client from './client.service'
import {
  invalidateArchiveFootprintCache,
  loadArchivedEventForFetch,
  prefetchArchivedEvents,
  queuePersistSeenEvent
} from './event-archive.service'
import { getDefaultSessionLruMaxSync } from '@/lib/event-archive-config'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { normalizeUrl } from '@/lib/url'

/**
 * Build comprehensive relay list for event-by-id fetch: user's inboxes (+ cache), relay hints,
 * author outboxes/inboxes when known, FAST_READ_RELAY_URLS, and SEARCHABLE_RELAY_URLS.
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
    includeSearchableRelays: true,
    includeLocalRelays: true
  })
}

const PREFETCH_HEX_IDS_CHUNK = 48

export class EventService {
  private queryService: QueryService
  private eventCacheMap = new Map<string, Promise<NEvent | undefined>>()
  /**
   * In-memory session cache: events seen this tab session (timelines, queries, fetches).
   * Larger cap + no TTL so navigation and repeat fetches reuse data until reload.
   */
  /** Timelines + note-stats; cap is platform-aware (see Cache settings). */
  private sessionEventCache = new LRUCache<string, NEvent>({ max: getDefaultSessionLruMaxSync() })
  /** Latest kind-0 per pubkey from {@link sessionEventCache} for batch profile short-circuit. */
  private sessionMetadataByPubkey = new Map<string, NEvent>()
  /** Callbacks waiting for an event id to appear in {@link sessionEventCache} (e.g. embed loads before timeline caches the note). */
  private sessionEventWaiters = new Map<string, Set<() => void>>()
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
   * Lowercase hex id for note/nevent/raw hex; `null` for naddr or invalid ids.
   */
  private resolveHexWaiterKey(id: string): string | null {
    const trimmed = id.trim()
    if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
    try {
      const { type, data } = nip19.decode(trimmed)
      if (type === 'note') return data
      if (type === 'nevent') return data.id
    } catch {
      /* invalid */
    }
    return null
  }

  /** Returns cached event or undefined; evicts stringified-JSON-object spam from the session LRU. */
  private getSessionEventIfAllowed(hexId: string): NEvent | undefined {
    const e = this.sessionEventCache.get(hexId)
    if (!e) return undefined
    if (shouldDropEventOnIngest(e)) {
      this.sessionEventCache.delete(hexId)
      return undefined
    }
    return e
  }

  private notifySessionEventWaiters(hexId: string): void {
    const waiters = this.sessionEventWaiters.get(hexId)
    if (!waiters?.size) return
    for (const cb of [...waiters]) {
      try {
        cb()
      } catch (e) {
        logger.warn('[EventService] sessionEventWaiter failed', { hexId: hexId.slice(0, 8), e })
      }
    }
  }

  /**
   * Read parent/root (or any) event from the session cache without removing it.
   * Accepts hex, note1, or nevent1 (not naddr).
   */
  peekSessionCachedEvent(noteId: string): NEvent | undefined {
    const hex = this.resolveHexWaiterKey(noteId.trim())
    if (!hex) return undefined
    return this.getSessionEventIfAllowed(hex)
  }

  /**
   * When an event with this id is added to the session cache, invoke `callback` (and when already cached).
   * Only supports hex, note1, and nevent1 (not naddr).
   */
  subscribeWhenSessionHasEvent(eventId: string, callback: () => void): () => void {
    const hex = this.resolveHexWaiterKey(eventId)
    if (!hex) return () => {}

    if (this.getSessionEventIfAllowed(hex)) {
      queueMicrotask(() => callback())
    }

    let set = this.sessionEventWaiters.get(hex)
    if (!set) {
      set = new Set()
      this.sessionEventWaiters.set(hex, set)
    }
    set.add(callback)
    return () => {
      set!.delete(callback)
      if (set!.size === 0) {
        this.sessionEventWaiters.delete(hex)
      }
    }
  }

  /**
   * Fetch single event by ID (hex, note1, nevent1, naddr1)
   */
  async fetchEvent(id: string): Promise<NEvent | undefined> {
    const trimmed = id.trim()
    let hexId: string | undefined
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      hexId = trimmed.toLowerCase()
    } else {
      try {
        const { type, data } = nip19.decode(trimmed)
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
      } catch {
        return undefined
      }
    }
    if (hexId) {
      const fromSession = this.getSessionEventIfAllowed(hexId)
      if (fromSession) return fromSession
      const cachedPromise = this.eventCacheMap.get(hexId)
      if (cachedPromise) {
        const resolved = await cachedPromise
        if (resolved && !shouldDropEventOnIngest(resolved)) return resolved
        const fromSessionAfterMiss = this.getSessionEventIfAllowed(hexId)
        if (fromSessionAfterMiss) return fromSessionAfterMiss
        const fromDb = await indexedDb.getEventFromPublicationStore(hexId)
        if (fromDb && !shouldDropEventOnIngest(fromDb)) {
          this.addEventToCache(fromDb)
          return fromDb
        }
        // Prior load() finished with undefined but left the promise in cacheMap — never retrying.
        this.eventDataLoader.clear(hexId)
      }
    }
    const loaded = await this.eventDataLoader.load(hexId ?? trimmed)
    if (hexId) {
      const fromSessionAfter = this.getSessionEventIfAllowed(hexId)
      if (fromSessionAfter) return fromSessionAfter
    }
    if (loaded && shouldDropEventOnIngest(loaded)) {
      return undefined
    }
    return loaded
  }

  /**
   * Invalidate DataLoader cache for this id so the next fetch hits IndexedDB/relays again.
   * (Otherwise a prior `undefined` result stays cached forever.)
   */
  private clearDataloaderCacheForFetchId(id: string): void {
    const trimmed = id.trim()
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      this.eventDataLoader.clear(trimmed.toLowerCase())
      return
    }
    try {
      const { type, data } = nip19.decode(trimmed)
      if (type === 'note') {
        this.eventDataLoader.clear(data)
      } else if (type === 'nevent') {
        this.eventDataLoader.clear(data.id)
      } else {
        this.eventDataLoader.clear(trimmed)
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Force retry fetch event
   */
  async fetchEventForceRetry(eventId: string): Promise<NEvent | undefined> {
    this.clearDataloaderCacheForFetchId(eventId)
    return this.fetchEvent(eventId)
  }

  /**
   * Batch-prefetch events by hex id into session cache (single REQ per chunk).
   * Used by feeds so embedded notes resolve without N parallel fetches.
   */
  async prefetchHexEventIds(rawIds: readonly string[]): Promise<void> {
    const hexIds = [
      ...new Set(
        rawIds
          .map((id) => id.trim().toLowerCase())
          .filter((id) => /^[0-9a-f]{64}$/.test(id))
      )
    ]
    let toFetch = hexIds.filter((id) => !this.getSessionEventIfAllowed(id))
    if (toFetch.length === 0) return

    const archived = await prefetchArchivedEvents(toFetch)
    for (const ev of archived) {
      if (!shouldDropEventOnIngest(ev)) this.addEventToCache(ev)
    }
    toFetch = toFetch.filter((id) => !this.getSessionEventIfAllowed(id))
    if (toFetch.length === 0) return

    const relayUrls = await buildComprehensiveRelayListForEvents(undefined, [], [], [])
    if (!relayUrls.length) return

    for (let i = 0; i < toFetch.length; i += PREFETCH_HEX_IDS_CHUNK) {
      const chunk = toFetch.slice(i, i + PREFETCH_HEX_IDS_CHUNK)
      const events = await this.queryService.query(
        relayUrls,
        { ids: chunk, limit: chunk.length },
        undefined,
        {
          immediateReturn: false,
          eoseTimeout: 2500,
          globalTimeout: 12000
        }
      )
      for (const ev of events) {
        this.addEventToCache(ev)
      }
    }
  }

  /**
   * REQ filter for searching a note/nevent/naddr/hex id on arbitrary relays.
   */
  private filterForExternalRelayFetch(noteId: string): Filter | null {
    const trimmed = noteId.trim()
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      return { ids: [trimmed.toLowerCase()], limit: 1 }
    }
    try {
      const { type, data } = nip19.decode(trimmed)
      if (type === 'note') return { ids: [data], limit: 1 }
      if (type === 'nevent') return { ids: [data.id], limit: 1 }
      if (type === 'naddr') {
        return {
          kinds: [data.kind],
          authors: [data.pubkey],
          '#d': [data.identifier],
          limit: 1
        }
      }
    } catch {
      /* invalid id */
    }
    return null
  }

  /**
   * Fetch event with external relays (hex, note1, nevent1, or naddr1)
   */
  async fetchEventWithExternalRelays(noteId: string, externalRelays: string[]): Promise<NEvent | undefined> {
    if (!externalRelays || externalRelays.length === 0) {
      logger.warn('fetchEventWithExternalRelays: No external relays provided', { noteId })
      return undefined
    }

    const filter = this.filterForExternalRelayFetch(noteId)
    if (!filter) {
      logger.warn('fetchEventWithExternalRelays: unparseable note id', {
        noteIdPrefix: noteId.slice(0, 24)
      })
      return undefined
    }

    const logKey =
      'ids' in filter && filter.ids?.[0]
        ? filter.ids[0].slice(0, 8)
        : `${filter.kinds?.[0]}:${(filter.authors?.[0] ?? '').slice(0, 8)}`

    logger.debug('fetchEventWithExternalRelays: Starting search', {
      noteIdKey: logKey,
      relayCount: externalRelays.length,
      relays: externalRelays
    })

    const startTime = Date.now()
    const events = await this.queryService.query(externalRelays, filter, undefined, {
      eoseTimeout: 10000,
      globalTimeout: 20000,
      immediateReturn: true
    })
    const duration = Date.now() - startTime

    logger.debug('fetchEventWithExternalRelays: Search completed', {
      noteIdKey: logKey,
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
    if (shouldDropEventOnIngest(event)) return
    const cleanEvent = { ...event }
    delete (cleanEvent as any).relayStatuses
    // REQ filters and nip19 decode use lowercase hex; some relays/clients emit uppercase ids.
    // Session lookups and waiters must use the same canonical key or embeds miss events already on the timeline.
    const id =
      /^[0-9a-f]{64}$/i.test(cleanEvent.id) ? cleanEvent.id.toLowerCase() : cleanEvent.id
    if (id !== cleanEvent.id) {
      ;(cleanEvent as NEvent).id = id
    }
    this.sessionEventCache.set(id, cleanEvent as NEvent)
    if (cleanEvent.kind === kinds.Metadata) {
      const pk = cleanEvent.pubkey.toLowerCase()
      const prev = this.sessionMetadataByPubkey.get(pk)
      if (!prev || cleanEvent.created_at >= prev.created_at) {
        this.sessionMetadataByPubkey.set(pk, cleanEvent as NEvent)
      }
    }
    this.notifySessionEventWaiters(id)
    queuePersistSeenEvent(cleanEvent as NEvent)
  }

  /** Apply {@link StorageKey.SESSION_EVENT_LRU_MAX} without reload (copies entries into a new LRU). */
  reapplySessionLruMax(): void {
    const max = getDefaultSessionLruMaxSync()
    const entries = [...this.sessionEventCache.entries()]
    this.sessionEventCache = new LRUCache<string, NEvent>({ max })
    for (const [k, v] of entries) {
      this.sessionEventCache.set(k, v)
    }
  }

  /** Kind 0 already ingested this session (e.g. from a timeline REQ). */
  getSessionMetadataForPubkey(hexPubkey: string): NEvent | undefined {
    const pk = hexPubkey.toLowerCase()
    const e = this.sessionMetadataByPubkey.get(pk)
    if (!e) return undefined
    if (shouldDropEventOnIngest(e)) {
      this.sessionMetadataByPubkey.delete(pk)
      return undefined
    }
    return e
  }

  /**
   * Pubkeys whose session-cached kind 0 matches a name / display_name / nip-05 substring (for search without IDB).
   */
  searchSessionProfilePubkeys(query: string, limit: number): string[] {
    const q = query.trim().toLowerCase()
    if (!q || limit <= 0) return []
    const out: string[] = []
    for (const ev of this.sessionMetadataByPubkey.values()) {
      if (shouldDropEventOnIngest(ev)) continue
      if (out.length >= limit) break
      try {
        const o = JSON.parse(ev.content) as Record<string, unknown>
        const blob = [
          o.display_name,
          o.name,
          typeof o.nip05 === 'string' ? o.nip05 : ''
        ]
          .map((x) => (typeof x === 'string' ? x : ''))
          .join(' ')
          .toLowerCase()
        if (blob.includes(q)) {
          out.push(ev.pubkey.toLowerCase())
        }
      } catch {
        /* invalid JSON */
      }
    }
    return out
  }

  /**
   * Get events from session cache matching search
   */
  getSessionEventsMatchingSearch(query: string, limit: number, allowedKinds?: number[]): NEvent[] {
    const results: NEvent[] = []
    const queryLower = query.toLowerCase()
    
    for (const [, event] of this.sessionEventCache.entries()) {
      if (shouldDropEventOnIngest(event)) continue
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
   * Kind 9735 in session LRU whose top-level `e` references the given hex event id (e.g. zap poll / note).
   * Used to show tally immediately when opening the note drawer after the feed already saw these receipts.
   */
  getSessionZapReceiptsForTargetEventId(targetEventHexId: string): NEvent[] {
    const id = targetEventHexId.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) return []
    const out: NEvent[] = []
    for (const [, event] of this.sessionEventCache.entries()) {
      if (event.kind !== kinds.Zap) continue
      if (shouldDropEventOnIngest(event)) continue
      const matches = event.tags.some(
        (t) => (t[0] === 'e' || t[0] === 'E') && t[1]?.toLowerCase() === id
      )
      if (matches) out.push(event)
    }
    return out
  }

  /**
   * WebSocket relay URLs from `e`-tag position 3 on session-cached events that reference this hex id.
   * Reactions often carry the publisher’s relay hint; without it, note-stats may miss kind 7 that never reached index relays.
   */
  getSessionRelayHintsForHexTarget(targetHexId: string): string[] {
    const id = targetHexId.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) return []
    const hints = new Set<string>()
    for (const [, event] of this.sessionEventCache.entries()) {
      if (shouldDropEventOnIngest(event)) continue
      for (const t of event.tags) {
        if (t[0] !== 'e' && t[0] !== 'E') continue
        if (t[1]?.toLowerCase() !== id) continue
        const raw = t[2]?.trim()
        if (!raw) continue
        const n = normalizeUrl(raw)
        if (n) hints.add(n)
      }
    }
    return [...hints]
  }

  /**
   * Reply-shaped events already in the session LRU for this thread (notes, kind 1111, voice comments, zaps),
   * found by BFS over e/E/q and (for `a`-root threads) a-tag links. Merges with relay fetches via ReplyProvider.
   */
  getSessionThreadInteractionEvents(
    root: { type: 'E'; id: string } | { type: 'A'; id: string; eventId: string } | { type: 'I'; id: string }
  ): NEvent[] {
    if (root.type === 'I') return []

    const threadKeys = new Set<string>()
    if (root.type === 'E') {
      const id = root.id.trim().toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(id)) return []
      threadKeys.add(id)
    } else {
      threadKeys.add(root.id.trim().toLowerCase())
      const aid = root.eventId.trim().toLowerCase()
      if (/^[0-9a-f]{64}$/.test(aid)) threadKeys.add(aid)
    }

    const linkRefs = (ev: NEvent): string[] => {
      const ids = new Set<string>()
      const add = (v?: string) => {
        if (v == null || v === '') return
        ids.add(v.trim().toLowerCase())
      }
      add(getParentETag(ev)?.[1])
      add(getRootETag(ev)?.[1])
      const qref = getQuotedReferenceFromQTags(ev)
      add(qref?.hexId)
      add(qref?.coordinate)
      if (ev.kind === kinds.Zap || ev.kind === kinds.Repost || ev.kind === ExtendedKind.GENERIC_REPOST) {
        add(getFirstHexEventIdFromETags(ev.tags))
      }
      if (
        ev.kind === kinds.ShortTextNote ||
        ev.kind === ExtendedKind.COMMENT ||
        ev.kind === ExtendedKind.VOICE_COMMENT
      ) {
        for (const t of ev.tags) {
          if ((t[0] === 'e' || t[0] === 'E') && t[1]) add(t[1])
        }
      }
      if (root.type === 'A') {
        add(getRootATag(ev)?.[1])
        add(getParentATag(ev)?.[1])
        for (const t of ev.tags) {
          if ((t[0] === 'a' || t[0] === 'A') && t[1]) add(t[1])
        }
      }
      return [...ids]
    }

    const seen = new Set<string>()
    const out: NEvent[] = []
    const maxRounds = 14
    for (let round = 0; round < maxRounds; round++) {
      let added = 0
      for (const [, ev] of this.sessionEventCache.entries()) {
        if (shouldDropEventOnIngest(ev)) continue
        const threadishKind1Quote =
          (root.type === 'E' || root.type === 'A') && kind1QuotesThreadRoot(ev, root)
        if (!isReplyNoteEvent(ev) && !threadishKind1Quote && !isNip25ReactionKind(ev.kind))
          continue
        if (seen.has(ev.id)) continue
        if (!linkRefs(ev).some((id) => threadKeys.has(id))) continue
        out.push(ev)
        seen.add(ev.id)
        added++
        const eid = ev.id.trim().toLowerCase()
        if (/^[0-9a-f]{64}$/.test(eid)) threadKeys.add(eid)
        if (root.type === 'A') {
          for (const t of ev.tags) {
            if ((t[0] === 'a' || t[0] === 'A') && t[1]) {
              threadKeys.add(t[1].trim().toLowerCase())
            }
          }
        }
      }
      if (added === 0) break
    }
    return out
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
    this.sessionMetadataByPubkey.clear()
    this.eventCacheMap.clear()
    this.sessionEventWaiters.clear()
    this.fetchEventFromBigRelaysDataloader.clearAll()
    invalidateArchiveFootprintCache()
    logger.info('[EventService] In-memory caches cleared')
  }

  /**
   * Private: Fetch event by ID (internal implementation)
   */
  private async _fetchEvent(id: string): Promise<NEvent | undefined> {
    let filter: Filter | undefined
    let relays: string[] = []
    
    if (/^[0-9a-f]{64}$/i.test(id)) {
      filter = { ids: [id.toLowerCase()], limit: 1 }
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

    if (filter.ids?.length === 1) {
      const hid = filter.ids[0]!.toLowerCase()
      if (/^[0-9a-f]{64}$/.test(hid)) {
        const fromArchive = await loadArchivedEventForFetch(hid)
        if (fromArchive && !shouldDropEventOnIngest(fromArchive)) {
          this.addEventToCache(fromArchive)
          return fromArchive
        }
      }
    }

    // Try cache first
    if (filter.ids?.length) {
      const cached = await indexedDb.getEventFromPublicationStore(filter.ids[0])
      if (cached && !shouldDropEventOnIngest(cached)) {
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
      if (event && !shouldDropEventOnIngest(event)) {
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
    if (event && !shouldDropEventOnIngest(event)) {
      this.addEventToCache(event)
      return event
    }

    // Another code path (e.g. feed prefetch) may have populated session while we were in-flight.
    if (filter.ids?.length === 1) {
      const raw = filter.ids[0]
      const key = /^[0-9a-f]{64}$/i.test(raw) ? raw.toLowerCase() : raw
      const sess = this.getSessionEventIfAllowed(key)
      if (sess) return sess
    }

    return undefined
  }

  /**
   * Private: Try harder to fetch event from relays
   * Uses: hints, seen, author relays when known, user's inboxes + cache, fast read + searchable relays.
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
      eoseTimeout: isSingleEventById ? 1500 : 500,
      globalTimeout: isSingleEventById ? 12000 : 10000
    })
    
    const event = events
      .filter((e) => !shouldDropEventOnIngest(e))
      .sort((a, b) => b.created_at - a.created_at)[0]
    
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
   * Uses same comprehensive list as single-event fetch (inboxes, fast read, searchable, cache).
   */
  private async fetchEventsFromBigRelays(ids: readonly string[]): Promise<(NEvent | undefined)[]> {
    const normalized = ids.map((id) => (/^[0-9a-f]{64}$/i.test(id) ? id.toLowerCase() : id))
    const fromSession = normalized.map((k) => this.getSessionEventIfAllowed(k))
    const missingIndices: number[] = []
    for (let i = 0; i < normalized.length; i++) {
      if (!fromSession[i]) missingIndices.push(i)
    }
    if (missingIndices.length === 0) {
      return fromSession as NEvent[]
    }

    // Build comprehensive relay list (user's inboxes + defaults)
    // Note: For batch fetches, we don't have author info, so we use user's inboxes + defaults
    const relayUrls = await buildComprehensiveRelayListForEvents(undefined, [], [], [])

    const missingIds = missingIndices.map((i) => normalized[i]!)
    const isSingleEventFetch = missingIds.length === 1
    // For single-event fetches, always use immediateReturn to return ASAP
    // This is especially important for non-replaceable events (not in 10000-19999 or 30000-39999 ranges)
    const events = await this.queryService.query(
      relayUrls,
      {
        ids: Array.from(new Set(missingIds)),
        limit: missingIds.length
      },
      undefined,
      {
        immediateReturn: isSingleEventFetch,
        eoseTimeout: isSingleEventFetch ? 1500 : 500,
        globalTimeout: isSingleEventFetch ? 12000 : 10000
      }
    )

    const fetchedById = new Map<string, NEvent>()
    for (const event of events) {
      if (shouldDropEventOnIngest(event)) continue
      const key = /^[0-9a-f]{64}$/i.test(event.id) ? event.id.toLowerCase() : event.id
      fetchedById.set(key, event)
      this.addEventToCache(event)
    }

    return normalized.map((k, i) => fromSession[i] ?? fetchedById.get(k))
  }
}
