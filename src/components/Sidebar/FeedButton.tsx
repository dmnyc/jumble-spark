import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { Newspaper } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

export default function FeedButton() {
  const { t } = useTranslation()
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()

  return (
    <SidebarItem
      title={t('Feed')}
      onClick={() => navigate('feed')}
      active={display && current === 'feed' && primaryViewType === null}
    >
      <Newspaper strokeWidth={3} />
    </SidebarItem>
  )
}
