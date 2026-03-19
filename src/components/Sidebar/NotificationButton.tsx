import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { Bell } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function NotificationsButton() {
  const { checkLogin } = useNostr()
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()

  return (
    <SidebarItem
      title="Notifications"
      onClick={() => checkLogin(() => navigate('notifications'))}
      active={display && current === 'notifications' && primaryViewType === null}
    >
      <Bell strokeWidth={3} />
    </SidebarItem>
  )
}
