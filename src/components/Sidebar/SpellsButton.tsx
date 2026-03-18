import { usePrimaryPage } from '@/PageManager'
import { Wand2 } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function SpellsButton() {
  const { navigate, current, display } = usePrimaryPage()

  const isActive = display && current === 'spells'

  return (
    <SidebarItem title="Spells" onClick={() => navigate('spells')} active={isActive}>
      <Wand2 strokeWidth={3} />
    </SidebarItem>
  )
}
