import { useNostr } from '@/providers/NostrProvider'
import { MessageCircle } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Notification from './Notification'

export function PublicMessageNotification({ notification }: { notification: Event }) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  
  const isRecipient = useMemo(() => {
    if (!pubkey) return false
    // Check if current user is in the 'p' tags (recipients)
    return notification.tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey)
  }, [pubkey, notification])

  // Get list of recipients for display
  const recipients = useMemo(() => {
    return notification.tags
      .filter((tag) => tag[0] === 'p')
      .map((tag) => tag[1])
      .slice(0, 3) // Show first 3 recipients
  }, [notification.tags])

  const description = useMemo(() => {
    if (isRecipient) {
      if (recipients.length > 1) {
        return t('sent you a public message (along with {{count}} others)', { 
          count: recipients.length - 1 
        })
      }
      return t('sent you a public message')
    }
    return t('sent a public message')
  }, [isRecipient, recipients.length, t])

  return (
    <Notification
      icon={<MessageCircle size={24} className="text-purple-400" />}
      sender={notification.pubkey}
      sentAt={notification.created_at}
      targetEvent={notification}
      description={description}
      showStats
    />
  )
}
