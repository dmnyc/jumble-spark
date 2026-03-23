import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { Wand2 } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function SpellsButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType, setPrimaryNoteView } = usePrimaryNoteView()

  return (
    <BottomNavigationBarItem
      active={current === 'spells' && display && primaryViewType === null}
      onClick={() => {
        if (primaryViewType !== null) {
          setPrimaryNoteView(null)
        } else {
          navigate('spells')
        }
      }}
    >
      <Wand2 />
    </BottomNavigationBarItem>
  )
}
