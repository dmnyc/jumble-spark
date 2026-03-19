import { ExtendedKind } from '@/constants'
import { notificationFilter } from '@/lib/notification'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { DiscussionNotification } from './DiscussionNotification'
import { MentionNotification } from './MentionNotification'
import { PollResponseNotification } from './PollResponseNotification'
import { PublicMessageNotification } from './PublicMessageNotification'
import { ReactionNotification } from './ReactionNotification'
import { RepostNotification } from './RepostNotification'
import { ZapNotification } from './ZapNotification'

export function NotificationItem({ notification }: { notification: Event }) {
  const { pubkey } = useNostr()
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const { hideUntrustedNotifications, isUserTrusted } = useUserTrust()
  const canShow = useMemo(() => {
    const result = notificationFilter(notification, {
      pubkey,
      mutePubkeySet,
      hideContentMentioningMutedUsers,
      hideUntrustedNotifications,
      isUserTrusted
    })

    return result
  }, [
    notification,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    hideUntrustedNotifications,
    isUserTrusted
  ])
  if (!canShow) return null

  if (notification.kind === 11) {
    return <DiscussionNotification notification={notification} />
  }
  if (notification.kind === kinds.Reaction) {
    return <ReactionNotification notification={notification} />
  }
  if (notification.kind === ExtendedKind.PUBLIC_MESSAGE) {
    return <PublicMessageNotification notification={notification} />
  }
  if (
    notification.kind === kinds.ShortTextNote ||
    notification.kind === ExtendedKind.COMMENT ||
    notification.kind === ExtendedKind.VOICE_COMMENT ||
    notification.kind === ExtendedKind.POLL
  ) {
    return <MentionNotification notification={notification} />
  }
  if (notification.kind === kinds.Repost) {
    return <RepostNotification notification={notification} />
  }
  if (notification.kind === kinds.Zap) {
    return <ZapNotification notification={notification} />
  }
  if (notification.kind === ExtendedKind.POLL_RESPONSE) {
    return <PollResponseNotification notification={notification} />
  }
  return null
}
