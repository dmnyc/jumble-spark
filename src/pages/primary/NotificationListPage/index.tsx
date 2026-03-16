import HideUntrustedContentButton from '@/components/HideUntrustedContentButton'
import NotificationList from '@/components/NotificationList'
import { RefreshButton } from '@/components/RefreshButton'
import Tabs from '@/components/Tabs'
import { usePrimaryPage } from '@/PageManager'
import { TNotificationType } from '@/types'
import { isTouchDevice } from '@/lib/utils'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { Bell } from 'lucide-react'
import { forwardRef, useEffect, useRef, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const NotificationListPage = forwardRef((_, ref) => {
  const { t } = useTranslation()
  const { current } = usePrimaryPage()
  const firstRenderRef = useRef(true)
  const notificationListRef = useRef<{ refresh: () => void }>(null)
  const [notificationType, setNotificationType] = useState<TNotificationType>('all')
  const supportTouch = useMemo(() => isTouchDevice(), [])

  useEffect(() => {
    if (current === 'notifications' && !firstRenderRef.current) {
      notificationListRef.current?.refresh()
    }
    firstRenderRef.current = false
  }, [current])

  useEffect(() => {
    const handleRestore = (e: CustomEvent<{ page: string; tab: string }>) => {
      if (e.detail.page === 'notifications' && e.detail.tab) {
        setNotificationType(e.detail.tab as TNotificationType)
      }
    }
    window.addEventListener('restorePageTab', handleRestore as EventListener)
    return () => window.removeEventListener('restorePageTab', handleRestore as EventListener)
  }, [])

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="notifications"
      titlebar={<NotificationListPageTitlebar />}
      subHeader={
        <Tabs
          value={notificationType}
          tabs={[
            { value: 'all', label: t('All') },
            { value: 'mentions', label: t('Mentions') },
            { value: 'reactions', label: t('Reactions') },
            { value: 'zaps', label: t('Zaps') }
          ]}
          onTabChange={(tab) => {
            setNotificationType(tab as TNotificationType)
            window.dispatchEvent(new CustomEvent('pageTabChanged', {
              detail: { page: 'notifications', tab }
            }))
          }}
          options={!supportTouch ? <RefreshButton onClick={() => notificationListRef.current?.refresh()} /> : null}
        />
      }
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-2">
        <NotificationList
          ref={notificationListRef}
          notificationType={notificationType}
        />
      </div>
    </PrimaryPageLayout>
  )
})
NotificationListPage.displayName = 'NotificationListPage'
export default NotificationListPage

function NotificationListPageTitlebar() {
  const { t } = useTranslation()

  return (
    <div className="flex gap-2 items-center justify-between h-full pl-3">
      <div className="flex items-center gap-2">
        <Bell />
        <div className="text-lg font-semibold">{t('Notifications')}</div>
      </div>
      <HideUntrustedContentButton type="notifications" size="titlebar-icon" />
    </div>
  )
}
