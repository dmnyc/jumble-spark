import { BIG_RELAY_URLS, BOOKSTR_RELAY_URLS, ExtendedKind, FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS, NIP66_DISCOVERY_RELAY_URLS, PROFILE_FETCH_RELAY_URLS, PROFILE_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'

/** NIP-01 filter keys only; NIP-50 adds `search` which non-searchable relays reject. */
function filterForRelay(f: Filter, relaySupportsSearch: boolean): Filter {
  if (relaySupportsSearch) return f
  const { search: _search, ...rest } = f
  return rest as Filter
}
import {
  compareEvents,
  getReplaceableCoordinate,
  getReplaceableCoordinateFromEvent,
  isReplaceableEvent
} from '@/lib/event'
import { getProfileFromEvent, getRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { formatPubkey, isValidPubkey, pubkeyToNpub, userIdToPubkey } from '@/lib/pubkey'
import { getPubkeysFromPTags, getServersFromServerTags, tagNameEquals } from '@/lib/tag'
import { isLocalNetworkUrl, isWebsocketUrl, normalizeUrl, simplifyUrl } from '@/lib/url'
import { isSafari } from '@/lib/utils'
import { ISigner, TProfile, TPublishOptions, TRelayList, TMailboxRelay, TSubRequestFilter } from '@/types'
import { sha256 } from '@noble/hashes/sha2'
import DataLoader from 'dataloader'
import dayjs from 'dayjs'
import FlexSearch from 'flexsearch'
import { LRUCache } from 'lru-cache'
import {
  EventTemplate,
  Filter,
  kinds,
  matchFilters,
  Event as NEvent,
  nip19,
  Relay,
  SimplePool,
  VerifiedEvent
} from 'nostr-tools'
import { AbstractRelay } from 'nostr-tools/abstract-relay'
import indexedDb, { StoreNames } from './indexed-db.service'
import nip66Service from './nip66.service'

type TTimelineRef = [string, number]

class ClientService extends EventTarget {
  static instance: ClientService

  signer?: ISigner
  pubkey?: string
  private pool: SimplePool

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
  private replaceableEventCacheMap = new Map<string, NEvent>()
  private eventCacheMap = new Map<string, Promise<NEvent | undefined>>()
  private relayListRequestCache = new Map<string, Promise<TRelayList>>() // Cache in-flight relay list requests
  private eventDataLoader = new DataLoader<string, NEvent | undefined>(
    (ids) => Promise.all(ids.map((id) => this._fetchEvent(id))),
    { cacheMap: this.eventCacheMap }
  )
  private fetchEventFromBigRelaysDataloader = new DataLoader<string, NEvent | undefined>(
    this.fetchEventsFromBigRelays.bind(this),
    { cache: false, batchScheduleFn: (callback) => setTimeout(callback, 50) }
  )
  private userIndex = new FlexSearch.Index({
    tokenize: 'forward'
  })

  /** Max concurrent REQ subscriptions per relay (many relays enforce ~10; we stay under to avoid NOTICE/rejection) */
  private static readonly MAX_CONCURRENT_SUBS_PER_RELAY = 8
  private activeSubCountByRelay = new Map<string, number>()
  private subSlotWaitQueueByRelay = new Map<string, Array<() => void>>()

  constructor() {
    super()
    this.pool = new SimplePool()
    this.pool.trackRelays = true
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
    this.fetchNip66RelayDiscovery().catch(() => {})
  }

  /** NIP-66: fetch relay discovery events (30166) in background to supplement search/NIP support. */
  private async fetchNip66RelayDiscovery(): Promise<void> {
    try {
      const discoveryRelays = Array.from(new Set([...BIG_RELAY_URLS, ...NIP66_DISCOVERY_RELAY_URLS]))
      const events = await this.query(
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

  /**
   * NIP-66: fetch 30166 events for a single relay (relay info page). Uses discovery relay set,
   * filter by #d so we get the newest report for this relay and can show monitor (author) info.
   */
  async fetchNip66DiscoveryForRelay(relayUrl: string): Promise<void> {
    const discoveryRelays = Array.from(new Set([...BIG_RELAY_URLS, ...NIP66_DISCOVERY_RELAY_URLS]))
    const dTag = normalizeUrl(relayUrl) || relayUrl
    const shortForm = simplifyUrl(dTag)
    const dValues = dTag !== shortForm ? [dTag, shortForm] : [dTag]
    try {
      const events = await this.query(
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

  /**
   * Acquire a slot to open a new subscription to the given relay. Resolves when we're under the per-relay limit.
   * Call releaseSubSlot(relayKey) when the subscription closes (user close() or relay onclose).
   */
  private acquireSubSlot(relayKey: string): Promise<void> {
    const count = this.activeSubCountByRelay.get(relayKey) ?? 0
    if (count < ClientService.MAX_CONCURRENT_SUBS_PER_RELAY) {
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

  /**
   * Release a subscription slot for the relay. Wakes the next waiter if any.
   */
  private releaseSubSlot(relayKey: string): void {
    const count = (this.activeSubCountByRelay.get(relayKey) ?? 1) - 1
    this.activeSubCountByRelay.set(relayKey, Math.max(0, count))
    const queue = this.subSlotWaitQueueByRelay.get(relayKey)
    if (queue?.length) {
      const next = queue.shift()!
      next()
    }
  }

  /**
   * Determine which relays to publish an event to.
   * Fallbacks (used when user relay list is empty or fetch fails):
   * - General events (reactions, notes, etc.): FAST_WRITE_RELAY_URLS
   * - Relay list / cache relays / contacts: BIG_RELAY_URLS + PROFILE_RELAY_URLS (added to additional)
   * - Favorite relays: FAST_WRITE_RELAY_URLS (added to additional)
   * - Report events: FAST_WRITE_RELAY_URLS when no user/seen relays
   */
  async determineTargetRelays(
    event: NEvent,
    { specifiedRelayUrls, additionalRelayUrls }: TPublishOptions = {}
  ) {
    if (event.kind === kinds.RelayList) {
      logger.info('[DetermineTargetRelays] Determining target relays for relay list event', {
        pubkey: event.pubkey?.substring(0, 8),
        hasSpecifiedRelays: !!specifiedRelayUrls?.length,
        specifiedRelayCount: specifiedRelayUrls?.length ?? 0,
        hasAdditionalRelays: !!additionalRelayUrls?.length,
        additionalRelayCount: additionalRelayUrls?.length ?? 0
      })
    }
    // For Report events, always include user's write relays first, then add seen relays if they're write-capable
    if (event.kind === kinds.Report) {
      // Start with user's write relays (outboxes) - these are the primary targets for reports
      const relayList = await this.fetchRelayList(event.pubkey)
      const userWriteRelays = relayList?.write.slice(0, 10) ?? []
      
      // Get seen relays where the reported event was found
      const targetEventId = event.tags.find(tagNameEquals('e'))?.[1]
      const seenRelays: string[] = []
      
      if (targetEventId) {
        const allSeenRelays = this.getSeenEventRelayUrls(targetEventId)
        // Filter seen relays: only include those that are in user's write list
        // This ensures we don't try to publish to read-only relays
        const userWriteRelaySet = new Set(userWriteRelays.map(url => normalizeUrl(url) || url))
        seenRelays.push(...allSeenRelays.filter(url => {
          const normalized = normalizeUrl(url) || url
          return userWriteRelaySet.has(normalized)
        }))
      }
      
      // Combine: user's write relays first (primary), then seen write relays (additional context)
      const reportRelays = Array.from(new Set([
        ...userWriteRelays,
        ...seenRelays
      ]))
      
      // If we still don't have any relays, fall back to fast write relays
      if (reportRelays.length === 0) {
        reportRelays.push(...FAST_WRITE_RELAY_URLS)
      }
      
      return reportRelays
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
        logger.debug('[DetermineTargetRelays] Relay list event detected, adding BIG_RELAY_URLS and PROFILE_RELAY_URLS', {
          kind: event.kind,
          bigRelays: BIG_RELAY_URLS,
          profileRelays: PROFILE_RELAY_URLS,
          additionalRelayCount: _additionalRelayUrls.length
        })
      } else if (event.kind === ExtendedKind.FAVORITE_RELAYS) {
        // Use fast write relays for favorite relays to avoid timeouts and payment requirements
        _additionalRelayUrls.push(...FAST_WRITE_RELAY_URLS)
        logger.debug('[DetermineTargetRelays] Favorite relays event detected, adding FAST_WRITE_RELAY_URLS', {
          kind: event.kind,
          fastWriteRelays: FAST_WRITE_RELAY_URLS,
          additionalRelayCount: _additionalRelayUrls.length
        })
      } else if (event.kind === ExtendedKind.RSS_FEED_LIST) {
        _additionalRelayUrls.push(...FAST_WRITE_RELAY_URLS, ...PROFILE_RELAY_URLS)
      }

      if (event.kind === kinds.RelayList || event.kind === ExtendedKind.FAVORITE_RELAYS) {
        logger.debug('[DetermineTargetRelays] Fetching user relay list for event publication', {
          pubkey: event.pubkey?.substring(0, 8),
          kind: event.kind
        })
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
      if (event.kind === kinds.RelayList || event.kind === ExtendedKind.FAVORITE_RELAYS) {
        logger.debug('[DetermineTargetRelays] User relay list fetched', {
          hasRelayList: !!relayList,
          writeRelayCount: relayList?.write?.length ?? 0,
          readRelayCount: relayList?.read?.length ?? 0,
          writeRelays: relayList?.write?.slice(0, 10) ?? []
        })
      }
      relays = (relayList?.write.slice(0, 10) ?? []).concat(
        Array.from(new Set(_additionalRelayUrls)) ?? []
      )
      if (event.kind === kinds.RelayList || event.kind === ExtendedKind.FAVORITE_RELAYS) {
        logger.info('[DetermineTargetRelays] Final relay list for event publication', {
          kind: event.kind,
          totalRelayCount: relays.length,
          userWriteRelays: relayList?.write?.slice(0, 10) ?? [],
          additionalRelays: Array.from(new Set(_additionalRelayUrls)),
          allRelays: relays
        })
      }
    }

    // Fallback for all publishing when no relays (e.g. after cache clear or fetch failure).
    // Use FAST_WRITE_RELAY_URLS so writes always have known-good write relays.
    if (!relays.length) {
      relays = [...FAST_WRITE_RELAY_URLS]
      logger.info('[DetermineTargetRelays] Using default write relays (no user/extra relays)', {
        count: relays.length
      })
    }

    return relays
  }

  async publishEvent(relayUrls: string[], event: NEvent) {
    logger.debug('[PublishEvent] Starting publishEvent', {
      eventId: event.id?.substring(0, 8),
      kind: event.kind,
      relayCount: relayUrls.length
    })
    
    const uniqueRelayUrls = Array.from(new Set(relayUrls))
    if (event.kind === kinds.RelayList || event.kind === ExtendedKind.FAVORITE_RELAYS) {
      logger.info('[PublishEvent] Publishing event to relays', {
        eventId: event.id?.substring(0, 8),
        kind: event.kind,
        totalRelayCount: uniqueRelayUrls.length,
        allRelays: uniqueRelayUrls
      })
    } else {
      logger.debug('[PublishEvent] Unique relays', { count: uniqueRelayUrls.length, relays: uniqueRelayUrls.slice(0, 5) })
    }
    
    const relayStatuses: { url: string; success: boolean; error?: string }[] = []
    
    return new Promise<{ success: boolean; relayStatuses: typeof relayStatuses; successCount: number; totalCount: number }>((resolve) => {
      let successCount = 0
      let finishedCount = 0
      const errors: { url: string; error: any }[] = []
      
      logger.debug('[PublishEvent] Setting up global timeout (30 seconds)')
      let hasResolved = false
      
      // Add a global timeout to prevent hanging - use 30 seconds for faster feedback
      const globalTimeout = setTimeout(() => {
        if (hasResolved) {
          logger.debug('[PublishEvent] Already resolved, ignoring timeout')
          return
        }
        
        logger.warn('[PublishEvent] Global timeout reached!', {
          finishedCount,
          totalRelays: uniqueRelayUrls.length,
          successCount,
          relayStatusesCount: relayStatuses.length
        })
        
        // Mark any unfinished relays as failed
        uniqueRelayUrls.forEach(url => {
          const alreadyFinished = relayStatuses.some(rs => rs.url === url)
          if (!alreadyFinished) {
            logger.warn('[PublishEvent] Marking relay as timed out', { url })
            relayStatuses.push({ url, success: false, error: 'Timeout: Operation took too long' })
            finishedCount++
          }
        })
        
        // Ensure we resolve even if not all relays finished
        if (!hasResolved) {
          hasResolved = true
          logger.debug('[PublishEvent] Resolving due to timeout', {
            success: successCount >= uniqueRelayUrls.length / 3,
            successCount,
            totalCount: uniqueRelayUrls.length,
            relayStatuses: relayStatuses.length
          })
          resolve({
            success: successCount >= uniqueRelayUrls.length / 3,
            relayStatuses,
            successCount,
            totalCount: uniqueRelayUrls.length
          })
        }
      }, 30_000) // 30 seconds global timeout (reduced from 2 minutes)
      
      logger.debug('[PublishEvent] Starting Promise.allSettled for all relays')
      Promise.allSettled(
        uniqueRelayUrls.map(async (url, index) => {
          logger.debug(`[PublishEvent] Starting relay ${index + 1}/${uniqueRelayUrls.length}`, { url })
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const that = this
          const isLocal = isLocalNetworkUrl(url)
          const connectionTimeout = isLocal ? 5_000 : 8_000 // 5s for local, 8s for remote
          const publishTimeout = isLocal ? 5_000 : 8_000 // 5s for local, 8s for remote
          
          // Set up a per-relay timeout to ensure we always reach the finally block
          const relayTimeout = setTimeout(() => {
            logger.warn(`[PublishEvent] Per-relay timeout for ${url}`, { connectionTimeout, publishTimeout })
            // This will be caught in the catch block if the promise is still pending
          }, connectionTimeout + publishTimeout + 2_000) // Add 2s buffer
          
          try {
            // For local relays, add a connection timeout
            let relay: Relay
            logger.debug(`[PublishEvent] Ensuring relay connection`, { url, isLocal, connectionTimeout })
            
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
            logger.debug(`[PublishEvent] Relay connected`, { url })
            
            relay.publishTimeout = publishTimeout
            
            logger.debug(`[PublishEvent] Publishing to relay`, { url })
            
            // Wrap publish in a timeout promise
            const publishPromise = relay
              .publish(event)
              .then(() => {
                logger.debug(`[PublishEvent] Successfully published to relay`, { url })
                this.trackEventSeenOn(event.id, relay)
                successCount++
                relayStatuses.push({ url, success: true })
              })
              .catch((error) => {
                logger.warn(`[PublishEvent] Publish failed, checking if auth required`, { url, error: error.message })
                if (
                  error instanceof Error &&
                  error.message.startsWith('auth-required') &&
                  !!that.signer
                ) {
                  logger.debug(`[PublishEvent] Auth required, attempting authentication`, { url })
                  return relay
                    .auth((authEvt: EventTemplate) => that.signer!.signEvent(authEvt))
                    .then(() => {
                      logger.debug(`[PublishEvent] Auth successful, retrying publish`, { url })
                      return relay.publish(event)
                    })
                    .then(() => {
                      logger.debug(`[PublishEvent] Successfully published after auth`, { url })
                      this.trackEventSeenOn(event.id, relay)
                      successCount++
                      relayStatuses.push({ url, success: true })
                    })
                    .catch((authError) => {
                      logger.error(`[PublishEvent] Auth or publish failed`, { url, error: authError.message })
                      errors.push({ url, error: authError })
                      relayStatuses.push({ url, success: false, error: authError.message })
                    })
                } else {
                  logger.error(`[PublishEvent] Publish failed`, { url, error: error.message })
                  errors.push({ url, error })
                  relayStatuses.push({ url, success: false, error: error.message })
                }
              })
            
            // Add a timeout wrapper for the entire publish operation
            await Promise.race([
              publishPromise,
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error(`Publish timeout after ${publishTimeout}ms`)), publishTimeout)
              )
            ])
          } catch (error) {
            logger.error(`[PublishEvent] Connection or setup failed`, { url, error: error instanceof Error ? error.message : String(error) })
            errors.push({ url, error })
            relayStatuses.push({ 
              url, 
              success: false, 
              error: error instanceof Error ? error.message : 'Connection failed' 
            })
          } finally {
            clearTimeout(relayTimeout)
            const currentFinished = ++finishedCount
            logger.debug(`[PublishEvent] Relay finished`, { 
              url, 
              finishedCount: currentFinished, 
              totalRelays: uniqueRelayUrls.length,
              successCount 
            })
            
            // If one third of the relays have accepted the event, consider it a success
            const isSuccess = successCount >= uniqueRelayUrls.length / 3
            if (isSuccess) {
              this.emitNewEvent(event)
            }
            if (currentFinished >= uniqueRelayUrls.length && !hasResolved) {
              hasResolved = true
              logger.debug('[PublishEvent] All relays finished, resolving', {
                success: successCount >= uniqueRelayUrls.length / 3,
                successCount,
                totalCount: uniqueRelayUrls.length,
                relayStatusesCount: relayStatuses.length
              })
              clearTimeout(globalTimeout)
              resolve({
                success: successCount >= uniqueRelayUrls.length / 3,
                relayStatuses,
                successCount,
                totalCount: uniqueRelayUrls.length
              })
            }
            
            // Also resolve early if we have enough successes (1/3 of relays)
            // This prevents waiting for slow/failing relays
            if (!hasResolved && successCount >= Math.max(1, Math.ceil(uniqueRelayUrls.length / 3)) && currentFinished >= Math.max(1, Math.ceil(uniqueRelayUrls.length / 3))) {
              // Wait a bit more to see if more relays succeed quickly
              setTimeout(() => {
                if (!hasResolved) {
                  hasResolved = true
                  logger.debug('[PublishEvent] Resolving early with enough successes', {
                    success: true,
                    successCount,
                    totalCount: uniqueRelayUrls.length,
                    finishedCount: currentFinished,
                    relayStatusesCount: relayStatuses.length
                  })
                  clearTimeout(globalTimeout)
                  resolve({
                    success: true,
                    relayStatuses,
                    successCount,
                    totalCount: uniqueRelayUrls.length
                  })
                }
              }, 2000) // Wait 2 more seconds for quick responses
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
    const event = await this.signer?.signEvent({
      content: description,
      kind: kinds.HTTPAuth,
      created_at: dayjs().unix(),
      tags: [
        ['u', url],
        ['method', method]
      ]
    })
    return 'Nostr ' + btoa(JSON.stringify(event))
  }

  /** =========== Timeline =========== */

  private generateTimelineKey(urls: string[], filter: Filter) {
    const stableFilter: any = {}
    Object.entries(filter)
      .sort()
      .forEach(([key, value]) => {
        if (Array.isArray(value)) {
          stableFilter[key] = [...value].sort()
        }
        stableFilter[key] = value
      })
    const paramsStr = JSON.stringify({
      urls: [...urls].sort(),
      filter: stableFilter
    })
    const encoder = new TextEncoder()
    const data = encoder.encode(paramsStr)
    const hashBuffer = sha256(data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private generateMultipleTimelinesKey(subRequests: { urls: string[]; filter: Filter }[]) {
    const keys = subRequests.map(({ urls, filter }) => this.generateTimelineKey(urls, filter))
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(keys.sort()))
    const hashBuffer = sha256(data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  async subscribeTimeline(
    subRequests: { urls: string[]; filter: TSubRequestFilter }[],
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
    const newEventIdSet = new Set<string>()
    const requestCount = subRequests.length
    const threshold = Math.floor(requestCount / 2)
    let eventIdSet = new Set<string>()
    let events: NEvent[] = []
    let eosedCount = 0

    const subs = await Promise.all(
      subRequests.map(({ urls, filter }) => {
        return this._subscribeTimeline(
          urls,
          filter,
          {
            onEvents: (_events, _eosed) => {
              if (_eosed) {
                eosedCount++
              }

              _events.forEach((evt) => {
                if (eventIdSet.has(evt.id)) return
                eventIdSet.add(evt.id)
                events.push(evt)
              })
              events = events.sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit)
              eventIdSet = new Set(events.map((evt) => evt.id))

              if (eosedCount >= threshold) {
                onEvents(events, eosedCount >= requestCount)
              }
            },
            onNew: (evt) => {
              if (newEventIdSet.has(evt.id)) return
              newEventIdSet.add(evt.id)
              onNew(evt)
            },
            onClose
          },
          { startLogin, needSort }
        )
      })
    )

    const key = this.generateMultipleTimelinesKey(subRequests)
    this.timelines[key] = subs.map((sub) => sub.timelineKey)

    return {
      closer: () => {
        onEvents = () => {}
        onNew = () => {}
        subs.forEach((sub) => {
          sub.closer()
        })
      },
      timelineKey: key
    }
  }

  async loadMoreTimeline(key: string, until: number, limit: number) {
    const timeline = this.timelines[key]
    if (!timeline) return []

    if (!Array.isArray(timeline)) {
      return this._loadMoreTimeline(key, until, limit)
    }
    const timelines = await Promise.all(
      timeline.map((key) => this._loadMoreTimeline(key, until, limit))
    )

    const eventIdSet = new Set<string>()
    const events: NEvent[] = []
    timelines.forEach((timeline) => {
      timeline.forEach((evt) => {
        if (eventIdSet.has(evt.id)) return
        eventIdSet.add(evt.id)
        events.push(evt)
      })
    })
    return events.sort((a, b) => b.created_at - a.created_at).slice(0, limit)
  }

  subscribe(
    urls: string[],
    filter: Filter | Filter[],
    {
      onevent,
      oneose,
      onclose,
      startLogin,
      onAllClose
    }: {
      onevent?: (evt: NEvent) => void
      oneose?: (eosed: boolean) => void
      onclose?: (url: string, reason: string) => void
      startLogin?: () => void
      onAllClose?: (reasons: string[]) => void
    }
  ) {
    const relays = Array.from(new Set(urls))
    const filters = Array.isArray(filter) ? filter : [filter]

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this
    const _knownIds = new Set<string>()

    // Group by relay (same as pool.subscribeMap) so one REQ per relay with all filters
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
        oneose?.(true)
      }
    }
    const handleClose = (i: number, reason: string) => {
      if (closesReceived[i] !== undefined) return
      handleEose(i)
      closesReceived[i] = reason
      const { url } = groupedRequests[i]!
      onclose?.(url, reason)
      if (closesReceived.every((r) => r !== undefined)) {
        onAllClose?.(closesReceived as string[])
      }
    }

    const localAlreadyHaveEvent = (id: string) => {
      const have = _knownIds.has(id)
      if (have) return true
      _knownIds.add(id)
      return false
    }

    const subs: { relayKey: string; close: () => void }[] = []
    const allOpened = Promise.all(
      groupedRequests.map(async ({ url, filters: relayFilters }, i) => {
        const relayKey = normalizeUrl(url) || url
        await that.acquireSubSlot(relayKey)
        let relay: AbstractRelay
        try {
          relay = await that.pool.ensureRelay(url, { connectionTimeout: 5000 })
        } catch (err) {
          that.releaseSubSlot(relayKey)
          handleClose(i, (err as Error)?.message ?? String(err))
          return
        }

        let slotReleased = false
        const releaseOnce = () => {
          if (!slotReleased) {
            slotReleased = true
            that.releaseSubSlot(relayKey)
          }
        }

        const sub = relay.subscribe(relayFilters, {
          receivedEvent: (_relay, id) => that.trackEventSeenOn(id, _relay),
          onevent: (evt: NEvent) => onevent?.(evt),
          oneose: () => handleEose(i),
          onclose: (reason: string) => {
            releaseOnce()
            if (reason.startsWith('auth-required: ') && that.signer) {
              relay.auth(async (authEvt: EventTemplate) => {
                const evt = await that.signer!.signEvent(authEvt)
                if (!evt) throw new Error('sign event failed')
                return evt as VerifiedEvent
              }).then(() => that.acquireSubSlot(relayKey)).then(() => {
                let slotReleased2 = false
                const releaseSlot2 = () => {
                  if (!slotReleased2) {
                    slotReleased2 = true
                    that.releaseSubSlot(relayKey)
                  }
                }
                const sub2 = relay.subscribe(relayFilters, {
                  receivedEvent: (_relay, id) => that.trackEventSeenOn(id, _relay),
                  onevent: (evt: NEvent) => onevent?.(evt),
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
              }).catch((err) => {
                handleClose(i, `auth failed: ${(err as Error)?.message ?? err}`)
              })
              return
            }
            if (reason.startsWith('auth-required: ')) {
              startLogin?.()
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
      })
    )

    const handleNewEventFromInternal = (data: Event) => {
      const customEvent = data as CustomEvent<NEvent>
      const evt = customEvent.detail
      if (!matchFilters(filters, evt)) return

      const id = evt.id
      const have = _knownIds.has(id)
      if (have) return

      _knownIds.add(id)
      onevent?.(evt)
    }

    this.addEventListener('newEvent', handleNewEventFromInternal)

    return {
      close: () => {
        this.removeEventListener('newEvent', handleNewEventFromInternal)
        allOpened.then(() => {
          subs.forEach(({ close: subClose }) => subClose())
        })
      }
    }
  }

  private async _subscribeTimeline(
    urls: string[],
    filter: TSubRequestFilter, // filter with limit,
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
    const relays = Array.from(new Set(urls))
    const key = this.generateTimelineKey(relays, filter)
    const timeline = this.timelines[key]
    let cachedEvents: NEvent[] = []
    let since: number | undefined
    if (timeline && !Array.isArray(timeline) && timeline.refs.length && needSort) {
      cachedEvents = (
        await this.eventDataLoader.loadMany(timeline.refs.slice(0, filter.limit).map(([id]) => id))
      ).filter((evt) => !!evt && !(evt instanceof Error)) as NEvent[]
      if (cachedEvents.length) {
        onEvents([...cachedEvents], false)
        since = cachedEvents[0].created_at + 1
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this
    let events: NEvent[] = []
    let eosedAt: number | null = null
    const subCloser = this.subscribe(relays, since ? { ...filter, since } : filter, {
      startLogin,
      onevent: (evt: NEvent) => {
        that.addEventToCache(evt)
        // not eosed yet, push to events
        if (!eosedAt) {
          return events.push(evt)
        }
        // new event
        if (evt.created_at > eosedAt) {
          onNew(evt)
        }

        const timeline = that.timelines[key]
        if (!timeline || Array.isArray(timeline) || !timeline.refs.length) {
          return
        }

        // find the right position to insert
        let idx = 0
        for (const ref of timeline.refs) {
          if (evt.created_at > ref[1] || (evt.created_at === ref[1] && evt.id < ref[0])) {
            break
          }
          // the event is already in the cache
          if (evt.created_at === ref[1] && evt.id === ref[0]) {
            return
          }
          idx++
        }
        // the event is too old, ignore it
        if (idx >= timeline.refs.length) return

        // insert the event to the right position
        timeline.refs.splice(idx, 0, [evt.id, evt.created_at])
      },
      oneose: (eosed) => {
        if (eosed && !eosedAt) {
          eosedAt = dayjs().unix()
        }
        // (algo feeds) no need to sort and cache
        if (!needSort) {
          return onEvents([...events], !!eosedAt)
        }
        if (!eosed) {
          events = events.sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit)
          return onEvents([...events.concat(cachedEvents).slice(0, filter.limit)], false)
        }

        events = events.sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit)
        const timeline = that.timelines[key]
        // no cache yet
        if (!timeline || Array.isArray(timeline) || !timeline.refs.length) {
          that.timelines[key] = {
            refs: events.map((evt) => [evt.id, evt.created_at]),
            filter,
            urls
          }
          return onEvents([...events], true)
        }

        // Prevent concurrent requests from duplicating the same event
        const firstRefCreatedAt = timeline.refs[0][1]
        const newRefs = events
          .filter((evt) => evt.created_at > firstRefCreatedAt)
          .map((evt) => [evt.id, evt.created_at] as TTimelineRef)

        if (events.length >= filter.limit) {
          // if new refs are more than limit, means old refs are too old, replace them
          timeline.refs = newRefs
          onEvents([...events], true)
        } else {
          // merge new refs with old refs
          timeline.refs = newRefs.concat(timeline.refs)
          onEvents([...events.concat(cachedEvents).slice(0, filter.limit)], true)
        }
      },
      onclose: onClose
    })

    return {
      timelineKey: key,
      closer: () => {
        onEvents = () => {}
        onNew = () => {}
        subCloser.close()
      }
    }
  }

  private async _loadMoreTimeline(key: string, until: number, limit: number) {
    const timeline = this.timelines[key]
    if (!timeline || Array.isArray(timeline)) return []

    const { filter, urls, refs } = timeline
    const startIdx = refs.findIndex(([, createdAt]) => createdAt <= until)
    const cachedEvents =
      startIdx >= 0
        ? ((
            await this.eventDataLoader.loadMany(
              refs.slice(startIdx, startIdx + limit).map(([id]) => id)
            )
          ).filter((evt) => !!evt && !(evt instanceof Error)) as NEvent[])
        : []
    if (cachedEvents.length >= limit) {
      return cachedEvents
    }

    until = cachedEvents.length ? cachedEvents[cachedEvents.length - 1].created_at - 1 : until
    limit = limit - cachedEvents.length
    let events = await this.query(urls, { ...filter, until, limit })
    events.forEach((evt) => {
      this.addEventToCache(evt)
    })
    events = events.sort((a, b) => b.created_at - a.created_at).slice(0, limit)

    // Prevent concurrent requests from duplicating the same event
    const lastRefCreatedAt = refs.length > 0 ? refs[refs.length - 1][1] : dayjs().unix()
    timeline.refs.push(
      ...events
        .filter((evt) => evt.created_at < lastRefCreatedAt)
        .map((evt) => [evt.id, evt.created_at] as TTimelineRef)
    )
    return [...cachedEvents, ...events]
  }

  /** =========== Event =========== */

  getSeenEventRelays(eventId: string) {
    return Array.from(this.pool.seenOn.get(eventId)?.values() || [])
  }

  getSeenEventRelayUrls(eventId: string) {
    return this.getSeenEventRelays(eventId).map((relay) => relay.url)
  }

  getEventHints(eventId: string) {
    return this.getSeenEventRelayUrls(eventId).filter((url) => !isLocalNetworkUrl(url))
  }

  getEventHint(eventId: string) {
    return this.getSeenEventRelayUrls(eventId).find((url) => !isLocalNetworkUrl(url)) ?? ''
  }

  trackEventSeenOn(eventId: string, relay: AbstractRelay) {
    let set = this.pool.seenOn.get(eventId)
    if (!set) {
      set = new Set()
      this.pool.seenOn.set(eventId, set)
    }
    set.add(relay)
  }

  private async query(
    urls: string[], 
    filter: Filter | Filter[], 
    onevent?: (evt: NEvent) => void,
    options?: { eoseTimeout?: number; globalTimeout?: number }
  ) {
    const eoseTimeout = options?.eoseTimeout ?? 500 // Default 500ms after EOSE
    const globalTimeout = options?.globalTimeout ?? 10000 // Default 10s global timeout
    const isExternalSearch = eoseTimeout > 1000 // Consider it external search if timeout > 1s
    
    if (isExternalSearch) {
      logger.info('query: Starting external relay search', {
        relayCount: urls.length,
        relays: urls,
        eoseTimeout,
        globalTimeout,
        filter: Array.isArray(filter) ? filter : [filter]
      })
    }
    
    return await new Promise<NEvent[]>((resolve) => {
      const events: NEvent[] = []
      let resolveTimeout: ReturnType<typeof setTimeout> | null = null
      let allEosed = false
      let eoseTime: number | null = null
      let eventCount = 0
      
      let globalTimeoutId: ReturnType<typeof setTimeout> | null = null
      
      const resolveWithEvents = () => {
        if (resolveTimeout) {
          clearTimeout(resolveTimeout)
          resolveTimeout = null
        }
        if (globalTimeoutId) {
          clearTimeout(globalTimeoutId)
          globalTimeoutId = null
        }
        const duration = eoseTime ? Date.now() - eoseTime : 0
        if (isExternalSearch) {
          logger.info('query: Resolving external search', {
            eventsFound: events.length,
            eventCount,
            allEosed,
            timeSinceEose: duration
          })
        }
        sub.close()
        resolve(events)
      }
      
      const sub = this.subscribe(urls, filter, {
        onevent(evt) {
          eventCount++
          if (isExternalSearch && eventCount <= 3) {
            logger.info('query: Received event', {
              eventId: evt.id.substring(0, 8),
              eventCount,
              timeSinceEose: eoseTime ? Date.now() - eoseTime : null
            })
          }
          onevent?.(evt)
          events.push(evt)
          
          // Check if we're looking for a specific event ID (limit: 1 with ids filter)
          const filters = Array.isArray(filter) ? filter : [filter]
          const hasIdFilter = filters.some(f => f.ids && f.ids.length > 0)
          const hasLimitOne = filters.some(f => f.limit === 1)
          
          // If we're searching for a specific event and found it, we can resolve early
          // But wait a bit (100ms) in case duplicate events arrive
          if (hasIdFilter && hasLimitOne && events.length > 0 && allEosed) {
            // We've found the event and received EOSE, wait a short moment then resolve
            if (resolveTimeout) {
              clearTimeout(resolveTimeout)
            }
            resolveTimeout = setTimeout(() => {
              resolveWithEvents()
            }, 100) // Short delay to catch any duplicate events
          }
        },
        oneose: (eosed) => {
          if (eosed) {
            // When eosed is true, it means all relays have finished (either sent EOSE or failed to connect)
            allEosed = true
            eoseTime = Date.now()
            if (isExternalSearch) {
              logger.info('query: Received EOSE from all relays', {
                eventsSoFar: events.length,
                eventCount,
                willWait: eoseTimeout
              })
            }
            // Clear any existing timeout
            if (resolveTimeout) {
              clearTimeout(resolveTimeout)
            }
            // Wait longer after all relays send EOSE to allow searchable relays to finish searching
            // For searchable relays, they may send EOSE quickly but still need time to search their database
            // Important: We keep the subscription open during this timeout so we can receive events
            resolveTimeout = setTimeout(() => {
              resolveWithEvents()
            }, eoseTimeout)
          }
        },
        onclose: (url, reason) => {
          if (isExternalSearch) {
            logger.info('query: Relay connection closed', { url, reason, eventsSoFar: events.length, allEosed })
          }
          // If we've received EOSE, we have a timeout set - let it handle resolution
          // This gives searchable relays time to search their databases
          if (allEosed) {
            // Don't resolve immediately - let the EOSE timeout handle it
            // This allows searchable relays to continue searching even if connections close
            return
          }
          
          // If we have events but no EOSE yet, we might want to wait a bit more
          // But if connections are closing, we should resolve
          if (events.length > 0) {
            // We have events, but haven't received EOSE from all relays
            // Wait a short time to see if more events come, then resolve
            if (!resolveTimeout) {
              resolveTimeout = setTimeout(() => {
                resolveWithEvents()
              }, 1000) // Wait 1 second for more events
            }
          } else {
            // No events and no EOSE - connection closed early
            // Wait a bit to see if events arrive, but not too long
            if (!resolveTimeout) {
              resolveTimeout = setTimeout(() => {
                resolveWithEvents()
              }, 2000) // Wait 2 seconds for events
            }
          }
        }
      })
      
      // Fallback timeout: resolve after globalTimeout to prevent hanging
      globalTimeoutId = setTimeout(() => {
        if (isExternalSearch) {
          logger.info('query: Global timeout reached', {
            eventsFound: events.length,
            eventCount,
            allEosed
          })
        }
        resolveWithEvents()
      }, globalTimeout)
    })
  }

  async fetchEvents(
    urls: string[],
    filter: Filter | Filter[],
    {
      onevent,
      cache = false,
      eoseTimeout,
      globalTimeout
    }: {
      onevent?: (evt: NEvent) => void
      cache?: boolean
      eoseTimeout?: number
      globalTimeout?: number
    } = {}
  ) {
    const relays = Array.from(new Set(urls))
    const events = await this.query(
      relays.length > 0 ? relays : BIG_RELAY_URLS, 
      filter, 
      onevent,
      { eoseTimeout, globalTimeout }
    )
    if (cache) {
      events.forEach((evt) => {
        this.addEventToCache(evt)
      })
    }
    return events
  }

  async fetchEvent(id: string): Promise<NEvent | undefined> {
    if (!/^[0-9a-f]{64}$/.test(id)) {
      let eventId: string | undefined
      let coordinate: string | undefined
      const { type, data } = nip19.decode(id)
      switch (type) {
        case 'note':
          eventId = data
          break
        case 'nevent':
          eventId = data.id
          break
        case 'naddr':
          coordinate = getReplaceableCoordinate(data.kind, data.pubkey, data.identifier)
          break
      }
      if (coordinate) {
        const cache = this.replaceableEventCacheMap.get(coordinate)
        if (cache) {
          return cache
        }
      } else if (eventId) {
        const cache = this.eventCacheMap.get(eventId)
        if (cache) {
          return cache
        }
      }
    }
    return this.eventDataLoader.load(id)
  }

  addEventToCache(event: NEvent) {
    // Remove relayStatuses before caching (it's metadata for logging, not part of the event)
    const cleanEvent = { ...event } as NEvent
    delete (cleanEvent as any).relayStatuses
    
    this.eventDataLoader.prime(cleanEvent.id, Promise.resolve(cleanEvent))
    if (isReplaceableEvent(cleanEvent.kind)) {
      const coordinate = getReplaceableCoordinateFromEvent(cleanEvent)
      const cachedEvent = this.replaceableEventCacheMap.get(coordinate)
      if (!cachedEvent || compareEvents(cleanEvent, cachedEvent) > 0) {
        this.replaceableEventCacheMap.set(coordinate, cleanEvent)
      }
    }
  }

  private async fetchEventById(relayUrls: string[], id: string): Promise<NEvent | undefined> {
    const event = await this.fetchEventFromBigRelaysDataloader.load(id)
    if (event) {
      return event
    }

    return this.tryHarderToFetchEvent(relayUrls, { ids: [id], limit: 1 }, true)
  }

  private async _fetchEvent(id: string): Promise<NEvent | undefined> {
    let filter: Filter | undefined
    let relays: string[] = []
    let author: string | undefined
    if (/^[0-9a-f]{64}$/.test(id)) {
      filter = { ids: [id] }
    } else {
      const { type, data } = nip19.decode(id)
      switch (type) {
        case 'note':
          filter = { ids: [data] }
          break
        case 'nevent':
          filter = { ids: [data.id] }
          if (data.relays) relays = data.relays
          if (data.author) author = data.author
          break
        case 'naddr':
          filter = {
            authors: [data.pubkey],
            kinds: [data.kind],
            limit: 1
          }
          author = data.pubkey
          if (data.identifier) {
            filter['#d'] = [data.identifier]
          }
          if (data.relays) relays = data.relays
      }
    }
    if (!filter) {
      throw new Error('Invalid id')
    }

    let event: NEvent | undefined
    if (filter.ids?.length) {
      event = await this.fetchEventById(relays, filter.ids[0])
    }

    if (!event && author) {
      const relayList = await this.fetchRelayList(author)
      event = await this.tryHarderToFetchEvent(relayList.write.slice(0, 5), filter)
    }

    if (event && event.id !== id) {
      this.addEventToCache(event)
    }

    return event
  }

  private async tryHarderToFetchEvent(
    relayUrls: string[],
    filter: Filter,
    alreadyFetchedFromBigRelays = false
  ) {
    if (!relayUrls.length && filter.authors?.length) {
      const relayList = await this.fetchRelayList(filter.authors[0])
      relayUrls = alreadyFetchedFromBigRelays
        ? relayList.write.filter((url) => !BIG_RELAY_URLS.includes(url)).slice(0, 4)
        : relayList.write.slice(0, 4)
    } else if (!relayUrls.length && !alreadyFetchedFromBigRelays) {
      relayUrls = BIG_RELAY_URLS
    }
    if (!relayUrls.length) {
      // Final fallback to searchable relays
      relayUrls = SEARCHABLE_RELAY_URLS
    }
    if (!relayUrls.length) return

    const events = await this.query(relayUrls, filter)
    return events.sort((a, b) => b.created_at - a.created_at)[0]
  }

  /**
   * Get user's favorite relays from kind 10012 event
   */
  private async getUserFavoriteRelays(): Promise<string[]> {
    if (!this.pubkey) return []
    
    try {
      const favoriteRelaysEvent = await this.fetchReplaceableEvent(this.pubkey, ExtendedKind.FAVORITE_RELAYS)
      if (!favoriteRelaysEvent) return []
      
      const relays: string[] = []
      favoriteRelaysEvent.tags.forEach(([tagName, tagValue]) => {
        if (tagName === 'relay' && tagValue && isWebsocketUrl(tagValue)) {
          const normalizedUrl = normalizeUrl(tagValue)
          if (normalizedUrl && !relays.includes(normalizedUrl)) {
            relays.push(normalizedUrl)
          }
        }
      })
      
      return relays
    } catch (error) {
      return []
    }
  }

  async fetchFavoriteRelays(pubkey: string): Promise<string[]> {
    try {
      const favoriteRelaysEvent = await this.fetchReplaceableEvent(pubkey, ExtendedKind.FAVORITE_RELAYS)
      if (!favoriteRelaysEvent) return []

      const relays: string[] = []
      favoriteRelaysEvent.tags.forEach(([tagName, tagValue]) => {
        if (tagName === 'relay' && tagValue) {
          const normalized = normalizeUrl(tagValue)
          if (normalized) {
            relays.push(normalized)
          }
        }
      })

      return Array.from(new Set(relays))
    } catch {
      return []
    }
  }

  /**
   * Build initial relay list for fetching events
   * Priority: FAST_READ_RELAY_URLS, user's favorite relays (10012), user's relay list read relays (10002) including cache relays (10432)
   * All relays are normalized and deduplicated
   */
  private async buildInitialRelayList(): Promise<string[]> {
    const relaySet = new Set<string>()
    
    // Add FAST_READ_RELAY_URLS
    FAST_READ_RELAY_URLS.forEach(url => {
      const normalized = normalizeUrl(url)
      if (normalized) relaySet.add(normalized)
    })
    
    // Add user's favorite relays (kind 10012)
    if (this.pubkey) {
      const favoriteRelays = await this.getUserFavoriteRelays()
      favoriteRelays.forEach(url => {
        const normalized = normalizeUrl(url)
        if (normalized) relaySet.add(normalized)
      })
      
      // Add user's relay list read relays (kind 10002) and cache relays (kind 10432)
      // fetchRelayList already merges cache relays with regular relay list
      try {
        const relayList = await this.fetchRelayList(this.pubkey)
        if (relayList?.read) {
          relayList.read.forEach(url => {
            const normalized = normalizeUrl(url)
            if (normalized) relaySet.add(normalized)
          })
        }
      } catch (error) {
        // Silent fail
      }
    }
    
    // Return deduplicated array (normalization already handled, Set ensures deduplication)
    return Array.from(relaySet)
  }

  private async fetchEventsFromBigRelays(ids: readonly string[]) {
    // Use optimized initial relay list instead of BIG_RELAY_URLS
    const initialRelays = await this.buildInitialRelayList()
    const relayUrls = initialRelays.length > 0 ? initialRelays : BIG_RELAY_URLS
    
    const events = await this.query(relayUrls, {
      ids: Array.from(new Set(ids)),
      limit: ids.length
    })
    const eventsMap = new Map<string, NEvent>()
    for (const event of events) {
      eventsMap.set(event.id, event)
    }

    return ids.map((id) => eventsMap.get(id))
  }

  /** =========== Following favorite relays =========== */

  private followingFavoriteRelaysCache = new LRUCache<string, Promise<[string, string[]][]>>({
    max: 10,
    fetchMethod: this._fetchFollowingFavoriteRelays.bind(this)
  })

  async fetchFollowingFavoriteRelays(pubkey: string) {
    return this.followingFavoriteRelaysCache.fetch(pubkey)
  }

  private async _fetchFollowingFavoriteRelays(pubkey: string) {
    const fetchNewData = async () => {
      const followings = await this.fetchFollowings(pubkey)
      const events = await this.fetchEvents(BIG_RELAY_URLS, {
        authors: followings,
        kinds: [ExtendedKind.FAVORITE_RELAYS, kinds.Relaysets],
        limit: 1000
      })
      const alreadyExistsFavoriteRelaysPubkeySet = new Set<string>()
      const alreadyExistsRelaySetsPubkeySet = new Set<string>()
      const uniqueEvents: NEvent[] = []
      events
        .sort((a, b) => b.created_at - a.created_at)
        .forEach((event) => {
          if (event.kind === ExtendedKind.FAVORITE_RELAYS) {
            if (alreadyExistsFavoriteRelaysPubkeySet.has(event.pubkey)) return
            alreadyExistsFavoriteRelaysPubkeySet.add(event.pubkey)
          } else if (event.kind === kinds.Relaysets) {
            if (alreadyExistsRelaySetsPubkeySet.has(event.pubkey)) return
            alreadyExistsRelaySetsPubkeySet.add(event.pubkey)
          } else {
            return
          }
          uniqueEvents.push(event)
        })

      const relayMap = new Map<string, Set<string>>()
      uniqueEvents.forEach((event) => {
        event.tags.forEach(([tagName, tagValue]) => {
          if (tagName === 'relay' && tagValue && isWebsocketUrl(tagValue)) {
            const url = normalizeUrl(tagValue)
            relayMap.set(url, (relayMap.get(url) || new Set()).add(event.pubkey))
          }
        })
      })
      const relayMapEntries = Array.from(relayMap.entries())
        .sort((a, b) => b[1].size - a[1].size)
        .map(([url, pubkeys]) => [url, Array.from(pubkeys)]) as [string, string[]][]

      indexedDb.putFollowingFavoriteRelays(pubkey, relayMapEntries)
      return relayMapEntries
    }

    const cached = await indexedDb.getFollowingFavoriteRelays(pubkey)
    if (cached) {
      fetchNewData()
      return cached
    }
    return fetchNewData()
  }

  /** =========== Followings =========== */

  async initUserIndexFromFollowings(pubkey: string, signal: AbortSignal) {
    const followings = await this.fetchFollowings(pubkey)
    for (let i = 0; i * 20 < followings.length; i++) {
      if (signal.aborted) return
      await Promise.all(
        followings.slice(i * 20, (i + 1) * 20).map((pubkey) => this.fetchProfileEvent(pubkey))
      )
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  /** =========== Profile =========== */

  async searchProfiles(relayUrls: string[], filter: Filter): Promise<TProfile[]> {
    const events = await this.query(relayUrls, {
      ...filter,
      kinds: [kinds.Metadata]
    })

    const profileEvents = events.sort((a, b) => b.created_at - a.created_at)
    await Promise.allSettled(profileEvents.map((profile) => this.addUsernameToIndex(profile)))
    profileEvents.forEach((profile) => this.updateProfileEventCache(profile))
    return profileEvents.map((profileEvent) => getProfileFromEvent(profileEvent))
  }

  async searchNpubsFromLocal(query: string, limit: number = 100) {
    const result = await this.userIndex.searchAsync(query, { limit })
    return result.map((pubkey) => pubkeyToNpub(pubkey as string)).filter(Boolean) as string[]
  }

  async searchProfilesFromLocal(query: string, limit: number = 100) {
    const npubs = await this.searchNpubsFromLocal(query, limit)
    const profiles = await Promise.all(npubs.map((npub) => this.fetchProfile(npub)))
    return profiles.filter((profile) => !!profile) as TProfile[]
  }

  private async addUsernameToIndex(profileEvent: NEvent) {
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
    const profileFromBigRelays = await this.replaceableEventFromBigRelaysDataloader.load({
      pubkey,
      kind: kinds.Metadata
    })
    if (profileFromBigRelays) {
      this.addUsernameToIndex(profileFromBigRelays)
      return profileFromBigRelays
    }

    if (!relays.length) {
      return undefined
    }

    const profileEvent = await this.tryHarderToFetchEvent(
      relays,
      {
        authors: [pubkey],
        kinds: [kinds.Metadata],
        limit: 1
      },
      true
    )

    if (profileEvent) {
      this.addUsernameToIndex(profileEvent)
      indexedDb.putReplaceableEvent(profileEvent)
    }

    return profileEvent
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

  async updateProfileEventCache(event: NEvent) {
    await this.updateReplaceableEventFromBigRelaysCache(event)
  }

  /** =========== Relay list =========== */

  async fetchRelayListEvent(pubkey: string) {
    const [relayEvent] = await this.fetchReplaceableEventsFromBigRelays([pubkey], kinds.RelayList)
    return relayEvent ?? null
  }

  clearRelayListCache(pubkey: string) {
    this.relayListRequestCache.delete(pubkey)
  }

  /**
   * Clear all in-memory caches. Call this after IndexedDB/cache clear so that
   * subsequent fetches go to the network instead of serving stale in-memory data.
   * Fixes missing profile pics and broken reactions after "Clear cache" on mobile.
   */
  clearInMemoryCaches(): void {
    this.replaceableEventCacheMap.clear()
    this.relayListRequestCache.clear()
    this.eventDataLoader.clearAll()
    this.replaceableEventFromBigRelaysDataloader.clearAll()
    this.followingFavoriteRelaysCache?.clear()
    logger.info('[ClientService] In-memory caches cleared')
  }

  async fetchRelayList(pubkey: string): Promise<TRelayList> {
    // Deduplicate concurrent requests for the same pubkey's relay list
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
        // Remove from cache after completion (cache result in replaceableEventCacheMap)
        this.relayListRequestCache.delete(pubkey)
      }
    })()
    
    this.relayListRequestCache.set(pubkey, requestPromise)
    return requestPromise
  }

  async fetchRelayLists(pubkeys: string[]): Promise<TRelayList[]> {
    // First check IndexedDB for offline/quick access (prioritizes cache relays for offline use)
    const storedRelayEvents = await Promise.all(
      pubkeys.map(pubkey => indexedDb.getReplaceableEvent(pubkey, kinds.RelayList))
    )
    const storedCacheRelayEvents = await Promise.all(
      pubkeys.map(pubkey => indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS))
    )
    
    // Then fetch from relays (will update cache if newer)
    const relayEvents = await this.fetchReplaceableEventsFromBigRelays(pubkeys, kinds.RelayList)
    
    // Fetch cache relays from multiple sources: BIG_RELAY_URLS, PROFILE_FETCH_RELAY_URLS, and user's inboxes/outboxes
    const cacheRelayEvents = await this.fetchCacheRelayEventsFromMultipleSources(pubkeys, relayEvents, storedRelayEvents)

    return relayEvents.map((event, index) => {
      // Use stored cache relay event if available (for offline), otherwise use fetched one
      const storedCacheEvent = storedCacheRelayEvents[index]
      const cacheEvent = cacheRelayEvents[index] || storedCacheEvent
      
      // Use stored relay event if no network event (for offline), otherwise use fetched one
      const storedRelayEvent = storedRelayEvents[index]
      const relayEvent = event || storedRelayEvent
      
      const relayList = relayEvent ? getRelayListFromEvent(relayEvent) : {
        write: [],
        read: [],
        originalRelays: []
      }
      
      // Merge cache relays (kind 10432) into the relay list
      // Prioritize cache relays by placing them first in the list (for offline functionality)
      if (cacheEvent) {
        const cacheRelayList = getRelayListFromEvent(cacheEvent)
        
        // Merge read relays - cache relays first, then others (for offline priority)
        const mergedRead = [...cacheRelayList.read, ...relayList.read]
        const mergedWrite = [...cacheRelayList.write, ...relayList.write]
        const mergedOriginalRelays = new Map<string, TMailboxRelay>()
        
        // Add cache relay original relays first (prioritized)
        cacheRelayList.originalRelays.forEach(relay => {
          mergedOriginalRelays.set(relay.url, relay)
        })
        // Then add regular relay original relays
        relayList.originalRelays.forEach(relay => {
          if (!mergedOriginalRelays.has(relay.url)) {
            mergedOriginalRelays.set(relay.url, relay)
          }
        })
        
        // Deduplicate while preserving order (cache relays first)
        return {
          write: Array.from(new Set(mergedWrite)),
          read: Array.from(new Set(mergedRead)),
          originalRelays: Array.from(mergedOriginalRelays.values())
        }
      }
      
      // If no cache event, return original relay list or default (with cache as fallback)
      if (!relayEvent) {
        // Check if we have a stored cache relay event as fallback
        if (storedCacheEvent) {
          const cacheRelayList = getRelayListFromEvent(storedCacheEvent)
          return {
            write: cacheRelayList.write.length > 0 ? cacheRelayList.write : BIG_RELAY_URLS,
            read: cacheRelayList.read.length > 0 ? cacheRelayList.read : BIG_RELAY_URLS,
            originalRelays: cacheRelayList.originalRelays
          }
        }
        return {
          write: BIG_RELAY_URLS,
          read: BIG_RELAY_URLS,
          originalRelays: []
        }
      }
      
      return relayList
    })
  }

  async forceUpdateRelayListEvent(pubkey: string) {
    await this.replaceableEventBatchLoadFn([{ pubkey, kind: kinds.RelayList }])
  }

  /**
   * Fetch cache relay events (kind 10432) from multiple sources:
   * - BIG_RELAY_URLS
   * - PROFILE_FETCH_RELAY_URLS
   * - User's inboxes (read relays from kind 10002)
   * - User's outboxes (write relays from kind 10002)
   */
  private async fetchCacheRelayEventsFromMultipleSources(
    pubkeys: string[],
    relayEvents: (NEvent | null | undefined)[],
    storedRelayEvents: (NEvent | null | undefined)[]
  ): Promise<(NEvent | null | undefined)[]> {
    // Start with events from IndexedDB
    const storedCacheRelayEvents = await Promise.all(
      pubkeys.map(pubkey => indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS))
    )
    
    // Determine which pubkeys need fetching (don't have stored events)
    const pubkeysToFetch = pubkeys.filter((_, index) => !storedCacheRelayEvents[index])
    if (pubkeysToFetch.length === 0) {
      return storedCacheRelayEvents
    }
    
    // Build list of relays to query from
    const relayUrls = new Set<string>([...BIG_RELAY_URLS, ...PROFILE_FETCH_RELAY_URLS])
    
    // Add user's inboxes and outboxes from their relay list (kind 10002)
    pubkeys.forEach((_pubkey, index) => {
      const relayEvent = relayEvents[index] || storedRelayEvents[index]
      if (relayEvent) {
        const relayList = getRelayListFromEvent(relayEvent)
        // Add read relays (inboxes)
        relayList.read.forEach(url => relayUrls.add(url))
        // Add write relays (outboxes)
        relayList.write.forEach(url => relayUrls.add(url))
      }
    })
    
    // Fetch cache relay events from all sources
    const cacheRelayEvents: (NEvent | null | undefined)[] = new Array(pubkeys.length).fill(undefined)
    
    // Initialize with stored events
    storedCacheRelayEvents.forEach((event, index) => {
      if (event) {
        cacheRelayEvents[index] = event
      }
    })
    
    // Fetch missing cache relay events
    if (pubkeysToFetch.length > 0) {
      try {
        const events = await this.query(Array.from(relayUrls), pubkeysToFetch.map(pubkey => ({
          authors: [pubkey],
          kinds: [ExtendedKind.CACHE_RELAYS]
        })))
        
        // Map fetched events back to original pubkey order
        const eventMap = new Map<string, NEvent>()
        events.forEach(event => {
          const key = event.pubkey
          const existing = eventMap.get(key)
          if (!existing || existing.created_at < event.created_at) {
            eventMap.set(key, event)
          }
        })
        
        pubkeysToFetch.forEach((pubkey) => {
          const pubkeyIndex = pubkeys.indexOf(pubkey)
          if (pubkeyIndex !== -1) {
            const event = eventMap.get(pubkey)
            if (event) {
              cacheRelayEvents[pubkeyIndex] = event
              // Cache the event
              indexedDb.putReplaceableEvent(event)
            }
          }
        })
      } catch (error) {
        // Silent fail
      }
    }
    
    return cacheRelayEvents
  }

  async updateRelayListCache(event: NEvent) {
    await this.updateReplaceableEventFromBigRelaysCache(event)
  }

  /** =========== Replaceable event from big relays dataloader =========== */

  private replaceableEventFromBigRelaysDataloader = new DataLoader<
    { pubkey: string; kind: number },
    NEvent | null,
    string
  >(this.replaceableEventFromBigRelaysBatchLoadFn.bind(this), {
    batchScheduleFn: (callback) => setTimeout(callback, 50),
    maxBatchSize: 500,
    cacheKeyFn: ({ pubkey, kind }) => `${pubkey}:${kind}`
  })

  private async replaceableEventFromBigRelaysBatchLoadFn(
    params: readonly { pubkey: string; kind: number }[]
  ) {
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
        const events = await this.query(BIG_RELAY_URLS, {
          authors: pubkeys,
          kinds: [kind]
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

  private async fetchReplaceableEventsFromBigRelays(pubkeys: string[], kind: number) {
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
    newEvents.forEach((event) => {
      if (event && !(event instanceof Error)) {
        const index = nonExistingPubkeyIndexMap.get(event.pubkey)
        if (index !== undefined) {
          events[index] = event
        }
      }
    })

    return events
  }

  private async updateReplaceableEventFromBigRelaysCache(event: NEvent) {
    this.replaceableEventFromBigRelaysDataloader.clear({ pubkey: event.pubkey, kind: event.kind })
    this.replaceableEventFromBigRelaysDataloader.prime(
      { pubkey: event.pubkey, kind: event.kind },
      Promise.resolve(event)
    )
    await indexedDb.putReplaceableEvent(event)
  }

  /** =========== Replaceable event dataloader =========== */

  private replaceableEventDataLoader = new DataLoader<
    { pubkey: string; kind: number; d?: string },
    NEvent | null,
    string
  >(this.replaceableEventBatchLoadFn.bind(this), {
    cacheKeyFn: ({ pubkey, kind, d }) => `${kind}:${pubkey}:${d ?? ''}`
  })

  private async replaceableEventBatchLoadFn(
    params: readonly { pubkey: string; kind: number; d?: string }[]
  ) {
    const groups = new Map<string, { kind: number; d?: string }[]>()
    params.forEach(({ pubkey, kind, d }) => {
      if (!groups.has(pubkey)) {
        groups.set(pubkey, [])
      }
      groups.get(pubkey)!.push({ kind: kind, d })
    })

    const eventMap = new Map<string, NEvent | null>()
    await Promise.allSettled(
      Array.from(groups.entries()).map(async ([pubkey, _params]) => {
        const groupByKind = new Map<number, string[]>()
        _params.forEach(({ kind, d }) => {
          if (!groupByKind.has(kind)) {
            groupByKind.set(kind, [])
          }
          if (d) {
            groupByKind.get(kind)!.push(d)
          }
        })
        const filters = Array.from(groupByKind.entries()).map(
          ([kind, dList]) =>
            (dList.length > 0
              ? {
                  authors: [pubkey],
                  kinds: [kind],
                  '#d': dList
                }
              : { authors: [pubkey], kinds: [kind] }) as Filter
        )
        const events = await this.query(BIG_RELAY_URLS, filters)

        for (const event of events) {
          const key = getReplaceableCoordinateFromEvent(event)
          const existing = eventMap.get(key)
          if (!existing || existing.created_at < event.created_at) {
            eventMap.set(key, event)
          }
        }
      })
    )

    return params.map(({ pubkey, kind, d }) => {
      const key = `${kind}:${pubkey}:${d ?? ''}`
      const event = eventMap.get(key)
      if (kind === kinds.Pinlist) return event ?? null

      if (event) {
        indexedDb.putReplaceableEvent(event)
        return event
      } else {
        indexedDb.putNullReplaceableEvent(pubkey, kind, d)
        return null
      }
    })
  }

  private async fetchReplaceableEvent(pubkey: string, kind: number, d?: string) {
    const storedEvent = await indexedDb.getReplaceableEvent(pubkey, kind, d)
    if (storedEvent !== undefined) {
      return storedEvent
    }

    return await this.replaceableEventDataLoader.load({ pubkey, kind, d })
  }

  private async updateReplaceableEventCache(event: NEvent) {
    this.replaceableEventDataLoader.clear({ pubkey: event.pubkey, kind: event.kind })
    this.replaceableEventDataLoader.prime(
      { pubkey: event.pubkey, kind: event.kind },
      Promise.resolve(event)
    )
    await indexedDb.putReplaceableEvent(event)
  }

  /** =========== Replaceable event =========== */

  async fetchFollowListEvent(pubkey: string) {
    return await this.fetchReplaceableEvent(pubkey, kinds.Contacts)
  }

  async fetchFollowings(pubkey: string) {
    const followListEvent = await this.fetchFollowListEvent(pubkey)
    return followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
  }

  async updateFollowListCache(evt: NEvent) {
    await this.updateReplaceableEventCache(evt)
  }

  async fetchMuteListEvent(pubkey: string) {
    return await this.fetchReplaceableEvent(pubkey, kinds.Mutelist)
  }

  async fetchBookmarkListEvent(pubkey: string) {
    return this.fetchReplaceableEvent(pubkey, kinds.BookmarkList)
  }

  async fetchBlossomServerListEvent(pubkey: string) {
    return await this.fetchReplaceableEvent(pubkey, ExtendedKind.BLOSSOM_SERVER_LIST)
  }

  async fetchInterestListEvent(pubkey: string) {
    return await this.fetchReplaceableEvent(pubkey, 10015)
  }

  async fetchPinListEvent(pubkey: string) {
    return await this.fetchReplaceableEvent(pubkey, 10001)
  }

  /** Fetch NIP-A3 payment info (kind 10133) for a user; uses replaceable cache and IndexedDB. */
  async fetchPaymentInfoEvent(pubkey: string) {
    return await this.fetchReplaceableEvent(pubkey, ExtendedKind.PAYMENT_INFO)
  }

  /** Update local cache after publishing a payment info (kind 10133) event. */
  async updatePaymentInfoCache(evt: NEvent) {
    await this.updateReplaceableEventCache(evt)
  }

  /**
   * Force-refresh profile (kind 0) and payment info (kind 10133) cache for a pubkey:
   * clears in-memory cache and IndexedDB so the next fetch loads from relays.
   */
  async forceRefreshProfileAndPaymentInfoCache(pubkey: string): Promise<void> {
    this.replaceableEventDataLoader.clear({ pubkey, kind: kinds.Metadata })
    this.replaceableEventDataLoader.clear({ pubkey, kind: ExtendedKind.PAYMENT_INFO })
    await indexedDb.invalidateReplaceableEvent(pubkey, kinds.Metadata)
    await indexedDb.invalidateReplaceableEvent(pubkey, ExtendedKind.PAYMENT_INFO)
  }

  clearRelayConnectionState(relayUrl: string) {
    // Clear connection state for specified relay
    this.pool.close([relayUrl])
  }

  getAlreadyTriedRelays() {
    return []
  }

  async fetchEventForceRetry(eventId: string) {
    return await this.fetchEvent(eventId)
  }

  async fetchEventWithExternalRelays(eventId: string, externalRelays: string[]) {
    if (!externalRelays || externalRelays.length === 0) {
      logger.warn('fetchEventWithExternalRelays: No external relays provided', { eventId })
      return undefined
    }
    
    logger.info('fetchEventWithExternalRelays: Starting search', {
      eventId: eventId.substring(0, 8),
      relayCount: externalRelays.length,
      relays: externalRelays
    })
    
    // Use external relays for fetching the event
    // For searchable relays, we want to give them more time to search their database
    // Use a longer EOSE timeout (10 seconds) to allow searchable relays to complete their search
    // and a longer global timeout (20 seconds) to ensure we wait long enough
    const startTime = Date.now()
    const events = await this.fetchEvents(
      externalRelays, 
      { ids: [eventId], limit: 1 },
      {
        eoseTimeout: 10000, // Wait 10 seconds after all EOSE (searchable relays need time to search)
        globalTimeout: 20000 // 20 second global timeout
      }
    )
    const duration = Date.now() - startTime
    
    logger.info('fetchEventWithExternalRelays: Search completed', {
      eventId: eventId.substring(0, 8),
      relayCount: externalRelays.length,
      eventsFound: events.length,
      durationMs: duration
    })
    
    return events[0]
  }

  async fetchBlossomServerList(pubkey: string) {
    const evt = await this.fetchBlossomServerListEvent(pubkey)
    return evt ? getServersFromServerTags(evt.tags) : []
  }

  async updateBlossomServerListEventCache(evt: NEvent) {
    await this.updateReplaceableEventCache(evt)
  }

  async fetchEmojiSetEvents(pointers: string[]) {
    const params = pointers
      .map((pointer) => {
        const [kindStr, pubkey, d = ''] = pointer.split(':')
        if (!pubkey || !kindStr) return null

        const kind = parseInt(kindStr, 10)
        if (kind !== kinds.Emojisets) return null

        return { pubkey, kind, d }
      })
      .filter(Boolean) as { pubkey: string; kind: number; d: string }[]
    return await this.replaceableEventDataLoader.loadMany(params)
  }

  // ================= Utils =================

  async generateSubRequestsForPubkeys(pubkeys: string[], myPubkey?: string | null) {
    // If many websocket connections are initiated simultaneously, it will be
    // very slow on Safari (for unknown reason)
    if (isSafari()) {
      let urls = BIG_RELAY_URLS
      if (myPubkey) {
        const relayList = await this.fetchRelayList(myPubkey)
        urls = relayList.read.concat(BIG_RELAY_URLS).slice(0, 5)
      }
      return [{ urls, filter: { authors: pubkeys } }]
    }

    const relayLists = await this.fetchRelayLists(pubkeys)
    const group: Record<string, Set<string>> = {}
    relayLists.forEach((relayList, index) => {
      relayList.write.slice(0, 4).forEach((url) => {
        if (!group[url]) {
          group[url] = new Set()
        }
        group[url].add(pubkeys[index])
      })
    })

    const relayCount = Object.keys(group).length
    const coveredCount = new Map<string, number>()
    Object.entries(group)
      .sort(([, a], [, b]) => b.size - a.size)
      .forEach(([url, pubkeys]) => {
        if (
          relayCount > 10 &&
          pubkeys.size < 10 &&
          Array.from(pubkeys).every((pubkey) => (coveredCount.get(pubkey) ?? 0) >= 2)
        ) {
          delete group[url]
        } else {
          pubkeys.forEach((pubkey) => {
            coveredCount.set(pubkey, (coveredCount.get(pubkey) ?? 0) + 1)
          })
        }
      })

    return Object.entries(group).map(([url, authors]) => ({
      urls: [url],
      filter: { authors: Array.from(authors) }
    }))
  }

  /**
   * Expand verse string into individual verse numbers
   * Examples: "4-5" -> [4, 5], "4,5,6" -> [4, 5, 6], "4-7,10" -> [4, 5, 6, 7, 10]
   */
  private expandVerseRange(verse: string): number[] {
    const verseNumbers = new Set<number>()
    
    // Split by comma to get individual verse specs (could be ranges or single verses)
    const verseSpecs = verse.split(',').map(v => v.trim()).filter(v => v)
    
    for (const spec of verseSpecs) {
      if (spec.includes('-')) {
        // This is a range like "4-5" or "4-7"
        const [startStr, endStr] = spec.split('-').map(v => v.trim())
        const start = parseInt(startStr)
        const end = parseInt(endStr)
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          // Add all verses in the range
          for (let v = start; v <= end; v++) {
            verseNumbers.add(v)
          }
        }
      } else {
        // Single verse number
        const verseNum = parseInt(spec)
        if (!isNaN(verseNum)) {
          verseNumbers.add(verseNum)
        }
      }
    }
    
    return Array.from(verseNumbers).sort((a, b) => a - b)
  }

  /**
   * Fetch bookstr events by tag filters
   * Strategy: 
   * 1. Check cache first
   * 2. Use tag filters with composite bookstr index on orly relay (most efficient)
   * 3. Fall back to other relays if needed
   * 4. Save fetched events to cache
   * 
   * Note: If verse is a range (e.g., "4-5"), we expand it and fetch each verse individually
   * since each verse is a separate event.
   */
  async fetchBookstrEvents(filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): Promise<NEvent[]> {
    logger.info('fetchBookstrEvents: Called', { filters })
    try {
      // Step 1: Check cache FIRST before any network requests
      // This is critical for performance - we should always check cache before making network calls
      const cachedEvents = await this.getCachedBookstrEvents(filters)
      if (cachedEvents.length > 0) {
        logger.info('fetchBookstrEvents: Found cached events (before verse expansion)', {
          count: cachedEvents.length,
          filters
        })
        // Still fetch in background to get updates, but return cached immediately
        this.fetchBookstrEventsFromRelays(filters).catch(err => {
          logger.warn('fetchBookstrEvents: Background fetch failed', { error: err })
        })
        return cachedEvents
      }
      
      // Step 2: If verse is specified and contains a range, expand it and fetch each verse individually
      // Each verse is a separate event, so we need to fetch them separately
      // BUT: Check cache for each verse FIRST before making network requests
      if (filters.verse) {
        const verseNumbers = this.expandVerseRange(filters.verse)
        
        // If we expanded to multiple verses, fetch each one separately and combine results
        if (verseNumbers.length > 1) {
          logger.info('fetchBookstrEvents: Expanding verse range', {
            originalVerse: filters.verse,
            expandedVerses: verseNumbers
          })
          
          const allEvents: NEvent[] = []
          const seenEventIds = new Set<string>()
          
          // Check cache for each verse FIRST before making network requests
          for (const verseNum of verseNumbers) {
            const verseFilter = { ...filters, verse: verseNum.toString() }
            
            // Check cache first for this specific verse
            const verseCachedEvents = await this.getCachedBookstrEvents(verseFilter)
            if (verseCachedEvents.length > 0) {
              logger.info('fetchBookstrEvents: Found cached events for verse', {
                verse: verseNum,
                count: verseCachedEvents.length
              })
              for (const event of verseCachedEvents) {
                if (!seenEventIds.has(event.id)) {
                  seenEventIds.add(event.id)
                  allEvents.push(event)
                }
              }
              // Still fetch in background for this verse
              this.fetchBookstrEventsFromRelays(verseFilter).catch(err => {
                logger.warn('fetchBookstrEvents: Background fetch failed for verse', { verse: verseNum, error: err })
              })
            } else {
              // No cache hit, fetch from network
              const verseEvents = await this.fetchBookstrEvents(verseFilter)
              for (const event of verseEvents) {
                if (!seenEventIds.has(event.id)) {
                  seenEventIds.add(event.id)
                  allEvents.push(event)
                }
              }
            }
          }
          
          logger.info('fetchBookstrEvents: Combined results from verse range', {
            originalVerse: filters.verse,
            expandedVerses: verseNumbers,
            totalEvents: allEvents.length
          })
          
          return allEvents
        }
        // If only one verse after expansion, continue with normal flow
      }
      
      // Step 3: Check cache again (in case verse expansion didn't happen or only one verse)
      // This is redundant but ensures we always check cache
      const finalCachedEvents = await this.getCachedBookstrEvents(filters)
      if (finalCachedEvents.length > 0) {
        logger.info('fetchBookstrEvents: Found cached events (final check)', {
          count: finalCachedEvents.length,
          filters
        })
        // Still fetch in background to get updates, but return cached immediately
        // Skip orly relay in background fetch since it's consistently failing
        this.fetchBookstrEventsFromRelays(filters).catch(err => {
          logger.warn('fetchBookstrEvents: Background fetch failed', { error: err })
        })
        return finalCachedEvents
      }
      
      // Step 2: First try the known book publishing pubkey (most efficient)
      const bookstrPublisherPubkey = '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690'
      let events: NEvent[] = []
      
      try {
        logger.info('fetchBookstrEvents: Querying known book publishing pubkey first', {
          pubkey: bookstrPublisherPubkey,
          filters: JSON.stringify(filters)
        })
        
        events = await this.fetchBookstrEventsFromPublicationPubkey(bookstrPublisherPubkey, filters)
        
        if (events.length > 0) {
          logger.info('fetchBookstrEvents: Successfully fetched from known publisher', {
            eventCount: events.length,
            filters: JSON.stringify(filters)
          })
        }
      } catch (error) {
        logger.warn('fetchBookstrEvents: Error fetching from known publisher', {
          error,
          filters: JSON.stringify(filters)
        })
      }
      
      // Step 3: If no results from known publisher, try fallback relays
      if (events.length === 0) {
        logger.info('fetchBookstrEvents: No results from known publisher, trying fallback relays', {
          filters: JSON.stringify(filters)
        })
        events = await this.fetchBookstrEventsFromRelays(filters)
      }
      
      // Step 4: Save events to cache
      if (events.length > 0) {
        try {
          // Group events by publication (master event)
          const eventsByPubkey = new Map<string, NEvent[]>()
          for (const event of events) {
            if (!eventsByPubkey.has(event.pubkey)) {
              eventsByPubkey.set(event.pubkey, [])
            }
            eventsByPubkey.get(event.pubkey)!.push(event)
          }
          
          // Save each group to cache
          for (const [pubkey, pubEvents] of eventsByPubkey) {
            // Find or create master publication event
            // For now, we'll save content events individually
            // TODO: Find the actual master publication (kind 30040) and link them
            for (const event of pubEvents) {
              await indexedDb.putNonReplaceableEventWithMaster(event, `${ExtendedKind.PUBLICATION}:${pubkey}:`)
            }
          }
          
          logger.info('fetchBookstrEvents: Saved events to cache', {
            count: events.length,
            filters
          })
        } catch (cacheError) {
          logger.warn('fetchBookstrEvents: Error saving to cache', {
            error: cacheError,
            filters
          })
        }
      }
      
      logger.info('fetchBookstrEvents: Final results', {
        filters,
        count: events.length
      })
      
      return events
    } catch (error) {
      logger.warn('Error querying bookstr events', { error, filters })
      return []
    }
  }
  
  /**
   * Get cached bookstr events from IndexedDB
   */
  async getCachedBookstrEvents(filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): Promise<NEvent[]> {
    try {
      const allCached = await indexedDb.getStoreItems(StoreNames.PUBLICATION_EVENTS)
      const cachedEvents: NEvent[] = []
      let checkedCount = 0
      let skippedCount = 0
      
      logger.info('getCachedBookstrEvents: Checking cache', {
        totalCached: allCached.length,
        filters: JSON.stringify(filters)
      })
      
      // If verse is specified, expand it to individual verse numbers
      // Each verse is a separate event, so we need to check each one
      const verseNumbers = filters.verse ? this.expandVerseRange(filters.verse) : null
      
      // Sample a few events to see what's in the cache
      const sampleEvents: any[] = []
      let sampleCount = 0
      
      for (const item of allCached) {
        if (!item?.value) {
          skippedCount++
          continue
        }
        
        const event = item.value as NEvent
        
        // Sample first few 30041 events to see what metadata they have
        if (event.kind === ExtendedKind.PUBLICATION_CONTENT && sampleCount < 5) {
          const metadata = this.extractBookMetadataFromEvent(event)
          sampleEvents.push({
            id: event.id.substring(0, 8),
            kind: event.kind,
            metadata: {
              type: metadata.type,
              book: metadata.book,
              chapter: metadata.chapter,
              verse: metadata.verse,
              version: metadata.version
            }
          })
          sampleCount++
        }
        
        // Check both 30040 (publications) and 30041 (content)
        // For 30040s, we want to find matching publications, then we can fetch their content
        // For 30041s, we want to return matching content directly
        if (event.kind === ExtendedKind.PUBLICATION_CONTENT) {
          checkedCount++
          
          // If verse range was expanded, check each verse individually
          if (verseNumbers && verseNumbers.length > 0) {
            const matchesAnyVerse = verseNumbers.some(verseNum => {
              const verseFilter = { ...filters, verse: verseNum.toString() }
              const matches = this.eventMatchesBookstrFilters(event, verseFilter)
              if (matches) {
                logger.debug('getCachedBookstrEvents: Event matches verse filter', {
                  eventId: event.id.substring(0, 8),
                  eventVerse: this.extractBookMetadataFromEvent(event).verse,
                  verseFilter: verseNum.toString(),
                  filters: JSON.stringify(verseFilter)
                })
              }
              return matches
            })
            if (matchesAnyVerse) {
              cachedEvents.push(event)
            }
          } else {
            // No verse expansion needed, use original filter
            const matches = this.eventMatchesBookstrFilters(event, filters)
            if (matches) {
              logger.debug('getCachedBookstrEvents: Event matches filter', {
                eventId: event.id.substring(0, 8),
                filters: JSON.stringify(filters)
              })
              cachedEvents.push(event)
            }
          }
        } else if (event.kind === ExtendedKind.PUBLICATION) {
          // For 30040s, we check if they match (without verse filtering)
          // If they match, we could potentially return them, but for now we only return 30041s
          // This is because we want to return the actual content, not just the publication index
          checkedCount++
        } else {
          skippedCount++
        }
      }
      
      // Log sample events to help diagnose why nothing matches
      if (sampleEvents.length > 0 && cachedEvents.length === 0) {
        logger.warn('getCachedBookstrEvents: No matches found, showing sample cached events', {
          filters: JSON.stringify(filters),
          sampleEvents,
          totalChecked: checkedCount
        })
      }
      
      logger.info('getCachedBookstrEvents: Cache check complete', {
        totalCached: allCached.length,
        checked: checkedCount,
        skipped: skippedCount,
        matched: cachedEvents.length,
        filters: JSON.stringify(filters)
      })
      
      return cachedEvents
    } catch (error) {
      logger.warn('getCachedBookstrEvents: Error reading cache', { error })
      return []
    }
  }

  /**
   * Query orly and thecitadel relays using publication pubkey
   * This is the optimized path when we have a matching publication
   * Always queries 30040s first, then fetches 30041s from those publications
   */
  private async fetchBookstrEventsFromPublicationPubkey(
    publicationPubkey: string,
    filters: {
      type?: string
      book?: string
      chapter?: number
      verse?: string
      version?: string
    }
  ): Promise<NEvent[]> {
    const thecitadelRelay = 'wss://thecitadel.nostr1.com'
    const prioritizedFallbackRelays = BIG_RELAY_URLS.filter(url => !BOOKSTR_RELAY_URLS.includes(url))
    const prioritizedFallbackRelaysWithCitadel = prioritizedFallbackRelays.includes(thecitadelRelay)
      ? [thecitadelRelay, ...prioritizedFallbackRelays.filter(url => url !== thecitadelRelay)]
      : prioritizedFallbackRelays
    
    logger.info('fetchBookstrEventsFromPublicationPubkey: Querying for 30040 publications by pubkey', {
      pubkey: publicationPubkey,
      filters: JSON.stringify(filters)
    })
    
    let events: NEvent[] = []
    
    try {
      // Query ONLY 30040s (publications/indexes) by pubkey and kind with precise tag filters
      const publicationFilter: Filter = {
        authors: [publicationPubkey],
        kinds: [ExtendedKind.PUBLICATION],
        limit: 500
      }
      
      // Add precise tag filters for collection, title, and chapter
      if (filters.type) {
        publicationFilter['#C'] = [filters.type.toLowerCase()]
      }
      if (filters.book) {
        const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
        publicationFilter['#T'] = [normalizedBook]
      }
      if (filters.chapter !== undefined) {
        publicationFilter['#c'] = [filters.chapter.toString()]
      }
      
      const allPublications = await this.fetchEvents(prioritizedFallbackRelaysWithCitadel, publicationFilter, {
        eoseTimeout: 5000,
        globalTimeout: 8000
      })
      
      logger.info('fetchBookstrEventsFromPublicationPubkey: Fetched 30040 publications', {
        total: allPublications.length,
        filters: JSON.stringify(filters)
      })
      
      // Filter 30040s client-side to find matching book/chapter
      const matchingPublications = allPublications.filter(pub => {
        return this.eventMatchesBookstrFilters(pub, filters)
      })
      
      logger.info('fetchBookstrEventsFromPublicationPubkey: Filtered 30040 publications', {
        total: allPublications.length,
        matching: matchingPublications.length,
        filters: JSON.stringify(filters)
      })
      
      // For each matching 30040, fetch its a-tagged 30041 events (content)
      for (const publication of matchingPublications) {
        const aTags = publication.tags
          .filter(tag => tag[0] === 'a' && tag[1])
          .map(tag => tag[1])
        
        logger.info('fetchBookstrEventsFromPublicationPubkey: Fetching 30041s from matching publication', {
          publicationId: publication.id.substring(0, 8),
          aTagCount: aTags.length,
          filters: JSON.stringify(filters)
        })
        
        // Fetch all a-tagged 30041 events in parallel
        const aTagPromises = aTags.map(async (aTag) => {
          const parts = aTag.split(':')
          if (parts.length < 2) return null
          
          const kind = parseInt(parts[0])
          const pubkey = parts[1]
          const d = parts[2] || ''
          
          // Only fetch 30041 events (content events)
          if (kind !== ExtendedKind.PUBLICATION_CONTENT) {
            return null
          }
          
          const aTagFilter: Filter = {
            authors: [pubkey],
            kinds: [ExtendedKind.PUBLICATION_CONTENT],
            limit: 1
          }
          if (d) {
            aTagFilter['#d'] = [d]
          }
          // Add all precise tag filters: C (collection), T (title), c (chapter), s (section/verse), v (version)
          if (filters.type) {
            aTagFilter['#C'] = [filters.type.toLowerCase()]
          }
          if (filters.book) {
            const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
            aTagFilter['#T'] = [normalizedBook]
          }
          if (filters.chapter !== undefined) {
            aTagFilter['#c'] = [filters.chapter.toString()]
          }
          if (filters.verse) {
            // Section tag (s) is used for verse
            // For verse ranges, we'll need to expand and query each verse
            // For now, just add the first verse if it's a single verse
            const verseParts = filters.verse.split(/[,\s-]+/).map(v => v.trim()).filter(v => v)
            if (verseParts.length === 1 && !verseParts[0].includes('-')) {
              aTagFilter['#s'] = [verseParts[0]]
            }
          }
          if (filters.version) {
            aTagFilter['#v'] = [filters.version.toLowerCase()]
          }
          
          try {
            const aTagEvents = await this.fetchEvents(prioritizedFallbackRelaysWithCitadel, aTagFilter, {
              eoseTimeout: 3000,
              globalTimeout: 5000
            })
            
            // Filter 30041s client-side by book, type, version, chapter, verse
            return aTagEvents.filter(event => {
              return this.eventMatchesBookstrFilters(event, filters)
            })
          } catch (err) {
            logger.debug('fetchBookstrEventsFromPublicationPubkey: Error fetching a-tag event', {
              aTag,
              error: err
            })
            return []
          }
        })
        
        const aTagResults = await Promise.all(aTagPromises)
        const aTagEvents = aTagResults.flat().filter((e): e is NEvent => e !== null)
        
        logger.info('fetchBookstrEventsFromPublicationPubkey: Fetched 30041s from publication', {
          publicationId: publication.id.substring(0, 8),
          fetched: aTagEvents.length,
          totalSoFar: events.length + aTagEvents.length
        })
        
        events.push(...aTagEvents)
      }
      
      if (events.length > 0) {
        logger.info('fetchBookstrEventsFromPublicationPubkey: Successfully fetched content events', {
          publicationCount: matchingPublications.length,
          eventCount: events.length,
          filters: JSON.stringify(filters)
        })
      }
    } catch (error) {
      logger.warn('fetchBookstrEventsFromPublicationPubkey: Error fetching from relays', {
        error,
        filters: JSON.stringify(filters)
      })
    }
    
    return events
  }

  /**
   * Fetch bookstr events from relays
   * Strategy: Query ONLY 30040s (indexes) by type and kind, filter client-side, then fetch 30041s
   */
  private async fetchBookstrEventsFromRelays(filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): Promise<NEvent[]> {
    const thecitadelRelay = 'wss://thecitadel.nostr1.com'
    const fallbackRelays = BIG_RELAY_URLS.filter(url => !BOOKSTR_RELAY_URLS.includes(url))
    const prioritizedFallbackRelays = fallbackRelays.includes(thecitadelRelay)
      ? [thecitadelRelay, ...fallbackRelays.filter(url => url !== thecitadelRelay)]
      : fallbackRelays
    
    logger.info('fetchBookstrEventsFromRelays: Querying for 30040 publications (indexes only)', {
      filters: JSON.stringify(filters),
      relayCount: prioritizedFallbackRelays.length
    })
    
    let events: NEvent[] = []
    
    try {
      const bookstrPublisherPubkey = '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690'
      
      // Query BOTH 30040s (publications/indexes) AND 30041s (content) together
      // Only use #T (title) and #c (chapter) in relay filter - filter #C, #s, #v client-side
      // This matches wikistr's approach and avoids relay compatibility issues
      const publicationFilter: Filter = {
        kinds: [ExtendedKind.PUBLICATION, ExtendedKind.PUBLICATION_CONTENT],
        authors: [bookstrPublisherPubkey],
        limit: 500
      }
      
      // Only add #T (title) and #c (chapter) filters - filter rest client-side
      if (filters.book) {
        // Normalize book name: lowercase, replace spaces with hyphens (NIP-54 style)
        // The parser already normalized it, but ensure consistency
        const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
        publicationFilter['#T'] = [normalizedBook]
      }
      if (filters.chapter !== undefined) {
        publicationFilter['#c'] = [filters.chapter.toString()]
      }
      // Don't include #C, #s, or #v in relay filter - filter client-side instead
      
      const publisherPublications = await this.fetchEvents(prioritizedFallbackRelays, publicationFilter, {
        eoseTimeout: 5000,
        globalTimeout: 8000
      })
      
      logger.info('fetchBookstrEventsFromRelays: Fetched events', {
        count: publisherPublications.length,
        filters: JSON.stringify(filters)
      })
      
      // Filter ALL events (both 30040 and 30041) client-side
      // This matches wikistr's approach - filter #C, #s, #v client-side
      const matchingEvents = publisherPublications.filter(event => {
        return this.eventMatchesBookstrFilters(event, filters)
      })
      
      logger.info('fetchBookstrEventsFromRelays: Filtered events', {
        total: publisherPublications.length,
        matching: matchingEvents.length,
        filters: JSON.stringify(filters)
      })
      
      // Separate 30040s (publications) and 30041s (content)
      // We queried for both kinds, so we get content events directly
      const contentEvents = matchingEvents.filter(e => e.kind === ExtendedKind.PUBLICATION_CONTENT)
      
      events.push(...contentEvents)
      
      // Note: We could also process 30040 publications to fetch their a-tagged 30041s,
      // but since we already queried for 30041s directly, we should have them.
      // If we need more, we can fetch from 30040 a-tags, but for now this is simpler.
      
      if (events.length > 0) {
        logger.info('fetchBookstrEventsFromRelays: Successfully fetched content events', {
          totalQueried: publisherPublications.length,
          matchingAfterFilter: matchingEvents.length,
          contentEvents: events.length,
          filters: JSON.stringify(filters)
        })
        return events
      }
    } catch (pubError) {
      logger.warn('fetchBookstrEventsFromRelays: Error querying publications', {
        error: pubError,
        filters: JSON.stringify(filters)
      })
    }
    
    // If no results from publications approach, try fallback relays for 30040s
    // (This is a fallback in case the publication approach didn't work)
    // BUT: Only query from the known publisher's pubkey to avoid fetching all events
    if (events.length === 0 && prioritizedFallbackRelays.length > 0) {
      logger.info('fetchBookstrEventsFromRelays: Trying fallback relays (30040 query from known publisher)', {
        fallbackRelays: prioritizedFallbackRelays.length,
        prioritized: prioritizedFallbackRelays[0] === thecitadelRelay ? 'thecitadel first' : 'normal order'
      })
      try {
        // Query only 30040s from the known bookstr publisher to avoid fetching all events
        // Do NOT include bookstr tags - these relays don't support them
        // Query by kind and author only, then filter client-side
        const bookstrPublisherPubkey = '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690'
        const fallbackFilter: Filter = {
          kinds: [ExtendedKind.PUBLICATION],
          authors: [bookstrPublisherPubkey],
          limit: 500 // Limit to avoid fetching too many
        }
        
        const fallbackPublications = await this.fetchEvents(prioritizedFallbackRelays, fallbackFilter, {
          eoseTimeout: 5000,
          globalTimeout: 10000
        })
        
        // Filter client-side to match bookstr criteria
        const matchingPublications = fallbackPublications.filter(pub => 
          this.eventMatchesBookstrFilters(pub, filters)
        )
        
        // Fetch a-tagged 30041 events from matching publications
        for (const publication of matchingPublications) {
          const aTags = publication.tags
            .filter(tag => tag[0] === 'a' && tag[1])
            .map(tag => tag[1])
          
          const aTagPromises = aTags.map(async (aTag) => {
            const parts = aTag.split(':')
            if (parts.length < 2) return null
            
            const kind = parseInt(parts[0])
            const pubkey = parts[1]
            const d = parts[2] || ''
            
            if (kind !== ExtendedKind.PUBLICATION_CONTENT) return null
            
            const aTagFilter: Filter = {
              authors: [pubkey],
              kinds: [ExtendedKind.PUBLICATION_CONTENT],
              limit: 1
            }
            if (d) {
              aTagFilter['#d'] = [d]
            }
            
            try {
              const aTagEvents = await this.fetchEvents(prioritizedFallbackRelays, aTagFilter, {
                eoseTimeout: 3000,
                globalTimeout: 5000
              })
              
              // Filter client-side for type, book, and version
              return aTagEvents.filter(event => {
                const metadata = this.extractBookMetadataFromEvent(event)
                
                if (filters.type && metadata.type?.toLowerCase() !== filters.type.toLowerCase()) {
                  return false
                }
                
                if (filters.book) {
                  const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
                  const eventBookTags = event.tags
                    .filter(tag => tag[0] === 'book' && tag[1])
                    .map(tag => tag[1].toLowerCase())
                  const hasMatchingBook = eventBookTags.some(eventBook => 
                    this.bookNamesMatch(eventBook, normalizedBook)
                  )
                  if (!hasMatchingBook) return false
                }
                
                if (filters.version && metadata.version?.toLowerCase() !== filters.version.toLowerCase()) {
                  return false
                }
                
                return true
              })
            } catch (error) {
              logger.debug('fetchBookstrEventsFromRelays: Error fetching a-tag event from fallback', {
                aTag,
                error
              })
              return []
            }
          })
          
          const aTagResults = await Promise.all(aTagPromises)
          const aTagEvents = aTagResults.flat().filter((e): e is NEvent => e !== null)
          events.push(...aTagEvents)
        }
        
        if (events.length > 0) {
          logger.info('fetchBookstrEventsFromRelays: Fetched 30041s from fallback 30040s', {
            publicationCount: matchingPublications.length,
            eventCount: events.length,
            filters: JSON.stringify(filters)
          })
          return events
        }
      } catch (fallbackError) {
        logger.warn('fetchBookstrEventsFromRelays: Error querying fallback relays', {
          error: fallbackError,
          filters
        })
      }
    }
    
    return events
  }

  /**
   * Check if event matches bookstr filters (for client-side filtering)
   * Note: For 30040 publications, we filter by chapter but NOT verse (verses are in 30041 content events)
   */
  private eventMatchesBookstrFilters(event: NEvent, filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): boolean {
    const metadata = this.extractBookMetadataFromEvent(event)
    const isPublication = event.kind === ExtendedKind.PUBLICATION
    
    if (filters.type && metadata.type?.toLowerCase() !== filters.type.toLowerCase()) {
      return false
    }
    if (filters.book) {
      const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
      // Get ALL book tags from the event (events can have multiple book tags)
      // Check 'T' (title/book) tags
      const eventBookTags = event.tags
        .filter(tag => tag[0] === 'T' && tag[1])
        .map(tag => tag[1].toLowerCase())
      
      // Check if any of the book tags match
      const hasMatchingBook = eventBookTags.some(eventBook => 
        this.bookNamesMatch(eventBook, normalizedBook)
      )
      
      if (!hasMatchingBook) {
        // Only log debug for first few mismatches to avoid spam
        if (eventBookTags.length > 0) {
          logger.debug('eventMatchesBookstrFilters: Book mismatch', {
            normalizedBook,
            eventBookTags,
            eventId: event.id.substring(0, 8),
            matches: eventBookTags.map(tag => ({
              tag,
              matches: this.bookNamesMatch(tag, normalizedBook)
            }))
          })
        }
        return false
      }
    }
    // Chapter filtering applies to both 30040 and 30041
    if (filters.chapter !== undefined) {
      const eventChapter = parseInt(metadata.chapter || '0')
      if (eventChapter !== filters.chapter) {
        return false
      }
    }
    // Verse filtering only applies to 30041 content events (not 30040 publications)
    if (filters.verse && !isPublication) {
      const eventVerse = metadata.verse
      if (!eventVerse) return false
      
      const verseParts = filters.verse.split(/[,\s-]+/).map(v => v.trim()).filter(v => v)
      const verseNum = parseInt(eventVerse)
      
      const matches = verseParts.some(part => {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(v => parseInt(v.trim()))
          return !isNaN(start) && !isNaN(end) && verseNum >= start && verseNum <= end
        } else {
          const partNum = parseInt(part)
          return !isNaN(partNum) && partNum === verseNum
        }
      })
      if (!matches) return false
    }
    if (filters.version && metadata.version?.toLowerCase() !== filters.version.toLowerCase()) {
      return false
    }
    
    return true
  }
  

  /**
   * Match book names with fuzzy matching
   * Handles variations like "psalm" vs "psalms", "genesis" vs "the-book-of-genesis", etc.
   */
  private bookNamesMatch(book1: string, book2: string): boolean {
    const normalized1 = book1.toLowerCase().replace(/\s+/g, '-')
    const normalized2 = book2.toLowerCase().replace(/\s+/g, '-')
    
    // Exact match
    if (normalized1 === normalized2) return true
    
    // Remove common suffixes for comparison (e.g., "psalm" vs "psalms")
    const removeSuffix = (str: string) => str.replace(/s$/, '').replace(/s-$/, '-')
    const base1 = removeSuffix(normalized1)
    const base2 = removeSuffix(normalized2)
    if (base1 === base2) return true
    
    // One contains the other
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) return true
    
    // Check if last parts match (e.g., "genesis" matches "the-book-of-genesis")
    const parts1 = normalized1.split('-')
    const parts2 = normalized2.split('-')
    if (parts1.length > 0 && parts2.length > 0) {
      const last1 = removeSuffix(parts1[parts1.length - 1])
      const last2 = removeSuffix(parts2[parts2.length - 1])
      if (last1 === last2) return true
    }
    
    return false
  }
  
  /**
   * Old implementation - keeping for reference but not using
   */
  async fetchBookstrEventsOld(filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): Promise<NEvent[]> {
    logger.info('fetchBookstrEvents: Called', { filters })
    try {
      // Step 1: Determine what level of publication we need
      // - If verse is specified → we need chapter-level publication
      // - If chapter is specified (but no verse) → we need chapter-level publication
      // - If only book is specified → we need book-level publication
      const needsChapterLevel = filters.chapter !== undefined || filters.verse !== undefined
      
      const publicationFilter: Filter = {
        kinds: [ExtendedKind.PUBLICATION]
      }
      
      // Build search terms for finding the publication
      const searchTerms: string[] = []
      if (filters.type) {
        searchTerms.push(filters.type)
      }
      if (filters.book) {
        const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
        const originalBook = filters.book.toLowerCase()
        searchTerms.push(normalizedBook)
        if (normalizedBook !== originalBook) {
          searchTerms.push(originalBook)
        }
      }
      // Only include chapter in search if we need chapter-level publication
      if (needsChapterLevel && filters.chapter !== undefined) {
        searchTerms.push(filters.chapter.toString())
      }
      if (filters.version) {
        searchTerms.push(filters.version)
      }

      const relayUrls = FAST_READ_RELAY_URLS
      
      logger.info('fetchBookstrEvents: Searching for publication', {
        filters,
        needsChapterLevel,
        searchTerms,
        relayUrls: relayUrls.length
      })
      
      // Fetch publications
      logger.info('fetchBookstrEvents: About to fetch publications', {
        relayUrls: relayUrls.length,
        filter: publicationFilter
      })
      
      let publications: NEvent[] = []
      try {
        publications = await this.fetchEvents(relayUrls, publicationFilter, {
          eoseTimeout: 10000,
          globalTimeout: 15000
        })
        
        logger.info('fetchBookstrEvents: Fetched publications', {
          count: publications.length
        })
      } catch (fetchError) {
        logger.error('fetchBookstrEvents: Error fetching publications', {
          error: fetchError,
          filters,
          relayUrls: relayUrls.length
        })
        throw fetchError
      }
      
      // Filter publications by tags
      // For chapter-level: must have matching chapter tag
      // For book-level: must NOT have chapter tag
      const filtersForMatching = { ...filters }
      delete filtersForMatching.verse // Never filter by verse for publication search
      
      // Log sample publications before filtering to debug
      if (publications.length > 0) {
        const samplePub = publications[0]
        const getTagValue = (name: string) => samplePub.tags.find(t => t[0] === name)?.[1]
        logger.info('fetchBookstrEvents: Sample publication before filtering', {
          id: samplePub.id.substring(0, 8),
          kind: samplePub.kind,
          tags: samplePub.tags.map(t => `${t[0]}:${t[1]}`).slice(0, 10),
          type: getTagValue('type'),
          book: getTagValue('book'),
          chapter: getTagValue('chapter'),
          version: getTagValue('version'),
          allTagNames: samplePub.tags.map(t => t[0])
        })
      }
      
      const beforeFilterCount = publications.length
      
      // Step 1: Filter by chapter-level requirement
      publications = publications.filter(event => {
        const getTagValue = (name: string) => event.tags.find(t => t[0] === name)?.[1]
        const hasChapter = getTagValue('chapter') !== undefined
        
        // If we need chapter-level, the publication must have a chapter tag
        // If we need book-level, the publication must NOT have a chapter tag
        if (needsChapterLevel && !hasChapter) {
          return false
        }
        if (!needsChapterLevel && hasChapter) {
          return false
        }
        return true
      })
      
      logger.info('fetchBookstrEvents: After chapter-level filter', {
        beforeFilter: beforeFilterCount,
        afterChapterFilter: publications.length,
        needsChapterLevel
      })
      
      // Step 2: Do fulltext search first (more lenient)
      // For book names, we'll rely on tag matching, so we only do fulltext for type, chapter, and version
      if (searchTerms.length > 0) {
        const beforeFulltext = publications.length
        const sampleBeforeFilter = beforeFulltext > 0 ? publications[0] : null
        
        // Separate book-related terms from other terms
        // Book terms will be handled by tag matching, so we only require non-book terms in fulltext
        const normalizedBook = filters.book ? filters.book.toLowerCase().replace(/\s+/g, '-') : null
        const bookTerms: string[] = []
        if (normalizedBook) {
          bookTerms.push(normalizedBook)
          if (filters.book) {
            bookTerms.push(filters.book.toLowerCase())
          }
        }
        
        publications = publications.filter(event => {
          const contentLower = event.content.toLowerCase()
          const allTags = event.tags.map(t => t.join(' ')).join(' ').toLowerCase()
          const searchableText = `${contentLower} ${allTags}`
          
          // For each search term, check if it matches
          // For book terms, we'll skip fulltext matching (handled by tag matching)
          // For other terms (type, chapter, version), require exact or partial match
          const matches = searchTerms.every(term => {
            const termLower = term.toLowerCase()
            
            // Skip fulltext matching for book terms - they'll be handled by tag matching
            if (bookTerms.some(bookTerm => termLower === bookTerm || termLower.includes(bookTerm) || bookTerm.includes(termLower))) {
              return true // Always pass for book terms in fulltext search
            }
            
            // For other terms, check if they're in the searchable text
            // Also try word-boundary matching for better results
            if (searchableText.includes(termLower)) {
              return true
            }
            
            // Try partial word matching (e.g., "psalm" matches "psalms")
            const termWords = termLower.split(/[-\s]+/).filter(w => w.length > 2)
            if (termWords.length > 0) {
              const hasPartialMatch = termWords.some(word => {
                // Check if the word or its plural/singular form appears
                const wordPlural = word + 's'
                const wordSingular = word.endsWith('s') ? word.slice(0, -1) : word
                return searchableText.includes(word) || 
                       searchableText.includes(wordPlural) || 
                       searchableText.includes(wordSingular)
              })
              if (hasPartialMatch) {
                return true
              }
            }
            
            return false
          })
          return matches
        })
        
        // Log a sample of what didn't match if we filtered everything out
        if (publications.length === 0 && sampleBeforeFilter) {
          const contentLower = sampleBeforeFilter.content.toLowerCase()
          const allTags = sampleBeforeFilter.tags.map(t => t.join(' ')).join(' ').toLowerCase()
          const searchableText = `${contentLower} ${allTags}`
          const missingTerms = searchTerms.filter(term => {
            const termLower = term.toLowerCase()
            if (bookTerms.some(bookTerm => termLower === bookTerm || termLower.includes(bookTerm) || bookTerm.includes(termLower))) {
              return false // Book terms are handled by tag matching
            }
            return !searchableText.includes(termLower)
          })
          logger.info('fetchBookstrEvents: Fulltext search filtered all out', {
            searchTerms,
            missingTerms,
            bookTerms,
            sampleBook: sampleBeforeFilter.tags.find(t => t[0] === 'book')?.[1],
            sampleChapter: sampleBeforeFilter.tags.find(t => t[0] === 'chapter')?.[1],
            sampleSearchableText: searchableText.substring(0, 200)
          })
        }
        
        logger.info('fetchBookstrEvents: After fulltext filter', {
          beforeFulltext,
          afterFulltext: publications.length,
          searchTerms
        })
      }
      
      // Step 3: Do lenient tag matching (only require matches if tags exist)
      publications = publications.filter(event => {
        return this.eventMatchesBookstrFiltersLenient(event, filtersForMatching)
      })
      
      logger.info('fetchBookstrEvents: Filtering results', {
        beforeFilter: beforeFilterCount,
        afterTagFilter: publications.length,
        needsChapterLevel,
        filtersForMatching
      })
      
      logger.info('fetchBookstrEvents: Found publications after filtering', {
        filters,
        needsChapterLevel,
        publicationCount: publications.length
      })
      
      if (publications.length === 0) {
        logger.info('fetchBookstrEvents: No matching publications found', { filters })
        return []
      }
      
      // Step 2: Find the best matching publication
      // Score publications by how well they match (exact matches score higher)
      const scoredPublications = publications.map(pub => {
        let score = 0
        const getTagValue = (name: string) => pub.tags.find(t => t[0] === name)?.[1]
        
        if (filters.type && getTagValue('type')?.toLowerCase() === filters.type.toLowerCase()) {
          score += 10
        }
        if (filters.book) {
          const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
          const eventBook = getTagValue('book')?.toLowerCase()
          if (eventBook === normalizedBook) {
            score += 10
          } else if (eventBook?.includes(normalizedBook) || normalizedBook.includes(eventBook || '')) {
            score += 5
          }
        }
        if (needsChapterLevel && filters.chapter !== undefined) {
          const eventChapter = parseInt(getTagValue('chapter') || '0')
          if (eventChapter === filters.chapter) {
            score += 10
          }
        }
        if (filters.version) {
          const eventVersion = getTagValue('version')?.toLowerCase()
          if (eventVersion === filters.version.toLowerCase()) {
            score += 10
          }
        }
        
        return { pub, score }
      })
      
      // Sort by score (highest first) and take the best match
      scoredPublications.sort((a, b) => b.score - a.score)
      const bestPublication = scoredPublications[0].pub
      
      logger.info('fetchBookstrEvents: Best matching publication', {
        filters,
        publicationId: bestPublication.id.substring(0, 8),
        score: scoredPublications[0].score,
        aTagCount: bestPublication.tags.filter(t => t[0] === 'a').length,
        level: needsChapterLevel ? 'chapter' : 'book'
      })
      
      // Step 3: Recursively fetch ALL content events from nested publications
      // Publications can be nested (book → chapters → verses), so we need to traverse
      // all the way down to the leaves (30041 content events)
      const allContentEvents: NEvent[] = []
      const visitedPublications = new Set<string>() // Prevent infinite loops
      
      const fetchFromPublication = async (publication: NEvent): Promise<void> => {
        const pubId = publication.id
        if (visitedPublications.has(pubId)) {
          return // Already processed this publication
        }
        visitedPublications.add(pubId)
        
        const aTags = publication.tags
          .filter(tag => tag[0] === 'a' && tag[1])
          .map(tag => tag[1])
        
        if (aTags.length === 0) {
          return
        }
        
      logger.info('fetchBookstrEvents: Processing publication a-tags', {
        publicationId: pubId.substring(0, 8),
        aTagCount: aTags.length
      })
        
        // Process all a-tags in parallel
        const promises = aTags.map(async (aTag) => {
          // aTag format: "kind:pubkey:d"
          const parts = aTag.split(':')
          if (parts.length < 2) return null
          
          const kind = parseInt(parts[0])
          const pubkey = parts[1]
          const d = parts[2] || ''
          
          const filter: any = {
            authors: [pubkey],
            kinds: [kind],
            limit: 1
          }
          if (d) {
            filter['#d'] = [d]
          }
          
          const events = await this.fetchEvents(relayUrls, filter, {
            eoseTimeout: 5000,
            globalTimeout: 10000
          })
          
          const event = events[0] || null
          if (!event) return null
          
          // If it's a nested publication (30040), recursively fetch from it
          if (event.kind === ExtendedKind.PUBLICATION) {
            await fetchFromPublication(event)
            return null // Don't add publications to content events
          }
          
          // If it's a content event (30041), add it to our collection
          if (event.kind === ExtendedKind.PUBLICATION_CONTENT) {
            return event
          }
          
          return null
        })
        
        const results = await Promise.all(promises)
        results.forEach(event => {
          if (event) {
            allContentEvents.push(event)
          }
        })
      }
      
      logger.info('fetchBookstrEvents: Starting recursive fetch from publication', {
        publicationId: bestPublication.id.substring(0, 8),
        note: 'Will traverse nested publications to find all content events'
      })
      
      await fetchFromPublication(bestPublication)
      
      logger.info('fetchBookstrEvents: Completed recursive fetch', {
        filters,
        totalFetched: allContentEvents.length,
        publicationsVisited: visitedPublications.size
      })
      
      // Step 4: Filter from cached results to show only what was requested
      // We have all the data, now filter to what they want to display
      let finalEvents = allContentEvents
      
      // Filter by book (if we fetched book-level, this ensures we only show the right book)
      if (filters.book) {
        const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
        finalEvents = finalEvents.filter(event => {
          const metadata = this.extractBookMetadataFromEvent(event)
          return metadata.book?.toLowerCase() === normalizedBook
        })
      }
      
      // Filter by chapter (if we fetched book-level but they want a specific chapter)
      if (filters.chapter !== undefined && !needsChapterLevel) {
        // We fetched book-level, but they want a specific chapter
        finalEvents = finalEvents.filter(event => {
          const metadata = this.extractBookMetadataFromEvent(event)
          return parseInt(metadata.chapter || '0') === filters.chapter
        })
      }
      
      // Filter by verse if specified
      if (filters.verse) {
        finalEvents = finalEvents.filter(event => {
          const metadata = this.extractBookMetadataFromEvent(event)
          const eventVerse = metadata.verse
          if (!eventVerse) return false
          
          const verseParts = filters.verse!.split(/[,\s-]+/).map(v => v.trim()).filter(v => v)
          const verseNum = parseInt(eventVerse)
          
          return verseParts.some(part => {
            if (part.includes('-')) {
              const [start, end] = part.split('-').map(v => parseInt(v.trim()))
              return !isNaN(start) && !isNaN(end) && verseNum >= start && verseNum <= end
            } else {
              const partNum = parseInt(part)
              return !isNaN(partNum) && partNum === verseNum
            }
          })
        })
      }
      
      // Filter by version if specified
      if (filters.version) {
        finalEvents = finalEvents.filter(event => {
          const metadata = this.extractBookMetadataFromEvent(event)
          return metadata.version?.toLowerCase() === filters.version!.toLowerCase()
        })
      }
      
      logger.info('fetchBookstrEvents: Final filtered results', {
        filters,
        totalFetched: allContentEvents.length,
        finalCount: finalEvents.length,
        note: 'All events cached for expansion support'
      })
      
      return finalEvents
    } catch (error) {
      logger.warn('Error querying bookstr events', { error, filters })
      return []
    }
  }
  
  /**
   * Extract book metadata from event tags (helper method)
   * Tags: C (collection), T (title), c (chapter), s (section), v (version)
   */
  private extractBookMetadataFromEvent(event: NEvent): {
    type?: string
    book?: string
    chapter?: string
    verse?: string
    version?: string
  } {
    const metadata: any = {}
    for (const [tag, value] of event.tags) {
      switch (tag) {
        case 'C': // Collection
          metadata.type = value
          break
        case 'T': // Title (book name)
          metadata.book = value
          break
        case 'c': // Chapter
          metadata.chapter = value
          break
        case 's': // Section
          // Section might be used for verse or other metadata
          // If we don't have verse yet, use section as verse
          if (!metadata.verse) {
            metadata.verse = value
          }
          break
        case 'v': // Version
          metadata.version = value
          break
      }
    }
    return metadata
  }

  /**
   * Lenient version of eventMatchesBookstrFilters
   * Only requires exact matches if the tag exists in the event.
   * If a filter is provided but the tag doesn't exist, it still passes
   * (since fulltext search already filtered it).
   */
  private eventMatchesBookstrFiltersLenient(event: NEvent, filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): boolean {
    // Accept both publication and publication content events
    if (event.kind !== ExtendedKind.PUBLICATION && event.kind !== ExtendedKind.PUBLICATION_CONTENT) {
      return false
    }

    const getTagValue = (tagName: string): string | undefined => {
      const tag = event.tags.find(t => t[0] === tagName)
      return tag?.[1]
    }

    // Type: if filter provided, check if tag exists and matches
    if (filters.type) {
      const eventType = getTagValue('type')
      // If tag exists, it must match. If it doesn't exist, we already did fulltext search
      if (eventType && eventType.toLowerCase() !== filters.type.toLowerCase()) {
        return false
      }
    }

    // Book: if filter provided, check if tag exists and matches (exact match only)
    if (filters.book) {
      const eventBook = getTagValue('book')
      const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
      // If tag exists, it must match exactly. If it doesn't exist, we already did fulltext search
      if (eventBook && eventBook.toLowerCase() !== normalizedBook) {
        return false
      }
    }

    // Chapter: if filter provided, check if tag exists and matches
    if (filters.chapter !== undefined) {
      const eventChapter = getTagValue('chapter')
      // If tag exists, it must match. If it doesn't exist, we already did fulltext search
      if (eventChapter && parseInt(eventChapter) !== filters.chapter) {
        return false
      }
    }

    // Version: if filter provided, check if tag exists and matches
    if (filters.version) {
      const eventVersion = getTagValue('version')
      // If tag exists, it must match. If it doesn't exist, we already did fulltext search
      if (eventVersion && eventVersion.toLowerCase() !== filters.version.toLowerCase()) {
        return false
      }
    }

    return true
  }

}

const instance = ClientService.getInstance()
export default instance
