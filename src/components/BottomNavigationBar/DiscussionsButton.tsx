import { usePrimaryPage } from '@/PageManager'
import { MessageCircle } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function DiscussionsButton() {
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell

  return (
    <BottomNavigationBarItem
      active={current === 'spells' && display && spell === 'discussions'}
      onClick={() => navigate('spells', { spell: 'discussions' })}
    >
      <MessageCircle />
    </BottomNavigationBarItem>
  )
}
