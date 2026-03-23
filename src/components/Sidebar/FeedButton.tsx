import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/PageManager'
import { Compass } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

export default function FeedButton() {
  const { t } = useTranslation()
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()

  return (
    <SidebarItem
      title={t('Explore')}
      onClick={() => navigate('explore')}
      active={display && current === 'explore' && primaryViewType === null}
    >
      <Compass strokeWidth={3} />
    </SidebarItem>
  )
}
