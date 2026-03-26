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
}>(function NormalFeed(
  {
    subRequests,
    areAlgoRelays = false,
    relayCapabilityReady = true,
    isMainFeed = false,
    setSubHeader,
    onSubHeaderRefresh,
    preserveTimelineOnSubRequestsChange = false,
    mergeTimelineWhenSubRequestFiltersMatch = false
  },
  ref
) {
  const { hideUntrustedNotes } = useUserTrust()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111 } = useKindFilter()
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

  const tabsElement = (
    <Tabs
      value={listMode}
      tabs={tabs}
      onTabChange={(tab) => handleListModeChange(tab)}
      options={
        <div className="flex items-center gap-1">
          {onSubHeaderRefresh != null && <RefreshButton onClick={onSubHeaderRefresh} />}
          <KindFilter showKinds={showKinds} onShowKindsChange={handleShowKindsChange} />
        </div>
      }
    />
  )

  useLayoutEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    setSubHeader(tabsElement)
    return () => setSubHeader(null)
  }, [isMainFeed, setSubHeader, listMode, showKindsKey, onSubHeaderRefresh])

  const renderTabsInFeed = !(isMainFeed && setSubHeader)

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
          subRequests={subRequests}
          hideReplies={listMode === 'posts'}
          hideUntrustedNotes={hideUntrustedNotes}
          areAlgoRelays={areAlgoRelays}
          relayCapabilityReady={relayCapabilityReady}
          preserveTimelineOnSubRequestsChange={preserveTimelineOnSubRequestsChange}
          mergeTimelineWhenSubRequestFiltersMatch={mergeTimelineWhenSubRequestFiltersMatch}
        />
      </div>
    </>
  )
})

export default NormalFeed
