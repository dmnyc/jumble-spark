import {
  FEED_FIRST_RELAY_RESULT_GRACE_MIN_LIMIT,
  FIRST_RELAY_RESULT_GRACE_MS,
  KIND_1_BLOCKED_RELAY_URLS,
  MAX_CONCURRENT_RELAY_CONNECTIONS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import { isStringifiedJsonObjectContentNostrEvent } from '@/lib/event-ingest-filter'
import logger from '@/lib/logger'
import { normalizeUrl } from '@/lib/url'
import type { Filter, Event as NEvent } from 'nostr-tools'
import { SimplePool, EventTemplate, VerifiedEvent } from 'nostr-tools'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import nip66Service from './nip66.service'
import type { ISigner, TSignerType } from '@/types'

/** NIP-01 filter keys only; NIP-50 adds `search` which non-searchable relays reject. */
function filterForRelay(f: Filter, relaySupportsSearch: boolean): Filter {
  if (relaySupportsSearch) return f
  const { search: _search, ...rest } = f
  return rest as Filter
}

export interface QueryOptions {
  eoseTimeout?: number
  globalTimeout?: number
  /** For replaceable events: race strategy - wait after first result, then return best (per author when batching) */
  replaceableRace?: boolean
  /** Ms to wait after the first event when replaceableRace is true (lets other relays return a newer version) */
  replaceableRaceWaitMs?: number
  /** For non-replaceable single events: return immediately on first match */
  immediateReturn?: boolean
  /**
   * Multi-relay feed / batch: after first event, wait this many ms then close and return.
   * `false` disables (wait for normal EOSE / global timeout). When omitted, implicit grace uses
   * {@link FIRST_RELAY_RESULT_GRACE_MS} only if the largest filter `limit` is at least
   * {@link FEED_FIRST_RELAY_RESULT_GRACE_MIN_LIMIT} (and not replaceableRace / immediateReturn / single-event fetch).
   */
  firstRelayResultGraceMs?: number | false
}

export interface SubscribeCallbacks {
  onevent?: (evt: NEvent) => void
  oneose?: (eosed: boolean) => void
  onclose?: (url: string, reason: string) => void
  startLogin?: () => void
  onAllClose?: (reasons: string[]) => void
}

export class QueryService {
  private pool: SimplePool
  private signer?: ISigner
  private signerType?: TSignerType
  
  /** Max concurrent REQ subscriptions per relay URL */
  private static readonly MAX_CONCURRENT_SUBS_PER_RELAY = MAX_CONCURRENT_RELAY_CONNECTIONS
  private activeSubCountByRelay = new Map<string, number>()
  private subSlotWaitQueueByRelay = new Map<string, Array<() => void>>()
  private eventSeenOnRelays = new Map<string, Set<string>>()

  /** App-wide cap on parallel ensureRelay + initial subscribe setup (any relay). */
  private globalRelayConnectionSlotsInUse = 0
  private globalRelayConnectionWaitQueue: Array<() => void> = []

  async acquireGlobalRelayConnectionSlot(): Promise<void> {
    if (this.globalRelayConnectionSlotsInUse < MAX_CONCURRENT_RELAY_CONNECTIONS) {
      this.globalRelayConnectionSlotsInUse++
      return
    }
    await new Promise<void>((resolve) => {
      this.globalRelayConnectionWaitQueue.push(() => {
        this.globalRelayConnectionSlotsInUse++
        resolve()
      })
    })
  }

  releaseGlobalRelayConnectionSlot(): void {
    this.globalRelayConnectionSlotsInUse = Math.max(0, this.globalRelayConnectionSlotsInUse - 1)
    const next = this.globalRelayConnectionWaitQueue.shift()
    if (next) next()
  }

  constructor(pool: SimplePool) {
    this.pool = pool
  }

  setSigner(signer: ISigner | undefined, signerType: TSignerType | undefined) {
    this.signer = signer
    this.signerType = signerType
  }

  private canSignerAuthenticateRelay(): boolean {
    if (!this.signer) return false
    if (this.signerType === 'npub') return false
    return true
  }

  async acquireSubSlot(relayKey: string): Promise<void> {
    const count = this.activeSubCountByRelay.get(relayKey) ?? 0
    if (count < QueryService.MAX_CONCURRENT_SUBS_PER_RELAY) {
      this.activeSubCountByRelay.set(relayKey, count + 1)
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      let queue = this.subSlotWaitQueueByRelay.get(relayKey)
      if (!queue) {
        queue = []
        this.subSlotWaitQueueByRelay.set(relayKey, queue)
      }
      queue.push(() => {
        const n = this.activeSubCountByRelay.get(relayKey) ?? 0
        this.activeSubCountByRelay.set(relayKey, n + 1)
        resolve()
      })
    })
  }

  releaseSubSlot(relayKey: string): void {
    const count = (this.activeSubCountByRelay.get(relayKey) ?? 1) - 1
    this.activeSubCountByRelay.set(relayKey, Math.max(0, count))
    const queue = this.subSlotWaitQueueByRelay.get(relayKey)
    if (queue?.length) {
      const next = queue.shift()!
      next()
    }
  }

  trackEventSeenOn(eventId: string, relay: AbstractRelay): void {
    const url = relay.url
    let set = this.eventSeenOnRelays.get(eventId)
    if (!set) {
      set = new Set()
      this.eventSeenOnRelays.set(eventId, set)
    }
    set.add(url)
  }

  getSeenEventRelayUrls(eventId: string): string[] {
    return Array.from(this.eventSeenOnRelays.get(eventId) ?? [])
  }

  /**
   * Core query method with race-based fetching strategies
   */
  async query(
    urls: string[], 
    filter: Filter | Filter[], 
    onevent?: (evt: NEvent) => void,
    options?: QueryOptions
  ): Promise<NEvent[]> {
    const eoseTimeout = options?.eoseTimeout ?? 500
    const globalTimeout = options?.globalTimeout ?? 10000
    const replaceableRace = options?.replaceableRace ?? false
    const replaceableRaceWaitMs = options?.replaceableRaceWaitMs ?? FIRST_RELAY_RESULT_GRACE_MS
    const immediateReturn = options?.immediateReturn ?? false
    const isExternalSearch = eoseTimeout > 1000
    
    if (isExternalSearch) {
      logger.debug('query: Starting external relay search', {
        relayCount: urls.length,
        relays: urls,
        eoseTimeout,
        globalTimeout,
        replaceableRace,
        immediateReturn,
        filter: Array.isArray(filter) ? filter : [filter]
      })
    }
    
    const filtersForGrace = Array.isArray(filter) ? filter : [filter]
    const maxLimitForGrace = Math.max(...filtersForGrace.map((f) => (f.limit ?? 0) as number), 0)
    const isSingleEventFetchForGrace = maxLimitForGrace === 1
    const useImplicitFeedFirstRelayGrace =
      maxLimitForGrace >= FEED_FIRST_RELAY_RESULT_GRACE_MIN_LIMIT && !isSingleEventFetchForGrace
    const feedGraceMsResolved: number | null =
      options?.firstRelayResultGraceMs === false
        ? null
        : typeof options?.firstRelayResultGraceMs === 'number'
          ? options.firstRelayResultGraceMs
          : !replaceableRace && !immediateReturn && useImplicitFeedFirstRelayGrace
            ? FIRST_RELAY_RESULT_GRACE_MS
            : null

    return await new Promise<NEvent[]>((resolve) => {
      const events: NEvent[] = []
      let resolveTimeout: ReturnType<typeof setTimeout> | null = null
      let firstResultGraceTimeoutId: ReturnType<typeof setTimeout> | null = null
      let feedFirstResultGraceTimeoutId: ReturnType<typeof setTimeout> | null = null
      let replaceableRaceTimeoutId: ReturnType<typeof setTimeout> | null = null
      let allEosed = false
      let eventCount = 0
      let resolved = false
      let firstResultTime: number | null = null
      let globalTimeoutId: ReturnType<typeof setTimeout> | null = null

      const resolveReplaceableRaceEvents = (): NEvent[] => {
        if (events.length === 0) return events
        const filters = Array.isArray(filter) ? filter : [filter]
        const authorSet = new Set<string>()
        for (const f of filters) {
          if (f.authors) {
            for (const a of f.authors) {
              if (a) authorSet.add(a)
            }
          }
        }
        // Batch profile / replaceable fetch: keep the newest event per pubkey (not one global "winner")
        if (authorSet.size > 1) {
          const byPk = new Map<string, NEvent>()
          for (const e of events) {
            if (!authorSet.has(e.pubkey)) continue
            const prev = byPk.get(e.pubkey)
            if (!prev || e.created_at > prev.created_at) {
              byPk.set(e.pubkey, e)
            }
          }
          return Array.from(byPk.values())
        }
        const bestEvent = events.reduce((best, current) =>
          current.created_at > best.created_at ? current : best
        )
        return [bestEvent]
      }

      const resolveWithEvents = () => {
        if (resolved) return
        resolved = true
        if (resolveTimeout) clearTimeout(resolveTimeout)
        if (firstResultGraceTimeoutId) clearTimeout(firstResultGraceTimeoutId)
        if (feedFirstResultGraceTimeoutId) clearTimeout(feedFirstResultGraceTimeoutId)
        if (replaceableRaceTimeoutId) clearTimeout(replaceableRaceTimeoutId)
        if (globalTimeoutId) clearTimeout(globalTimeoutId)
        
        sub.close()
        
        if (replaceableRace && events.length > 0) {
          resolve(resolveReplaceableRaceEvents())
        } else {
          resolve(events)
        }
      }

      const sub = this.subscribe(urls, filter, {
        onevent(evt) {
          eventCount++
          onevent?.(evt)
          events.push(evt)

          if (firstResultTime === null) {
            firstResultTime = Date.now()
          }

          const filters = Array.isArray(filter) ? filter : [filter]
          const maxLimit = Math.max(...filters.map((f) => (f.limit ?? 0) as number), 0)
          const isSingleEventFetch = maxLimit === 1
          const hasIdFilter = filters.some(f => f.ids && f.ids.length > 0)

          // For immediateReturn: return as soon as we find the event
          // This is critical for non-replaceable events (not in 10000-19999 or 30000-39999 ranges)
          // which should be rendered ASAP
          if (immediateReturn && hasIdFilter && isSingleEventFetch && events.length > 0) {
            resolveWithEvents()
            return
          }

          if (replaceableRace && firstResultTime !== null && !replaceableRaceTimeoutId) {
            replaceableRaceTimeoutId = setTimeout(() => {
              replaceableRaceTimeoutId = null
              resolveWithEvents()
            }, replaceableRaceWaitMs)
          }

          if (
            feedGraceMsResolved != null &&
            events.length >= 1 &&
            !feedFirstResultGraceTimeoutId &&
            !replaceableRace
          ) {
            feedFirstResultGraceTimeoutId = setTimeout(() => {
              feedFirstResultGraceTimeoutId = null
              resolveWithEvents()
            }, feedGraceMsResolved)
          }

          if (!replaceableRace && !immediateReturn && isSingleEventFetch && events.length === 1 && !firstResultGraceTimeoutId) {
            firstResultGraceTimeoutId = setTimeout(() => {
              firstResultGraceTimeoutId = null
              resolveWithEvents()
            }, FIRST_RELAY_RESULT_GRACE_MS)
          }

          if (hasIdFilter && isSingleEventFetch && events.length > 0 && allEosed && !replaceableRace && !immediateReturn) {
            if (firstResultGraceTimeoutId) clearTimeout(firstResultGraceTimeoutId)
            if (resolveTimeout) clearTimeout(resolveTimeout)
            resolveTimeout = setTimeout(() => resolveWithEvents(), 100)
          }
        },
        oneose: (eosed) => {
          if (eosed) {
            allEosed = true
            
            if (replaceableRace) {
              if (events.length > 0 && replaceableRaceTimeoutId) return
              if (events.length > 0) {
                resolveWithEvents()
                return
              }
            }
            
            if (immediateReturn && events.length > 0) {
              resolveWithEvents()
              return
            }
            
            if (firstResultGraceTimeoutId) clearTimeout(firstResultGraceTimeoutId)
            if (feedFirstResultGraceTimeoutId) clearTimeout(feedFirstResultGraceTimeoutId)
            if (resolveTimeout) clearTimeout(resolveTimeout)
            resolveTimeout = setTimeout(() => resolveWithEvents(), eoseTimeout)
          }
        },
        onclose: (_url, _reason) => {
          if (allEosed) return
          if (events.length > 0 && !resolveTimeout) {
            resolveTimeout = setTimeout(() => resolveWithEvents(), 1000)
          }
        }
      })
      
      globalTimeoutId = setTimeout(() => resolveWithEvents(), globalTimeout)
    })
  }

  /**
   * Subscribe to events from relays
   */
  subscribe(
    urls: string[],
    filter: Filter | Filter[],
    callbacks: SubscribeCallbacks
  ): { close: () => void } {
    let relays = Array.from(new Set(urls))
    const filters = Array.isArray(filter) ? filter : [filter]

    const hasKind1 = filters.some((f) => f.kinds && (Array.isArray(f.kinds) ? f.kinds.includes(1) : f.kinds === 1))
    if (hasKind1 && KIND_1_BLOCKED_RELAY_URLS.length > 0) {
      const kind1BlockedSet = new Set(KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
      relays = relays.filter((url) => !kind1BlockedSet.has(normalizeUrl(url) || url))
    }

    const _knownIds = new Set<string>()
    const grouped = new Map<string, Filter[]>()
    for (const url of relays) {
      const key = normalizeUrl(url) || url
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(...filters)
    }
    
    const searchableSet = new Set([
      ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u),
      ...nip66Service.getSearchableRelayUrls().map((u) => normalizeUrl(u) || u)
    ])
    
    const groupedRequests = Array.from(grouped.entries()).map(([url, f]) => {
      const relaySupportsSearch = searchableSet.has(url) || nip66Service.isRelaySearchable(url)
      const filtersForRelay = f.map((one) => filterForRelay(one, relaySupportsSearch))
      return { url, filters: filtersForRelay }
    })

    const eosesReceived: boolean[] = []
    const closesReceived: (string | undefined)[] = []
    const handleEose = (i: number) => {
      if (eosesReceived[i]) return
      eosesReceived[i] = true
      if (eosesReceived.filter(Boolean).length === groupedRequests.length) {
        callbacks.oneose?.(true)
      }
    }
    const handleClose = (i: number, reason: string) => {
      if (closesReceived[i] !== undefined) return
      handleEose(i)
      closesReceived[i] = reason
      const { url } = groupedRequests[i]!
      callbacks.onclose?.(url, reason)
      if (closesReceived.every((r) => r !== undefined)) {
        callbacks.onAllClose?.(closesReceived as string[])
      }
    }

    const localAlreadyHaveEvent = (id: string) => {
      const have = _knownIds.has(id)
      if (have) return true
      _knownIds.add(id)
      return false
    }

    const forwardOnevent = callbacks.onevent
      ? (evt: NEvent) => {
          if (isStringifiedJsonObjectContentNostrEvent(evt)) return
          callbacks.onevent!(evt)
        }
      : undefined

    const subs: { relayKey: string; close: () => void }[] = []
    const allOpened = Promise.all(
      groupedRequests.map(async ({ url, filters: relayFilters }, i) => {
        await this.acquireGlobalRelayConnectionSlot()
        try {
          const relayKey = normalizeUrl(url) || url
          await this.acquireSubSlot(relayKey)
          let relay: AbstractRelay
          try {
            relay = await this.pool.ensureRelay(url, { connectionTimeout: 5000 })
          } catch (err) {
            this.releaseSubSlot(relayKey)
            handleClose(i, (err as Error)?.message ?? String(err))
            return
          }

          let slotReleased = false
          const releaseOnce = () => {
            if (!slotReleased) {
              slotReleased = true
              this.releaseSubSlot(relayKey)
            }
          }

          const sub = relay.subscribe(relayFilters, {
            receivedEvent: (_relay, id) => this.trackEventSeenOn(id, _relay),
            onevent: (evt: NEvent) => forwardOnevent?.(evt),
            oneose: () => handleEose(i),
            onclose: (reason: string) => {
              releaseOnce()
              if (reason.startsWith('auth-required: ') && this.canSignerAuthenticateRelay()) {
                relay
                  .auth(async (authEvt: EventTemplate) => {
                    const evt = await this.signer!.signEvent(authEvt)
                    if (!evt) throw new Error('sign event failed')
                    return evt as VerifiedEvent
                  })
                  .then(async () => {
                    await this.acquireGlobalRelayConnectionSlot()
                    try {
                      await this.acquireSubSlot(relayKey)
                      let liveRelay: AbstractRelay
                      try {
                        liveRelay = await this.pool.ensureRelay(url, { connectionTimeout: 5000 })
                      } catch (err) {
                        this.releaseSubSlot(relayKey)
                        handleClose(i, (err as Error)?.message ?? String(err))
                        return
                      }
                      let slotReleased2 = false
                      const releaseSlot2 = () => {
                        if (!slotReleased2) {
                          slotReleased2 = true
                          this.releaseSubSlot(relayKey)
                        }
                      }
                      try {
                        const sub2 = liveRelay.subscribe(relayFilters, {
                          receivedEvent: (_relay, id) => this.trackEventSeenOn(id, _relay),
                          onevent: (evt: NEvent) => forwardOnevent?.(evt),
                          oneose: () => handleEose(i),
                          onclose: (reason2: string) => {
                            releaseSlot2()
                            handleClose(i, reason2)
                          },
                          alreadyHaveEvent: localAlreadyHaveEvent,
                          eoseTimeout: 10_000
                        })
                        subs.push({
                          relayKey,
                          close: () => {
                            releaseSlot2()
                            sub2.close()
                          }
                        })
                      } catch (err) {
                        releaseSlot2()
                        handleClose(i, (err as Error)?.message ?? String(err))
                      }
                    } finally {
                      this.releaseGlobalRelayConnectionSlot()
                    }
                  })
                  .catch((err) => {
                    handleClose(i, `auth failed: ${(err as Error)?.message ?? err}`)
                  })
                return
              }
              if (reason.startsWith('auth-required: ')) {
                callbacks.startLogin?.()
              }
              handleClose(i, reason)
            },
            alreadyHaveEvent: localAlreadyHaveEvent,
            eoseTimeout: 10_000
          })
          subs.push({
            relayKey,
            close: () => {
              releaseOnce()
              sub.close()
            }
          })
        } finally {
          this.releaseGlobalRelayConnectionSlot()
        }
      })
    )

    return {
      close: () => {
        allOpened.then(() => {
          subs.forEach(({ close: subClose }) => subClose())
        })
      }
    }
  }

  /**
   * Fetch events with caching support
   */
  async fetchEvents(
    urls: string[],
    filter: Filter | Filter[],
    options?: {
      onevent?: (evt: NEvent) => void
    } & QueryOptions
  ): Promise<NEvent[]> {
    let relays = Array.from(new Set(urls))
    if (relays.length === 0) {
      const { FAST_READ_RELAY_URLS } = await import('@/constants')
      relays = [...FAST_READ_RELAY_URLS]
    }
    const filters = Array.isArray(filter) ? filter : [filter]
    const hasKind1 = filters.some((f) => f.kinds && (Array.isArray(f.kinds) ? f.kinds.includes(1) : f.kinds === 1))
    if (hasKind1 && KIND_1_BLOCKED_RELAY_URLS.length > 0) {
      const kind1BlockedSet = new Set(KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
      relays = relays.filter((url) => !kind1BlockedSet.has(normalizeUrl(url) || url))
    }
    const { onevent, ...queryOpts } = options ?? {}
    return this.query(relays, filter, onevent, queryOpts)
  }
}
