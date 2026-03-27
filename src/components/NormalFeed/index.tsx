import NoteList, { TNoteListRef } from '@/components/NoteList'
import { RefreshButton } from '@/components/RefreshButton'
import Tabs, { TabDefinition } from '@/components/Tabs'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import storage from '@/services/local-storage.service'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  /** Home favorite-relays chip scope; see {@link NoteList} `feedTimelineScopeKey`. */
  feedTimelineScopeKey?: string
  /** Single-relay Explore / chip: kindless REQ (limit 200), no feed kind filter. */
  useFilterAsIs?: boolean
  clientSideKindFilter?: boolean
  allowKindlessRelayExplore?: boolean
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
    feedTimelineScopeKey,
    useFilterAsIs = false,
    clientSideKindFilter = false,
    allowKindlessRelayExplore = false
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

  const tabs = useMemo(
    (): TabDefinition[] => [
      { value: 'posts', label: 'Notes' },
      { value: 'postsAndReplies', label: 'Replies' }
    ],
    []
  )

  const handleListModeChange = (mode: TNoteListMode | string) => {
    const noteListMode = mode as TNoteListMode
    setListMode(noteListMode)
    if (isMainFeed) {
      storage.setNoteListMode(noteListMode)
      window.dispatchEvent(new CustomEvent('noteListModeChanged'))
    }
    if (noteListRef && typeof noteListRef !== 'function') {
      noteListRef.current?.scrollToTop('smooth')
    }
  }

  const handleShowKindsChange = (_newShowKinds: number[]) => {
    if (noteListRef && typeof noteListRef !== 'function') {
      noteListRef.current?.scrollToTop()
    }
  }

  const showKindsKey = useMemo(() => JSON.stringify(showKinds), [showKinds])

  const subHeaderFilterDepsKey = allowKindlessRelayExplore
    ? 'kindless-relay-explore'
    : `${showKindsKey}|${feedKindFilterBypass}`

  const tabsElement = (
    <Tabs
      value={listMode}
      tabs={tabs}
      onTabChange={(tab) => handleListModeChange(tab)}
      options={
        <div className="flex items-center gap-1">
          {onSubHeaderRefresh != null && <RefreshButton onClick={onSubHeaderRefresh} />}
          {!allowKindlessRelayExplore && (
            <KindFilter showKinds={showKinds} onShowKindsChange={handleShowKindsChange} />
          )}
        </div>
      }
    />
  )

  useLayoutEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    if (allowKindlessRelayExplore) {
      setSubHeader(
        onSubHeaderRefresh != null ? (
          <div className="flex w-full items-center justify-end gap-1">
            <RefreshButton onClick={onSubHeaderRefresh} />
          </div>
        ) : null
      )
      return () => setSubHeader(null)
    }
    setSubHeader(tabsElement)
    return () => setSubHeader(null)
  }, [
    isMainFeed,
    setSubHeader,
    listMode,
    subHeaderFilterDepsKey,
    onSubHeaderRefresh,
    allowKindlessRelayExplore
  ])

  const renderTabsInFeed = !(isMainFeed && setSubHeader) && !allowKindlessRelayExplore

  return (
    <>
      {renderTabsInFeed && tabsElement}
      <div className="min-w-0 pt-2">
        <NoteList
          ref={noteListRef}
          showKinds={showKinds}
          showKind1OPs={showKind1OPs}
          showKind1Replies={showKind1Replies}
          showKind1111={showKind1111}
          seeAllFeedEvents={feedKindFilterBypass}
          subRequests={subRequests}
          hideReplies={allowKindlessRelayExplore ? false : listMode === 'posts'}
          hideUntrustedNotes={hideUntrustedNotes}
          areAlgoRelays={areAlgoRelays}
          relayCapabilityReady={relayCapabilityReady}
          preserveTimelineOnSubRequestsChange={preserveTimelineOnSubRequestsChange}
          mergeTimelineWhenSubRequestFiltersMatch={mergeTimelineWhenSubRequestFiltersMatch}
          feedTimelineScopeKey={feedTimelineScopeKey}
          useFilterAsIs={useFilterAsIs}
          clientSideKindFilter={clientSideKindFilter}
          allowKindlessRelayExplore={allowKindlessRelayExplore}
        />
      </div>
    </>
  )
})

export default NormalFeed
