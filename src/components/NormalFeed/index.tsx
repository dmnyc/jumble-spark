import NoteList, { TNoteListRef } from '@/components/NoteList'
import Tabs, { TabDefinition } from '@/components/Tabs'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import storage from '@/services/local-storage.service'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from 'react'
import KindFilter from '../KindFilter'

const NormalFeed = forwardRef<TNoteListRef, {
  subRequests: TFeedSubRequest[]
  areAlgoRelays?: boolean
  isMainFeed?: boolean
  /** When set (e.g. on Home), tabs are rendered in layout subHeader instead of in-feed; avoids overlap */
  setSubHeader?: (node: React.ReactNode) => void
}>(function NormalFeed(
  {
    subRequests,
    areAlgoRelays = false,
    isMainFeed = false,
    setSubHeader
  },
  ref
) {
  const { hideUntrustedNotes } = useUserTrust()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111 } = useKindFilter()
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(showKinds)
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

  const handleShowKindsChange = (newShowKinds: number[]) => {
    setTemporaryShowKinds(newShowKinds)
    if (noteListRef && typeof noteListRef !== 'function') {
      noteListRef.current?.scrollToTop()
    }
  }

  const tabsElement = (
    <Tabs
      value={listMode}
      tabs={tabs}
      onTabChange={(tab) => handleListModeChange(tab)}
      options={<KindFilter showKinds={temporaryShowKinds} onShowKindsChange={handleShowKindsChange} />}
    />
  )

  useLayoutEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    setSubHeader(tabsElement)
    return () => setSubHeader(null)
  }, [isMainFeed, setSubHeader, listMode, temporaryShowKinds])

  const renderTabsInFeed = !(isMainFeed && setSubHeader)

  return (
    <>
      {renderTabsInFeed && tabsElement}
      <div className="min-w-0 pt-2">
        <NoteList
          ref={noteListRef}
          showKinds={temporaryShowKinds}
          showKind1OPs={showKind1OPs}
          showKind1Replies={showKind1Replies}
          showKind1111={showKind1111}
          subRequests={subRequests}
          hideReplies={listMode === 'posts'}
          hideUntrustedNotes={hideUntrustedNotes}
          areAlgoRelays={areAlgoRelays}
        />
      </div>
    </>
  )
})

export default NormalFeed
