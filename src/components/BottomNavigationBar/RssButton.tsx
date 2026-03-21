import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import storage from '@/services/local-storage.service'
import { Rss } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function RssButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType, setPrimaryNoteView } = usePrimaryNoteView()
  const showRssFeed = storage.getShowRssFeed()

  if (!showRssFeed) return null

  return (
    <BottomNavigationBarItem
      active={current === 'rss' && display && primaryViewType === null}
      onClick={() => {
        if (primaryViewType !== null) {
          setPrimaryNoteView(null)
        } else {
          navigate('rss')
        }
      }}
    >
      <Rss />
    </BottomNavigationBarItem>
  )
}
