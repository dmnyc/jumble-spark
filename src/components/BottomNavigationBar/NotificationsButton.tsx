import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { Bell } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function NotificationsButton() {
  const { checkLogin } = useNostr()
  const { navigate, current, display } = usePrimaryPage()

  return (
    <BottomNavigationBarItem
      active={current === 'notifications' && display}
      onClick={() => checkLogin(() => navigate('notifications'))}
    >
      <Bell />
    </BottomNavigationBarItem>
  )
}
