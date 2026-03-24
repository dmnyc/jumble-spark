import {
  FAST_READ_RELAY_URLS,
  ExtendedKind,
  FAST_WRITE_RELAY_URLS,
  FIRST_RELAY_RESULT_GRACE_MS,
  KIND_1_BLOCKED_RELAY_URLS,
  MAX_PUBLISH_RELAYS,
  NIP66_DISCOVERY_RELAY_URLS,
  PROFILE_FETCH_RELAY_URLS,
  READ_ONLY_RELAY_URLS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'

/** NIP-01 filter keys only; NIP-50 adds `search` which non-searchable relays reject. */
function filterForRelay(f: Filter, relaySupportsSearch: boolean): Filter {
  if (relaySupportsSearch) return f
  const { search: _search, ...rest } = f
  return rest as Filter
}
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { getProfileFromEvent, getRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { buildDeletionRelayUrls, dispatchTombstonesUpdated } from '@/lib/tombstone-events'
import { hexPubkeysEqual, isValidPubkey, pubkeyToNpub, userIdToPubkey } from '@/lib/pubkey'
import { getPubkeysFromPTags, tagNameEquals } from '@/lib/tag'
import {
  buildPrioritizedWriteRelayUrls,
  dedupeNormalizeRelayUrlsOrdered,
  mergeRelayPriorityLayers,
  relayUrlsLocalsFirst
} from '@/lib/relay-url-priority'
import { stripLocalNetworkRelaysFromRelayList } from '@/lib/relay-list-sanitize'
import { isLocalNetworkUrl, normalizeUrl, simplifyUrl } from '@/lib/url'
import { isSafari } from '@/lib/utils'
import {
  ISigner,
  TProfile,
  TPublishOptions,
  TRelayList,
  TMailboxRelay,
  TSignerType,
  TSubRequestFilter
} from '@/types'
import { sha256 } from '@noble/hashes/sha2'
import dayjs from 'dayjs'
import FlexSearch from 'flexsearch'
import {
  EventTemplate,
  Filter,
  kinds,
  matchFilters,
  Event as NEvent,
  Relay,
  SimplePool,
  VerifiedEvent,
  verifyEvent
} from 'nostr-tools'
import { AbstractRelay } from 'nostr-tools/abstract-relay'
import indexedDb from './indexed-db.service'
import nip66Service from './nip66.service'
import { QueryService } from './client-query.service'

/** Live timeline REQ: dead relays fail fast; EOSE caps “connected but silent” relays. */
const SUBSCRIBE_RELAY_CONNECTION_TIMEOUT_MS = 2800
const SUBSCRIBE_RELAY_EOSE_TIMEOUT_MS = 4800

/**
 * After initial timeline EOSE (incl. grace), events with `created_at` older than this many seconds
 * (relative to wall clock at EOSE) are treated as backlog stragglers and merged into the feed;
 * fresher timestamps go to `onNew` (live / “new notes” UX).
 */
const TIMELINE_STRAGGLER_MAX_AGE_SEC = 600

function summarizeFiltersForRelayLog(filters: Filter[]): Record<string, unknown> {
  const f = filters[0]
  if (!f) return {}
  const out: Record<string, unknown> = {}
  if (f.kinds != null) out.kinds = f.kinds
  if (f.limit != null) out.limit = f.limit
  if (f.authors?.length) out.authorCount = f.authors.length
  if (f.ids?.length) out.idCount = f.ids.length
  if (f.search) out.search = true
  if (f['#p']?.length) out.pTagCount = f['#p'].length
  if (f['#e']?.length) out.eTagCount = f['#e'].length
  if (f['#t']?.length) out.tTagCount = f['#t'].length
  return out
}
import { EventService } from './client-events.service'
import { ReplaceableEventService } from './client-replaceable-events.service'
import { MacroService, createBookstrService } from './client-macro.service'

type TTimelineRef = [string, number]

class ClientService extends EventTarget {
  static instance: ClientService

  signer?: ISigner
  /** Set with signer from NostrProvider; used to skip relay AUTH when read-only (e.g. npub). */
  signerType?: TSignerType
  pubkey?: string
  private pool: SimplePool

  // Sub-services (public for direct access)
  public readonly queryService: QueryService
  public readonly eventService: EventService
  public readonly replaceableEventService: ReplaceableEventService
  public readonly bookstrService: MacroService

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
  /** In-flight {@link fetchRelayList} dedupe: key = viewer pubkey + target pubkey (sanitization depends on viewer). */
  private relayListRequestCache = new Map<string, Promise<TRelayList>>()
  private userIndex = new FlexSearch.Index({
    tokenize: 'forward'
  })


  /**
   * Session-only: connection/publish failures per normalized relay URL. After
   * {@link ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD} strikes we skip that relay for reads and publishes until reload.
   */
  private publishStrikeCount = new Map<string, number>()
  private static readonly SESSION_RELAY_FAILURE_STRIKE_THRESHOLD = 2

  /** Session-only: relay URL -> { successCount, sumLatencyMs } for preferring faster, proven relays when picking "random" relays. */
  private sessionRelayPublishStats = new Map<string, { successCount: number; sumLatencyMs: number }>()

  /**
   * IndexedDB profile index + NIP-66 relay discovery run once per page session; followings prewarm (metadata + kind 10002) runs when logged in.
   * @see {@link runSessionPrewarm}
   */
  private sessionPrewarmBaseCompleted = false

  constructor() {
    super()
    this.pool = new SimplePool()
    this.pool.trackRelays = true

    // Initialize sub-services
    this.queryService = new QueryService(this.pool, {
      shouldSkipRelayForSession: (normalizedUrl) =>
        (this.publishStrikeCount.get(normalizedUrl) ?? 0) >=
        ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD,
      onRelayConnectionFailure: (normalizedUrl) => this.recordSessionRelayFailure(normalizedUrl)
    })
    this.eventService = new EventService(this.queryService)
    this.replaceableEventService = new ReplaceableEventService(
      this.queryService,
      (profileEvent) => this.addUsernameToIndex(profileEvent)
    )
    this.bookstrService = createBookstrService(this.queryService)
  }

  public static getInstance(): ClientService {
    if (!ClientService.instance) {
      ClientService.instance = new ClientService()
    }
    return ClientService.instance
  }

  private async prewarmProfileSearchIndexFromIdb(): Promise<void> {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    let profileRows = 0
    await indexedDb.iterateProfileEvents(async (profileEvent) => {
      this.addUsernameToIndex(profileEvent)
      profileRows += 1
    })
    logger.info('[client] Prewarm: profile @-mention index from IndexedDB done', {
      profileRows,
      ms: typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : undefined
    })
  }

  /**
   * One-shot batch: local profile search index + NIP-66 relay discovery (once per session) + optional following-profile fetch (parallel).
   * Call after Nostr session is ready so it does not compete with the first relay-list REQ.
   */
  async runSessionPrewarm(options: { pubkey: string | null; signal?: AbortSignal }): Promise<void> {
    const signal = options.signal ?? new AbortController().signal
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    const tasks: Promise<unknown>[] = []

    if (!this.sessionPrewarmBaseCompleted) {
      this.sessionPrewarmBaseCompleted = true
      tasks.push(this.prewarmProfileSearchIndexFromIdb(), this.fetchNip66RelayDiscovery())
    }
    if (options.pubkey) {
      tasks.push(this.initUserIndexFromFollowings(options.pubkey, signal))
    }

    if (tasks.length === 0) {
      return
    }

    logger.info('[client] Session prewarm batch started (parallel)', {
      hasPubkey: !!options.pubkey,
      taskCount: tasks.length
    })
    const results = await Promise.allSettled(tasks)
    logger.info('[client] Session prewarm batch finished', {
      ms: typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : undefined,
      results: results.map((r) => r.status)
    })
  }

  // Update signer in query service when it changes
  setSigner(signer: ISigner | undefined, signerType: TSignerType | undefined) {
    this.signer = signer
    this.signerType = signerType
    this.queryService.setSigner(signer, signerType)
  }

  /** NIP-66: fetch relay discovery events (30166) in background to supplement search/NIP support. */
  private async fetchNip66RelayDiscovery(): Promise<void> {
    try {
      const discoveryRelays = Array.from(new Set([...FAST_READ_RELAY_URLS, ...NIP66_DISCOVERY_RELAY_URLS]))
      const events = await this.queryService.query(
        discoveryRelays,
        { kinds: [ExtendedKind.RELAY_DISCOVERY], limit: 2000 },
        undefined,
        { eoseTimeout: 4000, globalTimeout: 8000 }
      )
      if (events.length > 0) {
        const capped = events.length > 2000 ? events.slice(0, 2000) : events
        nip66Service.loadFromEvents(capped)
        logger.info('[client] Prewarm: NIP-66 relay discovery list updated', { count: capped.length })
      }
    } catch (err) {
      logger.warn('[client] Prewarm: NIP-66 relay discovery fetch failed', { err })
    }
  }

  /**
   * NIP-66: fetch 30166 events for a single relay (relay info page). Uses discovery relay set,
   * filter by #d so we get the newest report for this relay and can show monitor (author) info.
   */
  async fetchNip66DiscoveryForRelay(relayUrl: string): Promise<void> {
    const discoveryRelays = Array.from(new Set([...FAST_READ_RELAY_URLS, ...NIP66_DISCOVERY_RELAY_URLS]))
    const dTag = normalizeUrl(relayUrl) || relayUrl
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

  /** Read-only logins (e.g. npub) cannot sign relay AUTH challenges; avoid calling signEvent. */
  private canSignerAuthenticateRelay(): boolean {
    if (!this.signer) return false
    if (this.signerType === 'npub') return false
    return true
  }

  /**
   * Pubkeys to pull **read** (inbox) relays for: `p`/`P` mentions and `e` tag relay pubkey hint (NIP-10).
   * Excludes the event author.
   */
  private collectReplyAndMentionPubkeys(event: NEvent): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (pk: string | undefined) => {
      if (!pk || !isValidPubkey(pk) || pk === event.pubkey || seen.has(pk)) return
      seen.add(pk)
      out.push(pk)
    }
    for (const t of event.tags) {
      const name = t[0]
      const v = t[1]
      const hint = t[3]
      if ((name === 'p' || name === 'P') && v) add(v)
      if (name === 'e' && hint) add(hint)
    }
    return out
  }

  /**
   * Write publish order: user outboxes → author inboxes → favorites → FAST_WRITE → FAST_READ → other.
   * Normalize, dedupe, then cap at {@link MAX_PUBLISH_RELAYS}.
   */
  private filterPublishingRelays(relays: string[], event: NEvent): string[] {
    const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    const kind1BlockedSet = new Set(KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    return dedupeNormalizeRelayUrlsOrdered(
      relays.filter((url) => {
        const n = normalizeUrl(url) || url
        if (readOnlySet.has(n)) return false
        if (event.kind === kinds.ShortTextNote && kind1BlockedSet.has(n)) return false
        return true
      })
    )
  }

  private async prioritizePublishUrlList(
    relayUrls: string[],
    event: NEvent,
    favoriteRelayUrls: string[] = []
  ): Promise<string[]> {
    let userWriteSet = new Set<string>()
    try {
      const rl = await this.fetchRelayList(event.pubkey)
      userWriteSet = new Set(
        (rl?.write ?? [])
          .map((u) => normalizeUrl(u) || u)
          .filter((u): u is string => !!u)
      )
    } catch {
      // ignore
    }

    const ctx = this.collectReplyAndMentionPubkeys(event)
    let authorReadSet = new Set<string>()
    if (ctx.length > 0) {
      const lists = await this.fetchRelayLists(ctx)
      for (const list of lists) {
        for (const u of list?.read ?? []) {
          const n = normalizeUrl(u) || u
          if (n) authorReadSet.add(n)
        }
      }
    }

    const favSet = new Set(
      favoriteRelayUrls.map((f) => normalizeUrl(f) || f).filter((u): u is string => !!u)
    )
    const fastWSet = new Set(
      FAST_WRITE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter((u): u is string => !!u)
    )
    const fastRSet = new Set(
      FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter((u): u is string => !!u)
    )

    const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    const kind1BlockedSet = new Set(KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))

    const t0: string[] = []
    const t1: string[] = []
    const t2: string[] = []
    const t3: string[] = []
    const t4: string[] = []
    const t5: string[] = []
    for (const u of relayUrls) {
      const n = normalizeUrl(u) || u
      if (!n) continue
      if (userWriteSet.has(n)) t0.push(n)
      else if (authorReadSet.has(n)) t1.push(n)
      else if (favSet.has(n)) t2.push(n)
      else if (fastWSet.has(n)) t3.push(n)
      else if (fastRSet.has(n)) t4.push(n)
      else t5.push(n)
    }
    return dedupeNormalizeRelayUrlsOrdered([...t0, ...t1, ...t2, ...t3, ...t4, ...t5])
      .filter((url) => {
        const n = normalizeUrl(url) || url
        if (readOnlySet.has(n)) return false
        if (event.kind === kinds.ShortTextNote && kind1BlockedSet.has(n)) return false
        return true
      })
      .slice(0, MAX_PUBLISH_RELAYS)
  }

  private async capPublishRelayUrlsForPublish(
    relayUrls: string[],
    event: NEvent,
    favoriteRelayUrls: string[] = []
  ): Promise<string[]> {
    return this.prioritizePublishUrlList(relayUrls, event, favoriteRelayUrls)
  }

  /**
   * Determine which relays to publish an event to.
   * Fallbacks (used when user relay list is empty or fetch fails):
   * - General events (reactions, notes, etc.): FAST_WRITE_RELAY_URLS
   * - Relay list / cache relays / contacts: FAST_READ_RELAY_URLS + PROFILE_RELAY_URLS (added to additional)
   * - Favorite relays: FAST_WRITE_RELAY_URLS (added to additional)
   * - Report events: FAST_WRITE_RELAY_URLS when no user/seen relays
   */
  async determineTargetRelays(
    event: NEvent,
    { specifiedRelayUrls, additionalRelayUrls, favoriteRelayUrls, blockedRelayUrls }: TPublishOptions = {}
  ) {
    const writeRelayPubOpts = {
      blockedRelays: blockedRelayUrls,
      applyKind1BlockedFilter: event.kind === kinds.ShortTextNote
    }
    if (event.kind === kinds.RelayList) {
      logger.info('[DetermineTargetRelays] Determining target relays for relay list event', {
        pubkey: event.pubkey,
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
      const userWriteRelays = dedupeNormalizeRelayUrlsOrdered(
        (relayList?.write ?? []).map((url) => normalizeUrl(url) || url).filter((u): u is string => !!u)
      )
      
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
      
      if (userWriteRelays.length === 0 && seenRelays.length === 0) {
        return this.filterPublishingRelays(
          buildPrioritizedWriteRelayUrls({
            userWriteRelays: [...FAST_WRITE_RELAY_URLS],
            favoriteRelays: favoriteRelayUrls ?? [],
            maxRelays: MAX_PUBLISH_RELAYS,
            ...writeRelayPubOpts
          }),
          event
        )
      }
      return this.filterPublishingRelays(
        buildPrioritizedWriteRelayUrls({
          userWriteRelays: userWriteRelays,
          authorReadRelays: [],
          favoriteRelays: favoriteRelayUrls ?? [],
          extraRelays: seenRelays,
          maxRelays: MAX_PUBLISH_RELAYS,
          ...writeRelayPubOpts
        }),
        event
      )
    }

    // Public messages (kind 24) and calendar RSVPs (kind 31925): only author's outboxes + each recipient's
    // inboxes — no user favorites, FAST_WRITE, or FAST_READ padding (see relay-selection getPublicMessageRelays).
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
      let pubRelays = mergeRelayPriorityLayers(
        [relayUrlsLocalsFirst(authorWrite), dedupeNormalizeRelayUrlsOrdered(recipientRead)],
        blockedRelayUrls,
        MAX_PUBLISH_RELAYS,
        { applyKind1BlockedFilter: false }
      )
      pubRelays = this.filterPublishingRelays(pubRelays, event)
      logger.debug('[DetermineTargetRelays] Public message / calendar RSVP: author outbox + recipient inboxes only', {
        kind: event.kind,
        relayCount: pubRelays.length,
        authorWriteCount: authorWrite.length,
        recipientReadCount: recipientRead.length
      })
      if (pubRelays.length > 0) return pubRelays
      return this.filterPublishingRelays(
        mergeRelayPriorityLayers(
          [relayUrlsLocalsFirst([...FAST_WRITE_RELAY_URLS])],
          blockedRelayUrls,
          MAX_PUBLISH_RELAYS,
          { applyKind1BlockedFilter: false }
        ),
        event
      )
    }

    let relays: string[]
    if (specifiedRelayUrls?.length) {
      relays = specifiedRelayUrls
    } else {
      // Kind 777 spells: merged write list (kind 10002 outbox + kind 10432 CACHE_RELAYS) + fast write.
      if (event.kind === ExtendedKind.SPELL) {
        let spellRelayList: TRelayList | undefined
        try {
          spellRelayList = await this.fetchRelayList(event.pubkey)
        } catch (err) {
          logger.warn('[DetermineTargetRelays] fetchRelayList failed for spell', {
            pubkey: event.pubkey,
            error: err instanceof Error ? err.message : String(err)
          })
          spellRelayList = { write: [], read: [], originalRelays: [] }
        }
        const normalizedWrite = dedupeNormalizeRelayUrlsOrdered(
          (spellRelayList?.write ?? [])
            .map((url) => normalizeUrl(url))
            .filter((url): url is string => !!url)
        )
        const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u))
        const spellWriteFiltered = normalizedWrite.filter((url) => {
          const n = normalizeUrl(url) || url
          return !readOnlySet.has(n)
        })
        return this.filterPublishingRelays(
          buildPrioritizedWriteRelayUrls({
            userWriteRelays:
              spellWriteFiltered.length > 0
                ? spellWriteFiltered
                : dedupeNormalizeRelayUrlsOrdered(FAST_WRITE_RELAY_URLS),
            favoriteRelays: favoriteRelayUrls ?? [],
            extraRelays: [],
            maxRelays: MAX_PUBLISH_RELAYS,
            ...writeRelayPubOpts
          }),
          event
        )
      }

      const bootstrapExtras: string[] = [...(additionalRelayUrls ?? [])]
      let authorInboxFromContext: string[] = []
      if (!specifiedRelayUrls?.length && ![kinds.Contacts, kinds.Mutelist].includes(event.kind)) {
        const ctxPubkeys = this.collectReplyAndMentionPubkeys(event)
        if (ctxPubkeys.length > 0) {
          const relayLists = await this.fetchRelayLists(ctxPubkeys)
          relayLists.forEach((relayList) => {
            for (const u of relayList.read ?? []) {
              const n = normalizeUrl(u) || u
              if (n) authorInboxFromContext.push(n)
            }
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
        bootstrapExtras.push(...PROFILE_FETCH_RELAY_URLS)
        logger.debug('[DetermineTargetRelays] Relay list event detected, adding PROFILE_FETCH_RELAY_URLS', {
          kind: event.kind,
          profileFetchRelays: PROFILE_FETCH_RELAY_URLS,
          additionalRelayCount: bootstrapExtras.length
        })
      } else if (event.kind === ExtendedKind.FAVORITE_RELAYS || event.kind === kinds.Relaysets) {
        // Use fast write relays for favorite-relays and kind 30002 relay-set replaceables to avoid
        // timeouts and auth-only relays dominating the attempt list.
        bootstrapExtras.push(...FAST_WRITE_RELAY_URLS)
        logger.debug('[DetermineTargetRelays] Favorite relays or relay set event, adding FAST_WRITE_RELAY_URLS', {
          kind: event.kind,
          fastWriteRelays: FAST_WRITE_RELAY_URLS,
          additionalRelayCount: bootstrapExtras.length
        })
      } else if (event.kind === ExtendedKind.RSS_FEED_LIST) {
        bootstrapExtras.push(...FAST_WRITE_RELAY_URLS, ...PROFILE_FETCH_RELAY_URLS)
      }

      if (
        event.kind === kinds.RelayList ||
        event.kind === ExtendedKind.FAVORITE_RELAYS ||
        event.kind === kinds.Relaysets
      ) {
        logger.debug('[DetermineTargetRelays] Fetching user relay list for event publication', {
          pubkey: event.pubkey,
          kind: event.kind
        })
      }
      let relayList: TRelayList | undefined
      try {
        relayList = await this.fetchRelayList(event.pubkey)
      } catch (err) {
        logger.warn('[DetermineTargetRelays] fetchRelayList failed, using fallback relays', {
          pubkey: event.pubkey,
          error: err instanceof Error ? err.message : String(err)
        })
        relayList = { write: [], read: [], originalRelays: [] }
      }
      if (
        event.kind === kinds.RelayList ||
        event.kind === ExtendedKind.FAVORITE_RELAYS ||
        event.kind === kinds.Relaysets
      ) {
        logger.debug('[DetermineTargetRelays] User relay list fetched', {
          hasRelayList: !!relayList,
          writeRelayCount: relayList?.write?.length ?? 0,
          readRelayCount: relayList?.read?.length ?? 0,
          writeRelays: relayList?.write?.slice(0, 10) ?? []
        })
      }
      const userWritesOrdered = dedupeNormalizeRelayUrlsOrdered(
        (relayList?.write ?? []).map((u) => normalizeUrl(u) || u).filter((u): u is string => !!u)
      )
      relays = this.filterPublishingRelays(
        buildPrioritizedWriteRelayUrls({
          userWriteRelays: userWritesOrdered,
          authorReadRelays: authorInboxFromContext,
          favoriteRelays: favoriteRelayUrls ?? [],
          extraRelays: bootstrapExtras,
          maxRelays: MAX_PUBLISH_RELAYS,
          ...writeRelayPubOpts
        }),
        event
      )
      if (
        event.kind === kinds.RelayList ||
        event.kind === ExtendedKind.FAVORITE_RELAYS ||
        event.kind === kinds.Relaysets
      ) {
        logger.info('[DetermineTargetRelays] Final relay list for event publication', {
          kind: event.kind,
          totalRelayCount: relays.length,
          userWriteRelays: userWritesOrdered.slice(0, MAX_PUBLISH_RELAYS),
          additionalRelays: dedupeNormalizeRelayUrlsOrdered(bootstrapExtras),
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

    relays = this.filterPublishingRelays(relays, event)

    if (specifiedRelayUrls?.length) {
      relays = await this.prioritizePublishUrlList(relays, event, favoriteRelayUrls ?? [])
    } else {
      relays = dedupeNormalizeRelayUrlsOrdered(relays).slice(0, MAX_PUBLISH_RELAYS)
    }
    return relays
  }

  /** One failed publish or subscribe connection per normalized URL (accumulates until {@link SESSION_RELAY_FAILURE_STRIKE_THRESHOLD}). */
  private recordSessionRelayFailure(url: string) {
    const n = normalizeUrl(url) || url
    if (!n) return
    const count = (this.publishStrikeCount.get(n) ?? 0) + 1
    this.publishStrikeCount.set(n, count)
    if (count >= ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD) {
      logger.info('[Relay] Session strike threshold — relay skipped for reads/publishes until reload', {
        url: n,
        strikes: count
      })
    }
  }

  private filterSessionStrikedRelays(urls: string[]): string[] {
    return urls.filter((u) => {
      const n = normalizeUrl(u) || u
      return (this.publishStrikeCount.get(n) ?? 0) < ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD
    })
  }

  /** Record a successful publish and its latency for session-based preference when selecting random relays. */
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

  /**
   * Relays that returned OK on at least one publish this session — merged ahead of NIP-66 lively list
   * so they stay in the random-relay pool even if not currently in monitoring data.
   */
  getSessionSuccessfulPublishRelayUrlsForRandomPool(): string[] {
    const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    const out: string[] = []
    for (const [url, stats] of this.sessionRelayPublishStats.entries()) {
      if (stats.successCount < 1) continue
      const n = normalizeUrl(url) || url
      if (!n || readOnlySet.has(n)) continue
      if ((this.publishStrikeCount.get(n) ?? 0) >= ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD) continue
      out.push(n)
    }
    out.sort((a, b) => {
      const sa = this.sessionRelayPublishStats.get(a)!
      const sb = this.sessionRelayPublishStats.get(b)!
      if (sb.successCount !== sa.successCount) return sb.successCount - sa.successCount
      return sa.sumLatencyMs / sa.successCount - sb.sumLatencyMs / sb.successCount
    })
    return out
  }

  /**
   * Session-only debug info for the Session Relays settings tab: working/striked preset relays and scored random relays.
   * Strikes accrue from failed publishes and failed subscribe/query connections (same counter).
   */
  getSessionRelayDebug(): {
    strikedUrls: string[]
    scoredRelays: { url: string; successCount: number; avgLatencyMs: number }[]
    presetWorking: string[]
    presetStriked: string[]
  } {
    const presetSet = new Set<string>()
    for (const u of [...FAST_WRITE_RELAY_URLS, ...FAST_READ_RELAY_URLS]) {
      const n = normalizeUrl(u) || u
      if (n) presetSet.add(n)
    }
    const preset = Array.from(presetSet)
    const strikedUrls = Array.from(this.publishStrikeCount.entries())
      .filter(([, count]) => count >= ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD)
      .map(([url]) => url)
    const presetStriked = preset.filter(
      (url) => (this.publishStrikeCount.get(url) ?? 0) >= ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD
    )
    const presetWorking = preset.filter(
      (url) => (this.publishStrikeCount.get(url) ?? 0) < ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD
    )
    const scoredRelays = Array.from(this.sessionRelayPublishStats.entries()).map(([url, s]) => ({
      url,
      successCount: s.successCount,
      avgLatencyMs: Math.round(s.sumLatencyMs / s.successCount)
    }))
    scoredRelays.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)
    return { strikedUrls, scoredRelays, presetWorking, presetStriked }
  }

  /**
   * From a list of candidate relay URLs (e.g. public lively), return up to `count` relays,
   * preferring those that have succeeded and been fast this session. Excludes 3-strike and read-only relays.
   */
  getPreferredRelaysForRandom(candidateUrls: string[], count: number): string[] {
    const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    const normalizedCandidates = candidateUrls
      .map((u) => normalizeUrl(u) || u)
      .filter((n) => n && !readOnlySet.has(n))
    const unique = Array.from(new Set(normalizedCandidates))
    const notStruckOut = unique.filter(
      (n) => (this.publishStrikeCount.get(n) ?? 0) < ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD
    )
    const preferred: string[] = []
    const rest: string[] = []
    for (const url of notStruckOut) {
      const stats = this.sessionRelayPublishStats.get(url)
      if (stats && stats.successCount >= 1) preferred.push(url)
      else rest.push(url)
    }
    preferred.sort((a, b) => {
      const sa = this.sessionRelayPublishStats.get(a)!
      const sb = this.sessionRelayPublishStats.get(b)!
      if (sb.successCount !== sa.successCount) return sb.successCount - sa.successCount
      const avgA = sa.sumLatencyMs / sa.successCount
      const avgB = sb.sumLatencyMs / sb.successCount
      return avgA - avgB
    })
    const result: string[] = []
    let pi = 0
    let ri = 0
    // Preserve candidate order (e.g. NIP-66 write-proven relays first); avoid full shuffle so monitoring hints apply.
    const orderedRest = rest.slice()
    while (result.length < count && (pi < preferred.length || ri < orderedRest.length)) {
      if (pi < preferred.length) {
        result.push(preferred[pi++])
      } else if (ri < orderedRest.length) {
        result.push(orderedRest[ri++])
      }
    }
    return result.slice(0, count)
  }

  async publishEvent(
    relayUrls: string[],
    event: NEvent,
    publishExtras?: { favoriteRelayUrls?: string[] }
  ) {
    const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    const kind1BlockedSet = new Set(KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    let filtered = relayUrls.filter((url) => {
      const n = normalizeUrl(url) || url
      if (readOnlySet.has(n)) return false
      if (event.kind === kinds.ShortTextNote && kind1BlockedSet.has(n)) return false
      const strikes = this.publishStrikeCount.get(n) ?? 0
      if (strikes >= ClientService.SESSION_RELAY_FAILURE_STRIKE_THRESHOLD) return false
      return true
    })
    filtered = Array.from(new Set(filtered))
    filtered = await this.capPublishRelayUrlsForPublish(
      filtered,
      event,
      publishExtras?.favoriteRelayUrls ?? []
    )

    logger.debug('[PublishEvent] Starting publishEvent', {
      eventId: event.id?.substring(0, 8),
      kind: event.kind,
      relayCount: filtered.length,
      skippedStrikes: relayUrls.length - filtered.length
    })

    const uniqueRelayUrls = filtered
    if (
      event.kind === kinds.RelayList ||
      event.kind === ExtendedKind.FAVORITE_RELAYS ||
      event.kind === kinds.Relaysets
    ) {
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
    
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const client = this
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
            client.recordSessionRelayFailure(url)
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
          const startMs = Date.now()
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
                that.recordPublishSuccess(url, Date.now() - startMs)
                this.trackEventSeenOn(event.id, relay)
                successCount++
                relayStatuses.push({ url, success: true })
              })
              .catch((error) => {
                logger.warn(`[PublishEvent] Publish failed, checking if auth required`, { url, error: error.message })
                if (
                  error instanceof Error &&
                  error.message.startsWith('auth-required') &&
                  that.canSignerAuthenticateRelay()
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
                      that.recordPublishSuccess(url, Date.now() - startMs)
                      this.trackEventSeenOn(event.id, relay)
                      successCount++
                      relayStatuses.push({ url, success: true })
                    })
                    .catch((authError) => {
                      logger.error(`[PublishEvent] Auth or publish failed`, { url, error: authError.message })
                      errors.push({ url, error: authError })
                      relayStatuses.push({ url, success: false, error: authError.message })
                      that.recordSessionRelayFailure(url)
                    })
                } else {
                  logger.error(`[PublishEvent] Publish failed`, { url, error: error.message })
                  errors.push({ url, error })
                  relayStatuses.push({ url, success: false, error: error.message })
                  that.recordSessionRelayFailure(url)
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
            that.recordSessionRelayFailure(url)
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
      needSort = true,
      firstRelayResultGraceMs = FIRST_RELAY_RESULT_GRACE_MS
    }: {
      startLogin?: () => void
      needSort?: boolean
      /** Passed to each shard’s {@link ClientService._subscribeTimeline}: 2s after first event completes initial load if EOSE is slower. */
      firstRelayResultGraceMs?: number
    } = {}
  ) {
    const timelineBatchId = `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
    const timelineT0 = performance.now()
    logger.debug('[relay-req] timeline_batch_start', {
      timelineBatchId,
      subRequestCount: subRequests.length,
      relayCounts: subRequests.map((r) => r.urls.length)
    })

    const newEventIdSet = new Set<string>()
    const requestCount = subRequests.length
    let eventIdSet = new Set<string>()
    let events: NEvent[] = []
    let eosedCount = 0
    /** One merged buffer — slice using the largest child `limit` so a later child with a smaller limit cannot drop other relays’ events. */
    const mergedTimelineLimit = Math.max(
      500,
      ...subRequests.map(({ filter }) =>
        typeof filter.limit === 'number' && filter.limit > 0 ? filter.limit : 0
      )
    )

    let firstPaintLogged = false
    const deliverTimelineToConsumer = (snapshot: NEvent[], allEosed: boolean) => {
      if (!firstPaintLogged && snapshot.length > 0) {
        firstPaintLogged = true
        logger.debug('[relay-req] first_paint', {
          timelineBatchId,
          phase: 'data_to_feed',
          rowCount: snapshot.length,
          allEosed,
          ms: Math.round(performance.now() - timelineT0)
        })
      }
      onEvents(snapshot, allEosed)
    }

    let outerFlushQueued = false
    let outerFlushBump = 0
    const scheduleOuterFlush = (immediate = false) => {
      const run = () => {
        outerFlushQueued = false
        const snapshot = events.length ? [...events] : []
        const allEosed = eosedCount >= requestCount
        deliverTimelineToConsumer(snapshot, allEosed)
      }
      if (immediate || eosedCount >= requestCount || events.length <= 1) {
        outerFlushBump++
        outerFlushQueued = false
        run()
        return
      }
      if (!outerFlushQueued) {
        outerFlushQueued = true
        const b = outerFlushBump
        queueMicrotask(() => {
          if (b !== outerFlushBump) return
          run()
        })
      }
    }

    const subs = await Promise.all(
      subRequests.map(({ urls, filter }, shardIndex) => {
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
              events = events
                .sort((a, b) => b.created_at - a.created_at)
                .slice(0, mergedTimelineLimit)
              eventIdSet = new Set(events.map((evt) => evt.id))

              scheduleOuterFlush(!!_eosed)
            },
            onNew: (evt) => {
              if (newEventIdSet.has(evt.id)) return
              newEventIdSet.add(evt.id)
              onNew(evt)
            },
            onClose
          },
          {
            startLogin,
            needSort,
            firstRelayResultGraceMs,
            relayReqLog: { groupId: `${timelineBatchId}:shard${shardIndex}` }
          }
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

  /**
   * Check if a timeline has more events available (either cached or from network)
   */
  hasMoreTimelineEvents(key: string, until: number): boolean {
    const timeline = this.timelines[key]
    if (!timeline) return false

    if (Array.isArray(timeline)) {
      // For multiple timelines, check if any has more events
      return timeline.some((subKey) => {
        const subTimeline = this.timelines[subKey]
        if (!subTimeline || Array.isArray(subTimeline)) return false
        const { refs } = subTimeline
        // Check if there are refs with created_at <= until that we haven't loaded
        return refs.some(([, createdAt]) => createdAt <= until)
      })
    }

    const { refs } = timeline
    // Check if there are refs with created_at <= until that we haven't loaded
    return refs.some(([, createdAt]) => createdAt <= until)
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
    },
    relayReqLog?: { groupId?: string }
  ) {
    let relays = Array.from(new Set(urls))
    const filters = Array.isArray(filter) ? filter : [filter]

    const hasKind1 = filters.some((f) => f.kinds && (Array.isArray(f.kinds) ? f.kinds.includes(1) : f.kinds === 1))
    if (hasKind1 && KIND_1_BLOCKED_RELAY_URLS.length > 0) {
      const kind1BlockedSet = new Set(KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
      relays = relays.filter((url) => !kind1BlockedSet.has(normalizeUrl(url) || url))
    }
    relays = this.filterSessionStrikedRelays(relays)

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

    // Kind-1 queries drop KIND_1_BLOCKED_RELAY_URLS; if every URL was removed, no subs run and
    // oneose would never fire — timelines stay loading forever (e.g. favorites feed).
    if (groupedRequests.length === 0) {
      logger.debug('[relay-req] batch_skip', {
        reason: 'no_relays_after_filters',
        filterSummary: summarizeFiltersForRelayLog(filters)
      })
      queueMicrotask(() => oneose?.(true))
      return {
        close: () => {}
      }
    }

    const reqGroupId =
      relayReqLog?.groupId ??
      `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const reqT0 = performance.now()
    let firstRelayResponseLogged = false
    /** When the first `first_response` was `eose` (no row yet), log once when the first EVENT arrives. */
    let awaitingFirstEventAfterEoseFirstResponse = false
    const logFirstRelayResponse = (kind: 'event' | 'eose', relayUrl: string) => {
      if (firstRelayResponseLogged) return
      firstRelayResponseLogged = true
      if (kind === 'eose') awaitingFirstEventAfterEoseFirstResponse = true
      logger.debug('[relay-req] first_response', {
        reqGroupId,
        kind,
        relayUrl,
        ms: Math.round(performance.now() - reqT0)
      })
    }
    const logFirstEventIfFirstResponseWasEmpty = (evt: NEvent, relayKey: string) => {
      if (!awaitingFirstEventAfterEoseFirstResponse) return
      awaitingFirstEventAfterEoseFirstResponse = false
      logger.debug('[relay-req] first_event', {
        reqGroupId,
        relayUrl: relayKey,
        eventId: evt.id,
        eventKind: evt.kind,
        ms: Math.round(performance.now() - reqT0),
        note: 'first_relay_response_was_eose_not_event'
      })
    }

    logger.debug('[relay-req] batch_start', {
      reqGroupId,
      relayCount: groupedRequests.length,
      relays: groupedRequests.map((r) => r.url),
      filterSummary: summarizeFiltersForRelayLog(filters)
    })

    const eosesReceived: boolean[] = []
    const closesReceived: (string | undefined)[] = []
    const handleEose = (i: number) => {
      if (eosesReceived[i]) return
      eosesReceived[i] = true
      logFirstRelayResponse('eose', groupedRequests[i]!.url)
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

    const forwardOnevent = onevent
      ? (evt: NEvent) => {
          if (shouldDropEventOnIngest(evt)) return
          onevent(evt)
        }
      : undefined

    const subs: { relayKey: string; close: () => void }[] = []
    const allOpened = Promise.all(
      groupedRequests.map(async ({ url, filters: relayFilters }, i) => {
        await that.queryService.acquireGlobalRelayConnectionSlot()
        try {
          const relayKey = normalizeUrl(url) || url
          await that.queryService.acquireSubSlot(relayKey)
          let relay: AbstractRelay
          try {
            relay = await that.pool.ensureRelay(url, { connectionTimeout: SUBSCRIBE_RELAY_CONNECTION_TIMEOUT_MS })
          } catch (err) {
            that.recordSessionRelayFailure(url)
            that.queryService.releaseSubSlot(relayKey)
            handleClose(i, (err as Error)?.message ?? String(err))
            return
          }

          let slotReleased = false
          const releaseOnce = () => {
            if (!slotReleased) {
              slotReleased = true
              that.queryService.releaseSubSlot(relayKey)
            }
          }

          const sub = relay.subscribe(relayFilters, {
            receivedEvent: (_relay, id) => that.trackEventSeenOn(id, _relay),
            onevent: (evt: NEvent) => {
              logFirstEventIfFirstResponseWasEmpty(evt, relayKey)
              logFirstRelayResponse('event', relayKey)
              forwardOnevent?.(evt)
            },
            oneose: () => handleEose(i),
            onclose: (reason: string) => {
              releaseOnce()
              if (reason.startsWith('auth-required: ') && that.canSignerAuthenticateRelay()) {
                relay
                  .auth(async (authEvt: EventTemplate) => {
                    const evt = await that.signer!.signEvent(authEvt)
                    if (!evt) throw new Error('sign event failed')
                    return evt as VerifiedEvent
                  })
                  .then(async () => {
                    await that.queryService.acquireGlobalRelayConnectionSlot()
                    try {
                      await that.queryService.acquireSubSlot(relayKey)
                      // After AUTH the socket may be closed or the relay dropped from the pool;
                      // resubscribe on a fresh connection from ensureRelay (fixes SendingOnClosedConnection).
                      let liveRelay: AbstractRelay
                      try {
                        liveRelay = await that.pool.ensureRelay(url, {
                          connectionTimeout: SUBSCRIBE_RELAY_CONNECTION_TIMEOUT_MS
                        })
                      } catch (err) {
                        that.recordSessionRelayFailure(url)
                        that.queryService.releaseSubSlot(relayKey)
                        handleClose(i, (err as Error)?.message ?? String(err))
                        return
                      }
                      let slotReleased2 = false
                      const releaseSlot2 = () => {
                        if (!slotReleased2) {
                          slotReleased2 = true
                          that.queryService.releaseSubSlot(relayKey)
                        }
                      }
                      try {
                        const sub2 = liveRelay.subscribe(relayFilters, {
                          receivedEvent: (_relay, id) => that.trackEventSeenOn(id, _relay),
                          onevent: (evt: NEvent) => {
                            logFirstEventIfFirstResponseWasEmpty(evt, relayKey)
                            logFirstRelayResponse('event', relayKey)
                            forwardOnevent?.(evt)
                          },
                          oneose: () => handleEose(i),
                          onclose: (reason2: string) => {
                            releaseSlot2()
                            handleClose(i, reason2)
                          },
                          alreadyHaveEvent: localAlreadyHaveEvent,
                          eoseTimeout: SUBSCRIBE_RELAY_EOSE_TIMEOUT_MS
                        })
                        logger.debug('[relay-req] req_sent', {
                          reqGroupId,
                          url: relayKey,
                          ms: Math.round(performance.now() - reqT0),
                          note: 'after_auth'
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
                      that.queryService.releaseGlobalRelayConnectionSlot()
                    }
                  })
                  .catch((err) => {
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
            eoseTimeout: SUBSCRIBE_RELAY_EOSE_TIMEOUT_MS
          })
          logger.debug('[relay-req] req_sent', {
            reqGroupId,
            url: relayKey,
            ms: Math.round(performance.now() - reqT0)
          })
          subs.push({
            relayKey,
            close: () => {
              releaseOnce()
              sub.close()
            }
          })
        } finally {
          that.queryService.releaseGlobalRelayConnectionSlot()
        }
      })
    )

    const handleNewEventFromInternal = (data: Event) => {
      const customEvent = data as CustomEvent<NEvent>
      const evt = customEvent.detail
      if (!matchFilters(filters, evt)) return
      if (shouldDropEventOnIngest(evt)) return

      const id = evt.id
      const have = _knownIds.has(id)
      if (have) return

      _knownIds.add(id)
      forwardOnevent?.(evt)
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
      needSort = true,
      /**
       * After the **first** stored event arrives from any relay, wait this long then treat the initial
       * backlog as complete (same as aggregate EOSE): enables pagination + live `onNew` without waiting for
       * every slow/hung relay. Real EOSE still clears the timer and completes earlier if all relays finish first.
       */
      firstRelayResultGraceMs = FIRST_RELAY_RESULT_GRACE_MS,
      relayReqLog
    }: {
      startLogin?: () => void
      needSort?: boolean
      firstRelayResultGraceMs?: number
      /** Correlate {@link ClientService.subscribe} logs with a timeline shard */
      relayReqLog?: { groupId: string }
    } = {}
  ) {
    const relays = Array.from(new Set(urls))
    const key = this.generateTimelineKey(relays, filter)
    let timeline = this.timelines[key]

    if (!timeline || Array.isArray(timeline)) {
      this.timelines[key] = {
        refs: [],
        filter,
        urls: relays
      }
      timeline = this.timelines[key]
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this
    let events: NEvent[] = []
    /** `null` until initial backlog is considered complete; then wall-clock unix at completion (for straggler vs live). */
    let eosedAt: number | null = null
    let eventIds = new Set<string>()

    let firstResultGraceTimer: ReturnType<typeof setTimeout> | null = null
    const clearFirstResultGraceTimer = () => {
      if (firstResultGraceTimer != null) {
        clearTimeout(firstResultGraceTimer)
        firstResultGraceTimer = null
      }
    }
    const armFirstResultGraceAfterFirstEvent = () => {
      if (eosedAt != null || firstResultGraceTimer != null) return
      if (events.length === 0) return
      if (firstRelayResultGraceMs <= 0) return
      firstResultGraceTimer = setTimeout(() => {
        firstResultGraceTimer = null
        if (eosedAt == null) {
          handleTimelineEose(true)
        }
      }, firstRelayResultGraceMs)
    }

    /**
     * Stream matching events to the UI immediately. Initial completion is either aggregate `oneose` from all
     * relays, or {@link firstRelayResultGraceMs} after the first event (whichever comes first).
     */
    let streamFlushMicrotask = false
    const flushStreamingSnapshot = () => {
      if (eosedAt) return
      const emit = () => {
        streamFlushMicrotask = false
        if (eosedAt) return
        if (needSort) {
          const sorted = [...events].sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit)
          onEvents(sorted, false)
        } else {
          onEvents([...events], false)
        }
      }
      if (events.length <= 1) {
        streamFlushMicrotask = false
        emit()
        return
      }
      if (!streamFlushMicrotask) {
        streamFlushMicrotask = true
        queueMicrotask(emit)
      }
    }

    const handleTimelineEose = (eosed: boolean) => {
      if (!eosed) return
      if (eosedAt != null) return

      clearFirstResultGraceTimer()

      eosedAt = dayjs().unix()

      if (!needSort) {
        return onEvents([...events], true)
      }

      events = events.sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit)
      eventIds = new Set(events.map((e) => e.id))

      const tl = that.timelines[key]
      if (!tl || Array.isArray(tl)) {
        that.timelines[key] = {
          refs: events.map((evt) => [evt.id, evt.created_at]),
          filter,
          urls
        }
      } else if (tl.refs.length === 0) {
        tl.refs = events.map((evt) => [evt.id, evt.created_at] as TTimelineRef)
      } else {
        const firstRefCreatedAt = tl.refs[0]![1]
        const newRefs = events
          .filter((evt) => evt.created_at > firstRefCreatedAt)
          .map((evt) => [evt.id, evt.created_at] as TTimelineRef)
        if (events.length >= filter.limit) {
          tl.refs = newRefs
        } else {
          tl.refs = newRefs.concat(tl.refs)
        }
      }
      onEvents([...events], true)
    }

    const subCloser = this.subscribe(relays, filter, {
      startLogin,
      onevent: (evt: NEvent) => {
        that.addEventToCache(evt)
        // not eosed yet, push to events
        if (!eosedAt) {
          if (eventIds.has(evt.id)) return
          eventIds.add(evt.id)
          events.push(evt)
          flushStreamingSnapshot()
          armFirstResultGraceAfterFirstEvent()
          return
        }

        if (eventIds.has(evt.id)) return

        const wallClockAtEose = eosedAt
        const isBacklogStraggler =
          evt.created_at + TIMELINE_STRAGGLER_MAX_AGE_SEC < wallClockAtEose

        if (isBacklogStraggler) {
          eventIds.add(evt.id)
          events.push(evt)
          if (needSort) {
            events = events.sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit)
          }
          eventIds = new Set(events.map((e) => e.id))
          onEvents([...events], false)

          const timeline = that.timelines[key]
          if (timeline && !Array.isArray(timeline)) {
            timeline.refs = events
              .map((e) => [e.id, e.created_at] as TTimelineRef)
              .sort((a, b) => b[1] - a[1])
          }
          return
        }

        eventIds.add(evt.id)
        onNew(evt)

        const timeline = that.timelines[key]
        if (!timeline || Array.isArray(timeline)) {
          return
        }

        if (timeline.refs.length === 0) {
          timeline.refs = events.map((e) => [e.id, e.created_at] as TTimelineRef).sort((a, b) => b[1] - a[1])
          return
        }

        let idx = 0
        for (const ref of timeline.refs) {
          if (evt.created_at > ref[1] || (evt.created_at === ref[1] && evt.id < ref[0])) {
            break
          }
          if (evt.created_at === ref[1] && evt.id === ref[0]) {
            return
          }
          idx++
        }
        if (idx >= timeline.refs.length) return

        timeline.refs.splice(idx, 0, [evt.id, evt.created_at])
      },
      oneose: handleTimelineEose,
      onclose: onClose
    },
    relayReqLog)

    return {
      timelineKey: key,
      closer: () => {
        clearFirstResultGraceTimer()
        onEvents = () => {}
        onNew = () => {}
        subCloser.close()
      }
    }
  }

  private async _loadMoreTimeline(key: string, until: number, limit: number) {
    const timeline = this.timelines[key]
    if (!timeline || Array.isArray(timeline)) return []

    const { filter, urls } = timeline

    let events = await this.query(urls, { ...filter, until, limit }, undefined, {
      firstRelayResultGraceMs: false,
      globalTimeout: 25_000,
      eoseTimeout: 2500
    })
    events.forEach((evt) => {
      this.addEventToCache(evt)
    })
    events = events.sort((a, b) => b.created_at - a.created_at).slice(0, limit)

    if (!timeline.refs) {
      timeline.refs = []
    }

    const existingRefIds = new Set(timeline.refs.map(([id]) => id))
    const newRefs: TTimelineRef[] = []
    for (const evt of events) {
      if (!existingRefIds.has(evt.id)) {
        newRefs.push([evt.id, evt.created_at])
        existingRefIds.add(evt.id)
      }
    }
    newRefs.sort((a, b) => b[1] - a[1])

    if (timeline.refs.length > 0) {
      const lastRefCreatedAt = timeline.refs[timeline.refs.length - 1][1]
      const olderRefs = newRefs.filter(([, createdAt]) => createdAt < lastRefCreatedAt)
      timeline.refs.push(...olderRefs)
      timeline.refs.sort((a, b) => b[1] - a[1])
    } else {
      timeline.refs.push(...newRefs)
    }

    return events
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

  // Delegate to QueryService
  private async query(
    urls: string[], 
    filter: Filter | Filter[], 
    onevent?: (evt: NEvent) => void,
    options?: { 
      eoseTimeout?: number
      globalTimeout?: number
      /** For replaceable events: race strategy - wait 2s after first result, then return best */
      replaceableRace?: boolean
      /** For non-replaceable single events: return immediately on first match */
      immediateReturn?: boolean
      firstRelayResultGraceMs?: number | false
    }
  ) {
    return this.queryService.query(urls, filter, onevent, options)
  }

  // Legacy query implementation removed - now delegated to QueryService

  async fetchEvents(
    urls: string[],
    filter: Filter | Filter[],
    {
      onevent,
      cache = false,
      eoseTimeout,
      globalTimeout,
      firstRelayResultGraceMs,
      replaceableRace,
      immediateReturn
    }: {
      onevent?: (evt: NEvent) => void
      cache?: boolean
      eoseTimeout?: number
      globalTimeout?: number
      firstRelayResultGraceMs?: number | false
      replaceableRace?: boolean
      immediateReturn?: boolean
    } = {}
  ) {
    let relays = Array.from(new Set(urls))
    if (relays.length === 0) relays = [...FAST_READ_RELAY_URLS]
    const filters = Array.isArray(filter) ? filter : [filter]
    const hasKind1 = filters.some((f) => f.kinds && (Array.isArray(f.kinds) ? f.kinds.includes(1) : f.kinds === 1))
    if (hasKind1 && KIND_1_BLOCKED_RELAY_URLS.length > 0) {
      const kind1BlockedSet = new Set(KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
      relays = relays.filter((url) => !kind1BlockedSet.has(normalizeUrl(url) || url))
    }
    const events = await this.queryService.query(relays, filter, onevent, {
      eoseTimeout,
      globalTimeout,
      firstRelayResultGraceMs,
      replaceableRace,
      immediateReturn
    })
    if (cache) {
      events.forEach((evt) => {
        this.addEventToCache(evt)
      })
    }
    return events
  }

  /**
   * Query one relay only (e.g. spell COUNT per-relay). Connection failures return `connectionError` instead of throwing.
   */
  async fetchEventsFromSingleRelay(
    url: string,
    filter: Filter | Filter[],
    options?: { globalTimeout?: number }
  ): Promise<{ events: NEvent[]; connectionError?: string }> {
    const normalized = normalizeUrl(url) || url
    if (!normalized) {
      return { events: [], connectionError: 'Invalid relay URL' }
    }
    if (this.filterSessionStrikedRelays([normalized]).length === 0) {
      return { events: [], connectionError: 'Relay skipped this session (repeated failures)' }
    }
    try {
      await this.pool.ensureRelay(normalized, { connectionTimeout: 12_000 })
    } catch (e) {
      this.recordSessionRelayFailure(normalized)
      const msg = e instanceof Error ? e.message : String(e)
      return { events: [], connectionError: msg }
    }
    try {
      const events = await this.queryService.query([normalized], filter, undefined, {
        globalTimeout: options?.globalTimeout ?? 25_000
      })
      return { events, connectionError: undefined }
    } catch (e) {
      return {
        events: [],
        connectionError: e instanceof Error ? e.message : String(e)
      }
    }
  }

  /**
   * Fetch a single event by id (hex, note1, nevent1, naddr1).
   * Relay order: (1) session/DataLoader cache (2) buildInitialRelayList (user's FAST_READ + favorite + read) or FAST_READ_RELAY_URLS
   * (3) for nevent/naddr: bech32 relay hints + author's read (inbox) + author's write (outbox) from kind 10002
   * (4) if still missing and filter has authors: author's read+write again in tryHarderToFetchEvent
   * (5) SEARCHABLE_RELAY_URLS as final fallback. Author relays are used so embedded notes load from the author's relays.
   */
  async fetchEvent(id: string): Promise<NEvent | undefined> {
    return this.eventService.fetchEvent(id)
  }

  // Legacy fetchEvent implementation removed - now delegated to EventService

  async fetchEventForceRetry(eventId: string): Promise<NEvent | undefined> {
    return this.eventService.fetchEventForceRetry(eventId)
  }

  /** Batch-prefetch by hex id into session cache (feed embeds). */
  async prefetchHexEventIds(hexIds: readonly string[]): Promise<void> {
    return this.eventService.prefetchHexEventIds(hexIds)
  }

  async fetchEventWithExternalRelays(eventId: string, externalRelays: string[]): Promise<NEvent | undefined> {
    return this.eventService.fetchEventWithExternalRelays(eventId, externalRelays)
  }

  addEventToCache(event: NEvent) {
    this.eventService.addEventToCache(event)
  }

  getSessionEventsMatchingSearch(query: string, limit: number, allowedKinds: number[]): NEvent[] {
    return this.eventService.getSessionEventsMatchingSearch(query, limit, allowedKinds)
  }


  async fetchFavoriteRelays(pubkey: string): Promise<string[]> {
    try {
      const favoriteRelaysEvent = await this.replaceableEventService.fetchReplaceableEvent(pubkey, ExtendedKind.FAVORITE_RELAYS)
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


  /** =========== Following favorite relays =========== */
  // Moved to ReplaceableEventService

  /** =========== Followings =========== */
  // Moved to ReplaceableEventService

  /** Part of {@link runSessionPrewarm}; batches followings to limit relay load. */
  private async initUserIndexFromFollowings(pubkey: string, signal: AbortSignal) {
    const followings = await this.replaceableEventService.fetchFollowings(pubkey)
    if (followings.length === 0) {
      logger.info('[client] Prewarm: following profiles skipped (no followings)', {
        pubkeySlice: pubkey.slice(0, 12)
      })
      return
    }
    logger.info('[client] Prewarm: following profile + NIP-65 relay list fetch started', {
      pubkeySlice: pubkey.slice(0, 12),
      followingCount: followings.length
    })
    let relayListResolved = 0
    const chunkSize = 20
    for (let i = 0; i * chunkSize < followings.length; i++) {
      if (signal.aborted) {
        logger.info('[client] Prewarm: following profiles + relay lists aborted', { pubkeySlice: pubkey.slice(0, 12) })
        return
      }
      const chunk = followings.slice(i * chunkSize, (i + 1) * chunkSize)
      const [relayListEvents] = await Promise.all([
        this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(chunk, kinds.RelayList),
        Promise.all(chunk.map((pk) => this.fetchProfileEvent(pk)))
      ])
      relayListResolved += relayListEvents.filter(Boolean).length
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    logger.info('[client] Prewarm: following profile + NIP-65 relay list fetch finished', {
      pubkeySlice: pubkey.slice(0, 12),
      followingCount: followings.length,
      relayListEventsResolved: relayListResolved
    })
  }

  /** =========== Profile =========== */

  async searchProfiles(relayUrls: string[], filter: Filter): Promise<TProfile[]> {
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
    profileEvents.forEach((profile) => this.updateProfileEventCache(profile))
    return profileEvents.map((profileEvent) => getProfileFromEvent(profileEvent))
  }

  async searchNpubsFromLocal(query: string, limit: number = 100) {
    const result = await this.userIndex.searchAsync(query, { limit })
    return result.map((pubkey) => pubkeyToNpub(pubkey as string)).filter(Boolean) as string[]
  }

  /**
   * Npubs for @-mention dropdown: (1) follow-list profiles matching the query,
   * (2) local index, (3) relay search on SEARCHABLE_RELAY_URLS (same as search page).
   * Returns cached results immediately, then streams relay results via callback.
   */
  /**
   * Record a kind-5 deletion in the local tombstone store (no network).
   * Call after publishing a deletion so cache updates without waiting for a fetch.
   */
  async applyDeletionRequestToLocalCache(deletionEvent: NEvent): Promise<void> {
    await this.addTombstoneEntriesFromDeletionEvent(deletionEvent)
    const removed = await indexedDb.removeTombstonedFromCache()
    if (removed > 0) {
      logger.info('[ClientService] Removed tombstoned events from cache', { count: removed })
    }
    dispatchTombstonesUpdated()
  }

  private async addTombstoneEntriesFromDeletionEvent(deletionEvent: NEvent): Promise<void> {
    const eTag = deletionEvent.tags.find((tag) => tag[0] === 'e')
    const aTag = deletionEvent.tags.find((tag) => tag[0] === 'a')
    const kTag = deletionEvent.tags.find((tag) => tag[0] === 'k')

    if (eTag?.[1]) {
      await indexedDb.addTombstone(eTag[1])
    } else if (aTag?.[1]) {
      await indexedDb.addTombstone(aTag[1])
    } else if (kTag?.[1] && deletionEvent.pubkey) {
      const kind = parseInt(kTag[1], 10)
      if (!isNaN(kind)) {
        await indexedDb.addTombstone(`${kind}:${deletionEvent.pubkey}`)
      }
    }
  }

  /**
   * Fetch kind-5 deletion events for an author, merge tombstones, remove matching rows from IndexedDB,
   * and notify the UI. Intended for **manual** refresh (e.g. cache settings); not run on every login.
   */
  async fetchDeletionEvents(relayUrls: string[] = [], authorPubkey?: string): Promise<void> {
    const pk = authorPubkey?.trim().toLowerCase()
    if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return

    const urls = (relayUrls.length > 0 ? relayUrls : [...PROFILE_FETCH_RELAY_URLS])
      .map((u) => normalizeUrl(u) || u)
      .filter(Boolean)
    const capped = Array.from(new Set(urls)).slice(0, 16)
    if (capped.length === 0) return

    try {
      const events = await this.queryService.fetchEvents(
        capped,
        {
          kinds: [kinds.EventDeletion],
          authors: [pk],
          limit: 500
        },
        {
          firstRelayResultGraceMs: false,
          globalTimeout: 22_000,
          eoseTimeout: 2500
        }
      )

      let any = false
      for (const e of events) {
        if (e.kind !== kinds.EventDeletion || e.pubkey.toLowerCase() !== pk) continue
        if (!verifyEvent(e)) continue
        if (shouldDropEventOnIngest(e)) continue
        await this.addTombstoneEntriesFromDeletionEvent(e)
        any = true
      }

      if (any) {
        const removed = await indexedDb.removeTombstonedFromCache()
        if (removed > 0) {
          logger.info('[ClientService] Removed tombstoned events from cache after deletion sync', {
            count: removed
          })
        }
        dispatchTombstonesUpdated()
      }
    } catch (e) {
      logger.warn('[ClientService] fetchDeletionEvents failed', { error: e })
    }
  }

  /** Fetch deletions for a profile pubkey using that user’s NIP-65 read stack when possible. */
  async fetchDeletionEventsForPubkey(profilePubkey: string): Promise<void> {
    const pk = profilePubkey.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return
    try {
      const rl = await this.fetchRelayList(pk)
      const urls = buildDeletionRelayUrls(rl)
      await this.fetchDeletionEvents(urls, pk)
    } catch {
      await this.fetchDeletionEvents(buildDeletionRelayUrls(null), pk)
    }
  }

  async searchNpubsForMention(
    query: string,
    limit: number = 100,
    onUpdate?: (npubs: string[]) => void
  ): Promise<string[]> {
    const q = query.trim()
    const qLower = q.toLowerCase()
    const addedNpubs = new Set<string>()
    const out: string[] = []
    
    // Helper to add npub and update if callback provided
    const addNpub = (npub: string) => {
      if (addedNpubs.has(npub) || out.length >= limit) return false
      addedNpubs.add(npub)
      out.push(npub)
      return true
    }
    
    const updateIfNeeded = () => {
      if (onUpdate && out.length > 0) {
        onUpdate([...out])
      }
    }

    // 1. Follow-list profiles (from cache) - return immediately if found
    if (this.pubkey && qLower.length >= 1) {
      try {
        const followListEvent = await this.replaceableEventService.fetchFollowListEvent(this.pubkey)
        const followPubkeys = followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
        const toCheck = followPubkeys.slice(0, 80)
        
        // Use cached profiles first (fast path)
        const profilePromises = toCheck.map(async (pubkey) => {
          const npub = pubkeyToNpub(pubkey)
          if (!npub) return undefined
          
          // Try cache first - this is synchronous from IndexedDB
          const cachedProfile = await this.replaceableEventService.getProfileFromIndexedDB(npub)
          if (cachedProfile) {
            return cachedProfile
          }
          
          // Fetch if not in cache (but don't wait - return cached results first)
          return this.replaceableEventService.fetchProfile(npub)
        })
        
        const profiles = await Promise.all(profilePromises)
        const matchText = (p: TProfile) =>
          ((p.username ?? '') + ' ' + (p.original_username ?? '') + ' ' + (p.nip05 ?? '')).toLowerCase()
        
        for (const p of profiles) {
          if (!p) continue
          const npub = p.npub || pubkeyToNpub(p.pubkey)
          if (!npub) continue
          if (!matchText(p).includes(qLower)) continue
          if (addNpub(npub)) {
            updateIfNeeded()
          }
          if (out.length >= limit) break
        }
      } catch {
        // ignore follow-list errors; fall back to local + relay
      }
    }

    // 2. Local index (fast, from cache) - return immediately
    const local = await this.searchNpubsFromLocal(q, limit)
    for (const npub of local) {
      if (addNpub(npub)) {
        updateIfNeeded()
      }
      if (out.length >= limit) break
    }

    // Return cached results immediately (don't wait for relays)
    if (out.length >= limit) {
      // Prime profile cache
      out.forEach((npub) => {
        this.replaceableEventService.fetchProfileEvent(npub).catch(() => {})
      })
      return out
    }

    // 3. Relay search (slow, but runs in background and updates incrementally)
    if (q.length >= 1) {
      // Start relay search in background - don't await, let it update via callback
      this.searchProfiles(SEARCHABLE_RELAY_URLS, {
        search: q,
        limit: limit - out.length
      })
        .then((relayProfiles) => {
          for (const p of relayProfiles) {
            const npub = pubkeyToNpub(p.pubkey)
            if (!npub) continue
            if (addNpub(npub)) {
              updateIfNeeded()
            }
            if (out.length >= limit) break
          }
          
          // Prime profile cache for relay results
          relayProfiles.forEach((p) => {
            const npub = pubkeyToNpub(p.pubkey)
            if (npub) {
              this.replaceableEventService.fetchProfileEvent(npub).catch(() => {})
            }
          })
        })
        .catch(() => {
          // relay search is best-effort
        })
    }

    // Prime profile cache for cached results
    out.forEach((npub) => {
      this.replaceableEventService.fetchProfileEvent(npub).catch(() => {})
    })
    
    return out
  }

  async searchProfilesFromLocal(query: string, limit: number = 100) {
    const npubs = await this.searchNpubsFromLocal(query, limit)
    const profiles = await Promise.all(npubs.map((npub) => this.replaceableEventService.fetchProfile(npub)))
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

  // Delegate to ReplaceableEventService
  async fetchProfileEvent(id: string, skipCache: boolean = false): Promise<NEvent | undefined> {
    return this.replaceableEventService.fetchProfileEvent(id, skipCache)
  }

  async fetchProfile(id: string, skipCache: boolean = false): Promise<TProfile | undefined> {
    return this.replaceableEventService.fetchProfile(id, skipCache)
  }

  async fetchProfilesForPubkeys(pubkeys: string[]): Promise<TProfile[]> {
    return this.replaceableEventService.fetchProfilesForPubkeys(pubkeys)
  }

  async getProfileFromIndexedDB(id: string): Promise<TProfile | undefined> {
    return this.replaceableEventService.getProfileFromIndexedDB(id)
  }

  async updateProfileEventCache(event: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(event)
  }

  /** =========== Relay list =========== */

  async fetchRelayListEvent(pubkey: string) {
    const event = await this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.RelayList)
    return event ?? null
  }

  clearRelayListCache(targetPubkey: string) {
    const suffix = `\x1e${targetPubkey}`
    for (const k of this.relayListRequestCache.keys()) {
      if (k.endsWith(suffix)) this.relayListRequestCache.delete(k)
    }
  }

  private relayListRequestCacheKey(targetPubkey: string): string {
    return `${this.pubkey ?? ''}\x1e${targetPubkey}`
  }

  /**
   * Clear all in-memory caches. Call this after IndexedDB/cache clear so that
   * subsequent fetches go to the network instead of serving stale in-memory data.
   * Fixes missing profile pics and broken reactions after "Clear cache" on mobile.
   */
  clearInMemoryCaches(): void {
    this.relayListRequestCache.clear()
    this.eventService.clearCaches()
    this.replaceableEventService.clearCaches()
    logger.info('[ClientService] In-memory caches cleared')
  }

  async fetchRelayList(pubkey: string): Promise<TRelayList> {
    // Deduplicate concurrent requests for the same pubkey's relay list
    const cacheKey = this.relayListRequestCacheKey(pubkey)
    const existingRequest = this.relayListRequestCache.get(cacheKey)
    if (existingRequest) {
      logger.debug('[FetchRelayList] Using cached in-flight request', { pubkey })
      return existingRequest
    }
    
    logger.debug('[FetchRelayList] Starting fetch', { pubkey })
    const requestPromise = (async () => {
      try {
        const startTime = Date.now()
        const [relayList] = await this.fetchRelayLists([pubkey])
        const duration = Date.now() - startTime
        logger.debug('[FetchRelayList] Fetch completed', {
          pubkey,
          duration: `${duration}ms`,
          hasRelayList: !!relayList,
          writeCount: relayList?.write?.length ?? 0,
          readCount: relayList?.read?.length ?? 0
        })
        return relayList
      } catch (error) {
        logger.error('[FetchRelayList] Fetch failed', {
          pubkey,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      } finally {
        this.relayListRequestCache.delete(cacheKey)
      }
    })()
    
    this.relayListRequestCache.set(cacheKey, requestPromise)
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
    const relayEvents = await this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(pubkeys, kinds.RelayList)
    
    // Fetch cache relays from multiple sources: FAST_READ_RELAY_URLS, PROFILE_RELAY_URLS, and user's inboxes/outboxes
    const cacheRelayEvents = await this.fetchCacheRelayEventsFromMultipleSources(pubkeys, relayEvents, storedRelayEvents)

    return pubkeys.map((targetPubkey, index) => {
      const isOwnRelayList =
        this.pubkey != null && hexPubkeysEqual(this.pubkey, userIdToPubkey(targetPubkey))

      // Use stored cache relay event if available (for offline), otherwise use fetched one
      const storedCacheEvent = storedCacheRelayEvents[index]
      const cacheEvent = cacheRelayEvents[index] || storedCacheEvent
      
      // Use stored relay event if no network event (for offline), otherwise use fetched one
      const storedRelayEvent = storedRelayEvents[index]
      const relayEvent = relayEvents[index] || storedRelayEvent
      
      const relayList = relayEvent ? getRelayListFromEvent(relayEvent) : {
        write: [],
        read: [],
        originalRelays: []
      }
      
      // Merge kind 10432 (cache relays) only for the logged-in user — never use someone else's local relays.
      if (isOwnRelayList && cacheEvent) {
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
      
      // If no merged cache path, return original relay list or default (with own cache as fallback only)
      if (!relayEvent) {
        if (isOwnRelayList && storedCacheEvent) {
          const cacheRelayList = getRelayListFromEvent(storedCacheEvent)
          return {
            write: cacheRelayList.write.length > 0 ? cacheRelayList.write : PROFILE_FETCH_RELAY_URLS,
            read: cacheRelayList.read.length > 0 ? cacheRelayList.read : PROFILE_FETCH_RELAY_URLS,
            originalRelays: cacheRelayList.originalRelays
          }
        }
        return {
          write: PROFILE_FETCH_RELAY_URLS,
          read: PROFILE_FETCH_RELAY_URLS,
          originalRelays: []
        }
      }
      
      if (!isOwnRelayList) {
        return stripLocalNetworkRelaysFromRelayList(relayList)
      }

      return relayList
    })
  }

  async forceUpdateRelayListEvent(pubkey: string) {
    await this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.RelayList)
  }

  /**
   * Fetch cache relay events (kind 10432) from multiple sources:
   * - PROFILE_FETCH_RELAY_URLS
   * - User's inboxes (read relays from kind 10002)
   * - User's outboxes (write relays from kind 10002)
   */
  private async fetchCacheRelayEventsFromMultipleSources(
    pubkeys: string[],
    _relayEvents: (NEvent | null | undefined)[],
    _storedRelayEvents: (NEvent | null | undefined)[]
  ): Promise<(NEvent | null | undefined)[]> {
    // Start with events from IndexedDB
    const storedCacheRelayEvents = await Promise.all(
      pubkeys.map(pubkey => indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS))
    )
    
    // Check which pubkeys need fetching (don't have stored cache relay events)
    const pubkeysToFetch = pubkeys.filter((_pubkey, index) => !storedCacheRelayEvents[index])
    
    if (pubkeysToFetch.length === 0) {
      return storedCacheRelayEvents
    }

    // Fetch from PROFILE_FETCH_RELAY_URLS
    const cacheRelayEvents = await this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(
      pubkeysToFetch,
      ExtendedKind.CACHE_RELAYS
    )

    // Map results back to original pubkey order
    return pubkeys.map((pubkey, index) => {
      const storedCacheEvent = storedCacheRelayEvents[index]
      if (storedCacheEvent) return storedCacheEvent

      const fetchIndex = pubkeysToFetch.indexOf(pubkey)
      return fetchIndex >= 0 ? cacheRelayEvents[fetchIndex] : null
    })
  }

  async updateRelayListCache(event: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(event)
  }


  /** =========== Replaceable event =========== */

  // Delegate to ReplaceableEventService
  async fetchFollowListEvent(pubkey: string) {
    return this.replaceableEventService.fetchFollowListEvent(pubkey)
  }

  async fetchFollowings(pubkey: string): Promise<string[]> {
    return this.replaceableEventService.fetchFollowings(pubkey)
  }

  async updateFollowListCache(evt: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async fetchMuteListEvent(pubkey: string) {
    return this.replaceableEventService.fetchMuteListEvent(pubkey)
  }

  async fetchBookmarkListEvent(pubkey: string) {
    return this.replaceableEventService.fetchBookmarkListEvent(pubkey)
  }

  async fetchBlossomServerListEvent(pubkey: string) {
    return this.replaceableEventService.fetchBlossomServerListEvent(pubkey)
  }

  async fetchBlossomServerList(pubkey: string): Promise<string[]> {
    return this.replaceableEventService.fetchBlossomServerList(pubkey)
  }

  async updateBlossomServerListEventCache(evt: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async fetchInterestListEvent(pubkey: string) {
    return this.replaceableEventService.fetchInterestListEvent(pubkey)
  }

  async fetchPinListEvent(pubkey: string) {
    return this.replaceableEventService.fetchPinListEvent(pubkey)
  }

  async fetchPaymentInfoEvent(pubkey: string) {
    return this.replaceableEventService.fetchPaymentInfoEvent(pubkey)
  }

  async updatePaymentInfoCache(evt: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async forceRefreshProfileAndPaymentInfoCache(pubkey: string): Promise<void> {
    return this.replaceableEventService.forceRefreshProfileAndPaymentInfoCache(pubkey)
  }

  async fetchEmojiSetEvents(_pointers: string[]) {
    // Implementation would use replaceableEventService
    return []
  }

  /** =========== Following favorite relays =========== */


  // Delegate to ReplaceableEventService
  async fetchFollowingFavoriteRelays(pubkey: string): Promise<[string, string[]][]> {
    return this.replaceableEventService.fetchFollowingFavoriteRelays(pubkey)
  }

  /** =========== Macro Events (Delegated to MacroService) =========== */

  // Delegate to MacroService
  async fetchBookstrEvents(filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): Promise<NEvent[]> {
    return this.bookstrService.fetchMacroEvents(filters)
  }

  // Delegate to MacroService
  async getCachedBookstrEvents(filters: {
    type?: string
    book?: string
    chapter?: number
    verse?: string
    version?: string
  }): Promise<NEvent[]> {
    return this.bookstrService.getCachedMacroEvents(filters)
  }

  // Legacy implementations removed - now delegated to MacroService


  // ================= Utils =================

  async generateSubRequestsForPubkeys(pubkeys: string[], myPubkey?: string | null) {
    // If many websocket connections are initiated simultaneously, it will be
    // very slow on Safari (for unknown reason)
    if (isSafari()) {
      let urls = FAST_READ_RELAY_URLS
      if (myPubkey) {
        const relayList = await this.fetchRelayList(myPubkey)
        urls = relayList.read.concat(FAST_READ_RELAY_URLS).slice(0, 5)
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

  // Legacy Bookstr implementations removed - now in MacroService

}
const instance = ClientService.getInstance()
export default instance

// Export sub-services for direct access
export const queryService = instance.queryService
export const eventService = instance.eventService
export const replaceableEventService = instance.replaceableEventService
export const macroService = instance.bookstrService
