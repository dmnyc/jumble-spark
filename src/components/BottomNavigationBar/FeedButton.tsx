import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { Compass } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

/** Relay explore / discovery (primary Explore page). */
export default function FeedButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType, setPrimaryNoteView } = usePrimaryNoteView()

  return (
    <BottomNavigationBarItem
      active={current === 'explore' && display && primaryViewType === null}
      onClick={() => {
        if (primaryViewType !== null) {
          setPrimaryNoteView(null)
        } else {
          navigate('explore')
        }
      }}
    >
      <Compass />
    </BottomNavigationBarItem>
  )
}
