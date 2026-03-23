import { cn } from '@/lib/utils'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/PageManager'
import { Star } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

/** Favorites feed (primary “home” destination in the bar). */
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
      <Star
        strokeWidth={active ? 2.4 : 2}
        className={cn(active && 'fill-green-500/30 dark:fill-green-400/35')}
      />
    </BottomNavigationBarItem>
  )
}
