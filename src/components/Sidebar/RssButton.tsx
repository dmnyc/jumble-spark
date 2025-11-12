import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { Rss } from 'lucide-react'
import SidebarItem from './SidebarItem'
import storage from '@/services/local-storage.service'
import { useState, useEffect } from 'react'

export default function RssButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const showRssFeed = storage.getShowRssFeed()
  const [rssTabActive, setRssTabActive] = useState(false)

  // Listen for RSS tab state changes
  useEffect(() => {
    const handleRssTabStateChange = (event: CustomEvent<{ active: boolean }>) => {
      setRssTabActive(event.detail.active)
    }

    window.addEventListener('rssTabStateChanged', handleRssTabStateChange as EventListener)
    
    // Check initial state
    setRssTabActive(false) // Default to false, will be updated by event
    
    return () => {
      window.removeEventListener('rssTabStateChanged', handleRssTabStateChange as EventListener)
    }
  }, [])

  // RSS is active when on home page, RSS tab is actually active, and RSS feed is enabled
  const isActive = display && current === 'home' && primaryViewType === null && showRssFeed && rssTabActive

  const handleClick = () => {
    // Navigate to home if not already there
    if (current !== 'home' || primaryViewType !== null) {
      navigate('home')
      // Wait a bit for navigation to complete, then switch to RSS
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('switchToRssFeed'))
      }, 100)
    } else {
      // Already on home, just switch to RSS tab
      window.dispatchEvent(new CustomEvent('switchToRssFeed'))
    }
  }

  return (
    <SidebarItem title="RSS Feed" onClick={handleClick} active={isActive}>
      <Rss strokeWidth={3} />
    </SidebarItem>
  )
}

