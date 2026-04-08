import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { Wand2 } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function SpellsButton() {
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell

  return (
    <SidebarItem
      title="Spells"
      onClick={() => navigate('spells')}
      active={current === 'spells' && display && primaryViewType === null && !spell}
    >
      <Wand2 strokeWidth={3} />
    </SidebarItem>
  )
}
