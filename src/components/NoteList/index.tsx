import NewNotesButton from '@/components/NewNotesButton'
import { ExtendedKind, FIRST_RELAY_RESULT_GRACE_MS } from '@/constants'
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
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { isTouchDevice } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import { useZap } from '@/providers/ZapProvider'
import client from '@/services/client.service'
import {
  getSessionFeedSnapshot,
  setSessionFeedSnapshot
} from '@/services/session-feed-snapshot.service'
import type { TFeedSubRequest, TSubRequestFilter } from '@/types'
import dayjs from 'dayjs'
import { type Event, type Filter, kinds } from 'nostr-tools'
import { decode } from 'nostr-tools/nip19'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from 'react-simple-pull-to-refresh'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { NoteFeedProfileContext, type NoteFeedProfileContextValue } from '@/providers/NoteFeedProfileContext'
import type { TProfile } from '@/types'
import NoteCard, { NoteCardLoadingSkeleton } from '../NoteCard'

const LIMIT = 100 // Increased from 200 to load more events per request
const ALGO_LIMIT = 200 // Increased from 500 for algorithm feeds
const SHOW_COUNT = 20 // Increased from 10 to show more events at once, reducing scroll load frequency
/** Hard cap after merging parallel one-shot fetches (e.g. interests = one REQ per topic). */
const ONE_SHOT_MERGED_CAP =100
const FEED_PROFILE_BATCH_DEBOUNCE_MS = 120
const FEED_PROFILE_CHUNK = 36

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

/** When omitting `kinds` from a live REQ, require another scope so we never subscribe to a whole relay. */
function timelineFilterHasNonKindScope(f: Filter): boolean {
  return (
    (Array.isArray(f.authors) && f.authors.length > 0) ||
    (Array.isArray(f.ids) && f.ids.length > 0) ||
    (Array.isArray(f['#p']) && f['#p']!.length > 0) ||
    (Array.isArray(f['#e']) && f['#e']!.length > 0)
  )
}

const NoteList = forwardRef(
  (
    {
      subRequests,
      showKinds,
      showKind1OPs = true,
      showKind1Replies = true,
      showKind1111 = true,
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
      /**
       * Spells / one-shot feeds: when the initial fetch finishes with zero rows, show explicit empty copy
       * (see list footer). Does not end loading early — loading stays until EOSE, first events, or safety timeouts.
       */
      spellFetchTimeoutMs,
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
       * With {@link useFilterAsIs}: omit relay `kinds` when the subrequest filter has none, and narrow
       * incoming events to {@link showKinds} before merging (so caps are not filled by unrelated kinds).
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
      oneShotDebugLabel
    }: {
      subRequests: TFeedSubRequest[]
      showKinds: number[]
      showKind1OPs?: boolean
      showKind1Replies?: boolean
      showKind1111?: boolean
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
      /** When set (e.g. spells), use explicit empty-feed copy after load completes with no rows. */
      spellFetchTimeoutMs?: number
      spellFeedInstrumentToken?: number
      onSpellFeedFirstPaint?: (detail: { eventCount: number; firstEventId: string }) => void
      timelineLoadingSafetyTimeoutMs?: number
      clientSideKindFilter?: boolean
      oneShotFetch?: boolean
      oneShotMergedCap?: number
      revealBatchSize?: number
      oneShotDebugLabel?: string
      oneShotGlobalTimeoutMs?: number
      oneShotEoseTimeoutMs?: number
      oneShotFirstRelayGraceMs?: number | false
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
    const [events, setEvents] = useState<Event[]>([])
    const eventsRef = useRef<Event[]>([])
    const [newEvents, setNewEvents] = useState<Event[]>([])
    const [hasMore, setHasMore] = useState<boolean>(true)
    const [loading, setLoading] = useState(true)
    const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
    const [refreshCount, setRefreshCount] = useState(0)
    const [showCount, setShowCount] = useState(SHOW_COUNT)
    const supportTouch = useMemo(() => isTouchDevice(), [])
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
    /** Session snapshot was written to state; log once after commit (see feed-paint layout effect). */
    const feedPaintSessionPendingRef = useRef(false)
    /** Relay / one-shot data was written to state; log once after commit. */
    const feedPaintRelayPendingRef = useRef(false)
    const feedPaintRelayMetaRef = useRef<Record<string, unknown> | null>(null)
    /** First live `onEvents` paint per timeline init (rows or terminal EOSE). */
    const feedPaintLiveRelayDoneRef = useRef(false)

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

    const timelineSubscriptionKey = feedSubscriptionKey ?? subRequestsKey
    const prevSubRequestsKeyForTimelineRef = useRef<string | null>(null)
    /** Detect pull-to-refresh so preserve-mode feeds still clear; unrelated dep changes must not clear. */
    const timelineEffectLastRefreshCountRef = useRef(refreshCount)

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
      for (const e of events) {
        addPk(e.pubkey)
      }
      for (const e of newEvents) {
        addPk(e.pubkey)
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
    }, [events, newEvents])

    const subRequestsRef = useRef(subRequests)
    subRequestsRef.current = subRequests

    // Stable key for kind filter so subscription effect doesn't re-run on parent re-renders with same kinds
    // Use sorted array and JSON.stringify to create a stable key that only changes when content changes
    const showKindsKey = useMemo(() => {
      if (!showKinds || showKinds.length === 0) return ''
      return JSON.stringify([...showKinds].sort((a, b) => a - b))
    }, [showKinds])

    /**
     * Session snapshot identity: feed + kind UI toggles that affect **REQ** / merged rows.
     * Do **not** include {@link hideReplies}: Notes vs Replies only changes client-side filtering; the same
     * raw timeline should restore for both tabs (otherwise Replies can show cache while Notes looks empty).
     */
    const sessionSnapshotIdentityKey = useMemo(
      () =>
        JSON.stringify({
          feed: timelineSubscriptionKey,
          kinds: showKindsKey,
          op: showKind1OPs,
          rep: showKind1Replies,
          c1111: showKind1111
        }),
      [timelineSubscriptionKey, showKindsKey, showKind1OPs, showKind1Replies, showKind1111]
    )

    const showKindsRef = useRef(showKinds)
    showKindsRef.current = showKinds
    const useFilterAsIsRef = useRef(useFilterAsIs)
    useFilterAsIsRef.current = useFilterAsIs
    const clientSideKindFilterRef = useRef(clientSideKindFilter)
    clientSideKindFilterRef.current = clientSideKindFilter

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
        if (filterMutedNotes && mutePubkeySet.has(evt.pubkey)) return true
        if (
          filterMutedNotes &&
          hideContentMentioningMutedUsers &&
          isMentioningMutedUsers(evt, mutePubkeySet)
        ) {
          return true
        }

        // Filter out expired events
        if (shouldFilterEvent(evt)) return true

        // Filter out zap receipts below the zap threshold (superzaps)
        if (evt.kind === ExtendedKind.ZAP_RECEIPT) {
          const zapInfo = getZapInfoFromEvent(evt)
          // Hide zap receipts if amount is missing, 0, or below the threshold
          if (!zapInfo || zapInfo.amount === undefined || zapInfo.amount === 0 || zapInfo.amount < zapReplyThreshold) {
            return true
          }
        }

        if (extraShouldHideEvent?.(evt)) return true

        return false
      },
      [
        hideReplies,
        hideUntrustedNotes,
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

      return events.slice(0, showCount).filter((evt) => {
        if (!showKinds.includes(evt.kind)) return false
        // Kind 1: show only OPs if showKind1OPs, only replies if showKind1Replies
        if (evt.kind === kinds.ShortTextNote) {
          const isReply = isReplyNoteEvent(evt)
          if (isReply && !showKind1Replies) return false
          if (!isReply && !showKind1OPs) return false
        }
        // Kind 1111 (comments): show only if showKind1111
        if (evt.kind === ExtendedKind.COMMENT && !showKind1111) return false
        if (shouldHideEvent(evt)) return false

        const id = isReplaceableEvent(evt.kind) ? getReplaceableCoordinateFromEvent(evt) : evt.id
        if (idSet.has(id)) {
          return false
        }
        idSet.add(id)
        return true
      })
    }, [events, showCount, shouldHideEvent, showKinds, showKind1OPs, showKind1Replies, showKind1111])

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
      const idSet = new Set<string>()

      return newEvents.filter((event: Event) => {
        if (!showKinds.includes(event.kind)) return false
        if (event.kind === kinds.ShortTextNote) {
          const isReply = isReplyNoteEvent(event)
          if (isReply && !showKind1Replies) return false
          if (!isReply && !showKind1OPs) return false
        }
        if (event.kind === ExtendedKind.COMMENT && !showKind1111) return false
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
    }, [newEvents, shouldHideEvent, showKinds, showKind1OPs, showKind1Replies, showKind1111])

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
            candidates.add(p)
          }
        }
        for (const e of events) {
          addPk(e.pubkey)
        }
        for (const e of newEvents) {
          addPk(e.pubkey)
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
          for (let i = 0; i < need.length; i += FEED_PROFILE_CHUNK) {
            if (gen !== feedProfileBatchGenRef.current) return
            const chunk = need.slice(i, i + FEED_PROFILE_CHUNK)
            try {
              const profiles = await client.fetchProfilesForPubkeys(chunk)
              if (gen !== feedProfileBatchGenRef.current) return
              setFeedProfileBatch((prev) => {
                const next = new Map(prev.profiles)
                const pend = new Set(prev.pending)
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
                return { profiles: next, pending: pend, version: prev.version + 1 }
              })
            } catch {
              chunk.forEach((pk) => feedProfileLoadedRef.current.delete(pk))
              if (gen !== feedProfileBatchGenRef.current) return
              setFeedProfileBatch((prev) => {
                const pend = new Set(prev.pending)
                chunk.forEach((pk) => pend.delete(pk))
                return { ...prev, pending: pend, version: prev.version + 1 }
              })
            }
          }
        })()
      }, FEED_PROFILE_BATCH_DEBOUNCE_MS)
      return () => window.clearTimeout(handle)
    }, [events, newEvents])

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

    useImperativeHandle(ref, () => ({ scrollToTop, refresh }), [scrollToTop, refresh])

    useEffect(() => {
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
      const keepExistingTimelineEvents =
        preserveTimelineOnSubRequestsChange &&
        !userPulledRefresh &&
        (prevSubKey === subRequestsKey ||
          isRelayUrlStrictSupersetIdentityKey(prevSubKey, subRequestsKey) ||
          (mergeTimelineWhenSubRequestFiltersMatch &&
            isSpellSubRequestsSameFiltersDifferentRelays(prevSubKey, subRequestsKey)))
      prevSubRequestsKeyForTimelineRef.current = subRequestsKey

      /** False after cleanup so stale timeline callbacks cannot overwrite state after switching feeds (e.g. Spells discussions → notifications). */
      let effectActive = true

      async function init() {
        feedPaintSessionPendingRef.current = false
        feedPaintRelayPendingRef.current = false
        feedPaintRelayMetaRef.current = null
        feedPaintLiveRelayDoneRef.current = false

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

        const defaultKinds = showKinds.length > 0 ? showKinds : [kinds.ShortTextNote]

        const mappedSubRequests = subRequestsRef.current.map(({ urls, filter }) => {
          const baseLimit = filter.limit ?? (areAlgoRelays ? ALGO_LIMIT : LIMIT)
          if (useFilterAsIs) {
            const finalFilter: Filter = { ...filter, limit: baseLimit }
            const hasKindsInRequest = Array.isArray(filter.kinds) && filter.kinds.length > 0
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
          return {
            urls,
            filter: {
              ...filter,
              kinds: defaultKinds,
              limit: areAlgoRelays ? ALGO_LIMIT : LIMIT
            }
          }
        })

        const filterMissingKinds = (f: Filter) => !f.kinds || f.kinds.length === 0
        const invalidFilters = mappedSubRequests.filter(({ filter: f }) => {
          if (!filterMissingKinds(f)) return false
          if (useFilterAsIs && clientSideKindFilter && timelineFilterHasNonKindScope(f)) return false
          return true
        })
        if (invalidFilters.length > 0) {
          if (oneShotDebugLabel) {
            logger.warn(`[${oneShotDebugLabel}] abort: filter missing kinds`, {
              subRequestsKey: timelineSubscriptionKey
            })
          }
          setLoading(false)
          setEvents([])
          return undefined
        }

        const narrowLiveBatch = (evs: Event[]) => {
          if (!useFilterAsIs || !clientSideKindFilter) return evs
          return evs.filter((e) => showKinds.includes(e.kind))
        }

        if (oneShotFetch) {
          setHasMore(false)
          try {
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
            if (!effectActive) return undefined
            const byId = new Map<string, Event>()
            for (const ev of batches.flat()) {
              const prev = byId.get(ev.id)
              if (!prev || ev.created_at > prev.created_at) {
                byId.set(ev.id, ev)
              }
            }
            const cap = oneShotMergedCap ?? ONE_SHOT_MERGED_CAP
            let merged = [...byId.values()]
              .sort((a, b) => b.created_at - a.created_at)
              .slice(0, cap)
            if (useFilterAsIs && clientSideKindFilter) {
              merged = merged.filter((e) => showKinds.includes(e.kind))
            }
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
            feedPaintRelayPendingRef.current = true
            feedPaintRelayMetaRef.current = {
              variant: 'one_shot_fetch',
              mergedCount: merged.length,
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
              setEvents([])
            }
          } finally {
            if (effectActive) {
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
          // Opening many relay subs can exceed 2s on spell feeds; a short race
          // rejects, the catch closes the late subscription, and the list stays empty after refresh.
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`subscribeTimeline timeout after ${subscribeSetupRaceMs}ms`))
            }, subscribeSetupRaceMs)
          })

          const eventCap = areAlgoRelays ? ALGO_LIMIT : LIMIT

          timelineSubscribePromise = client.subscribeTimeline(
            mappedSubRequests as Array<{ urls: string[]; filter: TSubRequestFilter }>,
            {
              onEvents: (batch: Event[], eosed: boolean) => {
                if (!effectActive) return
                const narrowed = narrowLiveBatch(batch)
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
                if (batch.length > 0) {
                  if (narrowed.length > 0) {
                    if (preserveTimelineOnSubRequestsChange) {
                      setEvents((prev) => {
                        const next = mergeEventBatchesById(prev, narrowed, eventCap)
                        lastEventsForTimelinePrefetchRef.current = next
                        return next
                      })
                    } else {
                      setEvents((prev) => {
                        const next = mergeEventBatchesById(prev, narrowed, eventCap)
                        lastEventsForTimelinePrefetchRef.current = next
                        return next
                      })
                    }
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
              },
            onNew: (event: Event) => {
              if (!effectActive) return
              if (!useFilterAsIs && !showKinds.includes(event.kind)) return
              if (clientSideKindFilter && useFilterAsIs && !showKinds.includes(event.kind)) return
              if (event.kind === kinds.ShortTextNote) {
                const isReply = isReplyNoteEvent(event)
                if (isReply && !showKind1Replies) return
                if (!isReply && !showKind1OPs) return
              }
              if (event.kind === ExtendedKind.COMMENT && !showKind1111) return
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
            firstRelayResultGraceMs: FIRST_RELAY_RESULT_GRACE_MS
          }
          )

          const result = await Promise.race([timelineSubscribePromise, timeoutPromise])
          if (!effectActive) {
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
      refreshCount,
      showKindsKey,
      showKind1OPs,
      showKind1Replies,
      showKind1111,
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
      clientSideKindFilter
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

    useEffect(() => {
      showCountRef.current = showCount
    }, [showCount])
    
    useEffect(() => {
      loadingRef.current = loading
    }, [loading])
    
    useEffect(() => {
      hasMoreRef.current = hasMore
    }, [hasMore])
    
    useEffect(() => {
      timelineKeyRef.current = timelineKey
    }, [timelineKey])

    useEffect(() => {
      const options: IntersectionObserverInit = {
        root: null,
        // Trigger when user is 400px from the bottom so we start loading before they reach the end
        rootMargin: '0px 0px 400px 0px',
        threshold: 0
      }

      const loadMore = async (): Promise<void> => {
        const currentEvents = eventsRef.current
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
            let toAppend =
              useFilterAsIsRef.current && clientSideKindFilterRef.current
                ? fetchBatch.filter((e) => showKindsRef.current.includes(e.kind))
                : fetchBatch

            if (
              useFilterAsIsRef.current &&
              clientSideKindFilterRef.current &&
              toAppend.length === 0 &&
              fetchBatch.length > 0
            ) {
              let skipUntil = Math.min(...fetchBatch.map((e) => e.created_at)) - 1
              for (let depth = 0; depth < 8 && toAppend.length === 0; depth++) {
                fetchBatch = await client.loadMoreTimeline(latestTimelineKey, skipUntil, LIMIT)
                if (fetchBatch.length === 0) break
                toAppend = fetchBatch.filter((e) => showKindsRef.current.includes(e.kind))
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
        const visibleTargets = mergePrefetchTargetsFromEvents(filteredEvents.slice(0, 40))
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
    }, [filteredEvents, events, mergePrefetchTargetsFromEvents])
    
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

    const list = (
      <div className="min-h-screen">
        {filteredEvents.map((event) => (
          <NoteCard
            key={event.id}
            className="w-full"
            event={event}
            filterMutedNotes={filterMutedNotes}
          />
        ))}
        {events.length === 0 && loading ? (
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
        ) : events.length > 0 && hasMore ? (
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
        ) : events.length > 0 ? (
          <div className="text-center text-sm text-muted-foreground mt-2">{t('no more notes')}</div>
        ) : (spellFetchTimeoutMs != null && spellFetchTimeoutMs > 0) || oneShotFetch ? (
          <div ref={bottomRef} className="mt-6 px-4 text-center text-sm text-muted-foreground">
            {t('No posts loaded for this feed. Try refreshing.')}
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
              {list}
            </PullToRefresh>
          ) : (
            list
          )}
        </NoteFeedProfileContext.Provider>
        <div className="h-40" />
        {filteredNewEvents.length > 0 && (
          <NewNotesButton newEvents={filteredNewEvents} onClick={showNewEvents} />
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
