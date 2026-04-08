import NoteList, { TNoteListRef } from '@/components/NoteList'
import { RefreshButton } from '@/components/RefreshButton'
import Tabs, { TabDefinition } from '@/components/Tabs'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import storage from '@/services/local-storage.service'
import type { TPrimaryPageName } from '@/PageManager'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { cn } from '@/lib/utils'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import KindFilter from '../KindFilter'

const NormalFeed = forwardRef<TNoteListRef, {
  subRequests: TFeedSubRequest[]
  areAlgoRelays?: boolean
  /** When false, NoteList waits before opening timeline REQs (relay algo probe). */
  relayCapabilityReady?: boolean
  isMainFeed?: boolean
  /** When set (e.g. on Home), tabs are rendered in layout subHeader instead of in-feed; avoids overlap */
  setSubHeader?: (node: React.ReactNode) => void
  /** Shown in the subHeader row to the left of the kind filter (mobile primary feed). */
  onSubHeaderRefresh?: () => void
  /**
   * When true with {@link mergeTimelineWhenSubRequestFiltersMatch}, relay URL list can change (e.g. favorites
   * hydrate after load) without clearing rows — same REQ shape, merge new stream into existing events.
   */
  preserveTimelineOnSubRequestsChange?: boolean
  mergeTimelineWhenSubRequestFiltersMatch?: boolean
  /** Home following: second subscribe wave (delta relays / new authors); see {@link NoteList}. */
  followingFeedDeltaSubRequests?: TFeedSubRequest[]
  /** Stable subscription identity; see {@link NoteList} `feedSubscriptionKey`. */
  feedSubscriptionKey?: string
  /** Home favorite-relays chip scope; see {@link NoteList} `feedTimelineScopeKey`. */
  feedTimelineScopeKey?: string
  /** Single-relay Explore / chip: kindless REQ (see `SINGLE_RELAY_KINDLESS_REQ_LIMIT` in constants). */
  useFilterAsIs?: boolean
  clientSideKindFilter?: boolean
  allowKindlessRelayExplore?: boolean
  /**
   * Default true (home following, favorites, sets, single-relay chip): kind picker narrows visible rows.
   * Ignored when {@link showAllKinds} is effectively true.
   */
  withKindFilter?: boolean
  /**
   * When true (relay explorer page), list shows the full relay batch. When omitted, uses KindFilter "All Events"
   * ({@link useKindFilter} / persisted bypass) on home feeds.
   */
  showAllKinds?: boolean
  /**
   * Client-side 🔍 feed filter. When omitted: hidden on main following, shown on relay explore and non-main feeds.
   */
  showFeedClientFilter?: boolean
  /** When set, {@link NoteList} clears 🔍 filters when another primary tab is shown (mounted-but-hidden pages). */
  hostPrimaryPageName?: TPrimaryPageName
  /** Single-relay kindless wave EOSEd with no events: parent re-subscribes with explicit kinds. */
  onSingleRelayKindlessEmpty?: () => void
  /** Shown above the feed list (e.g. after kindless→kinds fallback on a single-relay chip). */
  feedTopNotice?: ReactNode
  /** Passed through to {@link NoteList} (d-tag browse one-shot). */
  oneShotFetch?: boolean
  progressiveWarmupQuery?: string
  progressiveWarmupMatch?: (ev: Event) => boolean
  /** Union into kind picker kinds for REQ + UI when set (e.g. document kinds on search / d-tag feeds). */
  progressiveDocumentKinds?: readonly number[]
  oneShotAfterMergeComparator?: (a: Event, b: Event) => number
  extraShouldHideEvent?: (ev: Event) => boolean
  /** Override default cap for merged one-shot batches (wide d-tag / search merges). */
  oneShotMergedCap?: number
}>(function NormalFeed(
  {
    subRequests,
    areAlgoRelays = false,
    relayCapabilityReady = true,
    isMainFeed = false,
    setSubHeader,
    onSubHeaderRefresh,
    preserveTimelineOnSubRequestsChange = false,
    mergeTimelineWhenSubRequestFiltersMatch = false,
    followingFeedDeltaSubRequests,
    feedSubscriptionKey,
    feedTimelineScopeKey,
    useFilterAsIs = false,
    clientSideKindFilter = false,
    allowKindlessRelayExplore = false,
    withKindFilter = true,
    showAllKinds: showAllKindsProp,
    showFeedClientFilter: showFeedClientFilterProp,
    hostPrimaryPageName,
    onSingleRelayKindlessEmpty,
    feedTopNotice,
    oneShotFetch = false,
    progressiveWarmupQuery,
    progressiveWarmupMatch,
    progressiveDocumentKinds,
    oneShotAfterMergeComparator,
    extraShouldHideEvent,
    oneShotMergedCap
  },
  ref
) {
  const { hideUntrustedNotes } = useUserTrust()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111, feedKindFilterBypass } =
    useKindFilter()
  const [listMode, setListMode] = useState<TNoteListMode>(() => {
    const storedMode = storage.getNoteListMode()
    if (isMainFeed) {
      if (storedMode === 'posts' || storedMode === 'postsAndReplies') {
        return storedMode
      }
      return 'posts'
    }
    return storedMode || 'posts'
  })
  const internalNoteListRef = useRef<TNoteListRef>(null)
  const noteListRef = ref || internalNoteListRef
  const [feedFilterTabRowHost, setFeedFilterTabRowHost] = useState<HTMLDivElement | null>(null)
  const onFeedFilterTabRowSlotRef = useCallback((node: HTMLDivElement | null) => {
    setFeedFilterTabRowHost(node)
  }, [])

  const MEDIA_KINDS = useMemo(() => [20, 21, 22, 1222], [])

  const tabs = useMemo(
    (): TabDefinition[] => {
      const base: TabDefinition[] = [
        { value: 'posts', label: 'Notes' },
        { value: 'postsAndReplies', label: 'Replies' }
      ]
      if (isMainFeed) base.push({ value: 'media', label: 'Media' })
      return base
    },
    [isMainFeed]
  )

  /** When in media mode, replace each shard's kinds with the media set. */
  const effectiveSubRequests = useMemo(() => {
    if (listMode !== 'media') return subRequests
    return subRequests.map((req) => ({
      ...req,
      filter: { ...req.filter, kinds: MEDIA_KINDS }
    }))
  }, [listMode, subRequests, MEDIA_KINDS])

  const handleListModeChange = useCallback(
    (mode: TNoteListMode | string) => {
      const noteListMode = mode as TNoteListMode
      setListMode(noteListMode)
      if (isMainFeed) {
        storage.setNoteListMode(noteListMode)
        window.dispatchEvent(new CustomEvent('noteListModeChanged'))
      }
      if (noteListRef && typeof noteListRef !== 'function') {
        noteListRef.current?.scrollToTop('smooth')
      }
    },
    [isMainFeed, noteListRef]
  )

  const handleShowKindsChange = useCallback((_newShowKinds: number[]) => {
    if (noteListRef && typeof noteListRef !== 'function') {
      noteListRef.current?.scrollToTop()
    }
  }, [noteListRef])

  const showKindsKey = useMemo(() => JSON.stringify(showKinds), [showKinds])

  /** Relay detail + kindless home chip use {@link useFilterAsIs}; include it so the 🔍 row is not dropped if only one flag is set. */
  const showFeedClientFilter = useMemo(
    () =>
      showFeedClientFilterProp ??
      (!isMainFeed || allowKindlessRelayExplore || useFilterAsIs),
    [showFeedClientFilterProp, isMainFeed, allowKindlessRelayExplore, useFilterAsIs]
  )

  const listShowAllKinds = showAllKindsProp ?? feedKindFilterBypass

  /** Include kind picker deps for single-relay chips (kindless REQ + client-side kinds). */
  const subHeaderFilterDepsKey = `${allowKindlessRelayExplore ? 'kle' : 'std'}|${showKindsKey}|${feedKindFilterBypass}|${listShowAllKinds ? 'all' : 'k'}`

  const tabsElement = useMemo(
    () => (
      <Tabs
        value={listMode}
        tabs={tabs}
        onTabChange={handleListModeChange}
        options={
          <div className="flex items-center gap-1">
            {onSubHeaderRefresh != null && <RefreshButton onClick={onSubHeaderRefresh} />}
            <KindFilter showKinds={showKinds} onShowKindsChange={handleShowKindsChange} />
          </div>
        }
      />
    ),
    [
      listMode,
      tabs,
      handleListModeChange,
      showKinds,
      onSubHeaderRefresh,
      handleShowKindsChange
    ]
  )

  const renderTabsInFeed = !(isMainFeed && setSubHeader) && !allowKindlessRelayExplore

  const mergeFilterWithTabsRow =
    showFeedClientFilter && ((isMainFeed && !!setSubHeader) || renderTabsInFeed)

  /** Same row for multi-relay and single-relay chips: Notes/Replies + refresh + kind picker (REQ may stay kindless for single relay; NoteList filters client-side). */
  useLayoutEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    if (mergeFilterWithTabsRow) {
      setSubHeader(
        <div className="flex w-full min-w-0 flex-wrap items-end gap-x-2 gap-y-1 border-b border-border/80 bg-background/95 pb-1.5 pt-0.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="min-w-0 flex-1">{tabsElement}</div>
          <div
            ref={onFeedFilterTabRowSlotRef}
            className="flex shrink-0 flex-col items-end justify-center self-center"
          />
        </div>
      )
    } else {
      setSubHeader(tabsElement)
    }
    return () => setSubHeader(null)
  }, [
    isMainFeed,
    setSubHeader,
    listMode,
    subHeaderFilterDepsKey,
    onSubHeaderRefresh,
    allowKindlessRelayExplore,
    mergeFilterWithTabsRow,
    tabsElement,
    onFeedFilterTabRowSlotRef
  ])

  return (
    <>
      {renderTabsInFeed &&
        (mergeFilterWithTabsRow ? (
          <div className="sticky top-0 z-20 border-b border-border/80 bg-background/95 pb-1.5 pt-0.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex w-full min-w-0 flex-wrap items-end gap-x-2 gap-y-1">
              <div className="min-w-0 flex-1">{tabsElement}</div>
              <div
                ref={onFeedFilterTabRowSlotRef}
                className="flex shrink-0 flex-col items-end justify-center self-center"
              />
            </div>
          </div>
        ) : (
          tabsElement
        ))}
      <div
        className={cn('min-w-0', mergeFilterWithTabsRow && renderTabsInFeed ? 'pt-0' : 'pt-2')}
      >
        <NoteList
          ref={noteListRef}
          showKinds={showKinds}
          showKind1OPs={showKind1OPs}
          showKind1Replies={showKind1Replies}
          showKind1111={showKind1111}
          seeAllFeedEvents={feedKindFilterBypass}
          withKindFilter={withKindFilter}
          subRequests={effectiveSubRequests}
          hideReplies={listMode === 'posts'}
          hideUntrustedNotes={hideUntrustedNotes}
          areAlgoRelays={areAlgoRelays}
          relayCapabilityReady={relayCapabilityReady}
          feedSubscriptionKey={feedSubscriptionKey}
          preserveTimelineOnSubRequestsChange={preserveTimelineOnSubRequestsChange}
          mergeTimelineWhenSubRequestFiltersMatch={mergeTimelineWhenSubRequestFiltersMatch}
          followingFeedDeltaSubRequests={followingFeedDeltaSubRequests}
          feedTimelineScopeKey={feedTimelineScopeKey}
          gridLayout={listMode === 'media'}
          useFilterAsIs={listMode === 'media' ? true : useFilterAsIs}
          clientSideKindFilter={listMode === 'media' ? false : clientSideKindFilter}
          allowKindlessRelayExplore={listMode === 'media' ? false : allowKindlessRelayExplore}
          showAllKinds={listMode === 'media' ? true : listShowAllKinds}
          showFeedClientFilter={showFeedClientFilter}
          hostPrimaryPageName={hostPrimaryPageName}
          feedClientFilterTabRowHost={mergeFilterWithTabsRow ? feedFilterTabRowHost : undefined}
          onSingleRelayKindlessEmpty={onSingleRelayKindlessEmpty}
          feedTopNotice={feedTopNotice}
          oneShotFetch={oneShotFetch}
          progressiveWarmupQuery={progressiveWarmupQuery}
          progressiveWarmupMatch={progressiveWarmupMatch}
          progressiveDocumentKinds={progressiveDocumentKinds}
          oneShotAfterMergeComparator={oneShotAfterMergeComparator}
          extraShouldHideEvent={extraShouldHideEvent}
          oneShotMergedCap={oneShotMergedCap}
        />
      </div>
    </>
  )
})

export default NormalFeed
