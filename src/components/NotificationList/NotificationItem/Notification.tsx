import ContentPreview from '@/components/ContentPreview'
import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import NoteStats from '@/components/NoteStats'
import { Skeleton } from '@/components/ui/skeleton'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { NOTIFICATION_LIST_STYLE } from '@/constants'
import { toNote, toProfile } from '@/lib/link'
import client from '@/services/client.service'
import { cn } from '@/lib/utils'
import { useSmartNoteNavigation, useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { NostrEvent } from 'nostr-tools'

export default function Notification({
  icon,
  sender,
  sentAt,
  description,
  middle = null,
  targetEvent,
  showStats = false,
  rightAction = null
}: {
  icon: React.ReactNode
  sender: string
  sentAt: number
  description: string
  middle?: React.ReactNode
  targetEvent?: NostrEvent
  showStats?: boolean
  rightAction?: React.ReactNode
}) {
  const { navigateToNote } = useSmartNoteNavigation()
  const { push } = useSecondaryPage()
  const { pubkey } = useNostr()
  const { notificationListStyle } = useUserPreferences()

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('[role="button"]') || target.closest('a')) {
      return
    }

    if (target.closest('[data-note-stats]')) {
      return
    }

    const hasOpenModal = document.querySelector('[data-radix-dialog-content][data-state="open"]')
    if (hasOpenModal) {
      return
    }

    if (targetEvent) {
      client.addEventToCache(targetEvent)
      navigateToNote(toNote(targetEvent.id))
    } else if (pubkey) {
      push(toProfile(pubkey))
    }
  }

  if (notificationListStyle === NOTIFICATION_LIST_STYLE.COMPACT) {
    return (
      <div
        className="flex items-center justify-between cursor-pointer py-2 px-4"
        onClick={handleClick}
      >
        <div className="flex gap-2 items-center flex-1 w-0">
          <UserAvatar userId={sender} size="small" />
          {icon}
          {middle}
          {targetEvent && (
            <ContentPreview className="truncate flex-1 w-0 text-muted-foreground" event={targetEvent} />
          )}
        </div>
        <div className="text-muted-foreground shrink-0">
          <FormattedTimestamp timestamp={sentAt} short />
        </div>
      </div>
    )
  }

  return (
    <div
      className="clickable flex items-start gap-2 cursor-pointer py-2 px-4 border-b"
      onClick={handleClick}
    >
      <div className="flex gap-2 items-center mt-1.5">
        {icon}
        <UserAvatar userId={sender} size="medium" />
      </div>
      <div className="flex-1 w-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex gap-1 items-center">
            <Username
              userId={sender}
              className="flex-1 max-w-fit truncate font-semibold"
              skeletonClassName="h-4"
            />
            <div className="shrink-0 text-muted-foreground text-sm">{description}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">{rightAction}</div>
        </div>
        {middle}
        {targetEvent && (
          <ContentPreview className={cn('line-clamp-2 text-muted-foreground')} event={targetEvent} />
        )}
        <FormattedTimestamp timestamp={sentAt} className="shrink-0 text-muted-foreground text-sm" />
        {showStats && targetEvent && <NoteStats event={targetEvent} className="mt-1" />}
      </div>
    </div>
  )
}

export function NotificationSkeleton() {
  const { notificationListStyle } = useUserPreferences()

  if (notificationListStyle === NOTIFICATION_LIST_STYLE.COMPACT) {
    return (
      <div className="flex gap-2 items-center h-11 py-2 px-4">
        <Skeleton className="w-7 h-7 rounded-full" />
        <Skeleton className="h-6 flex-1 w-0" />
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2 cursor-pointer py-2 px-4">
      <div className="flex gap-2 items-center mt-1.5">
        <Skeleton className="w-6 h-6" />
        <Skeleton className="w-9 h-9 rounded-full" />
      </div>
      <div className="flex-1 w-0">
        <div className="py-1">
          <Skeleton className="w-16 h-4" />
        </div>
        <div className="py-1">
          <Skeleton className="w-full h-4" />
        </div>
        <div className="py-1">
          <Skeleton className="w-12 h-4" />
        </div>
      </div>
    </div>
  )
}
