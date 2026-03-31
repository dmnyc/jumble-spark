import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useNostr } from '@/providers/NostrProvider'
import { UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

export default function FollowsLatestButton() {
  const { t } = useTranslation()
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const { pubkey } = useNostr()

  if (!pubkey) return null

  return (
    <SidebarItem
      title={t('Follows latest nav label')}
      onClick={() => navigate('follows-latest')}
      active={current === 'follows-latest' && display && primaryViewType === null}
    >
      <UsersRound strokeWidth={2.5} />
    </SidebarItem>
  )
}
