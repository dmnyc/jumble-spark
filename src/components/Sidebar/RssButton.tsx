import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { Rss } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'
import storage from '@/services/local-storage.service'

export default function RssButton() {
  const { t } = useTranslation()
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const showRssFeed = storage.getShowRssFeed()

  if (!showRssFeed) return null

  const isActive = display && current === 'rss' && primaryViewType === null

  return (
    <SidebarItem title={t('RSS + Web')} onClick={() => navigate('rss')} active={isActive}>
      <Rss strokeWidth={3} />
    </SidebarItem>
  )
}
