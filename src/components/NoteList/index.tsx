import NewNotesButton from '@/components/NewNotesButton'
import { ExtendedKind, FIRST_RELAY_RESULT_GRACE_MS, SINGLE_RELAY_KINDLESS_REQ_LIMIT } from '@/constants'
import {
  collectEmbeddedEventPrefetchTargets,
  getReplaceableCoordinateFromEvent,
  isMentioningMutedUsers,
  isReplaceableEvent,
  isReplyNoteEvent
} from '@/lib/event'
import { shouldFilterEvent } from '@/lib/event-filtering'
import {
  isRelayUrlStrictSupersetIdentityKey,
  isSpellSubRequestsSameFiltersDifferentRelays,
  stableSpellFeedFilterKey
} from '@/lib/spell-feed-request-identity'
import logger from '@/lib/logger'
import { normalizeUrl } from '@/lib/url'
import { shouldIncludeZapReceiptAtReplyThreshold } from '@/lib/event-metadata'
import { isTouchDevice } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import { useZap } from '@/providers/ZapProvider'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import {
  getSessionFeedSnapshot,
  hardReloadPreservingFeedSnapshots,
  setSessionFeedSnapshot
} from '@/services/session-feed-snapshot.service'
import type { TFeedSubRequest, TSubRequestFilter } from '@/types'
import dayjs from 'dayjs'
import { type Event, type Filter, kinds } from 'nostr-tools'
import { decode } from 'nostr-tools/nip19'
import RelayStatusDisplay from '@/components/RelayStatusDisplay'
import {
  relayOpTerminalRowsToTimelineRelayUiStatuses,
  type RelayOpTerminalRow
} from '@/services/relay-operation-log.service'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from 'react'
import { CircleAlert } from 'lucide-react'
import { useLongPressAction } from '@/hooks/use-long-press-action'
import { useTranslation } from 'react-i18next'
import PullToRefresh from 'react-simple-pull-to-refresh'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { formatPubkey, inviteInputToHexPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { usePrimaryPageOptional } from '@/contexts/primary-page-context'
import type { TPrimaryPageName } from '@/PageManager'
import { NoteFeedProfileContext, type NoteFeedProfileContextValue } from '@/providers/NoteFeedProfileContext'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { buildFeedFullSearchRelayUrls } from '@/lib/feed-full-search-relays'
import type { TProfile } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import NoteCard, { NoteCardLoadingSkeleton } from '../NoteCard'

const LIMIT = 100 // Increased from 200 to load more events per request
const ALGO_LIMIT = 200 // Increased from 500 for algorithm feeds
/** Single-relay explore: kindless REQ cap (relay returns whatever it has, up to this many). */
const RELAY_EXPLORE_LIMIT = SINGLE_RELAY_KINDLESS_REQ_LIMIT

/**
 * Vite HMR replaces this module and remounts NoteList; timeline refs reset while the subscription can briefly look
 * empty, which re-triggers the “relays returned no events” toast. Suppress briefly after each HMR cycle (dev only).
 */
let suppressRelayEmptyFeedToastUntilMs = 0
if (import.meta.env.DEV && import.meta.hot) {
  const bumpSuppressRelayEmptyFeedToast = () => {
    suppressRelayEmptyFeedToastUntilMs = Date.now() + 6_000
  }
  import.meta.hot.on('vite:beforeUpdate', bumpSuppressRelayEmptyFeedToast)
  import.meta.hot.on('vite:beforeFullReload', bumpSuppressRelayEmptyFeedToast)
}
const SHOW_COUNT = 20 // Increased from 10 to show more events at once, reducing scroll load frequency
/**
 * When building visible rows, scan this many merged-timeline events at most. Previously we only looked at the first
 * {@link showCount} events then filtered — with “posts only”, kind filters, and mutes, most of those could be hidden
 * so the feed showed 2–4 notes while 100+ were already loaded (felt like a crawl).
 */
const MAX_TIMELINE_EVENTS_SCAN_FOR_VISIBLE = 2500
/** Hard cap after merging parallel one-shot fetches (e.g. interests = one REQ per topic). */
const ONE_SHOT_MERGED_CAP =100
/** Max events kept after merging parallel full-search REQ results across relays. */
const FEED_FULL_SEARCH_MERGE_CAP = 400
/** Cap archive cursor time so progressive search does not monopolize the main thread; pub-store hits are unchanged. */
const PROGRESSIVE_IDB_ARCHIVE_SCAN_MAX_MS = 3_200
/** Client-side feed time window units (Day.js `.subtract` names). */
type TFeedClientTimeUnit = 'minute' | 'day' | 'week' | 'month' | 'year'

/** Client-side “who wrote this” filter on already-loaded posts. */
type TFeedClientAuthorMode = 'everyone' | 'me' | 'npub'
const FEED_FILTER_KIND_MIN = 0
const FEED_FILTER_KIND_MAX = 40_000

/** Short debounce: batch rapid timeline updates without delaying first paint on feeds like notifications. */
const FEED_PROFILE_BATCH_DEBOUNCE_MS = 50
/** Larger chunks + parallel fetches below — sequential 36-pubkey rounds made notification avatars lag. */
const FEED_PROFILE_CHUNK = 80

function mergeEventBatchesById(prev: Event[], incoming: Event[], cap: number): Event[] {
  const byId = new Map<string, Event>()
  for (const e of prev) {
    byId.set(e.id, e)
  }
  for (const e of incoming) {
    byId.set(e.id, e)
  }
  return Array.from(byId.values())
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, cap)
}

/** Multi-layer search: keep all existing rows, add new ids only; newer `created_at` wins on duplicate id. No cap. */
function mergeProgressiveSearchEvents(
  prev: Event[],
  incoming: Event[],
  afterSort?: (a: Event, b: Event) => number
): Event[] {
  const byId = new Map<string, Event>()
  for (const e of prev) {
    byId.set(e.id, e)
  }
  for (const e of incoming) {
    const o = byId.get(e.id)
    if (!o) {
      byId.set(e.id, e)
    } else if (e.created_at > o.created_at) {
      byId.set(e.id, e)
    }
  }
  const arr = Array.from(byId.values())
  if (afterSort) {
    arr.sort(afterSort)
  } else {
    arr.sort((a, b) => b.created_at - a.created_at)
  }
  return arr
}

function mergeKindsForProgressiveWarmup(
  showKindsFromPicker: number[],
  progressiveDocumentKinds: readonly number[] | undefined
): number[] {
  const base = showKindsFromPicker.length > 0 ? showKindsFromPicker : [kinds.ShortTextNote]
  if (!progressiveDocumentKinds?.length) return base
  return Array.from(new Set([...base, ...progressiveDocumentKinds])).sort((a, b) => a - b)
}

type ProgressiveSearchLocalLayerOpts = {
  warmQ: string
  isStale: () => boolean
  kindsForWarm: number[]
  warmMatch?: (ev: Event) => boolean
  afterSort?: (a: Event, b: Event) => number
  setEvents: Dispatch<SetStateAction<Event[]>>
  setLoading: (loading: boolean) => void
}

/** In-memory session hits only (sync). Relay / IndexedDB run in parallel via {@link kickProgressiveSearchLocalLayers}. */
function applyProgressiveSessionSearchLayer(params: ProgressiveSearchLocalLayerOpts): void {
  const { warmQ, isStale, kindsForWarm, warmMatch, afterSort, setEvents, setLoading } = params
  const cap = FEED_FULL_SEARCH_MERGE_CAP
  let boot = client.getSessionEventsMatchingSearch(warmQ, cap, kindsForWarm)
  if (warmMatch) boot = boot.filter(warmMatch)
  const sortCreated = (evs: Event[]) => [...evs].sort((a, b) => b.created_at - a.created_at)
  const finalizeOrder = (evs: Event[]) => (afterSort ? [...evs].sort(afterSort) : sortCreated(evs))
  if (!isStale() && boot.length) {
    setEvents((prev) => mergeProgressiveSearchEvents(prev, finalizeOrder(boot), afterSort))
    setLoading(false)
  }
}

function startProgressiveIdbSearchLayer(params: ProgressiveSearchLocalLayerOpts): void {
  const { warmQ, isStale, kindsForWarm, warmMatch, afterSort, setEvents, setLoading } = params
  const cap = FEED_FULL_SEARCH_MERGE_CAP
  void (async () => {
    try {
      const idbE = await indexedDb.getCachedAndArchivedEventsMatchingLocalSearch(
        warmQ,
        cap,
        kindsForWarm,
        { archiveScanMaxMs: PROGRESSIVE_IDB_ARCHIVE_SCAN_MAX_MS }
      )
      if (isStale()) return
      const idbUse = warmMatch ? idbE.filter(warmMatch) : idbE
      if (idbUse.length) {
        setEvents((prev) => mergeProgressiveSearchEvents(prev, idbUse, afterSort))
        setLoading(false)
      }
    } catch {
      /* ignore */
    }
  })()
}

function kickProgressiveSearchLocalLayers(params: ProgressiveSearchLocalLayerOpts): void {
  applyProgressiveSessionSearchLayer(params)
  startProgressiveIdbSearchLayer(params)
}

/** When omitting `kinds` from a live REQ, require another scope so we never subscribe to a whole relay. */
function timelineFilterHasNonKindScope(f: Filter): boolean {
  const search = f.search
  return (
    (Array.isArray(f.authors) && f.authors.length > 0) ||
    (Array.isArray(f.ids) && f.ids.length > 0) ||
    (Array.isArray(f['#p']) && f['#p']!.length > 0) ||
    (Array.isArray(f['#e']) && f['#e']!.length > 0) ||
    (typeof search === 'string' && search.trim().length > 0)
  )
}

/** REQ filter for the first subrequest, matching {@link NoteList} timeline mapping (for full relay search). */
function buildNoteListMappedFilterForFullSearch(
  req: TFeedSubRequest,
  options: {
    showKinds: number[]
    useFilterAsIs: boolean
    allowKindlessRelayExplore: boolean
    clientSideKindFilter: boolean
    seeAllFeedEvents: boolean
    areAlgoRelays: boolean
  }
): Filter | null {
  const { urls, filter } = req
  const defaultKinds = options.showKinds.length > 0 ? options.showKinds : [kinds.ShortTextNote]
  const baseLimit = filter.limit ?? (options.areAlgoRelays ? ALGO_LIMIT : LIMIT)
  const seeAllNoSpell = options.seeAllFeedEvents && !options.useFilterAsIs
  let f: Filter

  if (options.useFilterAsIs) {
    const hasKindsInRequest = Array.isArray(filter.kinds) && filter.kinds.length > 0
    if (options.allowKindlessRelayExplore && urls.length === 1 && !hasKindsInRequest) {
      const finalFilter: Filter = {
        ...filter,
        limit: filter.limit ?? RELAY_EXPLORE_LIMIT
      }
      delete finalFilter.kinds
      f = finalFilter
    } else {
      const finalFilter: Filter = { ...filter, limit: baseLimit }
      if (options.clientSideKindFilter) {
        if (hasKindsInRequest) {
          finalFilter.kinds = filter.kinds
        } else {
          delete finalFilter.kinds
        }
      } else if (hasKindsInRequest) {
        finalFilter.kinds = filter.kinds
      } else {
        finalFilter.kinds = defaultKinds
      }
      f = finalFilter
    }
  } else if (seeAllNoSpell) {
    const { kinds: _omitKinds, ...rest } = filter
    f = {
      ...rest,
      limit: options.areAlgoRelays ? ALGO_LIMIT : LIMIT
    }
  } else {
    f = {
      ...filter,
      kinds: defaultKinds,
      limit: options.areAlgoRelays ? ALGO_LIMIT : LIMIT
    }
  }

  if (seeAllNoSpell) return f

  const missingKinds = !f.kinds || f.kinds.length === 0
  if (!missingKinds) return f
  if (options.useFilterAsIs && options.clientSideKindFilter && timelineFilterHasNonKindScope(f)) return f
  if (options.useFilterAsIs && options.allowKindlessRelayExplore && urls.length === 1) return f
  return null
}

function eventTagValues(event: Event, tagName: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === tagName && typeof tag[1] === 'string')
    .map((tag) => tag[1] as string)
}

function eventMatchesSubRequestFilter(event: Event, filter: Filter): boolean {
  const ids = Array.isArray(filter.ids) ? filter.ids : undefined
  if (ids && ids.length > 0 && !ids.includes(event.id)) return false

  const authors = Array.isArray(filter.authors) ? filter.authors : undefined
  if (authors && authors.length > 0 && !authors.includes(event.pubkey)) return false

  const kindsFilter = Array.isArray(filter.kinds) ? filter.kinds : undefined
  if (kindsFilter && kindsFilter.length > 0 && !kindsFilter.includes(event.kind)) return false

  const tagFilterEntries = Object.entries(filter).filter(([key]) => key.startsWith('#'))
  for (const [key, values] of tagFilterEntries) {
    if (!Array.isArray(values) || values.length === 0) continue
    const tagName = key.slice(1)
    const eventValues = eventTagValues(event, tagName)
    if (eventValues.length === 0) return false
    const matched =
      tagName.toLowerCase() === 't'
        ? (() => {
            const allowed = new Set(values.map((v) => String(v).toLowerCase()))
            return eventValues.some((v) => allowed.has(v.toLowerCase()))
          })()
        : (() => {
            const allowed = new Set(values.map((v) => String(v)))
            return eventValues.some((v) => allowed.has(v))
          })()
    if (!matched) return false
  }

  return true
}

const NoteList = forwardRef(
  (
    {
      subRequests,
      showKinds,
      showKind1OPs = true,
      showKind1Replies = true,
      showKind1111 = true,
      seeAllFeedEvents = false,
      /**
       * Default true: kind picker + kind-1 / 1111 splits narrow visible rows. False only when {@link showAllKinds}
       * should win without listing every kind (rare).
       */
      withKindFilter = true,
      /**
       * True on relay explorer and when KindFilter "All Events" is on (home): merged timeline is not narrowed to
       * {@link showKinds} for display or live merge.
       */
      showAllKinds = false,
      /**
       * Single-relay Explore / home chip: REQ omits `kinds`, relay limit (see `SINGLE_RELAY_KINDLESS_REQ_LIMIT`).
       */
      allowKindlessRelayExplore = false,
      filterMutedNotes = true,
      hideReplies = false,
      hideUntrustedNotes = false,
      areAlgoRelays = false,
      relayCapabilityReady = true,
      pinnedEventIds = [],
      useFilterAsIs = false,
      extraShouldHideEvent,
      /** When set (e.g. Spells page), timeline subscription keys off this string instead of `subRequests` reference churn. */
      feedSubscriptionKey,
      /**
       * When true (e.g. Explore relay reviews), `subRequests` may grow after first paint (bootstrap relays → full list).
       * Re-subscribe when URLs change but **merge** new timeline batches into existing rows by event id instead of clearing.
       */
      preserveTimelineOnSubRequestsChange = false,
      /**
       * With {@link preserveTimelineOnSubRequestsChange}: when relay URLs change but each subrequest’s canonical
       * filter string is unchanged (e.g. profile Medien provisional stack → NIP-65 stack), keep visible rows and
       * avoid a loading reset.
       */
      mergeTimelineWhenSubRequestFiltersMatch = false,
      /** Home following: second {@link client.subscribeTimeline} merged into the primary composite key (delta relays / new authors). */
      followingFeedDeltaSubRequests,
      /**
       * When set with {@link preserveTimelineOnSubRequestsChange}: home relay chip / feed mode identity.
       * If this string changes (e.g. single relay → all favorites), the timeline is cleared even when the new
       * relay URL set is a strict superset of the old one (which would otherwise keep stale rows).
       */
      feedTimelineScopeKey,
      /** Spells page: bumps when user picks a feed; used with {@link onSpellFeedFirstPaint}. */
      spellFeedInstrumentToken,
      /** Spells page: fired once when the filtered list first has rows after a picker change. */
      onSpellFeedFirstPaint,
      /**
       * After this many ms with no forced completion, loading is cleared so empty state can show (default 15s).
       * Use a larger value for slow feeds (e.g. notifications `#p` across many relays).
       */
      timelineLoadingSafetyTimeoutMs,
      /**
       * With {@link useFilterAsIs}: omit relay `kinds` when the subrequest filter has none. Kindless relay feeds
       * merge the full batch; {@link withKindFilter} + {@link showAllKinds} control whether {@link showKinds}
       * narrows merge and visible rows. Other `useFilterAsIs` paths may still narrow merged batches to {@link showKinds}.
       */
      clientSideKindFilter = false,
      /**
       * When true, load events with parallel {@link client.fetchEvents} per subRequest instead of
       * {@link client.subscribeTimeline}. No live stream or `loadMore` timeline pagination; use for faux spells
       * (except Following). Refresh re-fetches.
       */
      oneShotFetch = false,
      /** Override {@link client.fetchEvents} / query global timeout (default 14s). */
      oneShotGlobalTimeoutMs = 14_000,
      /** Override post-EOSE settle delay before resolving (default 2s). */
      oneShotEoseTimeoutMs = 2_000,
      /**
       * When `false`, do not resolve shortly after the first event (lets every relay finish EOSE first).
       * Use for wide multi-relay one-shot REQs so slow mirrors are not cut off.
       */
      oneShotFirstRelayGraceMs,
      /** Max events kept after merging one-shot REQ batches (default 100). */
      oneShotMergedCap,
      /** Initial visible rows and each “reveal more” step when scrolling cached events (default first {@link SHOW_COUNT}, then 2× per step). */
      revealBatchSize,
      /** When set with {@link oneShotFetch}, logs fetch + filter diagnostics to the console (e.g. faux spells). */
      oneShotDebugLabel,
      /**
       * When set, session cache + IndexedDB are scanned for this string before relay REQ completes, merged into the
       * timeline immediately (optional {@link progressiveWarmupMatch} narrows rows). Used for NIP-50 search + d-tag browse.
       */
      progressiveWarmupQuery,
      /** Optional extra filter for {@link progressiveWarmupQuery} hits (e.g. d-tag substring semantics). */
      progressiveWarmupMatch,
      /**
       * Union these kinds into {@link showKinds} for REQ mapping, UI kind gates, progressive warmup, and load-more
       * narrowing (e.g. long-form / publication kinds on d-tag + NIP-50 search feeds).
       */
      progressiveDocumentKinds,
      /**
       * When set with {@link oneShotFetch}, sort merged one-shot results with this comparator (e.g. exact d-tag first).
       */
      oneShotAfterMergeComparator,
      /**
       * When true (default), show the 🔍 client-side filter bar (search / from me / time window).
       * Set false on feeds where it should stay hidden (e.g. main following).
       */
      showFeedClientFilter = true,
      /**
       * When set, clear 🔍 filter + full-search results whenever this primary tab is not visible (other tabs stay
       * mounted with `hidden`) or when the in-page feed identity changes — see {@link feedClientFilterScopeKey}.
       */
      hostPrimaryPageName,
      /**
       * When {@link NormalFeed} renders Notes/Replies + kind row, it passes the slot element so the 🔍 control
       * sits on that row instead of an extra bar above the list. Omitted on spells / standalone NoteList.
       */
      feedClientFilterTabRowHost,
      onSingleRelayKindlessEmpty,
      feedTopNotice
    }: {
      subRequests: TFeedSubRequest[]
      showKinds: number[]
      showKind1OPs?: boolean
      showKind1Replies?: boolean
      showKind1111?: boolean
      /** Omit REQ kinds and skip client-side kind filtering (main feed testing). Ignored when useFilterAsIs. */
      seeAllFeedEvents?: boolean
      withKindFilter?: boolean
      showAllKinds?: boolean
      allowKindlessRelayExplore?: boolean
      filterMutedNotes?: boolean
      hideReplies?: boolean
      hideUntrustedNotes?: boolean
      areAlgoRelays?: boolean
      /**
       * When false (e.g. home relay feed waiting on `getRelayInfos`), skip timeline subscribe so
       * `areAlgoRelays` does not flip after the first REQ and tear the subscription down.
       */
      relayCapabilityReady?: boolean
      pinnedEventIds?: string[]
      /** When true, use filter from subRequests as-is (kinds, limit) instead of showKinds. For spell feeds. */
      useFilterAsIs?: boolean
      /** When provided and returns true, the event is omitted from the feed (in addition to built-in rules). */
      extraShouldHideEvent?: (evt: Event) => boolean
      feedSubscriptionKey?: string
      preserveTimelineOnSubRequestsChange?: boolean
      mergeTimelineWhenSubRequestFiltersMatch?: boolean
      followingFeedDeltaSubRequests?: TFeedSubRequest[]
      feedTimelineScopeKey?: string
      spellFeedInstrumentToken?: number
      onSpellFeedFirstPaint?: (detail: { eventCount: number; firstEventId: string }) => void
      timelineLoadingSafetyTimeoutMs?: number
      clientSideKindFilter?: boolean
      oneShotFetch?: boolean
      oneShotMergedCap?: number
      revealBatchSize?: number
      oneShotDebugLabel?: string
      progressiveWarmupQuery?: string
      progressiveWarmupMatch?: (ev: Event) => boolean
      progressiveDocumentKinds?: readonly number[]
      oneShotAfterMergeComparator?: (a: Event, b: Event) => number
      oneShotGlobalTimeoutMs?: number
      oneShotEoseTimeoutMs?: number
      oneShotFirstRelayGraceMs?: number | false
      showFeedClientFilter?: boolean
      hostPrimaryPageName?: TPrimaryPageName
      feedClientFilterTabRowHost?: HTMLElement | null
      /** Single-relay kindless: if EOSE with no events, parent switches to explicit kinds in `subRequests`. */
      onSingleRelayKindlessEmpty?: () => void
      /** Optional banner above the feed (e.g. kindless→kinds fallback). */
      feedTopNotice?: ReactNode
    },
    ref
  ) => {
    const { t } = useTranslation()
    const { startLogin, pubkey } = useNostr()
    const { isUserTrusted } = useUserTrust()
    const { mutePubkeySet } = useMuteList()
    const { hideContentMentioningMutedUsers } = useContentPolicy()
    const { isEventDeleted } = useDeletedEvent()
    const { zapReplyThreshold } = useZap()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const [events, setEvents] = useState<Event[]>([])
    const eventsRef = useRef<Event[]>([])
    const [feedFullSearchEvents, setFeedFullSearchEvents] = useState<Event[] | null>(null)
    const [feedFullSearchLoading, setFeedFullSearchLoading] = useState(false)
    const feedFullSearchEventsRef = useRef<Event[] | null>(null)
    const displayTimelineSourceRef = useRef<Event[]>([])
    const [newEvents, setNewEvents] = useState<Event[]>([])
    const [hasMore, setHasMore] = useState<boolean>(true)
    const [loading, setLoading] = useState(true)
    /** Session/IDB/relay layers still running for {@link progressiveWarmupQuery} feeds (drives “Looking for more…”). */
    const [progressiveLayersSearching, setProgressiveLayersSearching] = useState(false)
    const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
    const [refreshCount, setRefreshCount] = useState(0)
    const [showCount, setShowCount] = useState(SHOW_COUNT)
    const [feedClientFilterOpen, setFeedClientFilterOpen] = useState(false)
    const [feedClientSearch, setFeedClientSearch] = useState('')
    const [feedClientAuthorMode, setFeedClientAuthorMode] = useState<TFeedClientAuthorMode>('everyone')
    const [feedClientAuthorNpubInput, setFeedClientAuthorNpubInput] = useState('')
    const [feedClientKindInput, setFeedClientKindInput] = useState('')
    const [feedClientTimeAmount, setFeedClientTimeAmount] = useState('')
    const [feedClientTimeUnit, setFeedClientTimeUnit] = useState<TFeedClientTimeUnit>('day')
    const supportTouch = useMemo(() => isTouchDevice(), [])

    const timelineEventsForFilter = feedFullSearchEvents ?? events

    useEffect(() => {
      feedFullSearchEventsRef.current = feedFullSearchEvents
    }, [feedFullSearchEvents])

    useEffect(() => {
      displayTimelineSourceRef.current = timelineEventsForFilter
    }, [timelineEventsForFilter])
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const topRef = useRef<HTMLDivElement | null>(null)
    const spellFeedFirstPaintLoggedKeyRef = useRef('')
    const consecutiveEmptyRef = useRef(0) // Track consecutive empty results to prevent infinite retries
    const loadMoreTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Throttle loadMore calls to prevent stuttering
    /** Batched profile + embed prefetch after timeline updates (avoids N×9s profile storms while relays stream). */
    const timelinePrefetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastEventsForTimelinePrefetchRef = useRef<Event[]>([])
    /**
     * {@link client.subscribeTimeline} resolves asynchronously; cleanup used to only close via
     * `promise.then(closer)`, so the next effect could open a new REQ before the prior closer ran.
     * That stacks subscriptions on strict relays (e.g. ≤10 subs) and triggers rejections / rate limits.
     */
    const timelineEstablishedCloserRef = useRef<(() => void) | null>(null)
    /** Bumps on each timeline effect run so Strict Mode / fast remount does not stack subscribeTimeline waves. */
    const timelineEffectGenerationRef = useRef(0)
    /** Session snapshot was written to state; log once after commit (see feed-paint layout effect). */
    const feedPaintSessionPendingRef = useRef(false)
    /** Relay / one-shot data was written to state; log once after commit. */
    const feedPaintRelayPendingRef = useRef(false)
    const feedPaintRelayMetaRef = useRef<Record<string, unknown> | null>(null)
    /** First live `onEvents` paint per timeline init (rows or terminal EOSE). */
    const feedPaintLiveRelayDoneRef = useRef(false)
    /** True if any timeline `onEvents` batch had `batch.length > 0`, or one-shot fetches returned any raw events (before UI filters). */
    const feedRelayReturnedAnyEventRef = useRef(false)
    /** One-shot per timeline init: avoid double-calling parent fallback (Strict Mode / duplicate EOSE). */
    const singleRelayKindlessFallbackAttemptedRef = useRef(false)
    const onSingleRelayKindlessEmptyRef = useRef(onSingleRelayKindlessEmpty)
    onSingleRelayKindlessEmptyRef.current = onSingleRelayKindlessEmpty
    /** Dedupe {@link toast.error} when relays return nothing for a feed load. */
    const emptyRelayNoHitsToastKeyRef = useRef('')
    /** Per-relay outcomes for the current subscribe wave (merged shards); drives empty-feed toast detail. */
    const [feedSubscribeRelayOutcomes, setFeedSubscribeRelayOutcomes] = useState<RelayOpTerminalRow[]>([])
    /**
     * Bumped when {@link feedPaintLiveRelayDoneRef} becomes true so the empty-feed toast effect re-runs.
     * (Loading clears when subscribe wires; merged EOSE arrives later.)
     */
    const [feedEmptyToastGateTick, setFeedEmptyToastGateTick] = useState(0)
    /**
     * Mirrors {@link feedPaintLiveRelayDoneRef} in React state so the list can show a skeleton until the first
     * merged `onEvents` (rows or EOSE). {@link loading} clears when subscribe wires, which is earlier than REQ/EOSE.
     */
    const [feedTimelineEmptyUiReady, setFeedTimelineEmptyUiReady] = useState(false)

    const [feedProfileBatch, setFeedProfileBatch] = useState<{
      profiles: Map<string, TProfile>
      pending: Set<string>
      version: number
    }>(() => ({ profiles: new Map(), pending: new Set(), version: 0 }))
    const feedProfileLoadedRef = useRef<Set<string>>(new Set())
    const feedProfileBatchGenRef = useRef(0)

    const noteFeedProfileContextValue = useMemo<NoteFeedProfileContextValue>(
      () => ({
        profiles: feedProfileBatch.profiles,
        pendingPubkeys: feedProfileBatch.pending,
        version: feedProfileBatch.version
      }),
      [feedProfileBatch]
    )
    
    // Memoize subRequests serialization to avoid expensive JSON.stringify on every render
    const subRequestsKey = useMemo(() => {
      return JSON.stringify(
        subRequests.map((req) => ({
          urls: [...req.urls].map((u) => normalizeUrl(u) || u).filter(Boolean).sort(),
          filter: stableSpellFeedFilterKey(req.filter)
        }))
      )
    }, [subRequests])

    const followingFeedDeltaSubRequestsKey = useMemo(
      () =>
        JSON.stringify(
          (followingFeedDeltaSubRequests ?? []).map((req) => ({
            urls: [...req.urls].map((u) => normalizeUrl(u) || u).filter(Boolean).sort(),
            filter: stableSpellFeedFilterKey(req.filter)
          }))
        ),
      [followingFeedDeltaSubRequests]
    )

    const effectiveShowKinds = useMemo(() => {
      if (!progressiveDocumentKinds?.length) return showKinds
      return Array.from(new Set([...showKinds, ...progressiveDocumentKinds])).sort((a, b) => a - b)
    }, [showKinds, progressiveDocumentKinds])

    const mapLiveSubRequestsForTimeline = useCallback(
      (requests: TFeedSubRequest[]) => {
        const defaultKinds = effectiveShowKinds.length > 0 ? effectiveShowKinds : [kinds.ShortTextNote]
        const seeAllNoSpell = seeAllFeedEvents && !useFilterAsIs
        return requests.map(({ urls, filter }) => {
          const baseLimit = filter.limit ?? (areAlgoRelays ? ALGO_LIMIT : LIMIT)
          if (useFilterAsIs) {
            const hasKindsInRequest = Array.isArray(filter.kinds) && filter.kinds.length > 0
            if (allowKindlessRelayExplore && urls.length === 1 && !hasKindsInRequest) {
              const finalFilter: Filter = {
                ...filter,
                limit: filter.limit ?? RELAY_EXPLORE_LIMIT
              }
              delete finalFilter.kinds
              return { urls, filter: finalFilter }
            }
            const finalFilter: Filter = { ...filter, limit: baseLimit }
            if (clientSideKindFilter) {
              if (hasKindsInRequest) {
                finalFilter.kinds = filter.kinds
              } else {
                delete finalFilter.kinds
              }
            } else if (hasKindsInRequest) {
              finalFilter.kinds = filter.kinds
            } else {
              finalFilter.kinds = defaultKinds
            }
            return { urls, filter: finalFilter }
          }
          if (seeAllNoSpell) {
            const { kinds: _omitKinds, ...rest } = filter
            return {
              urls,
              filter: {
                ...rest,
                limit: areAlgoRelays ? ALGO_LIMIT : LIMIT
              }
            }
          }
          return {
            urls,
            filter: {
              ...filter,
              kinds: defaultKinds,
              limit: areAlgoRelays ? ALGO_LIMIT : LIMIT
            }
          }
        })
      },
      [
        allowKindlessRelayExplore,
        areAlgoRelays,
        clientSideKindFilter,
        seeAllFeedEvents,
        effectiveShowKinds,
        useFilterAsIs
      ]
    )

    /** Feed identity for scoping client filter state (timeline key minus unrelated churn where possible). */
    const feedClientFilterScopeKey = useMemo(
      () => feedTimelineScopeKey ?? feedSubscriptionKey ?? subRequestsKey,
      [feedTimelineScopeKey, feedSubscriptionKey, subRequestsKey]
    )

    const primaryPageCtx = usePrimaryPageOptional()
    const primaryPageCurrent = primaryPageCtx?.current ?? null

    /** Clears text/author/time/full-search; does not change panel open state. */
    const clearFeedClientSearchCriteria = useCallback(() => {
      setFeedClientSearch('')
      setFeedClientAuthorMode('everyone')
      setFeedClientAuthorNpubInput('')
      setFeedClientKindInput('')
      setFeedClientTimeAmount('')
      setFeedClientTimeUnit('day')
      setFeedFullSearchEvents(null)
      setFeedFullSearchLoading(false)
    }, [])

    const resetFeedClientFilterState = useCallback(() => {
      clearFeedClientSearchCriteria()
      setFeedClientFilterOpen(false)
    }, [clearFeedClientSearchCriteria])

    const onToggleFeedClientFilterPanel = useCallback(() => {
      setFeedClientFilterOpen((wasOpen) => {
        if (wasOpen) {
          clearFeedClientSearchCriteria()
          return false
        }
        return true
      })
    }, [clearFeedClientSearchCriteria])

    useEffect(() => {
      resetFeedClientFilterState()
    }, [feedClientFilterScopeKey, resetFeedClientFilterState])

    useEffect(() => {
      if (hostPrimaryPageName === undefined) return
      if (primaryPageCurrent !== hostPrimaryPageName) {
        resetFeedClientFilterState()
      }
    }, [hostPrimaryPageName, primaryPageCurrent, resetFeedClientFilterState])

    const timelineSubscriptionKey = feedSubscriptionKey ?? subRequestsKey
    const prevSubRequestsKeyForTimelineRef = useRef<string | null>(null)
    const feedTimelineScopePrevRef = useRef<string | undefined>(undefined)
    /** Detect pull-to-refresh so preserve-mode feeds still clear; unrelated dep changes must not clear. */
    const timelineEffectLastRefreshCountRef = useRef(refreshCount)
    const followingFeedDeltaCloserRef = useRef<(() => void) | null>(null)

    useLayoutEffect(() => {
      setFeedTimelineEmptyUiReady(false)
      setFeedSubscribeRelayOutcomes([])
    }, [timelineSubscriptionKey, refreshCount])

    useEffect(() => {
      feedProfileBatchGenRef.current += 1
      feedProfileLoadedRef.current.clear()
      setFeedProfileBatch({ profiles: new Map(), pending: new Set(), version: 0 })
    }, [timelineSubscriptionKey, refreshCount])

    /** Pending pubkeys sync with rows so useFetchProfile skips per-note fetches before the debounced batch. */
    useLayoutEffect(() => {
      const candidates = new Set<string>()
      const addPk = (p: string | undefined) => {
        if (!p) return
        const t = p.trim()
        if (t.length === 64 && /^[0-9a-f]{64}$/i.test(t)) {
          candidates.add(t.toLowerCase())
        }
      }
      const addPkFromEventTags = (e: Event) => {
        let n = 0
        for (const tag of e.tags) {
          if (tag[0] === 'p' && tag[1]) {
            addPk(tag[1])
            n++
            if (n >= 4) break
          }
        }
      }
      for (const e of timelineEventsForFilter) {
        addPk(e.pubkey)
        addPkFromEventTags(e)
      }
      for (const e of newEvents) {
        addPk(e.pubkey)
        addPkFromEventTags(e)
      }

      setFeedProfileBatch((prev) => {
        const pending = new Set(prev.pending)
        let changed = false
        for (const pk of candidates) {
          if (!prev.profiles.has(pk) && !pending.has(pk)) {
            pending.add(pk)
            changed = true
          }
        }
        if (!changed) return prev
        return { ...prev, pending, version: prev.version + 1 }
      })
    }, [timelineEventsForFilter, newEvents])

    const subRequestsRef = useRef(subRequests)
    subRequestsRef.current = subRequests

    // Stable key for kind filter so subscription effect doesn't re-run on parent re-renders with same kinds
    // Use sorted array and JSON.stringify to create a stable key that only changes when content changes
    const showKindsKey = useMemo(() => {
      if (!effectiveShowKinds || effectiveShowKinds.length === 0) return ''
      return JSON.stringify([...effectiveShowKinds].sort((a, b) => a - b))
    }, [effectiveShowKinds])

    /**
     * Session snapshot identity: feed + kind UI toggles that affect **REQ** / merged rows.
     * Do **not** include {@link hideReplies}: Notes vs Replies only changes client-side filtering; the same
     * raw timeline should restore for both tabs (otherwise Replies can show cache while Notes looks empty).
     */
    const sessionSnapshotIdentityKey = useMemo(
      () =>
        JSON.stringify({
          feed: timelineSubscriptionKey,
          ...(allowKindlessRelayExplore
            ? { relayKindless: true, showAllKinds }
            : {
                kinds: showKindsKey,
                op: showKind1OPs,
                rep: showKind1Replies,
                c1111: showKind1111,
                seeAll: seeAllFeedEvents
              })
        }),
      [
        timelineSubscriptionKey,
        showKindsKey,
        showKind1OPs,
        showKind1Replies,
        showKind1111,
        seeAllFeedEvents,
        allowKindlessRelayExplore,
        showAllKinds
      ]
    )

    /** Kindless relay explore ignores the feed kind picker; avoid re-subscribing when it changes. */
    const timelineResubscribeKindKey = allowKindlessRelayExplore
      ? 'kindless-relay-explore'
      : `${showKindsKey}|${showKind1OPs}|${showKind1Replies}|${showKind1111}`

    const showKindsRef = useRef(showKinds)
    showKindsRef.current = showKinds
    const effectiveShowKindsRef = useRef(effectiveShowKinds)
    effectiveShowKindsRef.current = effectiveShowKinds
    const progressiveDocumentKindsRef = useRef(progressiveDocumentKinds)
    progressiveDocumentKindsRef.current = progressiveDocumentKinds
    const progressiveWarmupQueryRef = useRef(progressiveWarmupQuery)
    progressiveWarmupQueryRef.current = progressiveWarmupQuery
    const progressiveWarmupMatchRef = useRef(progressiveWarmupMatch)
    progressiveWarmupMatchRef.current = progressiveWarmupMatch
    const oneShotAfterMergeComparatorRef = useRef(oneShotAfterMergeComparator)
    oneShotAfterMergeComparatorRef.current = oneShotAfterMergeComparator
    const seeAllFeedEventsRef = useRef(seeAllFeedEvents)
    seeAllFeedEventsRef.current = seeAllFeedEvents
    const allowKindlessRelayExploreRef = useRef(allowKindlessRelayExplore)
    allowKindlessRelayExploreRef.current = allowKindlessRelayExplore
    const useFilterAsIsRef = useRef(useFilterAsIs)
    useFilterAsIsRef.current = useFilterAsIs
    const clientSideKindFilterRef = useRef(clientSideKindFilter)
    clientSideKindFilterRef.current = clientSideKindFilter
    const showAllKindsRef = useRef(showAllKinds)
    showAllKindsRef.current = showAllKinds
    const withKindFilterRef = useRef(withKindFilter)
    withKindFilterRef.current = withKindFilter

    /**
     * When to apply kind picker + kind-1 OP|reply / 1111 / GitRelease splits to visible rows.
     * Home feeds default to {@link withKindFilter}; relay explorer and KindFilter "All Events" use {@link showAllKinds}.
     */
    const applyKindPickerInUi = useMemo(
      () => withKindFilter && !showAllKinds && !seeAllFeedEvents,
      [withKindFilter, showAllKinds, seeAllFeedEvents]
    )

    const shouldHideEvent = useCallback(
      (evt: Event) => {
        const pinnedEventHexIdSet = new Set()
        pinnedEventIds.forEach((id) => {
          try {
            const { type, data } = decode(id)
            if (type === 'nevent') {
              pinnedEventHexIdSet.add(data.id)
            }
          } catch {
            // ignore
          }
        })

        if (pinnedEventHexIdSet.has(evt.id)) return true
        if (isEventDeleted(evt)) return true
        if (hideReplies && isReplyNoteEvent(evt)) return true
        if (hideUntrustedNotes && !isUserTrusted(evt.pubkey)) return true
        if (filterMutedNotes && muteSetHas(mutePubkeySet, evt.pubkey)) return true
        if (
          filterMutedNotes &&
          hideContentMentioningMutedUsers &&
          isMentioningMutedUsers(evt, mutePubkeySet)
        ) {
          return true
        }

        // Filter out expired events
        if (shouldFilterEvent(evt)) return true

        // Filter out zap receipts below the zap-reply threshold (same rule as thread replies)
        if (evt.kind === ExtendedKind.ZAP_RECEIPT && !shouldIncludeZapReceiptAtReplyThreshold(evt, zapReplyThreshold)) {
          return true
        }

        if (extraShouldHideEvent?.(evt)) return true

        return false
      },
      [
        filterMutedNotes,
        hideReplies,
        hideUntrustedNotes,
        hideContentMentioningMutedUsers,
        mutePubkeySet,
        pinnedEventIds,
        isEventDeleted,
        zapReplyThreshold,
        extraShouldHideEvent
      ]
    )

    const shouldHideEventRef = useRef(shouldHideEvent)
    useEffect(() => {
      shouldHideEventRef.current = shouldHideEvent
    }, [shouldHideEvent])

    const filteredEvents = useMemo(() => {
      const idSet = new Set<string>()
      const out: Event[] = []
      const target = showCount
      const maxScan = Math.min(
        timelineEventsForFilter.length,
        Math.min(MAX_TIMELINE_EVENTS_SCAN_FOR_VISIBLE, Math.max(target * 60, 400))
      )

      for (let i = 0; i < maxScan && out.length < target; i++) {
        const evt = timelineEventsForFilter[i]
        if (applyKindPickerInUi) {
          if (!effectiveShowKinds.includes(evt.kind)) continue
          if (evt.kind === kinds.ShortTextNote) {
            const isReply = isReplyNoteEvent(evt)
            if (isReply && !showKind1Replies) continue
            if (!isReply && !showKind1OPs) continue
          }
          if (evt.kind === ExtendedKind.COMMENT && !showKind1111) continue
          if (evt.kind === ExtendedKind.GIT_RELEASE && !showKind1OPs) continue
        }
        if (shouldHideEvent(evt)) continue

        const id = isReplaceableEvent(evt.kind) ? getReplaceableCoordinateFromEvent(evt) : evt.id
        if (idSet.has(id)) continue
        idSet.add(id)
        out.push(evt)
      }
      return out
    }, [
      timelineEventsForFilter,
      showCount,
      shouldHideEvent,
      showKinds,
      showKind1OPs,
      showKind1Replies,
      showKind1111,
      applyKindPickerInUi
    ])

    useLayoutEffect(() => {
      if (!feedPaintSessionPendingRef.current && !feedPaintRelayPendingRef.current) return

      const shorten = (s: string, max: number) =>
        s.length > max ? `${s.slice(0, max)}…` : s
      const feedKeyShort = shorten(timelineSubscriptionKey, 200)
      const snapshotKeyShort = shorten(sessionSnapshotIdentityKey, 160)

      if (feedPaintSessionPendingRef.current) {
        feedPaintSessionPendingRef.current = false
        logger.info('[FeedPaint] Session cache committed (DOM)', {
          feedKey: feedKeyShort,
          snapshotKey: snapshotKeyShort,
          eventCount: events.length,
          filteredVisibleRows: filteredEvents.length,
          pubkeySlice: pubkey ? `${pubkey.slice(0, 12)}…` : undefined
        })
      }
      if (feedPaintRelayPendingRef.current) {
        feedPaintRelayPendingRef.current = false
        const meta = feedPaintRelayMetaRef.current
        feedPaintRelayMetaRef.current = null
        logger.info('[FeedPaint] Relay/network results committed (DOM)', {
          feedKey: feedKeyShort,
          snapshotKey: snapshotKeyShort,
          committedEventCount: events.length,
          filteredVisibleRows: filteredEvents.length,
          pubkeySlice: pubkey ? `${pubkey.slice(0, 12)}…` : undefined,
          ...meta
        })
      }
    }, [
      events,
      filteredEvents.length,
      timelineSubscriptionKey,
      sessionSnapshotIdentityKey,
      pubkey
    ])

    const filteredNewEvents = useMemo(() => {
      if (feedFullSearchEvents !== null) return []

      const idSet = new Set<string>()

      return newEvents.filter((event: Event) => {
        if (applyKindPickerInUi) {
          if (!effectiveShowKinds.includes(event.kind)) return false
          if (event.kind === kinds.ShortTextNote) {
            const isReply = isReplyNoteEvent(event)
            if (isReply && !showKind1Replies) return false
            if (!isReply && !showKind1OPs) return false
          }
          if (event.kind === ExtendedKind.COMMENT && !showKind1111) return false
          if (event.kind === ExtendedKind.GIT_RELEASE && !showKind1OPs) return false
        }
        if (shouldHideEvent(event)) return false

        const id = isReplaceableEvent(event.kind)
          ? getReplaceableCoordinateFromEvent(event)
          : event.id
        if (idSet.has(id)) {
          return false
        }
        idSet.add(id)
        return true
      })
    }, [
      feedFullSearchEvents,
      newEvents,
      shouldHideEvent,
      effectiveShowKinds,
      showKind1OPs,
      showKind1Replies,
      showKind1111,
      applyKindPickerInUi
    ])

    const feedClientMinCreatedAt = useMemo(() => {
      const raw = feedClientTimeAmount.trim()
      const n = parseInt(raw, 10)
      if (!Number.isFinite(n) || n < 1) return null
      return dayjs().subtract(n, feedClientTimeUnit).unix()
    }, [feedClientTimeAmount, feedClientTimeUnit])

    const filterAuthorHexForRelayBootstrap = useMemo(() => {
      if (feedClientAuthorMode === 'me' && pubkey) return pubkey
      if (feedClientAuthorMode === 'npub') {
        return inviteInputToHexPubkey(feedClientAuthorNpubInput)
      }
      return null
    }, [feedClientAuthorMode, feedClientAuthorNpubInput, pubkey])

    /**
     * `null` => no kind constraint, `number` => valid kind, `undefined` => invalid non-empty input.
     */
    const feedClientKindFilter = useMemo<number | null | undefined>(() => {
      const raw = feedClientKindInput.trim()
      if (raw.length === 0) return null
      if (!/^\d+$/.test(raw)) return undefined
      const parsed = Number(raw)
      if (!Number.isInteger(parsed)) return undefined
      if (parsed < FEED_FILTER_KIND_MIN || parsed > FEED_FILTER_KIND_MAX) return undefined
      return parsed
    }, [feedClientKindInput])

    const applyClientFeedFilter = useCallback(
      (evts: Event[]) => {
        let rows = evts
        if (feedClientAuthorMode === 'me' && pubkey) {
          const p = pubkey.toLowerCase()
          rows = rows.filter((e) => e.pubkey.toLowerCase() === p)
        } else if (feedClientAuthorMode === 'npub') {
          const raw = feedClientAuthorNpubInput.trim()
          if (raw) {
            const pk = inviteInputToHexPubkey(feedClientAuthorNpubInput)
            if (pk) {
              const pl = pk.toLowerCase()
              rows = rows.filter((e) => e.pubkey.toLowerCase() === pl)
            } else {
              rows = []
            }
          }
        }
        if (feedClientMinCreatedAt !== null) {
          rows = rows.filter((e) => e.created_at >= feedClientMinCreatedAt)
        }
        if (typeof feedClientKindFilter === 'number') {
          rows = rows.filter((e) => e.kind === feedClientKindFilter)
        } else if (feedClientKindFilter === undefined) {
          rows = []
        }
        const q = feedClientSearch.trim().toLowerCase()
        if (q) {
          rows = rows.filter((e) => {
            if (e.content?.toLowerCase().includes(q)) return true
            for (const tag of e.tags) {
              for (const cell of tag) {
                if (typeof cell === 'string' && cell.toLowerCase().includes(q)) return true
              }
            }
            return false
          })
        }
        return rows
      },
      [
        feedClientAuthorMode,
        feedClientAuthorNpubInput,
        pubkey,
        feedClientMinCreatedAt,
        feedClientKindFilter,
        feedClientSearch
      ]
    )

    const clientFilteredEvents = useMemo(
      () =>
        showFeedClientFilter ? applyClientFeedFilter(filteredEvents) : filteredEvents,
      [showFeedClientFilter, applyClientFeedFilter, filteredEvents]
    )

    const clientFilteredNewEvents = useMemo(
      () =>
        showFeedClientFilter ? applyClientFeedFilter(filteredNewEvents) : filteredNewEvents,
      [showFeedClientFilter, applyClientFeedFilter, filteredNewEvents]
    )

    const feedClientFilterActive = useMemo(
      () =>
        !!(
          showFeedClientFilter &&
          (feedClientSearch.trim() ||
            (feedClientAuthorMode === 'me' && !!pubkey) ||
            (feedClientAuthorMode === 'npub' && feedClientAuthorNpubInput.trim() !== '') ||
            feedClientKindInput.trim() !== '' ||
            feedClientMinCreatedAt !== null)
        ),
      [
        showFeedClientFilter,
        feedClientSearch,
        feedClientAuthorMode,
        feedClientAuthorNpubInput,
        feedClientKindInput,
        pubkey,
        feedClientMinCreatedAt
      ]
    )

    useLayoutEffect(() => {
      if (!onSpellFeedFirstPaint || spellFeedInstrumentToken === undefined) return
      if (filteredEvents.length === 0) return
      const first = filteredEvents[0]
      if (!first) return
      const fpKey = `${spellFeedInstrumentToken}|${timelineSubscriptionKey ?? ''}`
      if (spellFeedFirstPaintLoggedKeyRef.current === fpKey) return
      spellFeedFirstPaintLoggedKeyRef.current = fpKey
      onSpellFeedFirstPaint({
        eventCount: filteredEvents.length,
        firstEventId: first.id
      })
    }, [
      onSpellFeedFirstPaint,
      spellFeedInstrumentToken,
      timelineSubscriptionKey,
      filteredEvents.length,
      filteredEvents[0]?.id
    ])

    useEffect(() => {
      const handle = window.setTimeout(() => {
        const gen = feedProfileBatchGenRef.current
        const candidates = new Set<string>()
        const addPk = (p: string | undefined) => {
          if (p && p.length === 64 && /^[0-9a-f]{64}$/.test(p)) {
            candidates.add(p.toLowerCase())
          }
        }
        const addPkFromEventTags = (e: Event) => {
          let n = 0
          for (const tag of e.tags) {
            if (tag[0] === 'p' && tag[1]) {
              addPk(tag[1])
              n++
              if (n >= 4) break
            }
          }
        }
        for (const e of timelineEventsForFilter) {
          addPk(e.pubkey)
          addPkFromEventTags(e)
        }
        for (const e of newEvents) {
          addPk(e.pubkey)
          addPkFromEventTags(e)
        }

        const need = [...candidates].filter((pk) => !feedProfileLoadedRef.current.has(pk))
        if (need.length === 0) return

        need.forEach((pk) => feedProfileLoadedRef.current.add(pk))

        setFeedProfileBatch((prev) => {
          const pending = new Set(prev.pending)
          let pendingChanged = false
          for (const pk of need) {
            if (!pending.has(pk)) {
              pending.add(pk)
              pendingChanged = true
            }
          }
          if (!pendingChanged) return prev
          return { ...prev, pending, version: prev.version + 1 }
        })

        void (async () => {
          if (gen !== feedProfileBatchGenRef.current) return
          const chunks: string[][] = []
          for (let i = 0; i < need.length; i += FEED_PROFILE_CHUNK) {
            chunks.push(need.slice(i, i + FEED_PROFILE_CHUNK))
          }
          const settled = await Promise.allSettled(
            chunks.map((chunk) => client.fetchProfilesForPubkeys(chunk))
          )
          if (gen !== feedProfileBatchGenRef.current) return

          setFeedProfileBatch((prev) => {
            const next = new Map(prev.profiles)
            const pend = new Set(prev.pending)
            settled.forEach((res, idx) => {
              const chunk = chunks[idx]!
              if (res.status === 'rejected') {
                chunk.forEach((pk) => feedProfileLoadedRef.current.delete(pk))
                chunk.forEach((pk) => pend.delete(pk))
                return
              }
              const profiles = res.value
              for (const p of profiles) {
                next.set(p.pubkey, p)
                pend.delete(p.pubkey)
              }
              for (const pk of chunk) {
                pend.delete(pk)
                if (!next.has(pk)) {
                  next.set(pk, {
                    pubkey: pk,
                    npub: pubkeyToNpub(pk) ?? '',
                    username: formatPubkey(pk)
                  })
                }
              }
            })
            return { profiles: next, pending: pend, version: prev.version + 1 }
          })
        })()
      }, FEED_PROFILE_BATCH_DEBOUNCE_MS)
      return () => window.clearTimeout(handle)
    }, [timelineEventsForFilter, newEvents])

    const scrollToTop = useCallback((behavior: ScrollBehavior = 'instant') => {
      setTimeout(() => {
        topRef.current?.scrollIntoView({ behavior, block: 'start' })
      }, 20)
    }, [])

    const refresh = useCallback(() => {
      scrollToTop()
      setTimeout(() => {
        setRefreshCount((count) => count + 1)
      }, 500)
    }, [scrollToTop])

    const onPerformFeedFullSearch = useCallback(async () => {
      if (!showFeedClientFilter) return
      const reqs = subRequestsRef.current
      if (!reqs.length) {
        toast.error(t('Feed full search invalid feed'))
        return
      }
      const hasSearch = feedClientSearch.trim().length > 0
      const hasTime = feedClientMinCreatedAt !== null
      const hasKind = typeof feedClientKindFilter === 'number'
      let hasAuthor = false
      if (feedClientAuthorMode === 'me' && pubkey) hasAuthor = true
      if (feedClientAuthorMode === 'npub' && inviteInputToHexPubkey(feedClientAuthorNpubInput)) {
        hasAuthor = true
      }
      if (feedClientKindFilter === undefined) {
        toast.error(
          t('Feed filter kind invalid', {
            defaultValue: `Kind must be an integer between ${FEED_FILTER_KIND_MIN} and ${FEED_FILTER_KIND_MAX}.`
          })
        )
        return
      }
      if (!hasSearch && !hasTime && !hasAuthor && !hasKind) {
        toast.error(t('Feed full search need constraint'))
        return
      }

      const base = buildNoteListMappedFilterForFullSearch(reqs[0]!, {
        showKinds,
        useFilterAsIs,
        allowKindlessRelayExplore,
        clientSideKindFilter,
        seeAllFeedEvents,
        areAlgoRelays
      })
      if (!base) {
        toast.error(t('Feed full search invalid feed'))
        return
      }

      const finalFilter: Filter = { ...base }
      if (hasSearch) {
        finalFilter.search = feedClientSearch.trim()
      }
      if (feedClientAuthorMode === 'me' && pubkey) {
        finalFilter.authors = [pubkey]
      } else if (feedClientAuthorMode === 'npub') {
        const pk = inviteInputToHexPubkey(feedClientAuthorNpubInput)
        if (pk) finalFilter.authors = [pk]
      }
      if (feedClientMinCreatedAt !== null) {
        finalFilter.since = Math.max(
          feedClientMinCreatedAt,
          typeof finalFilter.since === 'number' ? finalFilter.since : 0
        )
      }
      if (hasKind) {
        finalFilter.kinds = [feedClientKindFilter]
      }

      const hasRelayScope =
        timelineFilterHasNonKindScope(finalFilter) ||
        (typeof finalFilter.since === 'number' && finalFilter.since > 0) ||
        (Array.isArray(finalFilter.kinds) && finalFilter.kinds.length > 0)
      if (!hasRelayScope) {
        toast.error(t('Feed full search need constraint'))
        return
      }

      setFeedFullSearchLoading(true)
      try {
        const relayUrls = await buildFeedFullSearchRelayUrls({
          viewerPubkey: pubkey ?? null,
          filterAuthorHex: filterAuthorHexForRelayBootstrap,
          favoriteRelays,
          blockedRelays
        })
        if (relayUrls.length === 0) {
          toast.error(t('Feed full search invalid feed'))
          return
        }
        const raw = await client.fetchEvents(relayUrls, finalFilter, {
          cache: true,
          globalTimeout: 22_000,
          eoseTimeout: 3500,
          firstRelayResultGraceMs: false
        })
        const merged = mergeEventBatchesById([], raw, FEED_FULL_SEARCH_MERGE_CAP)
        setFeedFullSearchEvents(merged)
        setShowCount(revealBatchSize ?? SHOW_COUNT)
        scrollToTop()
      } catch (e) {
        logger.warn('[NoteList] Feed full search failed', { error: e })
        toast.error(t('Feed full search failed'))
      } finally {
        setFeedFullSearchLoading(false)
      }
    }, [
      showFeedClientFilter,
      feedClientSearch,
      feedClientMinCreatedAt,
      feedClientKindFilter,
      feedClientAuthorMode,
      feedClientAuthorNpubInput,
      pubkey,
      filterAuthorHexForRelayBootstrap,
      favoriteRelays,
      blockedRelays,
      showKinds,
      useFilterAsIs,
      allowKindlessRelayExplore,
      clientSideKindFilter,
      seeAllFeedEvents,
      areAlgoRelays,
      revealBatchSize,
      scrollToTop,
      t
    ])

    const onClearFeedFullSearch = useCallback(() => {
      setFeedFullSearchEvents(null)
    }, [])

    const emptyFeedHardReloadLongPress = useLongPressAction(hardReloadPreservingFeedSnapshots)

    useImperativeHandle(ref, () => ({ scrollToTop, refresh }), [scrollToTop, refresh])

    useEffect(() => {
      const effectGen = ++timelineEffectGenerationRef.current
      const timelineEffectStale = () => effectGen !== timelineEffectGenerationRef.current

      timelineEstablishedCloserRef.current?.()
      timelineEstablishedCloserRef.current = null

      const currentSubRequests = subRequestsRef.current
      if (!currentSubRequests.length) {
        if (oneShotDebugLabel) {
          logger.info(`[${oneShotDebugLabel}] no subRequests — skipping timeline fetch`, {
            feedKey: timelineSubscriptionKey
          })
        }
        setLoading(false)
        setEvents([])
        // Return a no-op closer function to satisfy the cleanup function
        return () => {}
      }

      if (!relayCapabilityReady && !oneShotFetch) {
        setLoading(true)
        return () => {}
      }

      const prevSubKey = prevSubRequestsKeyForTimelineRef.current
      const userPulledRefresh = refreshCount !== timelineEffectLastRefreshCountRef.current
      if (userPulledRefresh) {
        timelineEffectLastRefreshCountRef.current = refreshCount
      }

      const prevFeedScope = feedTimelineScopePrevRef.current
      const feedScopeKey = feedTimelineScopeKey
      const feedScopeChanged =
        feedScopeKey !== undefined &&
        prevFeedScope !== undefined &&
        prevFeedScope !== feedScopeKey
      if (feedScopeKey !== undefined) {
        feedTimelineScopePrevRef.current = feedScopeKey
      } else {
        feedTimelineScopePrevRef.current = undefined
      }

      const keepExistingTimelineEvents =
        preserveTimelineOnSubRequestsChange &&
        !userPulledRefresh &&
        !feedScopeChanged &&
        (prevSubKey === subRequestsKey ||
          isRelayUrlStrictSupersetIdentityKey(prevSubKey, subRequestsKey) ||
          (mergeTimelineWhenSubRequestFiltersMatch &&
            isSpellSubRequestsSameFiltersDifferentRelays(prevSubKey, subRequestsKey)))
      prevSubRequestsKeyForTimelineRef.current = subRequestsKey

      /** False after cleanup so stale timeline callbacks cannot overwrite state after switching feeds (e.g. Spells discussions → notifications). */
      let effectActive = true

      async function init() {
        if (timelineEffectStale()) return undefined
        feedPaintSessionPendingRef.current = false
        feedPaintRelayPendingRef.current = false
        feedPaintRelayMetaRef.current = null
        feedPaintLiveRelayDoneRef.current = false
        feedRelayReturnedAnyEventRef.current = false
        singleRelayKindlessFallbackAttemptedRef.current = false

        // Re-subscribe with rows visible (e.g. relay URL expansion): don't flash global loading / skeleton.
        const keepRowsVisible =
          preserveTimelineOnSubRequestsChange &&
          keepExistingTimelineEvents &&
          eventsRef.current.length > 0

        const sessionSnap =
          !userPulledRefresh ? getSessionFeedSnapshot(sessionSnapshotIdentityKey) : undefined
        const restoredFromSession = !keepExistingTimelineEvents && !!(sessionSnap?.length)

        if (!keepExistingTimelineEvents) {
          if (restoredFromSession && sessionSnap) {
            feedPaintSessionPendingRef.current = true
            setEvents(sessionSnap)
            lastEventsForTimelinePrefetchRef.current = sessionSnap
            setNewEvents([])
            setShowCount(revealBatchSize ?? SHOW_COUNT)
            setLoading(!!oneShotFetch)
          } else {
            if (!keepRowsVisible) setLoading(true)
            setEvents([])
            setNewEvents([])
            setShowCount(revealBatchSize ?? SHOW_COUNT)
          }
        } else if (!keepRowsVisible) {
          setLoading(true)
        }
        setHasMore(true)
        consecutiveEmptyRef.current = 0 // Reset counter on refresh

        const seeAllNoSpell = seeAllFeedEventsRef.current && !useFilterAsIsRef.current

        const mappedSubRequests = mapLiveSubRequestsForTimeline(subRequestsRef.current)

        const filterMissingKinds = (f: Filter) => !f.kinds || f.kinds.length === 0
        const invalidFilters = mappedSubRequests.filter(({ urls, filter: f }) => {
          if (seeAllNoSpell) return false
          if (!filterMissingKinds(f)) return false
          if (useFilterAsIs && clientSideKindFilter && timelineFilterHasNonKindScope(f)) return false
          if (useFilterAsIs && allowKindlessRelayExplore && urls.length === 1) {
            return false
          }
          return true
        })
        if (invalidFilters.length > 0) {
          if (oneShotDebugLabel) {
            logger.warn(`[${oneShotDebugLabel}] abort: filter missing kinds`, {
              subRequestsKey: timelineSubscriptionKey
            })
          }
          feedPaintLiveRelayDoneRef.current = true
          setFeedEmptyToastGateTick((n) => n + 1)
          setFeedTimelineEmptyUiReady(true)
          setLoading(false)
          setEvents([])
          return undefined
        }

        /**
         * Kindless relay REQ: when {@link showAllKinds} is true (explorer / "All Events"), keep the full batch;
         * otherwise narrow to effectiveShowKinds so the merged timeline matches {@link applyKindPickerInUi}.
         */
        const narrowLiveBatch = (evs: Event[]) => {
          if (seeAllFeedEventsRef.current) return evs
          if (allowKindlessRelayExploreRef.current && showAllKindsRef.current) return evs
          if (!useFilterAsIsRef.current || !clientSideKindFilterRef.current) return evs
          if (!withKindFilterRef.current) return evs
          return evs.filter((e) => effectiveShowKinds.includes(e.kind))
        }

        if (oneShotFetch) {
          setHasMore(false)
          try {
            if (timelineEffectStale()) return undefined
            const warmQOneShot = progressiveWarmupQueryRef.current?.trim()
            if (warmQOneShot) {
              setProgressiveLayersSearching(true)
              kickProgressiveSearchLocalLayers({
                warmQ: warmQOneShot,
                isStale: () => !effectActive || timelineEffectStale(),
                kindsForWarm: mergeKindsForProgressiveWarmup(
                  showKindsRef.current,
                  progressiveDocumentKindsRef.current
                ),
                warmMatch: progressiveWarmupMatchRef.current,
                afterSort: oneShotAfterMergeComparatorRef.current,
                setEvents,
                setLoading
              })
            }
            if (timelineEffectStale()) {
              if (warmQOneShot) setProgressiveLayersSearching(false)
              return undefined
            }
            const firstRelayGraceResolved =
              oneShotFirstRelayGraceMs === undefined
                ? FIRST_RELAY_RESULT_GRACE_MS
                : oneShotFirstRelayGraceMs
            const batches = await Promise.all(
              mappedSubRequests.map(({ urls, filter }) =>
                client.fetchEvents(urls, filter, {
                  firstRelayResultGraceMs: firstRelayGraceResolved,
                  globalTimeout: oneShotGlobalTimeoutMs,
                  eoseTimeout: oneShotEoseTimeoutMs,
                  cache: true
                })
              )
            )
            if (!effectActive || timelineEffectStale()) return undefined
            if (batches.some((b) => b.length > 0)) {
              feedRelayReturnedAnyEventRef.current = true
            }
            const byId = new Map<string, Event>()
            for (const ev of batches.flat()) {
              const prev = byId.get(ev.id)
              if (!prev || ev.created_at > prev.created_at) {
                byId.set(ev.id, ev)
              }
            }
            const cap = oneShotMergedCap ?? ONE_SHOT_MERGED_CAP
            const isProgressiveLayers = !!progressiveWarmupQueryRef.current?.trim()
            let relayOnly = [...byId.values()].sort((a, b) => b.created_at - a.created_at)
            if (!isProgressiveLayers) {
              relayOnly = relayOnly.slice(0, cap)
            }
            if (
              useFilterAsIs &&
              clientSideKindFilter &&
              withKindFilter &&
              !seeAllFeedEventsRef.current &&
              (!allowKindlessRelayExplore || !showAllKinds)
            ) {
              relayOnly = relayOnly.filter((e) => effectiveShowKinds.includes(e.kind))
            }
            const mergeCmp = oneShotAfterMergeComparatorRef.current
            if (isProgressiveLayers) {
              setEvents((prev) => {
                let next = mergeProgressiveSearchEvents(prev, relayOnly, mergeCmp)
                if (sessionSnap?.length && !userPulledRefresh) {
                  next = mergeProgressiveSearchEvents(next, sessionSnap, mergeCmp)
                }
                if (mergeCmp) {
                  next = [...next].sort(mergeCmp)
                }
                lastEventsForTimelinePrefetchRef.current = next
                return next
              })
            } else {
              let merged = relayOnly
              if (sessionSnap?.length && !userPulledRefresh) {
                merged = mergeEventBatchesById(sessionSnap, merged, oneShotMergedCap ?? ONE_SHOT_MERGED_CAP)
              }
              if (oneShotDebugLabel) {
                const f0 = mappedSubRequests[0]?.filter
                const batchEventCounts = batches.map((b) => b.length)
                const rawTotal = batchEventCounts.reduce((s, n) => s + n, 0)
                logger.info(`[${oneShotDebugLabel}] one-shot fetch merged`, {
                  relayUrlsPerSub: mappedSubRequests.map((r) => r.urls.length),
                  batchEventCounts,
                  rawTotal,
                  dedupedCount: byId.size,
                  afterCap: merged.length,
                  cap,
                  filterAuthors: f0?.authors,
                  filterKinds: f0?.kinds,
                  filterLimit: f0?.limit,
                  ...(rawTotal === 0
                    ? {
                        emptyHint:
                          'All sub-batches returned 0 events: relays may not index these kinds for this author, the query may have timed out before slow relays EOSEd, or posts are kind 1 with links (this tab uses kinds 20/21/22/1222 only).'
                      }
                    : {})
                })
              }
              setEvents(merged)
              lastEventsForTimelinePrefetchRef.current = merged
            }
            if (oneShotDebugLabel && isProgressiveLayers) {
              const f0 = mappedSubRequests[0]?.filter
              const batchEventCounts = batches.map((b) => b.length)
              const rawTotal = batchEventCounts.reduce((s, n) => s + n, 0)
              logger.info(`[${oneShotDebugLabel}] one-shot progressive relay merge`, {
                relayUrlsPerSub: mappedSubRequests.map((r) => r.urls.length),
                batchEventCounts,
                rawTotal,
                dedupedCount: byId.size,
                filterAuthors: f0?.authors,
                filterKinds: f0?.kinds,
                filterLimit: f0?.limit
              })
            }
            feedPaintRelayPendingRef.current = true
            feedPaintRelayMetaRef.current = {
              variant: 'one_shot_fetch',
              mergedCount: relayOnly.length,
              mergedWithPriorSession: !!(sessionSnap?.length && !userPulledRefresh)
            }
          } catch (err) {
            if (oneShotDebugLabel) {
              logger.warn(`[${oneShotDebugLabel}] one-shot fetch threw`, err)
            }
            if (effectActive) {
              feedPaintRelayPendingRef.current = true
              feedPaintRelayMetaRef.current = {
                variant: 'one_shot_fetch',
                mergedCount: 0,
                fetchThrew: true
              }
              if (!progressiveWarmupQueryRef.current?.trim()) {
                setEvents([])
              }
            }
          } finally {
            if (effectActive) {
              if (progressiveWarmupQueryRef.current?.trim()) {
                setProgressiveLayersSearching(false)
              }
              feedPaintLiveRelayDoneRef.current = true
              setFeedEmptyToastGateTick((n) => n + 1)
              setFeedTimelineEmptyUiReady(true)
              setLoading(false)
              setHasMore(false)
              setTimelineKey(undefined)
            }
          }
          return undefined
        }

        const totalRelayUrls = mappedSubRequests.reduce((n, r) => n + r.urls.length, 0)
        // Many relays are opened under MAX_CONCURRENT_RELAY_CONNECTIONS; a short race aborts the whole feed.
        const subscribeSetupRaceMs = Math.min(
          300_000,
          Math.max(90_000, 25_000 + totalRelayUrls * 2_500)
        )

        let closer: (() => void) | undefined
        let timelineKey: string | undefined
        let timelineSubscribePromise:
          | Promise<{ closer: () => void; timelineKey: string }>
          | undefined

        try {
          if (timelineEffectStale()) return undefined
          // Opening many relay subs can exceed 2s on spell feeds; a short race
          // rejects, the catch closes the late subscription, and the list stays empty after refresh.
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`subscribeTimeline timeout after ${subscribeSetupRaceMs}ms`))
            }, subscribeSetupRaceMs)
          })

          const eventCap = allowKindlessRelayExplore
            ? RELAY_EXPLORE_LIMIT
            : areAlgoRelays
              ? ALGO_LIMIT
              : LIMIT

          // New REQ wave (incl. delta relays with same feed key): outcomes stay stale until this wave ends.
          setFeedSubscribeRelayOutcomes([])

          const warmQLive = progressiveWarmupQueryRef.current?.trim()
          if (warmQLive) {
            setProgressiveLayersSearching(true)
            kickProgressiveSearchLocalLayers({
              warmQ: warmQLive,
              isStale: () => !effectActive || timelineEffectStale(),
              kindsForWarm: mergeKindsForProgressiveWarmup(
                showKindsRef.current,
                progressiveDocumentKindsRef.current
              ),
              warmMatch: progressiveWarmupMatchRef.current,
              afterSort: oneShotAfterMergeComparatorRef.current,
              setEvents,
              setLoading
            })
          }
          if (timelineEffectStale()) {
            if (warmQLive) setProgressiveLayersSearching(false)
            return undefined
          }

          timelineSubscribePromise = client.subscribeTimeline(
            mappedSubRequests as Array<{ urls: string[]; filter: TSubRequestFilter }>,
            {
              onEvents: (batch: Event[], eosed: boolean) => {
                if (!effectActive) return
                if (batch.length > 0) {
                  feedRelayReturnedAnyEventRef.current = true
                }
                const narrowed = narrowLiveBatch(batch)
                const paintDoneBefore = feedPaintLiveRelayDoneRef.current
                if (!feedPaintLiveRelayDoneRef.current) {
                  if (narrowed.length > 0) {
                    feedPaintLiveRelayDoneRef.current = true
                    feedPaintRelayPendingRef.current = true
                    feedPaintRelayMetaRef.current = {
                      variant: 'live_subscription',
                      mode: 'rows',
                      narrowedInBatch: narrowed.length,
                      batchIncoming: batch.length,
                      eosed
                    }
                  } else if (eosed) {
                    feedPaintLiveRelayDoneRef.current = true
                    feedPaintRelayPendingRef.current = true
                    feedPaintRelayMetaRef.current = {
                      variant: 'live_subscription',
                      mode: 'eose_no_visible_rows',
                      batchIncoming: batch.length,
                      eosed
                    }
                  }
                }
                if (!paintDoneBefore && feedPaintLiveRelayDoneRef.current) {
                  setFeedEmptyToastGateTick((n) => n + 1)
                  setFeedTimelineEmptyUiReady(true)
                }
                if (batch.length > 0) {
                  if (narrowed.length > 0) {
                    setEvents((prev) => {
                      const next = progressiveWarmupQueryRef.current?.trim()
                        ? mergeProgressiveSearchEvents(
                            prev,
                            narrowed,
                            oneShotAfterMergeComparatorRef.current
                          )
                        : mergeEventBatchesById(prev, narrowed, eventCap)
                      lastEventsForTimelinePrefetchRef.current = next
                      return next
                    })
                    // Do not wait for full EOSE across many relays — otherwise loading/skeleton stays up for 10–30s+
                    setLoading(false)

                    // Defer profile + embed prefetch: streaming timelines fire onEvents often; starting
                    // fetchProfilesForPubkeys on every update spams relays (multi-second each) and cancels hooks.
                    if (timelinePrefetchDebounceRef.current) {
                      clearTimeout(timelinePrefetchDebounceRef.current)
                    }
                    timelinePrefetchDebounceRef.current = setTimeout(() => {
                      timelinePrefetchDebounceRef.current = null
                      if (!effectActive) return
                      const evs = lastEventsForTimelinePrefetchRef.current
                      if (evs.length === 0) return

                      const { hexIds, nip19Pointers } = mergePrefetchTargetsFromEvents(evs.slice(0, 50))
                      const hexIdsToFetch = hexIds.filter((id) => !prefetchedEventIdsRef.current.has(id))
                      const nip19ToFetch = nip19Pointers.filter((p) => !prefetchedEventIdsRef.current.has(p))
                      if (hexIdsToFetch.length > 0 || nip19ToFetch.length > 0) {
                        hexIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.add(id))
                        nip19ToFetch.forEach((p) => prefetchedEventIdsRef.current.add(p))
                        const run = async () => {
                          try {
                            await client.prefetchHexEventIds(hexIdsToFetch)
                            await Promise.all(nip19ToFetch.map((p) => client.fetchEvent(p)))
                          } catch {
                            hexIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.delete(id))
                            nip19ToFetch.forEach((p) => prefetchedEventIdsRef.current.delete(p))
                          }
                        }
                        void run()
                      }
                    }, 450)
                  } else if (eosed) {
                    setLoading(false)
                  }
                } else if (eosed) {
                  setLoading(false)
                }

                if (areAlgoRelays) {
                  // Algorithm feeds typically return all results at once
                  setHasMore(false)
                } else if (eosed) {
                  setLoading(false)
                  // CRITICAL FIX: For non-algo feeds, always assume there might be more events
                  // The initial load might only return a few events due to filtering or relay limits
                  // We should still try to load more on scroll - the loadMore logic will handle stopping
                  // Only set to false if we explicitly know there are no more events (handled in loadMore)
                  // If we got a full limit of events, there's likely more available
                  if (batch.length >= (areAlgoRelays ? ALGO_LIMIT : LIMIT)) {
                    setHasMore(true)
                  } else {
                    // Even with fewer events, there might be more (filtering, slow relays, etc.)
                    // Let loadMore determine if we've reached the end
                    setHasMore(true)
                  }
                }

                // Single-relay home chip: kindless REQ returned nothing — parent re-subscribes with explicit kinds.
                if (
                  eosed &&
                  effectActive &&
                  onSingleRelayKindlessEmptyRef.current &&
                  !singleRelayKindlessFallbackAttemptedRef.current &&
                  !feedRelayReturnedAnyEventRef.current
                ) {
                  const reqs = subRequestsRef.current
                  const f0 = reqs[0]
                  if (
                    reqs.length === 1 &&
                    f0 &&
                    f0.urls.length === 1 &&
                    allowKindlessRelayExploreRef.current &&
                    useFilterAsIsRef.current &&
                    clientSideKindFilterRef.current
                  ) {
                    const f = f0.filter as Filter
                    const noKinds = !f.kinds || f.kinds.length === 0
                    if (noKinds) {
                      singleRelayKindlessFallbackAttemptedRef.current = true
                      onSingleRelayKindlessEmptyRef.current()
                    }
                  }
                }
              },
            onNew: (event: Event) => {
              if (!effectActive) return
              feedRelayReturnedAnyEventRef.current = true
              if (!seeAllFeedEventsRef.current && withKindFilterRef.current) {
                const kindlessFirehose =
                  allowKindlessRelayExploreRef.current && showAllKindsRef.current
                  if (!kindlessFirehose) {
                  if (!useFilterAsIsRef.current && !effectiveShowKindsRef.current.includes(event.kind))
                    return
                  if (
                    clientSideKindFilterRef.current &&
                    useFilterAsIsRef.current &&
                    !effectiveShowKindsRef.current.includes(event.kind)
                  )
                    return
                  if (event.kind === kinds.ShortTextNote) {
                    const isReply = isReplyNoteEvent(event)
                    if (isReply && !showKind1Replies) return
                    if (!isReply && !showKind1OPs) return
                  }
                  if (event.kind === ExtendedKind.COMMENT && !showKind1111) return
                  if (event.kind === ExtendedKind.GIT_RELEASE && !showKind1OPs) return
                }
              }
              if (shouldHideEventRef.current(event)) return
              if (pubkey && event.pubkey === pubkey) {
                // If the new event is from the current user, insert it directly into the feed
                setEvents((oldEvents) =>
                  oldEvents.some((e) => e.id === event.id) ? oldEvents : [event, ...oldEvents]
                )
              } else {
                // Otherwise, buffer it and show the New Notes button
                setNewEvents((oldEvents) =>
                  [event, ...oldEvents].sort((a, b) => b.created_at - a.created_at)
                )
              }
            },
          },
          {
            startLogin,
            needSort: !areAlgoRelays,
            firstRelayResultGraceMs: FIRST_RELAY_RESULT_GRACE_MS,
            onRelaySubscribeWaveComplete: (rows) => {
              if (!effectActive) return
              setFeedSubscribeRelayOutcomes(rows)
              if (progressiveWarmupQueryRef.current?.trim()) {
                setProgressiveLayersSearching(false)
              }
            }
          }
          )

          const result = await Promise.race([timelineSubscribePromise, timeoutPromise])
          if (!effectActive || timelineEffectStale()) {
            result.closer()
            return undefined
          }
          closer = result.closer
          timelineEstablishedCloserRef.current = closer
          timelineKey = result.timelineKey
          setTimelineKey(timelineKey)
          // subscribeTimeline resolves once shards are wired; EOSE / merge callbacks can be delayed or
          // skipped on edge paths (all relays fail, strict NOTICE closes, etc.). Do not keep the global
          // skeleton until the first onEvents(..., eosed) — that can freeze the feed indefinitely.
          setLoading(false)
          return closer
      } catch (_error) {
        setLoading(false)
        if (progressiveWarmupQueryRef.current?.trim()) {
          setProgressiveLayersSearching(false)
        }
        if (effectActive) {
          feedPaintLiveRelayDoneRef.current = true
          setFeedEmptyToastGateTick((n) => n + 1)
          setFeedTimelineEmptyUiReady(true)
        }
        // Race timeout or subscribe failure: if the timeline promise later resolves, close or subs leak (relay slots + stale setEvents).
        if (timelineSubscribePromise) {
          void timelineSubscribePromise
            .then((r) => {
              r.closer()
            })
            .catch(() => {})
        }
        return undefined
      }
      }

      const promise = init()
      const snapshotKeyForCleanup = sessionSnapshotIdentityKey
      return () => {
        effectActive = false
        setProgressiveLayersSearching(false)
        followingFeedDeltaCloserRef.current?.()
        followingFeedDeltaCloserRef.current = null
        setSessionFeedSnapshot(snapshotKeyForCleanup, eventsRef.current)
        if (timelinePrefetchDebounceRef.current) {
          clearTimeout(timelinePrefetchDebounceRef.current)
          timelinePrefetchDebounceRef.current = null
        }
        const syncClose = timelineEstablishedCloserRef.current
        timelineEstablishedCloserRef.current = null
        syncClose?.()
        void promise.then((fallbackClose) => {
          if (fallbackClose && fallbackClose !== syncClose) {
            fallbackClose()
          }
        })
      }
    }, [
      timelineSubscriptionKey,
      sessionSnapshotIdentityKey,
      subRequestsKey,
      preserveTimelineOnSubRequestsChange,
      mergeTimelineWhenSubRequestFiltersMatch,
      feedTimelineScopeKey,
      refreshCount,
      timelineResubscribeKindKey,
      seeAllFeedEvents,
      useFilterAsIs,
      areAlgoRelays,
      relayCapabilityReady,
      oneShotFetch,
      oneShotMergedCap,
      revealBatchSize,
      oneShotDebugLabel,
      oneShotGlobalTimeoutMs,
      oneShotEoseTimeoutMs,
      oneShotFirstRelayGraceMs,
      clientSideKindFilter,
      allowKindlessRelayExplore,
      showAllKinds,
      withKindFilter,
      onSingleRelayKindlessEmpty,
      mapLiveSubRequestsForTimeline,
      progressiveWarmupQuery
    ])

    useEffect(() => {
      if (oneShotFetch) return
      const deltas = followingFeedDeltaSubRequests ?? []
      if (deltas.length === 0) {
        followingFeedDeltaCloserRef.current?.()
        followingFeedDeltaCloserRef.current = null
        return
      }
      const tk = timelineKey
      if (!tk) return

      let deltaActive = true
      const mappedDelta = mapLiveSubRequestsForTimeline(deltas)
      const seeAllNoSpellDelta = seeAllFeedEventsRef.current && !useFilterAsIsRef.current
      const filterMissingKindsDelta = (f: Filter) => !f.kinds || f.kinds.length === 0
      const invalidDelta = mappedDelta.filter(({ urls, filter: f }) => {
        if (seeAllNoSpellDelta) return false
        if (!filterMissingKindsDelta(f)) return false
        if (useFilterAsIs && clientSideKindFilter && timelineFilterHasNonKindScope(f)) return false
        if (useFilterAsIs && allowKindlessRelayExplore && urls.length === 1) return false
        return true
      })
      if (invalidDelta.length > 0) {
        logger.warn('[NoteList] following feed delta: invalid filters, skipping wave', {
          invalidCount: invalidDelta.length
        })
        followingFeedDeltaCloserRef.current?.()
        followingFeedDeltaCloserRef.current = null
        return
      }

      const eventCapDelta = allowKindlessRelayExplore
        ? RELAY_EXPLORE_LIMIT
        : areAlgoRelays
          ? ALGO_LIMIT
          : LIMIT

      const narrowDeltaBatch = (evs: Event[]) => {
        if (seeAllFeedEventsRef.current) return evs
        if (allowKindlessRelayExploreRef.current && showAllKindsRef.current) return evs
        if (!useFilterAsIsRef.current || !clientSideKindFilterRef.current) return evs
        if (!withKindFilterRef.current) return evs
        return evs.filter((e) => effectiveShowKindsRef.current.includes(e.kind))
      }

      void (async () => {
        try {
          const { closer, timelineKey: deltaTk } = await client.subscribeTimeline(
            mappedDelta as Array<{ urls: string[]; filter: TSubRequestFilter }>,
            {
              onEvents: (batch: Event[], eosed: boolean) => {
                if (!deltaActive) return
                if (batch.length > 0) {
                  feedRelayReturnedAnyEventRef.current = true
                }
                const narrowed = narrowDeltaBatch(batch)
                const paintDoneBefore = feedPaintLiveRelayDoneRef.current
                if (!feedPaintLiveRelayDoneRef.current) {
                  if (narrowed.length > 0) {
                    feedPaintLiveRelayDoneRef.current = true
                    feedPaintRelayPendingRef.current = true
                    feedPaintRelayMetaRef.current = {
                      variant: 'live_subscription',
                      mode: 'rows',
                      narrowedInBatch: narrowed.length,
                      batchIncoming: batch.length,
                      eosed
                    }
                  } else if (eosed) {
                    feedPaintLiveRelayDoneRef.current = true
                    feedPaintRelayPendingRef.current = true
                    feedPaintRelayMetaRef.current = {
                      variant: 'live_subscription',
                      mode: 'eose_no_visible_rows',
                      batchIncoming: batch.length,
                      eosed
                    }
                  }
                }
                if (!paintDoneBefore && feedPaintLiveRelayDoneRef.current) {
                  setFeedEmptyToastGateTick((n) => n + 1)
                  setFeedTimelineEmptyUiReady(true)
                }
                if (batch.length > 0) {
                  if (narrowed.length > 0) {
                    setEvents((prev) => {
                      const next = mergeEventBatchesById(prev, narrowed, eventCapDelta)
                      lastEventsForTimelinePrefetchRef.current = next
                      return next
                    })
                    setLoading(false)
                  } else if (eosed) {
                    setLoading(false)
                  }
                } else if (eosed) {
                  setLoading(false)
                }
                if (!areAlgoRelays && eosed) {
                  setHasMore(true)
                }
              },
              onNew: (event: Event) => {
                if (!deltaActive) return
                feedRelayReturnedAnyEventRef.current = true
                if (!seeAllFeedEventsRef.current && withKindFilterRef.current) {
                  const kindlessFirehose =
                    allowKindlessRelayExploreRef.current && showAllKindsRef.current
                  if (!kindlessFirehose) {
                    if (!useFilterAsIsRef.current && !effectiveShowKindsRef.current.includes(event.kind))
                      return
                    if (
                      clientSideKindFilterRef.current &&
                      useFilterAsIsRef.current &&
                      !effectiveShowKindsRef.current.includes(event.kind)
                    )
                      return
                    if (event.kind === kinds.ShortTextNote) {
                      const isReply = isReplyNoteEvent(event)
                      if (isReply && !showKind1Replies) return
                      if (!isReply && !showKind1OPs) return
                    }
                    if (event.kind === ExtendedKind.COMMENT && !showKind1111) return
                    if (event.kind === ExtendedKind.GIT_RELEASE && !showKind1OPs) return
                  }
                }
                if (shouldHideEventRef.current(event)) return
                if (pubkey && event.pubkey === pubkey) {
                  setEvents((oldEvents) =>
                    oldEvents.some((e) => e.id === event.id) ? oldEvents : [event, ...oldEvents]
                  )
                } else {
                  setNewEvents((oldEvents) =>
                    [event, ...oldEvents].sort((a, b) => b.created_at - a.created_at)
                  )
                }
              }
            },
            {
              startLogin,
              needSort: !areAlgoRelays,
              firstRelayResultGraceMs: FIRST_RELAY_RESULT_GRACE_MS
            }
          )
          if (!deltaActive) {
            closer()
            return
          }
          const addedLeaves = client.appendTimelinesToComposite(tk, deltaTk)
          const innerClose = closer
          const tkForLeafRemoval = tk
          followingFeedDeltaCloserRef.current = () => {
            innerClose()
            if (tkForLeafRemoval && addedLeaves.length > 0) {
              client.removeTimelineLeavesFromComposite(tkForLeafRemoval, addedLeaves)
            }
          }
        } catch (e) {
          logger.warn('[NoteList] following feed delta subscribe failed', { error: e })
        }
      })()

      return () => {
        deltaActive = false
        followingFeedDeltaCloserRef.current?.()
        followingFeedDeltaCloserRef.current = null
      }
    }, [
      followingFeedDeltaSubRequestsKey,
      timelineKey,
      oneShotFetch,
      mapLiveSubRequestsForTimeline,
      areAlgoRelays,
      allowKindlessRelayExplore,
      useFilterAsIs,
      clientSideKindFilter,
      startLogin,
      pubkey,
      effectiveShowKinds,
      showKind1OPs,
      showKind1Replies,
      showKind1111
    ])

    const oneShotDebugPrevLoadingRef = useRef(false)
    useEffect(() => {
      if (!oneShotDebugLabel || !oneShotFetch) return
      const wasLoading = oneShotDebugPrevLoadingRef.current
      oneShotDebugPrevLoadingRef.current = loading
      if (!wasLoading || loading) return

      const kind1s = events.filter((e) => e.kind === kinds.ShortTextNote)
      const kind1HiddenByExtra = kind1s.filter((e) => extraShouldHideEvent?.(e) === true).length
      const kindCounts: Record<number, number> = {}
      for (const e of events) {
        kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1
      }
      logger.info(`[${oneShotDebugLabel}] one-shot load settled (UI filters)`, {
        timelineSubscriptionKey,
        eventsInState: events.length,
        filteredVisibleRows: filteredEvents.length,
        showCount,
        kindCounts,
        kind1Count: kind1s.length,
        kind1HiddenByExtraShouldHide: kind1HiddenByExtra
      })
    }, [
      oneShotDebugLabel,
      oneShotFetch,
      loading,
      events,
      filteredEvents.length,
      showCount,
      timelineSubscriptionKey,
      extraShouldHideEvent
    ])

    useEffect(() => {
      eventsRef.current = events
    }, [events])

    const loadingSafetyMs = timelineLoadingSafetyTimeoutMs ?? 15_000

    useEffect(() => {
      if (!subRequestsRef.current.length) return
      let cancelled = false
      const timer = window.setTimeout(() => {
        if (cancelled) return
        setLoading((prev) => (prev ? false : prev))
        // hasMore defaults true; if timeline never sends eosed (slow/hung relays), we would keep a
        // bottom skeleton forever while loading is false — unblock empty state / reload.
        if (eventsRef.current.length === 0) {
          setHasMore(false)
        }
      }, loadingSafetyMs)
      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }, [timelineSubscriptionKey, refreshCount, loadingSafetyMs])

    // Use refs to avoid dependency issues and ensure latest values in async callbacks
    const showCountRef = useRef(showCount)
    const loadingRef = useRef(loading)
    const hasMoreRef = useRef(hasMore)
    const timelineKeyRef = useRef(timelineKey)
    const blankFeedHiddenAtRef = useRef<number | null>(null)

    useEffect(() => {
      showCountRef.current = showCount
    }, [showCount])
    
    useEffect(() => {
      loadingRef.current = loading
    }, [loading])

    useEffect(() => {
      if (loading || events.length > 0) return
      if (!subRequests.length) return
      // Do not toast until merged timeline reports first paint or all shards EOSE (see subscribeTimeline
      // `allEosed`); `loading` is cleared earlier when the subscribe promise resolves.
      if (!feedPaintLiveRelayDoneRef.current) return
      /**
       * Outcomes are cleared in layout when the subscription key changes; `onRelaySubscribeWaveComplete`
       * runs only after every shard’s relay batch ends (often 10–30s on slow / NIP-42 relays). Without this
       * guard, `uiStatuses.length === 0` and the toast fires ~900ms after the first empty paint — not after
       * relays actually respond. One-shot fetches never populate outcomes; they are excluded here.
       */
      if (!oneShotFetch && feedSubscribeRelayOutcomes.length === 0) return

      const toastKey = `${timelineSubscriptionKey}|${refreshCount}`
      const debounceMs = 900
      const timer = window.setTimeout(() => {
        if (loadingRef.current) return
        if (eventsRef.current.length > 0) return
        if (!subRequestsRef.current.length) return
        if (!feedPaintLiveRelayDoneRef.current) return
        if (!oneShotFetch && feedSubscribeRelayOutcomes.length === 0) return
        if (feedRelayReturnedAnyEventRef.current) return
        if (Date.now() < suppressRelayEmptyFeedToastUntilMs) return
        if (emptyRelayNoHitsToastKeyRef.current === toastKey) return
        emptyRelayNoHitsToastKeyRef.current = toastKey
        const uiStatuses = relayOpTerminalRowsToTimelineRelayUiStatuses(feedSubscribeRelayOutcomes)
        const successCount = uiStatuses.filter((s) => s.success).length
        const title = t(
          'Relays returned no events for this feed. They may be offline, slow, or not indexing these notes.'
        )
        if (uiStatuses.length === 0) {
          toast.error(title, { duration: 8000 })
        } else {
          toast.error(
            <div className="w-full min-w-0">
              <div className="flex items-center gap-2 mb-3">
                <CircleAlert className="w-5 h-5 text-red-500 shrink-0" />
                <div className="font-semibold">{title}</div>
              </div>
              <div className="text-xs text-muted-foreground mb-2">
                {t('Per-relay timeline results ({{count}} connections)', {
                  count: uiStatuses.length
                })}
              </div>
              <RelayStatusDisplay
                relayStatuses={uiStatuses}
                successCount={successCount}
                totalCount={uiStatuses.length}
                aggregateSummary={false}
              />
            </div>,
            { duration: 12_000, className: 'max-w-lg w-full' }
          )
        }
      }, debounceMs)
      return () => window.clearTimeout(timer)
    }, [
      loading,
      events.length,
      subRequests.length,
      timelineSubscriptionKey,
      refreshCount,
      feedEmptyToastGateTick,
      feedSubscribeRelayOutcomes,
      oneShotFetch,
      t
    ])
    
    useEffect(() => {
      hasMoreRef.current = hasMore
    }, [hasMore])
    
    useEffect(() => {
      timelineKeyRef.current = timelineKey
    }, [timelineKey])

    useEffect(() => {
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') {
          blankFeedHiddenAtRef.current = Date.now()
          return
        }
        const hidAt = blankFeedHiddenAtRef.current
        blankFeedHiddenAtRef.current = null
        const hiddenMs = hidAt != null ? Date.now() - hidAt : 0
        if (hiddenMs < 1500) return
        if (loadingRef.current) return
        if (eventsRef.current.length > 0) return
        if (!subRequestsRef.current.length) return
        logger.info('[NoteList] Blank feed — auto-retry after tab resume', { hiddenMs })
        refresh()
      }
      document.addEventListener('visibilitychange', onVisibility)
      return () => document.removeEventListener('visibilitychange', onVisibility)
    }, [refresh])

    useEffect(() => {
      const options: IntersectionObserverInit = {
        root: null,
        // Trigger when user is 400px from the bottom so we start loading before they reach the end
        rootMargin: '0px 0px 400px 0px',
        threshold: 0
      }

      const loadMore = async (): Promise<void> => {
        const currentEvents = displayTimelineSourceRef.current
        const currentShowCount = showCountRef.current
        const currentLoading = loadingRef.current
        const currentHasMore = hasMoreRef.current
        const currentTimelineKey = timelineKeyRef.current
        
        // CRITICAL: Throttle loadMore calls to prevent stuttering during rapid scrolling
        if (loadMoreTimeoutRef.current) {
          return // Already scheduled, skip
        }
        
        // Show more events immediately if we have them cached
        if (currentShowCount < currentEvents.length) {
          const remaining = currentEvents.length - currentShowCount
          const step = revealBatchSize ?? SHOW_COUNT * 2
          const increment = Math.min(step, remaining)
          setShowCount((prev) => prev + increment)
          // Only preload more if we have plenty cached (more than 3/4 of LIMIT)
          // BUT: Always try to load more if we have very few events (might be due to filtering)
          if (currentEvents.length - currentShowCount > LIMIT * 0.75 && currentEvents.length >= 50) {
            return
          }
          // If we have very few events, always try to load more (might be aggressive filtering)
          if (currentEvents.length < 50) {
            // Continue to loadMore below even if we have cached events
            // This ensures we keep loading when filtering is aggressive
          }
        }

        if (feedFullSearchEventsRef.current !== null) return

        const canLoadFromTimeline = !!currentTimelineKey && currentHasMore
        if (currentLoading || (!canLoadFromTimeline && currentShowCount >= currentEvents.length)) return
        
        // Schedule loadMore with a small delay to throttle rapid calls
        loadMoreTimeoutRef.current = setTimeout(async () => {
          loadMoreTimeoutRef.current = null
          const latestEvents = eventsRef.current
          const latestTimelineKey = timelineKeyRef.current
          const latestLoading = loadingRef.current
          const latestHasMore = hasMoreRef.current
          
          if (!latestTimelineKey || latestLoading || !latestHasMore) return
          
          setLoading(true)
          let newEvents: Event[] = []
          try {
            const until = latestEvents.length ? latestEvents[latestEvents.length - 1].created_at - 1 : dayjs().unix()
            newEvents = await client.loadMoreTimeline(
              latestTimelineKey,
              until,
              LIMIT
            )
            
            // CRITICAL FIX: Be extremely conservative about stopping the feed
            // Only stop if we're absolutely certain there are no more events
            if (newEvents.length === 0) {
              // Check if timeline has more cached refs that we haven't loaded yet
              const hasMoreCached = client.hasMoreTimelineEvents?.(latestTimelineKey, until) ?? false
              
              if (hasMoreCached) {
                // There are more cached events, keep hasMore true and try again
                setLoading(false)
                // Retry after a short delay to allow IndexedDB to catch up
                setTimeout(() => {
                  if (hasMoreRef.current && !loadingRef.current) {
                    loadMore()
                  }
                }, 300)
                return
              }
              
              // No cached events and network returned empty
              // Be VERY patient - don't stop too early, especially when we have few events
              // This prevents stopping due to temporary relay issues or slow relays
              consecutiveEmptyRef.current += 1
              
              // CRITICAL FIX: Only stop if we have MANY consecutive empty results AND we have a reasonable number of events
              // This ensures we don't stop prematurely when relays are slow or filtering is aggressive
              // If we have very few events (< 50), keep trying longer in case filtering is aggressive
              const eventCount = latestEvents.length
              const shouldStop = consecutiveEmptyRef.current >= (eventCount < 50 ? 30 : 15)
              
              if (shouldStop) {
                // After many consecutive empty results, assume we've reached the end
                setHasMore(false)
              }
              // Otherwise, keep hasMore true to allow retry on next scroll
              // This ensures the feed continues trying even if relays are slow
              setLoading(false)
              return
            }

            let fetchBatch = newEvents
            const narrowLoadMore =
              useFilterAsIsRef.current &&
              clientSideKindFilterRef.current &&
              withKindFilterRef.current &&
              !seeAllFeedEventsRef.current &&
              (!allowKindlessRelayExploreRef.current || !showAllKindsRef.current)
            let toAppend = narrowLoadMore
              ? fetchBatch.filter((e) => effectiveShowKindsRef.current.includes(e.kind))
              : fetchBatch

            if (
              narrowLoadMore &&
              toAppend.length === 0 &&
              fetchBatch.length > 0
            ) {
              let skipUntil = Math.min(...fetchBatch.map((e) => e.created_at)) - 1
              for (let depth = 0; depth < 8 && toAppend.length === 0; depth++) {
                fetchBatch = await client.loadMoreTimeline(latestTimelineKey, skipUntil, LIMIT)
                if (fetchBatch.length === 0) break
                toAppend = fetchBatch.filter((e) => effectiveShowKindsRef.current.includes(e.kind))
                if (toAppend.length > 0) break
                skipUntil = Math.min(...fetchBatch.map((e) => e.created_at)) - 1
              }
            }

            if (toAppend.length === 0) {
              consecutiveEmptyRef.current += 1
              const eventCount = latestEvents.length
              const shouldStop = consecutiveEmptyRef.current >= (eventCount < 50 ? 30 : 15)
              if (shouldStop) {
                setHasMore(false)
              }
              setLoading(false)
              return
            }

            consecutiveEmptyRef.current = 0

            setEvents((oldEvents) => [...oldEvents, ...toAppend])
            
            // After appending, the bottom sentinel may have moved below the fold. Re-check after
            // paint: if it's still in/near view, trigger loadMore again so user doesn't have to scroll.
            setTimeout(() => {
              const bottomEl = bottomRef.current
              if (bottomEl && hasMoreRef.current && !loadingRef.current) {
                const rect = bottomEl.getBoundingClientRect()
                if (rect.top < window.innerHeight + 200) {
                  loadMore()
                }
              }
            }, 150)
            
            // NEVER automatically set hasMore to false based on result count
            // Only stop when we get consecutive empty results
            // This ensures the feed continues loading even with partial results
            
            // CRITICAL: Prefetch profiles for newly loaded events (optimized to reduce stuttering)
            // Only prefetch if we're not currently loading to avoid blocking scroll
            if (toAppend.length > 0 && !loadingRef.current) {
              // Use requestIdleCallback if available, otherwise setTimeout with longer delay
              const schedulePrefetch = (callback: () => void) => {
                if (typeof requestIdleCallback !== 'undefined') {
                  requestIdleCallback(callback, { timeout: 500 })
                } else {
                  setTimeout(callback, 300)
                }
              }
              
              schedulePrefetch(() => {
                const { hexIds, nip19Pointers } = mergePrefetchTargetsFromEvents(toAppend.slice(0, 30))
                const hexIdsToFetch = hexIds.filter((id) => !prefetchedEventIdsRef.current.has(id))
                const nip19ToFetch = nip19Pointers.filter((p) => !prefetchedEventIdsRef.current.has(p))
                if (hexIdsToFetch.length === 0 && nip19ToFetch.length === 0) return
                hexIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.add(id))
                nip19ToFetch.forEach((p) => prefetchedEventIdsRef.current.add(p))
                const run = async () => {
                  try {
                    await client.prefetchHexEventIds(hexIdsToFetch)
                    await Promise.all(nip19ToFetch.map((p) => client.fetchEvent(p)))
                  } catch {
                    hexIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.delete(id))
                    nip19ToFetch.forEach((p) => prefetchedEventIdsRef.current.delete(p))
                  }
                }
                void run()
              })
            }
          } catch (_error) {
            // On error, don't set hasMore to false - might be temporary network issue
            consecutiveEmptyRef.current += 1
            // Only stop after MANY consecutive errors - be very patient with network issues
            // This prevents stopping when relays are temporarily down or slow
            if (consecutiveEmptyRef.current >= 25) {
              // Increased from 15 to 25 to be even more patient with network issues
              setHasMore(false)
            }
          } finally {
            setLoading(false)
          }
        }, 50) // Reduced delay from 100ms to 50ms for more responsive scrolling
      }

      const observerInstance = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting || loadingRef.current) return
        const ev = eventsRef.current
        const sc = showCountRef.current
        if (sc < ev.length || hasMoreRef.current) {
          loadMore()
        }
      }, options)

      const currentBottomRef = bottomRef.current

      if (currentBottomRef) {
        observerInstance.observe(currentBottomRef)
      }

      return () => {
        if (observerInstance && currentBottomRef) {
          observerInstance.unobserve(currentBottomRef)
        }
        // Clean up timeout on unmount
        if (loadMoreTimeoutRef.current) {
          clearTimeout(loadMoreTimeoutRef.current)
          loadMoreTimeoutRef.current = null
        }
      }
    // Dependencies are handled via refs to avoid stale closures in async callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // CRITICAL: Prefetch embedded events (referenced in e tags, a tags, and content)
    // This ensures embedded events are ready before user scrolls to them
    const prefetchedEventIdsRef = useRef<Set<string>>(new Set())
    const prefetchEmbeddedEventsTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    
    const mergePrefetchTargetsFromEvents = useCallback((evts: Event[]) => {
      const hex = new Set<string>()
      const nip19 = new Set<string>()
      for (const e of evts) {
        const t = collectEmbeddedEventPrefetchTargets(e)
        t.hexIds.forEach((id) => hex.add(id))
        t.nip19Pointers.forEach((p) => nip19.add(p))
      }
      return { hexIds: Array.from(hex), nip19Pointers: Array.from(nip19) }
    }, [])
    
    // CRITICAL: Prefetch embedded events for visible events
    useEffect(() => {
      // Throttle embedded event prefetching to reduce frequency during rapid scrolling
      // Clear any existing timeout
      if (prefetchEmbeddedEventsTimeoutRef.current) {
        clearTimeout(prefetchEmbeddedEventsTimeoutRef.current)
      }
      
      // Debounce embedded event prefetching by 400ms to reduce frequency during rapid scrolling
      prefetchEmbeddedEventsTimeoutRef.current = setTimeout(() => {
        const visibleTargets = mergePrefetchTargetsFromEvents(clientFilteredEvents.slice(0, 40))
        const upcomingTargets = mergePrefetchTargetsFromEvents(events.slice(0, 80))
        const hexIds = Array.from(
          new Set([...visibleTargets.hexIds, ...upcomingTargets.hexIds])
        )
        const nip19Pointers = Array.from(
          new Set([...visibleTargets.nip19Pointers, ...upcomingTargets.nip19Pointers])
        )

        const hexIdsToFetch = hexIds.filter((id) => !prefetchedEventIdsRef.current.has(id))
        const nip19ToFetch = nip19Pointers.filter((p) => !prefetchedEventIdsRef.current.has(p))
        if (hexIdsToFetch.length === 0 && nip19ToFetch.length === 0) return

        hexIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.add(id))
        nip19ToFetch.forEach((p) => prefetchedEventIdsRef.current.add(p))

        const scheduleFetch = (callback: () => void) => {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(callback, { timeout: 500 })
          } else {
            setTimeout(callback, 0)
          }
        }

        scheduleFetch(() => {
          const run = async () => {
            try {
              await client.prefetchHexEventIds(hexIdsToFetch)
              await Promise.all(nip19ToFetch.map((p) => client.fetchEvent(p)))
            } catch {
              hexIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.delete(id))
              nip19ToFetch.forEach((p) => prefetchedEventIdsRef.current.delete(p))
            }
          }
          void run()
        })
      }, 400) // Debounce by 400ms to reduce frequency during rapid scrolling
      
      return () => {
        if (prefetchEmbeddedEventsTimeoutRef.current) {
          clearTimeout(prefetchEmbeddedEventsTimeoutRef.current)
          prefetchEmbeddedEventsTimeoutRef.current = null
        }
      }
    }, [clientFilteredEvents, events, mergePrefetchTargetsFromEvents])
    
    // Also prefetch when loading more events (scrolling down)
    // Throttled to reduce frequency during rapid scrolling
    const prefetchNewEventsTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    useEffect(() => {
      if (loading || !hasMore) return
      
      // Clear any existing timeout
      if (prefetchNewEventsTimeoutRef.current) {
        clearTimeout(prefetchNewEventsTimeoutRef.current)
      }
      
      // Debounce embedded-event prefetch for newly revealed rows (profiles use NoteFeed batcher above)
      prefetchNewEventsTimeoutRef.current = setTimeout(() => {
        const { hexIds, nip19Pointers } = mergePrefetchTargetsFromEvents(
          events.slice(showCount, showCount + 50)
        )
        const hexIdsToFetch = hexIds.filter((id) => !prefetchedEventIdsRef.current.has(id))
        const nip19ToFetch = nip19Pointers.filter((p) => !prefetchedEventIdsRef.current.has(p))
        if (hexIdsToFetch.length === 0 && nip19ToFetch.length === 0) return

        hexIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.add(id))
        nip19ToFetch.forEach((p) => prefetchedEventIdsRef.current.add(p))

        const scheduleFetch = (callback: () => void) => {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(callback, { timeout: 500 })
          } else {
            setTimeout(callback, 0)
          }
        }

        scheduleFetch(() => {
          const run = async () => {
            try {
              await client.prefetchHexEventIds(hexIdsToFetch)
              await Promise.all(nip19ToFetch.map((p) => client.fetchEvent(p)))
            } catch {
              hexIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.delete(id))
              nip19ToFetch.forEach((p) => prefetchedEventIdsRef.current.delete(p))
            }
          }
          void run()
        })
      }, 400) // Debounce by 400ms to reduce frequency during rapid scrolling
      
      return () => {
        if (prefetchNewEventsTimeoutRef.current) {
          clearTimeout(prefetchNewEventsTimeoutRef.current)
          prefetchNewEventsTimeoutRef.current = null
        }
      }
    }, [events.length, showCount, loading, hasMore, mergePrefetchTargetsFromEvents])

    const showNewEvents = () => {
      setEvents((oldEvents) => [...newEvents, ...oldEvents])
      setNewEvents([])
      setTimeout(() => {
        scrollToTop('smooth')
      }, 0)
    }

    const useFeedFilterTabRowPortal =
      showFeedClientFilter && typeof feedClientFilterTabRowHost !== 'undefined'

    const feedClientFilterPanelSurfaceClass =
      useFeedFilterTabRowPortal && feedClientFilterTabRowHost
        ? 'mt-1 w-[min(100vw-1rem,28rem)] max-w-[calc(100vw-1rem)] space-y-3 rounded-lg border border-border bg-background p-3 shadow-lg'
        : 'space-y-3 border-t border-border/60 px-2 py-3'
    const feedClientFilterSectionClass = 'space-y-2 rounded-md border border-border/60 bg-muted/25 p-2.5'

    const feedClientFilterChrome = (
      <>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-lg leading-none"
            aria-expanded={feedClientFilterOpen}
            aria-controls="feed-client-filter-panel"
            aria-label={t('Feed filter')}
            title={t('Feed filter')}
            onClick={onToggleFeedClientFilterPanel}
          >
            <span aria-hidden>🔍</span>
          </Button>
        </div>
        {feedClientFilterOpen ? (
          <div id="feed-client-filter-panel" className={feedClientFilterPanelSurfaceClass}>
            <div className={feedClientFilterSectionClass}>
              <Label htmlFor="feed-client-search" className="text-sm font-medium">
                {t('Search loaded posts')}
              </Label>
              <Input
                id="feed-client-search"
                value={feedClientSearch}
                onChange={(e) => setFeedClientSearch(e.target.value)}
                placeholder={t('Filter loaded posts placeholder')}
                autoComplete="off"
                className="w-full"
              />
            </div>
            <div className={feedClientFilterSectionClass}>
              <Label htmlFor="feed-client-kind" className="text-sm font-medium">
                {t('Feed filter kind', { defaultValue: 'Event kind' })}
              </Label>
              <Input
                id="feed-client-kind"
                inputMode="numeric"
                min={FEED_FILTER_KIND_MIN}
                max={FEED_FILTER_KIND_MAX}
                value={feedClientKindInput}
                onChange={(e) => {
                  const v = e.target.value.trim()
                  if (v === '' || /^\d+$/.test(v)) setFeedClientKindInput(v)
                }}
                placeholder={t('Feed filter kind placeholder', { defaultValue: 'e.g. 30023' })}
                className="w-full sm:max-w-[11rem]"
                aria-invalid={feedClientKindFilter === undefined ? true : undefined}
              />
              <p className="text-xs text-muted-foreground">
                {t('Feed filter kind hint', {
                  defaultValue: `Integer ${FEED_FILTER_KIND_MIN}-${FEED_FILTER_KIND_MAX}.`
                })}
              </p>
            </div>
            <div className={feedClientFilterSectionClass}>
              <Label className="text-sm font-medium">{t('Feed filter author')}</Label>
              <RadioGroup
                value={feedClientAuthorMode}
                onValueChange={(v) => setFeedClientAuthorMode(v as TFeedClientAuthorMode)}
                className="grid gap-2"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="everyone" id="feed-client-author-everyone" />
                  <span>{t('Feed filter author everyone')}</span>
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-2 text-sm ${!pubkey ? 'cursor-not-allowed opacity-60' : ''}`}
                  title={!pubkey ? t('Feed filter author me needs login') : undefined}
                >
                  <RadioGroupItem value="me" id="feed-client-author-me" disabled={!pubkey} />
                  <span>{t('Feed filter author me')}</span>
                </label>
                <div className="space-y-1.5">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem value="npub" id="feed-client-author-npub" />
                    <span>{t('Feed filter author npub')}</span>
                  </label>
                  {feedClientAuthorMode === 'npub' ? (
                    <div className="grid gap-1.5 pl-6">
                      <span className="text-sm text-muted-foreground">
                        {t('Feed filter author npub from prefix')}
                      </span>
                      <Input
                        id="feed-client-author-npub-input"
                        value={feedClientAuthorNpubInput}
                        onChange={(e) => setFeedClientAuthorNpubInput(e.target.value)}
                        placeholder={t('Feed filter author npub placeholder')}
                        autoComplete="off"
                        className="w-full"
                        aria-invalid={
                          feedClientAuthorNpubInput.trim() !== '' &&
                          !inviteInputToHexPubkey(feedClientAuthorNpubInput)
                            ? true
                            : undefined
                        }
                      />
                    </div>
                  ) : null}
                </div>
              </RadioGroup>
            </div>
            <div className={feedClientFilterSectionClass}>
              <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-end gap-2">
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="feed-client-time-n" className="text-sm font-medium">
                  {t('Within the last')}
                </Label>
                <Input
                  id="feed-client-time-n"
                  inputMode="numeric"
                  min={1}
                  value={feedClientTimeAmount}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^\d+$/.test(v)) setFeedClientTimeAmount(v)
                  }}
                  placeholder="1"
                  className="w-full"
                />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="feed-client-time-unit" className="text-sm font-medium">
                  {t('Time unit')}
                </Label>
                <Select
                  value={feedClientTimeUnit}
                  onValueChange={(v) => setFeedClientTimeUnit(v as TFeedClientTimeUnit)}
                >
                  <SelectTrigger id="feed-client-time-unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minute">{t('Minutes')}</SelectItem>
                    <SelectItem value="day">{t('Days')}</SelectItem>
                    <SelectItem value="week">{t('Weeks')}</SelectItem>
                    <SelectItem value="month">{t('Months')}</SelectItem>
                    <SelectItem value="year">{t('Years')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              </div>
            </div>
            <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
              {t('Feed filter client-side hint')}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8"
                disabled={feedFullSearchLoading}
                onClick={() => void onPerformFeedFullSearch()}
              >
                {feedFullSearchLoading ? t('Feed full search running') : t('Feed full search')}
              </Button>
              {feedFullSearchEvents !== null ? (
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={onClearFeedFullSearch}>
                  {t('Feed full search clear')}
                </Button>
              ) : null}
            </div>
            {feedFullSearchEvents !== null ? (
              <p className="text-xs text-muted-foreground">{t('Feed full search active hint')}</p>
            ) : null}
          </div>
        ) : null}
      </>
    )

    const feedClientFilterBarEmbedded = (
      <div className="sticky top-0 z-20 border-b border-border/80 bg-background/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {feedClientFilterChrome}
      </div>
    )

    const feedClientFilterBar =
      useFeedFilterTabRowPortal && feedClientFilterTabRowHost
        ? createPortal(
            <div className="flex flex-col items-end gap-0">{feedClientFilterChrome}</div>,
            feedClientFilterTabRowHost
          )
        : useFeedFilterTabRowPortal && !feedClientFilterTabRowHost
          ? null
          : feedClientFilterBarEmbedded

    const listSourceEvents = timelineEventsForFilter
    const feedFullSearchActive = feedFullSearchEvents !== null
    const progressiveWarmupTrimmed = progressiveWarmupQuery?.trim()
    const showRelaySubscribeWavePendingBanner =
      !oneShotFetch &&
      !feedFullSearchActive &&
      subRequests.length > 0 &&
      relayCapabilityReady &&
      timelineKey != null &&
      feedSubscribeRelayOutcomes.length === 0 &&
      feedTimelineEmptyUiReady
    const showProgressiveLayersPendingBanner =
      Boolean(progressiveWarmupTrimmed) && progressiveLayersSearching && !feedFullSearchActive
    const showLookingForMoreEventsBanner =
      showRelaySubscribeWavePendingBanner || showProgressiveLayersPendingBanner
    const relayWavePendingBannerEl = showLookingForMoreEventsBanner ? (
      <div
        className="mb-2 rounded border border-border/40 bg-muted/15 px-3 py-1.5 text-center text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {t('Looking for more events…')}
      </div>
    ) : null
    const eventReasonLabelMap = useMemo(() => {
      const reqs = subRequestsRef.current.filter((req) => req.reasonLabel && req.reasonLabel.trim().length > 0)
      if (!reqs.length || !clientFilteredEvents.length) return new Map<string, string>()
      const map = new Map<string, string>()
      for (const event of clientFilteredEvents) {
        const labels: string[] = []
        for (const req of reqs) {
          if (!eventMatchesSubRequestFilter(event, req.filter as Filter)) continue
          if (req.reasonLabelIfSeenOnRelay) {
            const target = normalizeUrl(req.reasonLabelIfSeenOnRelay) || req.reasonLabelIfSeenOnRelay
            const seenNorm = client
              .getSeenEventRelayUrls(event.id)
              .map((u) => normalizeUrl(u) || u)
            if (!seenNorm.includes(target)) continue
          }
          labels.push(req.reasonLabel as string)
        }
        if (labels.length) {
          map.set(event.id, Array.from(new Set(labels)).join(' · '))
        }
      }
      return map
    }, [clientFilteredEvents, subRequestsKey])

    const list = (
      <div className="min-h-screen">
        {relayWavePendingBannerEl}
        {feedClientFilterActive && filteredEvents.length > 0 && clientFilteredEvents.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            {t('No loaded posts match your filters.')}
          </div>
        ) : null}
        {feedFullSearchActive && listSourceEvents.length === 0 && !feedFullSearchLoading ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            {t('Feed full search empty')}
          </div>
        ) : null}
        {clientFilteredEvents.map((event) => (
          <NoteCard
            key={event.id}
            className="w-full"
            event={event}
            filterMutedNotes={filterMutedNotes}
            bottomNoteLabel={eventReasonLabelMap.get(event.id)}
          />
        ))}
        {listSourceEvents.length === 0 &&
        !feedFullSearchActive &&
        (loading || (subRequests.length > 0 && !feedTimelineEmptyUiReady)) ? (
          <div
            ref={bottomRef}
            className="min-h-[40vh] space-y-2 px-1 py-4"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <NoteCardLoadingSkeleton key={i} />
            ))}
          </div>
        ) : listSourceEvents.length > 0 &&
          (feedFullSearchActive ? showCount < listSourceEvents.length : hasMore) ? (
          <div
            ref={bottomRef}
            className={
              filteredEvents.length === 0 && !loading
                ? 'min-h-[35vh] py-4'
                : loading
                  ? 'min-h-8'
                  : 'min-h-4'
            }
          >
            {loading ? <NoteCardLoadingSkeleton /> : null}
          </div>
        ) : listSourceEvents.length > 0 ? (
          <div className="text-center text-sm text-muted-foreground mt-2">{t('no more notes')}</div>
        ) : listSourceEvents.length === 0 &&
          !feedFullSearchActive &&
          !loading &&
          feedTimelineEmptyUiReady &&
          subRequests.length > 0 ? (
          <div
            ref={bottomRef}
            className="mt-6 flex min-h-[35vh] flex-col items-center justify-start gap-4 px-4 text-center text-sm text-muted-foreground"
            role="status"
          >
            <p>{t('No posts loaded for this feed. Try refreshing.')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              title={t('refresh.longPressHardReload')}
              onPointerDown={emptyFeedHardReloadLongPress.onPointerDown}
              onPointerUp={emptyFeedHardReloadLongPress.onPointerUp}
              onPointerLeave={emptyFeedHardReloadLongPress.onPointerLeave}
              onPointerCancel={emptyFeedHardReloadLongPress.onPointerCancel}
              onClick={() => {
                if (emptyFeedHardReloadLongPress.consumeIfLongPress()) return
                refresh()
              }}
            >
              {t('Refresh')}
            </Button>
          </div>
        ) : (
          <div ref={bottomRef} className="mt-2 min-h-4" aria-hidden />
        )}
      </div>
    )

    return (
      <div>
        <div ref={topRef} className="scroll-mt-[calc(6rem+1px)]" />
        <NoteFeedProfileContext.Provider value={noteFeedProfileContextValue}>
          {supportTouch ? (
            <PullToRefresh
              onRefresh={async () => {
                refresh()
                await new Promise((resolve) => setTimeout(resolve, 1000))
              }}
              pullingContent=""
            >
              <div>
                {feedTopNotice ? (
                  <div
                    className="mb-2 rounded-md border border-border/80 bg-muted/35 px-3 py-2 text-sm text-muted-foreground"
                    role="note"
                  >
                    {feedTopNotice}
                  </div>
                ) : null}
                {showFeedClientFilter ? feedClientFilterBar : null}
                {list}
              </div>
            </PullToRefresh>
          ) : (
            <div>
              {feedTopNotice ? (
                <div
                  className="mb-2 rounded-md border border-border/80 bg-muted/35 px-3 py-2 text-sm text-muted-foreground"
                  role="note"
                >
                  {feedTopNotice}
                </div>
              ) : null}
              {showFeedClientFilter ? feedClientFilterBar : null}
              {list}
            </div>
          )}
        </NoteFeedProfileContext.Provider>
        <div className="h-40" />
        {clientFilteredNewEvents.length > 0 && (
          <NewNotesButton newEvents={clientFilteredNewEvents} onClick={showNewEvents} />
        )}
      </div>
    )
  }
)
NoteList.displayName = 'NoteList'
export default NoteList

export type TNoteListRef = {
  scrollToTop: (behavior?: ScrollBehavior) => void
  refresh: () => void
}
