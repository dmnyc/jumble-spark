import NoteList, { TNoteListRef } from '@/components/NoteList'
import Tabs, { TabDefinition } from '@/components/Tabs'
import logger from '@/lib/logger'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import storage from '@/services/local-storage.service'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { forwardRef, useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import KindFilter from '../KindFilter'
import { RefreshButton } from '../RefreshButton'
import RssFeedList from '../RssFeedList'
import { useNostr } from '@/providers/NostrProvider'
import rssFeedService from '@/services/rss-feed.service'
import { DEFAULT_RSS_FEEDS } from '@/constants'
import { Rss, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'

const NormalFeed = forwardRef<TNoteListRef, {
  subRequests: TFeedSubRequest[]
  areAlgoRelays?: boolean
  isMainFeed?: boolean
  showRelayCloseReason?: boolean
  /** When set (e.g. on Home), tabs are rendered in layout subHeader instead of in-feed; avoids overlap */
  setSubHeader?: (node: React.ReactNode) => void
}>(function NormalFeed({
  subRequests,
  areAlgoRelays = false,
  isMainFeed = false,
  showRelayCloseReason = false,
  setSubHeader
}, ref) {
  logger.debug('NormalFeed component rendering with:', { subRequests, areAlgoRelays, isMainFeed })
  const { t } = useTranslation()
  const { hideUntrustedNotes } = useUserTrust()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111 } = useKindFilter()
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(showKinds)
  const [listMode, setListMode] = useState<TNoteListMode>(() => {
    // Get stored mode preference
    const storedMode = storage.getNoteListMode()
    // For main feed, only allow 'posts' or 'postsAndReplies' as valid values
    // Default to 'posts' if no valid preference is stored
    if (isMainFeed) {
      if (storedMode === 'posts' || storedMode === 'postsAndReplies') {
        return storedMode
      }
      return 'posts'
    }
    // For non-main feeds, use stored mode or default to 'posts'
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

  // Check showRssFeed setting on mount and listen for changes
  useEffect(() => {
    const checkShowRssFeed = () => {
      const currentShowRssFeed = storage.getShowRssFeed()
      setShowRssFeed(currentShowRssFeed)
    }
    
    // Check on mount
    checkShowRssFeed()
    
    // Listen for storage changes (polling approach - check every second)
    const intervalId = setInterval(checkShowRssFeed, 1000)
    
    // Also listen for custom event if RSS setting changes
    const handleRssSettingChange = () => {
      checkShowRssFeed()
    }
    window.addEventListener('rssFeedSettingChanged', handleRssSettingChange)
    
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('rssFeedSettingChanged', handleRssSettingChange)
    }
  }, [])
  
  // Handle RSS tab visibility when showRssFeed changes
  useEffect(() => {
    // If RSS tab is hidden while it's active, switch to posts
    if (!showRssFeed && activeTab === 'rss') {
      setActiveTab('posts')
      setListMode('posts')
    }
  }, [showRssFeed, activeTab])

  // Listen for custom event to switch to RSS tab
  useEffect(() => {
    const handleSwitchToRss = () => {
      if (showRssFeed) {
        setActiveTab('rss')
        // Dispatch event to notify sidebar that RSS tab is active
        window.dispatchEvent(new CustomEvent('rssTabStateChanged', { detail: { active: true } }))
        if (noteListRef && typeof noteListRef !== 'function') {
          noteListRef.current?.scrollToTop('smooth')
        }
      }
    }

    window.addEventListener('switchToRssFeed', handleSwitchToRss)
    return () => {
      window.removeEventListener('switchToRssFeed', handleSwitchToRss)
    }
  }, [showRssFeed, noteListRef])

  // Listen for custom event to switch to Notes tab
  useEffect(() => {
    const handleSwitchToNotes = () => {
      // Switch to posts (Notes) tab
      setListMode('posts')
      setActiveTab('posts')
      // Dispatch event to notify sidebar that RSS tab is not active
      window.dispatchEvent(new CustomEvent('rssTabStateChanged', { detail: { active: false } }))
      if (isMainFeed) {
        storage.setNoteListMode('posts')
      }
      if (noteListRef && typeof noteListRef !== 'function') {
        noteListRef.current?.scrollToTop('smooth')
      }
    }

    window.addEventListener('switchToNotesTab', handleSwitchToNotes)
    return () => {
      window.removeEventListener('switchToNotesTab', handleSwitchToNotes)
    }
  }, [isMainFeed, noteListRef])

  // Dispatch initial RSS tab state on mount and when activeTab changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('rssTabStateChanged', { 
      detail: { active: activeTab === 'rss' } 
    }))
  }, [activeTab])

  const handleListModeChange = (mode: TNoteListMode | string) => {
    if (mode === 'rss') {
      setActiveTab('rss')
      // Dispatch event to notify sidebar that RSS tab is active
      window.dispatchEvent(new CustomEvent('rssTabStateChanged', { detail: { active: true } }))
      return
    }
    const noteListMode = mode as TNoteListMode
    setListMode(noteListMode)
    setActiveTab(noteListMode)
    // Dispatch event to notify sidebar that RSS tab is not active
    window.dispatchEvent(new CustomEvent('rssTabStateChanged', { detail: { active: false } }))
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
  const tabs = useMemo((): TabDefinition[] => {
    const baseTabs: TabDefinition[] = [
      { value: 'posts', label: 'Notes' },
      { value: 'postsAndReplies', label: 'Replies' }
    ]
    
    if (showRssFeed) {
      baseTabs.push({ value: 'rss', label: 'RSS', icon: <Rss className="size-4" /> })
    }
    
    return baseTabs
  }, [showRssFeed])

  // Determine current tab value
  const currentTabValue = activeTab

  const tabsElement = (
    <Tabs
      value={currentTabValue}
      tabs={tabs}
      onTabChange={(tab) => {
        handleListModeChange(tab)
      }}
      options={
        <>
          {activeTab === 'rss' && showRssFeed && (
            <Button
              variant="ghost"
              size="titlebar-icon"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('toggleRssFilters'))
              }}
              title={t('Toggle filters')}
            >
              <Search className="h-4 w-4" />
            </Button>
          )}
          <RefreshButton onClick={() => {
            if (activeTab === 'rss') {
              let feedUrls: string[] = []
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
                  feedUrls = urls
                } catch (e) {
                  feedUrls = []
                }
              } else {
                feedUrls = DEFAULT_RSS_FEEDS
              }
              logger.info('[NormalFeed] Manual refresh: triggering RSS background refresh', { feedCount: feedUrls.length })
              rssFeedService.backgroundRefreshFeeds(feedUrls).catch(err => {
                logger.error('[NormalFeed] Manual refresh: background refresh failed', { error: err })
              })
              if (pubkey) {
                window.dispatchEvent(new CustomEvent('rssFeedListUpdated', {
                  detail: { pubkey, feedUrls, eventId: 'manual-refresh' }
                }))
              }
              setRssRefreshKey(prev => prev + 1)
            } else {
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
  )

  // When used on Home, render tabs in layout subHeader so they don't overlap content
  useLayoutEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    setSubHeader(tabsElement)
    return () => setSubHeader(null)
  }, [isMainFeed, setSubHeader, currentTabValue, activeTab, showRssFeed, temporaryShowKinds])

  const renderTabsInFeed = !(isMainFeed && setSubHeader)

  return (
    <>
      {renderTabsInFeed && tabsElement}
      <div className="pt-2 min-w-0">
        {activeTab === 'rss' ? (
          <RssFeedList key={rssRefreshKey} />
        ) : (
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
            showRelayCloseReason={showRelayCloseReason}
          />
        )}
      </div>
    </>
  )
})

export default NormalFeed
