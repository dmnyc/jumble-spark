import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

export default function DiscussionsButton() {
  const { t } = useTranslation()
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()

  return (
    <SidebarItem
      title={t('Discussions')}
      onClick={() => navigate('spells', { spell: 'discussions' })}
      active={display && current === 'spells' && primaryViewType === null}
    >
      <MessageCircle strokeWidth={3} />
    </SidebarItem>
  )
}
