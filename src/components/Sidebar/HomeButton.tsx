import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { Home } from 'lucide-react'
import SidebarItem from './SidebarItem'
import storage from '@/services/local-storage.service'
import { useState, useEffect } from 'react'

export default function HomeButton() {
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

  // Home is active when on home page, but NOT when RSS tab is active (RSS button handles that)
  const isActive = display && current === 'home' && primaryViewType === null && !(showRssFeed && rssTabActive)

  const handleClick = () => {
    // Navigate to home if not already there
    if (current !== 'home' || primaryViewType !== null) {
      navigate('home')
      // Wait a bit for navigation to complete, then switch to Notes tab
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('switchToNotesTab'))
      }, 100)
    } else {
      // Already on home, just switch to Notes tab (if RSS is active)
      if (showRssFeed && rssTabActive) {
        window.dispatchEvent(new CustomEvent('switchToNotesTab'))
      }
    }
  }

  return (
    <SidebarItem 
      title="Home" 
      onClick={handleClick} 
      active={isActive}
    >
      <Home strokeWidth={3} />
    </SidebarItem>
  )
}
