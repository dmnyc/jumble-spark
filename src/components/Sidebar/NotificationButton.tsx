import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { Bell } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function NotificationButton() {
  const { navigate } = usePrimaryPage()
  const { checkLogin } = useNostr()

  return (
    <SidebarItem
      title="notifications"
      onClick={() => checkLogin(() => navigate('spells', { spell: 'notifications' }))}
      active={false}
    >
      <Bell strokeWidth={3} />
    </SidebarItem>
  )
}
