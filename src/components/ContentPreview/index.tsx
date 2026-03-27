import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import {
  notificationReactionSummaryKey,
  useNotificationReactionDisplay
} from '@/hooks/useNotificationReactionDisplay'
import { isMentioningMutedUsers, isNip18RepostKind, isNip25ReactionKind } from '@/lib/event'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY
} from '@/lib/discussion-votes'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useMuteListOptional } from '@/contexts/mute-list-context'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import CommunityDefinitionPreview from './CommunityDefinitionPreview'
import GroupMetadataPreview from './GroupMetadataPreview'
import HighlightPreview from './HighlightPreview'
import LiveEventPreview from './LiveEventPreview'
import LongFormArticlePreview from './LongFormArticlePreview'
import NormalContentPreview from './NormalContentPreview'
import PictureNotePreview from './PictureNotePreview'
import PollPreview from './PollPreview'
import VideoNotePreview from './VideoNotePreview'
import ZapPreview from './ZapPreview'
import DiscussionNote from '../DiscussionNote'
import ApplicationHandlerInfo from '../ApplicationHandlerInfo'
import ApplicationHandlerRecommendation from '../ApplicationHandlerRecommendation'
import FollowPackPreview from './FollowPackPreview'
import ReactionEmojiDisplay from '../Note/ReactionEmojiDisplay'
import NoteKindLabel from '../Note/NoteKindLabel'

/** Inert event so hooks can run before `event` is defined. */
const CONTENT_PREVIEW_HOOK_PLACEHOLDER = {
  kind: kinds.ShortTextNote,
  id: '',
  pubkey: '',
  content: '',
  tags: [],
  created_at: 0,
  sig: ''
} as Event

/** Keep spacing/margins on the outer wrapper; put line-clamp on the preview body so it still clamps text. */
function splitPreviewLayoutClasses(className?: string) {
  if (!className?.trim()) return { outer: undefined, body: undefined }
  const tokens = className.trim().split(/\s+/)
  const body: string[] = []
  const outer: string[] = []
  for (const tok of tokens) {
    if (tok.startsWith('line-clamp')) body.push(tok)
    else outer.push(tok)
  }
  return {
    outer: outer.length ? outer.join(' ') : undefined,
    body: body.length ? body.join(' ') : undefined
  }
}

export default function ContentPreview({
  event,
  className
}: {
  event?: Event
  className?: string
}) {
  const { t } = useTranslation()
  const reactionDisplay = useNotificationReactionDisplay(event ?? CONTENT_PREVIEW_HOOK_PLACEHOLDER)
  const muteList = useMuteListOptional()
  const mutePubkeySet = muteList?.mutePubkeySet ?? new Set<string>()
  const contentPolicy = useContentPolicyOptional()
  const hideContentMentioningMutedUsers = contentPolicy?.hideContentMentioningMutedUsers ?? false
  const isMuted = useMemo(
    () => (event ? mutePubkeySet.has(event.pubkey) : false),
    [mutePubkeySet, event]
  )
  const isMentioningMuted = useMemo(
    () =>
      hideContentMentioningMutedUsers && event
        ? isMentioningMutedUsers(event, mutePubkeySet)
        : false,
    [event, mutePubkeySet]
  )

  if (!event) {
    return <div className={cn('pointer-events-none', className)}>{`[${t('Note not found')}]`}</div>
  }

  if (isMuted) {
    return (
      <div className={cn('pointer-events-none', className)}>[{t('This user has been muted')}]</div>
    )
  }

  if (isMentioningMuted) {
    return (
      <div className={cn('pointer-events-none', className)}>
        [{t('This note mentions a user you muted')}]
      </div>
    )
  }

  const { outer: previewOuter, body: previewBody } = splitPreviewLayoutClasses(className)

  const withKindRow = (node: React.ReactNode) => (
    <div className={cn('flex min-w-0 flex-col gap-1', previewOuter)}>
      <NoteKindLabel kind={event.kind} event={event} size="small" />
      <div className={cn('min-w-0', previewBody)}>{node}</div>
    </div>
  )

  if (
    [
      kinds.ShortTextNote,
      ExtendedKind.COMMENT,
      ExtendedKind.VOICE,
      ExtendedKind.VOICE_COMMENT,
      ExtendedKind.RELAY_REVIEW,
      ExtendedKind.PUBLIC_MESSAGE
    ].includes(event.kind)
  ) {
    return withKindRow(<NormalContentPreview event={event} />)
  }

  if (event.kind === ExtendedKind.DISCUSSION) {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1', previewOuter)}>
        <NoteKindLabel kind={event.kind} event={event} size="small" />
        <div className={cn('min-w-0', previewBody)}>
          <DiscussionNote event={event} size="small" />
        </div>
      </div>
    )
  }

  if (event.kind === kinds.Highlights) {
    return withKindRow(<HighlightPreview event={event} />)
  }

  if (event.kind === ExtendedKind.POLL) {
    return withKindRow(<PollPreview event={event} />)
  }

  if (event.kind === kinds.LongFormArticle) {
    return withKindRow(<LongFormArticlePreview event={event} />)
  }

  if (event.kind === ExtendedKind.VIDEO || event.kind === ExtendedKind.SHORT_VIDEO) {
    return withKindRow(<VideoNotePreview event={event} />)
  }

  if (event.kind === ExtendedKind.PICTURE) {
    return withKindRow(<PictureNotePreview event={event} />)
  }

  if (event.kind === ExtendedKind.GROUP_METADATA) {
    return withKindRow(<GroupMetadataPreview event={event} />)
  }

  if (event.kind === kinds.CommunityDefinition) {
    return withKindRow(<CommunityDefinitionPreview event={event} />)
  }

  if (event.kind === kinds.LiveEvent) {
    return withKindRow(<LiveEventPreview event={event} />)
  }

  if (event.kind === ExtendedKind.ZAP_REQUEST || event.kind === ExtendedKind.ZAP_RECEIPT) {
    return withKindRow(<ZapPreview event={event} />)
  }

  if (event.kind === ExtendedKind.APPLICATION_HANDLER_INFO) {
    return withKindRow(<ApplicationHandlerInfo event={event} />)
  }

  if (event.kind === ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION) {
    return withKindRow(<ApplicationHandlerRecommendation event={event} />)
  }

  if (event.kind === ExtendedKind.FOLLOW_PACK) {
    return withKindRow(<FollowPackPreview event={event} />)
  }

  if (isNip25ReactionKind(event.kind)) {
    return withKindRow(
      <div className="pointer-events-none flex items-center gap-1.5 text-sm text-muted-foreground">
        {reactionDisplay.status === 'pending' ? (
          <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />
        ) : reactionDisplay.status === 'vote_up' ? (
          <span className="text-base leading-none" aria-hidden>
            {DISCUSSION_UPVOTE_DISPLAY}
          </span>
        ) : reactionDisplay.status === 'vote_down' ? (
          <span className="text-base leading-none" aria-hidden>
            {DISCUSSION_DOWNVOTE_DISPLAY}
          </span>
        ) : (
          <ReactionEmojiDisplay event={event} maxRawLength={24} variant="compact" />
        )}
        {t(notificationReactionSummaryKey(reactionDisplay))}
      </div>
    )
  }

  if (isNip18RepostKind(event.kind)) {
    return withKindRow(
      <div className="pointer-events-none text-sm text-muted-foreground">{t('Notification boost summary')}</div>
    )
  }

  if (event.kind === ExtendedKind.POLL_RESPONSE) {
    return withKindRow(
      <div className="pointer-events-none text-sm text-muted-foreground">
        {t('Notification poll vote summary')}
      </div>
    )
  }

  return withKindRow(<div>[{t('Cannot handle event of kind k', { k: event.kind })}]</div>)
}
