import ParentNotePreview from '@/components/ParentNotePreview'
import { NOTIFICATION_LIST_STYLE } from '@/constants'
import { getEmbeddedPubkeys, getParentBech32Id } from '@/lib/event'
import { toNote } from '@/lib/link'
import { useSmartNoteNavigation } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { AtSign, MessageCircle, Quote } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Notification from './Notification'

export function MentionNotification({ notification }: { notification: Event }) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const { pubkey } = useNostr()
  const { notificationListStyle } = useUserPreferences()
  const isMention = useMemo(() => {
    if (!pubkey) return false
    const mentions = getEmbeddedPubkeys(notification)
    return mentions.includes(pubkey)
  }, [pubkey, notification])
  const parentEventId = useMemo(() => getParentBech32Id(notification), [notification])

  return (
    <Notification
      icon={
        isMention ? (
          <AtSign size={24} className="text-pink-400" />
        ) : parentEventId ? (
          <MessageCircle size={24} className="text-blue-400" />
        ) : (
          <Quote size={24} className="text-green-400" />
        )
      }
      sender={notification.pubkey}
      sentAt={notification.created_at}
      targetEvent={notification}
      middle={
        notificationListStyle === NOTIFICATION_LIST_STYLE.DETAILED &&
        parentEventId && (
          <ParentNotePreview
            eventId={parentEventId}
            className=""
            onClick={(e) => {
              e.stopPropagation()
              navigateToNote(toNote(parentEventId))
            }}
          />
        )
      }
      description={
        isMention ? t('mentioned you in a note') : parentEventId ? '' : t('quoted your note')
      }
      showStats
    />
  )
}
