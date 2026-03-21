import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { Wand2 } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function SpellsButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()

  return (
    <SidebarItem
      title="Spells"
      onClick={() => navigate('spells')}
      active={current === 'spells' && display && primaryViewType === null}
    >
      <Wand2 strokeWidth={3} />
    </SidebarItem>
  )
}
