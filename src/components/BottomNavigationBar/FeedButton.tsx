import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { Newspaper } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function FeedButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType, setPrimaryNoteView } = usePrimaryNoteView()

  return (
    <BottomNavigationBarItem
      active={current === 'feed' && display && primaryViewType === null}
      onClick={() => {
        if (primaryViewType !== null) {
          setPrimaryNoteView(null)
        } else {
          navigate('feed')
        }
      }}
    >
      <Newspaper />
    </BottomNavigationBarItem>
  )
}
