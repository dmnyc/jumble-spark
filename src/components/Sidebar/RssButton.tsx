import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { Rss } from 'lucide-react'
import SidebarItem from './SidebarItem'
import storage from '@/services/local-storage.service'

export default function RssButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const showRssFeed = storage.getShowRssFeed()

  if (!showRssFeed) return null

  const isActive = display && current === 'rss' && primaryViewType === null

  return (
    <SidebarItem title="RSS Feed" onClick={() => navigate('rss')} active={isActive}>
      <Rss strokeWidth={3} />
    </SidebarItem>
  )
}
