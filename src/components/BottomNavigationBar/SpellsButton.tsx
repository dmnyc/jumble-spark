import { usePrimaryPage } from '@/PageManager'
import { Wand2 } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function SpellsButton() {
  const { navigate, current, display } = usePrimaryPage()

  return (
    <BottomNavigationBarItem
      active={current === 'spells' && display}
      onClick={() => navigate('spells')}
    >
      <Wand2 />
    </BottomNavigationBarItem>
  )
}
