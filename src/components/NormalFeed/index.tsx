import NoteList, { TNoteListRef } from '@/components/NoteList'
import Tabs from '@/components/Tabs'
import logger from '@/lib/logger'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import storage from '@/services/local-storage.service'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { forwardRef, useMemo, useRef, useState, useEffect } from 'react'
import KindFilter from '../KindFilter'
import { RefreshButton } from '../RefreshButton'
import RssFeedList from '../RssFeedList'
import { useNostr } from '@/providers/NostrProvider'
import rssFeedService from '@/services/rss-feed.service'
import { DEFAULT_RSS_FEEDS } from '@/constants'

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
  const internalNoteListRef = useRef<TNoteListRef>(null)
  const noteListRef = ref || internalNoteListRef
  const [showRssFeed, setShowRssFeed] = useState(() => storage.getShowRssFeed())
  const [activeTab, setActiveTab] = useState<string>(listMode)
  const [rssRefreshKey, setRssRefreshKey] = useState(0)
  const { pubkey, rssFeedListEvent } = useNostr()

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
          <>
            <RefreshButton onClick={() => {
              if (activeTab === 'rss') {
                // Refresh RSS feeds
                // Get feed URLs from event or use default
                let feedUrls: string[] = DEFAULT_RSS_FEEDS
                if (pubkey && rssFeedListEvent) {
                  try {
                    const urls = rssFeedListEvent.tags
                      .filter(tag => tag[0] === 'u' && tag[1])
                      .map(tag => tag[1] as string)
                      .filter((url): url is string => {
                        if (typeof url !== 'string') return false
                        const trimmed = url.trim()
                        return trimmed.length > 0
                      })
                    if (urls.length > 0) {
                      feedUrls = urls
                    }
                  } catch (e) {
                    // Use default feeds on error
                  }
                }
                
                // Trigger background refresh and UI update
                logger.info('[NormalFeed] Manual refresh: triggering RSS background refresh', { feedCount: feedUrls.length })
                // Start background refresh (don't wait for it)
                rssFeedService.backgroundRefreshFeeds(feedUrls).catch(err => {
                  logger.error('[NormalFeed] Manual refresh: background refresh failed', { error: err })
                })
                // Immediately trigger UI update (will show cached items, then update when background refresh completes)
                if (pubkey) {
                  window.dispatchEvent(new CustomEvent('rssFeedListUpdated', { 
                    detail: { pubkey, feedUrls, eventId: 'manual-refresh' } 
                  }))
                }
                // Also force re-render by updating key
                setRssRefreshKey(prev => prev + 1)
              } else {
                // Refresh Notes/Replies
                if (noteListRef && typeof noteListRef !== 'function') {
                  noteListRef.current?.refresh()
                }
              }
            }} />
            {activeTab !== 'rss' && (
              <KindFilter showKinds={temporaryShowKinds} onShowKindsChange={handleShowKindsChange} />
            )}
          </>
        }
      />
      {activeTab === 'rss' ? (
        <RssFeedList key={rssRefreshKey} />
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
