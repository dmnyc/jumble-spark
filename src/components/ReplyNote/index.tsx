import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { useSmartNoteNavigation } from '@/PageManager'
import { ExtendedKind } from '@/constants'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  notificationReactionSummaryKey,
  useNotificationReactionDisplay
} from '@/hooks/useNotificationReactionDisplay'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY
} from '@/lib/discussion-votes'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { isMentioningMutedUsers, isNip25ReactionKind } from '@/lib/event'
import { getWebExternalReactionTargetUrl } from '@/lib/rss-article'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Event, kinds } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ClientTag from '../ClientTag'
import Collapsible from '../Collapsible'
import MarkdownArticle from '../Note/MarkdownArticle/MarkdownArticle'
import ReactionEmojiDisplay from '../Note/ReactionEmojiDisplay'
import { FormattedTimestamp } from '../FormattedTimestamp'
import Nip05 from '../Nip05'
import NoteOptions from '../NoteOptions'
import NoteStats from '../NoteStats'
import ParentNotePreview from '../ParentNotePreview'
import WebPreview from '../WebPreview'
import UserAvatar from '../UserAvatar'
import Username from '../Username'
import NoteKindLabel from '../Note/NoteKindLabel'
import Zap from '../Note/Zap'

export default function ReplyNote({
  event,
  parentEventId,
  onClickParent = () => {},
  onClickReply,
  highlight = false,
  duplicateWebPreviewCleanedUrlHints
}: {
  event: Event
  parentEventId?: string
  onClickParent?: () => void
  onClickReply?: (event: Event) => void
  highlight?: boolean
  duplicateWebPreviewCleanedUrlHints?: string[]
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { navigateToNote } = useSmartNoteNavigation()
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const [showMuted, setShowMuted] = useState(false)
  const reactionDisplay = useNotificationReactionDisplay(event)
  const webReactionParentUrl = useMemo(
    () =>
      event.kind === ExtendedKind.EXTERNAL_REACTION ? getWebExternalReactionTargetUrl(event) : undefined,
    [event]
  )
  const headerUserId = useMemo(() => {
    if (event.kind !== kinds.Zap) return event.pubkey
    const info = getZapInfoFromEvent(event)
    return info?.senderPubkey ?? event.pubkey
  }, [event])

  const show = useMemo(() => {
    if (showMuted) {
      return true
    }
    if (muteSetHas(mutePubkeySet, event.pubkey)) {
      return false
    }
    if (hideContentMentioningMutedUsers && isMentioningMutedUsers(event, mutePubkeySet)) {
      return false
    }
    return true
  }, [showMuted, mutePubkeySet, event, hideContentMentioningMutedUsers])


  return (
    <div
      className={`pb-3 border-b transition-colors duration-500 clickable ${highlight ? 'bg-primary/50' : ''}`}
      onClick={(e) => {
        // Don't navigate if clicking on interactive elements
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('[role="button"]') || target.closest('a') || target.closest('[data-parent-note-preview]')) {
          return
        }
        if (onClickReply) {
          onClickReply(event)
        } else {
          navigateToNote(toNote(event), event, getCachedThreadContextEvents(event))
        }
      }}
    >
      <Collapsible>
        <div className="flex space-x-2 items-start px-4 pt-3">
          <UserAvatar userId={headerUserId} size="medium" className="shrink-0 mt-0.5" />
          <div className="w-full overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 w-0">
                <div className="flex gap-1 items-center">
                  <Username
                    userId={headerUserId}
                    className="text-sm font-semibold text-muted-foreground hover:text-foreground truncate"
                    skeletonClassName="h-3"
                  />
                  <ClientTag event={event} />
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Nip05 pubkey={headerUserId} append="·" />
                  <FormattedTimestamp
                    timestamp={event.created_at}
                    className="shrink-0"
                    short={isSmallScreen}
                  />
                </div>
              </div>
              <div className="flex items-center shrink-0">
                <NoteOptions event={event} className="shrink-0 [&_svg]:size-5" />
              </div>
            </div>
            <NoteKindLabel
              kind={event.kind}
              event={event}
              size="small"
              className={cn(
                'mt-0.5',
                (isNip25ReactionKind(event.kind) || event.kind === kinds.Zap) && 'opacity-60'
              )}
            />
            {webReactionParentUrl ? (
              <div className="mt-1.5 not-prose max-w-full" data-parent-note-preview>
                <WebPreview url={webReactionParentUrl} className="w-full" />
              </div>
            ) : parentEventId ? (
              <ParentNotePreview
                appearance="subtle"
                className="mt-1.5"
                eventId={parentEventId}
                onClick={(e) => {
                  e.stopPropagation()
                  onClickParent()
                }}
              />
            ) : null}
            {show ? (
              isNip25ReactionKind(event.kind) ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
                  {reactionDisplay.status === 'pending' ? (
                    <Skeleton className="size-3.5 shrink-0 rounded-sm" aria-hidden />
                  ) : reactionDisplay.status === 'vote_up' ? (
                    <span className="text-sm leading-none opacity-90" aria-hidden>
                      {DISCUSSION_UPVOTE_DISPLAY}
                    </span>
                  ) : reactionDisplay.status === 'vote_down' ? (
                    <span className="text-sm leading-none opacity-90" aria-hidden>
                      {DISCUSSION_DOWNVOTE_DISPLAY}
                    </span>
                  ) : (
                    <ReactionEmojiDisplay event={event} variant="thread" maxRawLength={64} />
                  )}
                  <span className="text-foreground/85">{t(notificationReactionSummaryKey(reactionDisplay))}</span>
                </div>
              ) : event.kind === kinds.Zap ? (
                <Zap className="mt-1.5" event={event} omitSenderHeading variant="compact" />
              ) : (
                <MarkdownArticle
                  className="mt-2"
                  event={event}
                  hideMetadata={true}
                  duplicateWebPreviewCleanedUrlHints={duplicateWebPreviewCleanedUrlHints}
                />
              )
            ) : (
              <Button
                variant="outline"
                className="text-muted-foreground font-medium mt-2"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMuted(true)
                }}
              >
                {t('Temporarily display this reply')}
              </Button>
            )}
          </div>
        </div>
      </Collapsible>
      {show && !isNip25ReactionKind(event.kind) && (
        <NoteStats
          className="ml-14 pl-1 mr-4 mt-2"
          event={event}
          displayTopZapsAndLikes={event.kind !== kinds.Zap}
          fetchIfNotExisting
        />
      )}
    </div>
  )
}

export function ReplyNoteSkeleton() {
  return (
    <div className="px-4 py-3 flex items-start space-x-2 w-full">
      <Skeleton className="w-9 h-9 rounded-full shrink-0 mt-0.5" />
      <div className="w-full">
        <div className="py-1">
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="my-1">
          <Skeleton className="w-full h-4 my-1 mt-2" />
        </div>
        <div className="my-1">
          <Skeleton className="w-2/3 h-4 my-1" />
        </div>
      </div>
    </div>
  )
}
