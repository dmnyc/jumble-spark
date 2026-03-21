import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

export default function DiscussionsButton() {
  const { t } = useTranslation()
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell

  return (
    <SidebarItem
      title={t('Discussions')}
      onClick={() => navigate('spells', { spell: 'discussions' })}
      active={
        display && current === 'spells' && primaryViewType === null && spell === 'discussions'
      }
    >
      <MessageCircle strokeWidth={3} />
    </SidebarItem>
  )
}
