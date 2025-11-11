import { BIG_RELAY_URLS, ExtendedKind, FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS, PROFILE_FETCH_RELAY_URLS, PROFILE_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
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
import { isLocalNetworkUrl, isWebsocketUrl, normalizeUrl } from '@/lib/url'
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
  validateEvent,
  VerifiedEvent
} from 'nostr-tools'
import { AbstractRelay } from 'nostr-tools/abstract-relay'
import indexedDb from './indexed-db.service'

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
  private trendingNotesCache: NEvent[] | null = null

  private userIndex = new FlexSearch.Index({
    tokenize: 'forward'
  })

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
  }

  async determineTargetRelays(
    event: NEvent,
    { specifiedRelayUrls, additionalRelayUrls }: TPublishOptions = {}
  ) {
    if (event.kind === kinds.Report) {
      const targetEventId = event.tags.find(tagNameEquals('e'))?.[1]
      if (targetEventId) {
        return this.getSeenEventRelayUrls(targetEventId)
      }
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
          ExtendedKind.FAVORITE_RELAYS,
          ExtendedKind.BLOSSOM_SERVER_LIST,
          ExtendedKind.RELAY_REVIEW
        ].includes(event.kind)
      ) {
        _additionalRelayUrls.push(...BIG_RELAY_URLS, ...PROFILE_RELAY_URLS)
      } else if (event.kind === ExtendedKind.RSS_FEED_LIST) {
        _additionalRelayUrls.push(...FAST_WRITE_RELAY_URLS, ...PROFILE_RELAY_URLS)
      }

      const relayList = await this.fetchRelayList(event.pubkey)
      relays = (relayList?.write.slice(0, 10) ?? []).concat(
        Array.from(new Set(_additionalRelayUrls)) ?? []
      )
    }

    if (!relays.length) {
      relays.push(...BIG_RELAY_URLS)
    }

    return relays
  }

  async publishEvent(relayUrls: string[], event: NEvent) {
    console.log('🔵 [PublishEvent] Starting publishEvent', {
      eventId: event.id?.substring(0, 8),
      kind: event.kind,
      relayCount: relayUrls.length
    })
    
    const uniqueRelayUrls = Array.from(new Set(relayUrls))
    console.log('🔵 [PublishEvent] Unique relays', { count: uniqueRelayUrls.length, relays: uniqueRelayUrls.slice(0, 5) })
    
    const relayStatuses: { url: string; success: boolean; error?: string }[] = []
    
    return new Promise<{ success: boolean; relayStatuses: typeof relayStatuses; successCount: number; totalCount: number }>((resolve) => {
      let successCount = 0
      let finishedCount = 0
      const errors: { url: string; error: any }[] = []
      
      console.log('🔵 [PublishEvent] Setting up global timeout (30 seconds)')
      let hasResolved = false
      
      // Add a global timeout to prevent hanging - use 30 seconds for faster feedback
      const globalTimeout = setTimeout(() => {
        if (hasResolved) {
          console.log('🔵 [PublishEvent] Already resolved, ignoring timeout')
          return
        }
        
        console.warn('⚠️ [PublishEvent] Global timeout reached!', {
          finishedCount,
          totalRelays: uniqueRelayUrls.length,
          successCount,
          relayStatusesCount: relayStatuses.length
        })
        
        // Mark any unfinished relays as failed
        uniqueRelayUrls.forEach(url => {
          const alreadyFinished = relayStatuses.some(rs => rs.url === url)
          if (!alreadyFinished) {
            console.warn('⚠️ [PublishEvent] Marking relay as timed out', { url })
            relayStatuses.push({ url, success: false, error: 'Timeout: Operation took too long' })
            finishedCount++
          }
        })
        
        // Ensure we resolve even if not all relays finished
        if (!hasResolved) {
          hasResolved = true
          console.log('✅ [PublishEvent] Resolving due to timeout', {
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
      
      console.log('🔵 [PublishEvent] Starting Promise.allSettled for all relays')
      Promise.allSettled(
        uniqueRelayUrls.map(async (url, index) => {
          console.log(`🔵 [PublishEvent] Starting relay ${index + 1}/${uniqueRelayUrls.length}`, { url })
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const that = this
          const isLocal = isLocalNetworkUrl(url)
          const connectionTimeout = isLocal ? 5_000 : 8_000 // 5s for local, 8s for remote
          const publishTimeout = isLocal ? 5_000 : 8_000 // 5s for local, 8s for remote
          
          // Set up a per-relay timeout to ensure we always reach the finally block
          const relayTimeout = setTimeout(() => {
            console.warn(`⚠️ [PublishEvent] Per-relay timeout for ${url}`, { connectionTimeout, publishTimeout })
            // This will be caught in the catch block if the promise is still pending
          }, connectionTimeout + publishTimeout + 2_000) // Add 2s buffer
          
          try {
            // For local relays, add a connection timeout
            let relay: Relay
            console.log(`🔵 [PublishEvent] Ensuring relay connection`, { url, isLocal, connectionTimeout })
            
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
            console.log(`✅ [PublishEvent] Relay connected`, { url })
            
            relay.publishTimeout = publishTimeout
            
            console.log(`🔵 [PublishEvent] Publishing to relay`, { url })
            
            // Wrap publish in a timeout promise
            const publishPromise = relay
              .publish(event)
              .then(() => {
                console.log(`✅ [PublishEvent] Successfully published to relay`, { url })
                this.trackEventSeenOn(event.id, relay)
                successCount++
                relayStatuses.push({ url, success: true })
              })
              .catch((error) => {
                console.warn(`⚠️ [PublishEvent] Publish failed, checking if auth required`, { url, error: error.message })
                if (
                  error instanceof Error &&
                  error.message.startsWith('auth-required') &&
                  !!that.signer
                ) {
                  console.log(`🔵 [PublishEvent] Auth required, attempting authentication`, { url })
                  return relay
                    .auth((authEvt: EventTemplate) => that.signer!.signEvent(authEvt))
                    .then(() => {
                      console.log(`✅ [PublishEvent] Auth successful, retrying publish`, { url })
                      return relay.publish(event)
                    })
                    .then(() => {
                      console.log(`✅ [PublishEvent] Successfully published after auth`, { url })
                      this.trackEventSeenOn(event.id, relay)
                      successCount++
                      relayStatuses.push({ url, success: true })
                    })
                    .catch((authError) => {
                      console.error(`❌ [PublishEvent] Auth or publish failed`, { url, error: authError.message })
                      errors.push({ url, error: authError })
                      relayStatuses.push({ url, success: false, error: authError.message })
                    })
                } else {
                  console.error(`❌ [PublishEvent] Publish failed`, { url, error: error.message })
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
            console.error(`❌ [PublishEvent] Connection or setup failed`, { url, error: error instanceof Error ? error.message : String(error) })
            errors.push({ url, error })
            relayStatuses.push({ 
              url, 
              success: false, 
              error: error instanceof Error ? error.message : 'Connection failed' 
            })
          } finally {
            clearTimeout(relayTimeout)
            const currentFinished = ++finishedCount
            console.log(`🔵 [PublishEvent] Relay finished`, { 
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
              console.log('✅ [PublishEvent] All relays finished, resolving', {
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
                  console.log('✅ [PublishEvent] Resolving early with enough successes', {
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
    let startedCount = 0
    let eosedCount = 0
    let eosed = false
    let closedCount = 0
    const closeReasons: string[] = []
    const subPromises: Promise<{ close: () => void }>[] = []
    relays.forEach((url) => {
      let hasAuthed = false

      subPromises.push(startSub())

      async function startSub() {
        startedCount++
        const relay = await that.pool.ensureRelay(url, { connectionTimeout: 5000 }).catch(() => {
          return undefined
        })
        // cannot connect to relay
        if (!relay) {
          if (!eosed) {
            eosedCount++
            eosed = eosedCount >= startedCount
            oneose?.(eosed)
          }
          return {
            close: () => {}
          }
        }

        return relay.subscribe(filters, {
          receivedEvent: (relay, id) => {
            that.trackEventSeenOn(id, relay)
          },
          alreadyHaveEvent: (id: string) => {
            const have = _knownIds.has(id)
            if (have) {
              return true
            }
            _knownIds.add(id)
            return false
          },
          onevent: (evt: NEvent) => {
            onevent?.(evt)
          },
          oneose: () => {
            // make sure eosed is not called multiple times
            if (eosed) return

            eosedCount++
            eosed = eosedCount >= startedCount
            oneose?.(eosed)
          },
          onclose: (reason: string) => {
            // auth-required
            if (reason.startsWith('auth-required') && !hasAuthed) {
              // already logged in
              if (that.signer) {
                relay
                  .auth(async (authEvt: EventTemplate) => {
                    const evt = await that.signer!.signEvent(authEvt)
                    if (!evt) {
                      throw new Error('sign event failed')
                    }
                    return evt as VerifiedEvent
                  })
                  .then(() => {
                    hasAuthed = true
                    if (!eosed) {
                      subPromises.push(startSub())
                    }
                  })
                  .catch(() => {
                    // ignore
                  })
                return
              }

              // open login dialog
              if (startLogin) {
                startLogin()
                return
              }
            }

            // close the subscription
            closedCount++
            closeReasons.push(reason)
            onclose?.(url, reason)
            if (closedCount >= startedCount) {
              onAllClose?.(closeReasons)
            }
            return
          },
          eoseTimeout: 10_000 // 10s
        })
      }
    })

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
        subPromises.forEach((subPromise) => {
          subPromise
            .then((sub) => {
              sub.close()
            })
            .catch(() => {
              // Silent fail
            })
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

  async fetchTrendingNotes() {
    if (this.trendingNotesCache) {
      return this.trendingNotesCache
    }

    try {
      // Create a timeout promise that rejects after 5 seconds
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('TIMEOUT'))
        }, 5000)
      })

      // Race between the fetch and timeout
      const response = await Promise.race([
        fetch('https://api.nostr.band/v0/trending/notes'),
        timeoutPromise
      ])

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      const events: NEvent[] = []
      for (const note of data.notes ?? []) {
        if (validateEvent(note.event)) {
          events.push(note.event)
          this.addEventToCache(note.event)
          if (note.relays?.length) {
            note.relays.map((r: string) => {
              try {
                const relay = new Relay(r)
                this.trackEventSeenOn(note.event.id, relay)
              } catch {
                return null
              }
            })
          }
        }
      }
      this.trendingNotesCache = events
      return this.trendingNotesCache
    } catch (error) {
      // Re-throw timeout errors so the component can handle them
      // Don't cache on timeout - let the component handle the error state
      if (error instanceof Error && error.message === 'TIMEOUT') {
        throw error
      }
      // For other errors, return empty array and cache it (existing behavior)
      this.trendingNotesCache = []
      return []
    }
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

  async fetchRelayList(pubkey: string): Promise<TRelayList> {
    // Deduplicate concurrent requests for the same pubkey's relay list
    const existingRequest = this.relayListRequestCache.get(pubkey)
    if (existingRequest) {
      return existingRequest
    }
    
    const requestPromise = (async () => {
      try {
        const [relayList] = await this.fetchRelayLists([pubkey])
        return relayList
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
}

const instance = ClientService.getInstance()
export default instance
