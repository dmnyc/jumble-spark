import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { Bell } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function NotificationsButton() {
  const { navigate } = usePrimaryPage()
  const { checkLogin } = useNostr()

  return (
    <BottomNavigationBarItem
      active={false}
      onClick={() => checkLogin(() => navigate('spells', { spell: 'notifications' }))}
    >
      <Bell />
    </BottomNavigationBarItem>
  )
}
