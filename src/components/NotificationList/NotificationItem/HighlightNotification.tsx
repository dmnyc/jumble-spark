import { Highlighter } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import Notification from './Notification'

export function HighlightNotification({
  notification,
  isNew = false,
  onVisibilityChange
}: {
  notification: Event
  isNew?: boolean
  onVisibilityChange?: (isVisible: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Notification
      notificationId={notification.id}
      icon={<Highlighter size={24} className="text-orange-400" />}
      sender={notification.pubkey}
      sentAt={notification.created_at}
      targetEvent={notification}
      description={t('highlighted your note')}
      isNew={isNew}
      onVisibilityChange={onVisibilityChange}
    />
  )
}
