import { usePrimaryPage } from '@/PageManager'
import { MessageCircle } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function DiscussionsButton() {
  const { navigate, current, display } = usePrimaryPage()

  return (
    <BottomNavigationBarItem
      active={current === 'spells' && display}
      onClick={() => navigate('spells', { spell: 'discussions' })}
    >
      <MessageCircle />
    </BottomNavigationBarItem>
  )
}
