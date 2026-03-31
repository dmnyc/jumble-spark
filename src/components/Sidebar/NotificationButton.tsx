import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useNostr } from '@/providers/NostrProvider'
import { Bell, Settings } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function NotificationButton() {
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const { pubkey } = useNostr()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell

  if (!pubkey) {
    return (
      <SidebarItem
        title="Settings"
        onClick={() => navigate('settings')}
        active={display && current === 'settings' && primaryViewType === null}
      >
        <Settings strokeWidth={3} />
      </SidebarItem>
    )
  }

  return (
    <SidebarItem
      title="Notifications"
      onClick={() => navigate('spells', { spell: 'notifications' })}
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
