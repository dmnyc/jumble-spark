import NoteList, { TNoteListRef } from '@/components/NoteList'
import Tabs from '@/components/Tabs'
import logger from '@/lib/logger'
import { isTouchDevice } from '@/lib/utils'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import storage from '@/services/local-storage.service'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { forwardRef, useMemo, useRef, useState, useEffect } from 'react'
import KindFilter from '../KindFilter'
import { RefreshButton } from '../RefreshButton'
import RssFeedList from '../RssFeedList'

const NormalFeed = forwardRef<TNoteListRef, {
  subRequests: TFeedSubRequest[]
  areAlgoRelays?: boolean
  isMainFeed?: boolean
  showRelayCloseReason?: boolean
}>(function NormalFeed({
  subRequests,
  areAlgoRelays = false,
  isMainFeed = false,
  showRelayCloseReason = false
}, ref) {
  logger.debug('NormalFeed component rendering with:', { subRequests, areAlgoRelays, isMainFeed })
  const { hideUntrustedNotes } = useUserTrust()
  const { showKinds } = useKindFilter()
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(showKinds)
  const [listMode, setListMode] = useState<TNoteListMode>(() => {
    // For main feed, always default to 'posts' (Notes tab) to show the main content
    // Only use stored mode for non-main feeds
    if (isMainFeed) {
      return 'posts'
    }
    const storedMode = storage.getNoteListMode()
    return storedMode || 'posts'
  })
  const supportTouch = useMemo(() => isTouchDevice(), [])
  const internalNoteListRef = useRef<TNoteListRef>(null)
  const noteListRef = ref || internalNoteListRef
  const [showRssFeed, setShowRssFeed] = useState(() => storage.getShowRssFeed())
  const [activeTab, setActiveTab] = useState<string>(listMode)

  // Sync activeTab with listMode when listMode changes (but not when switching to RSS)
  useEffect(() => {
    if (activeTab !== 'rss' && activeTab !== listMode) {
      setActiveTab(listMode)
    }
  }, [listMode, activeTab])

  // Check showRssFeed setting on mount
  useEffect(() => {
    const currentShowRssFeed = storage.getShowRssFeed()
    setShowRssFeed(currentShowRssFeed)
  }, [])
  
  // Handle RSS tab visibility when showRssFeed changes
  useEffect(() => {
    // If RSS tab is hidden while it's active, switch to posts
    if (!showRssFeed && activeTab === 'rss') {
      setActiveTab('posts')
      setListMode('posts')
    }
  }, [showRssFeed, activeTab])

  const handleListModeChange = (mode: TNoteListMode | string) => {
    if (mode === 'rss') {
      setActiveTab('rss')
      return
    }
    const noteListMode = mode as TNoteListMode
    setListMode(noteListMode)
    setActiveTab(noteListMode)
    if (isMainFeed) {
      storage.setNoteListMode(noteListMode)
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

  // Build tabs array conditionally
  const tabs = useMemo(() => {
    const baseTabs = [
      { value: 'posts', label: 'Notes' },
      { value: 'postsAndReplies', label: 'Replies' }
    ]
    
    if (showRssFeed) {
      baseTabs.push({ value: 'rss', label: 'RSS' })
    }
    
    return baseTabs
  }, [showRssFeed])

  // Determine current tab value
  const currentTabValue = activeTab

  return (
    <>
      <Tabs
        value={currentTabValue}
        tabs={tabs}
        onTabChange={(tab) => {
          handleListModeChange(tab)
        }}
        options={
          activeTab !== 'rss' ? (
            <>
              {!supportTouch && <RefreshButton onClick={() => {
                if (noteListRef && typeof noteListRef !== 'function') {
                  noteListRef.current?.refresh()
                }
              }} />}
              <KindFilter showKinds={temporaryShowKinds} onShowKindsChange={handleShowKindsChange} />
            </>
          ) : null
        }
      />
      {activeTab === 'rss' ? (
        <RssFeedList />
      ) : (
        <NoteList
          ref={noteListRef}
          showKinds={temporaryShowKinds}
          subRequests={subRequests}
          hideReplies={listMode === 'posts'}
          hideUntrustedNotes={hideUntrustedNotes}
          areAlgoRelays={areAlgoRelays}
          showRelayCloseReason={showRelayCloseReason}
        />
      )}
    </>
  )
})

export default NormalFeed
