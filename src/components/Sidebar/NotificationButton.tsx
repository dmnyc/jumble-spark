import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { Bell } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function NotificationButton() {
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const { checkLogin } = useNostr()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell

  return (
    <SidebarItem
      title="notifications"
      onClick={() => checkLogin(() => navigate('spells', { spell: 'notifications' }))}
      active={
        display &&
        current === 'spells' &&
        primaryViewType === null &&
        spell === 'notifications'
      }
    >
      <Bell strokeWidth={3} />
    </SidebarItem>
  )
}
