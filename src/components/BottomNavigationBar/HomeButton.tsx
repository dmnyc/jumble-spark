import { cn } from '@/lib/utils'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { House } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

/** Home feed (primary timeline). */
export default function HomeButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType, setPrimaryNoteView } = usePrimaryNoteView()

  const active = current === 'feed' && display && primaryViewType === null

  return (
    <BottomNavigationBarItem
      prominent
      active={active}
      onClick={() => {
        if (primaryViewType !== null) {
          setPrimaryNoteView(null)
        } else {
          navigate('feed')
        }
      }}
    >
      <House
        strokeWidth={active ? 2.4 : 2}
        className={cn(active && 'fill-green-500/30 dark:fill-green-400/35')}
      />
    </BottomNavigationBarItem>
  )
}
