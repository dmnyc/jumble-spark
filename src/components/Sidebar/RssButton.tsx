import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { Rss } from 'lucide-react'
import SidebarItem from './SidebarItem'
import storage from '@/services/local-storage.service'

export default function RssButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const showRssFeed = storage.getShowRssFeed()

  // RSS is active when on home page and RSS tab would be active
  // We can't directly check if RSS tab is active, so we'll just check if we're on home
  const isActive = display && current === 'home' && primaryViewType === null && showRssFeed

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

