import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useNostr } from '@/providers/NostrProvider'
import { Bell } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function NotificationsButton() {
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { checkLogin } = useNostr()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell

  return (
    <BottomNavigationBarItem
      active={current === 'spells' && display && spell === 'notifications'}
      onClick={() => checkLogin(() => navigate('spells', { spell: 'notifications' }))}
    >
      <Bell />
    </BottomNavigationBarItem>
  )
}
