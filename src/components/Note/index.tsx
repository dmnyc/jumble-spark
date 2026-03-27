import { useSmartNoteNavigationOptional } from '@/PageManager'
import { ExtendedKind } from '@/constants'
import { isRenderableNoteKind } from '@/lib/note-renderable-kinds'
import {
  getHttpUrlFromITags,
  getParentBech32Id,
  isNip18RepostKind,
  isNip25ReactionKind,
  isNsfwEvent
} from '@/lib/event'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY
} from '@/lib/discussion-votes'
import {
  notificationReactionSummaryKey,
  useNotificationReactionDisplay
} from '@/hooks/useNotificationReactionDisplay'
import logger from '@/lib/logger'
import client from '@/services/client.service'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useMuteListOptional } from '@/contexts/mute-list-context'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import type { HighlightData } from '@/components/PostEditor/HighlightEditor'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getWebExternalReactionTargetUrl, isRssThreadSyntheticParentEvent } from '@/lib/rss-article'
import { CreateHighlightContext } from './CreateHighlightContext'
import SelectionHighlightTrigger from './SelectionHighlightTrigger'
import AudioPlayer from '../AudioPlayer'
import WebPreview from '../WebPreview'
import ClientTag from '../ClientTag'
import { FormattedTimestamp } from '../FormattedTimestamp'
import Nip05 from '../Nip05'
import NoteOptions from '../NoteOptions'
import ParentNotePreview from '../ParentNotePreview'
import UserAvatar from '../UserAvatar'
import Username from '../Username'
import { MessageSquare } from 'lucide-react'
import CommunityDefinition from './CommunityDefinition'
import GroupMetadata from './GroupMetadata'
import Highlight from './Highlight'

import IValue from './IValue'
import LiveEvent from './LiveEvent'
import LongFormArticlePreview from './LongFormArticlePreview'
import MarkdownArticle from './MarkdownArticle/MarkdownArticle'
import AsciidocArticle from './AsciidocArticle/AsciidocArticle'
import PublicationCard from './PublicationCard'
import PublicationIndex from './PublicationIndex/PublicationIndex'
import WikiCard from './WikiCard'
import MutedNote from './MutedNote'
import NsfwNote from './NsfwNote'
import PictureNote from './PictureNote'
import Poll from './Poll'
import ZapPoll from './ZapPoll'
import NotificationEventCard from './NotificationEventCard'
import ReactionEmojiDisplay from './ReactionEmojiDisplay'
import UnknownNote from './UnknownNote'
import NoteKindLabel from './NoteKindLabel'
import { Skeleton } from '@/components/ui/skeleton'
import VideoNote from './VideoNote'
import RelayReview from './RelayReview'
import Zap from './Zap'
import CitationCard from '@/components/CitationCard'
import FollowPackPreview from '../ContentPreview/FollowPackPreview'
import CalendarEventContent from '../CalendarEventContent'

export default function Note({
  event,
  originalNoteId,
  size = 'normal',
  className,
  hideParentNotePreview = false,
  showFull = false,
  disableClick = false,
  fullCalendarInvite,
  zapPollVoteHighlightOption
}: {
  event: Event
  originalNoteId?: string
  size?: 'normal' | 'small'
  className?: string
  hideParentNotePreview?: boolean
  showFull?: boolean
  disableClick?: boolean
  /** When viewing a kind-24 invite, use this to replace the embedded calendar with the full card (RSVP) in content */
  fullCalendarInvite?: { event: Event; naddr: string }
  /** Profile: highlight option when this row is from a zap vote receipt. */
  zapPollVoteHighlightOption?: number
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const parentEventId = useMemo(
    () => (hideParentNotePreview ? undefined : getParentBech32Id(event)),
    [event, hideParentNotePreview]
  )
  const contentPolicy = useContentPolicyOptional()
  const defaultShowNsfw = contentPolicy?.defaultShowNsfw ?? true
  const [showNsfw, setShowNsfw] = useState(false)
  const muteList = useMuteListOptional()
  const mutePubkeySet = muteList?.mutePubkeySet ?? new Set<string>()
  const [showMuted, setShowMuted] = useState(false)
  const [highlightData, setHighlightData] = useState<HighlightData | undefined>(undefined)
  const [highlightDefaultContent, setHighlightDefaultContent] = useState<string>('')
  const [postEditorOpen, setPostEditorOpen] = useState(false)
  const [publicMessageTo, setPublicMessageTo] = useState<string | null>(null)
  const [callInviteContent, setCallInviteContent] = useState<string | null>(null)
  const reactionDisplay = useNotificationReactionDisplay(event)
  const webReactionParentUrl = useMemo(
    () =>
      event.kind === ExtendedKind.EXTERNAL_REACTION ? getWebExternalReactionTargetUrl(event) : undefined,
    [event]
  )

  const openHighlight = useCallback((data: HighlightData, eventContent?: string) => {
    setHighlightData(data)
    setHighlightDefaultContent(eventContent ?? '')
    setPublicMessageTo(null)
    setCallInviteContent(null)
    setPostEditorOpen(true)
  }, [])

  const openPublicMessage = useCallback((pubkey: string) => {
    setPublicMessageTo(pubkey)
    setCallInviteContent(null)
    setPostEditorOpen(true)
  }, [])

  const openCallInvite = useCallback((url: string) => {
    setCallInviteContent(url)
    setPublicMessageTo(null)
    setHighlightData(undefined)
    setHighlightDefaultContent('')
    setPostEditorOpen(true)
  }, [])

  const isHighlightableKind =
    event.kind === kinds.ShortTextNote ||
    event.kind === kinds.LongFormArticle ||
    event.kind === ExtendedKind.WIKI_ARTICLE ||
    event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN ||
    event.kind === ExtendedKind.PUBLICATION ||
    event.kind === ExtendedKind.PUBLICATION_CONTENT ||
    event.kind === ExtendedKind.DISCUSSION ||
    event.kind === ExtendedKind.CALENDAR_EVENT_TIME ||
    event.kind === ExtendedKind.CALENDAR_EVENT_DATE ||
    event.kind === ExtendedKind.COMMENT

  let content: React.ReactNode
  
  if (!isRenderableNoteKind(event.kind)) {
    logger.debug('Note component - rendering UnknownNote for unsupported kind:', event.kind)
    content = <UnknownNote className="mt-2" event={event} omitKindLabel />
  } else if (mutePubkeySet.has(event.pubkey) && !showMuted) {
    content = <MutedNote show={() => setShowMuted(true)} />
  } else if (!defaultShowNsfw && isNsfwEvent(event) && !showNsfw) {
    content = <NsfwNote show={() => setShowNsfw(true)} />
  } else if (isNip25ReactionKind(event.kind)) {
    content = null
  } else if (isNip18RepostKind(event.kind) || event.kind === ExtendedKind.POLL_RESPONSE) {
    content = <NotificationEventCard className="mt-2" event={event} />
  } else if (event.kind === kinds.Highlights) {
    // Try to render the Highlight component with error boundary
    try {
      content = <Highlight className="mt-2" event={event} />
    } catch (error) {
      logger.error('Note component - Error rendering Highlight component:', error)
      content = <div className="mt-2 p-4 bg-red-100 border border-red-500 rounded">
        <div className="font-bold text-red-800">HIGHLIGHT ERROR:</div>
        <div className="text-red-700">Error: {String(error)}</div>
        <div className="mt-2">Content: {event.content}</div>
        <div>Context: {event.tags.find(tag => tag[0] === 'context')?.[1] || 'No context found'}</div>
      </div>
    }
  } else if (event.kind === ExtendedKind.WIKI_ARTICLE) {
    content = showFull ? (
      <AsciidocArticle className="mt-2" event={event} />
    ) : (
      <WikiCard className="mt-2" event={event} />
    )
  } else if (event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN) {
    content = showFull ? (
      <MarkdownArticle className="mt-2" event={event} />
    ) : (
      <WikiCard className="mt-2" event={event} />
    )
  } else if (event.kind === ExtendedKind.PUBLICATION) {
    content = showFull ? (
      <PublicationIndex className="mt-2" event={event} />
    ) : (
      <PublicationCard className="mt-2" event={event} />
    )
  } else if (event.kind === ExtendedKind.PUBLICATION_CONTENT) {
    content = showFull ? (
      <AsciidocArticle className="mt-2" event={event} />
    ) : (
      <PublicationCard className="mt-2" event={event} />
    )
  } else if (event.kind === kinds.LongFormArticle) {
    content = showFull ? (
      <MarkdownArticle className="mt-2" event={event} />
    ) : (
      <LongFormArticlePreview className="mt-2" event={event} />
    )
  } else if (event.kind === kinds.LiveEvent) {
    content = <LiveEvent className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.GROUP_METADATA) {
    content = <GroupMetadata className="mt-2" event={event} originalNoteId={originalNoteId} />
  } else if (event.kind === kinds.CommunityDefinition) {
    content = <CommunityDefinition className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.DISCUSSION) {
    const titleTag = event.tags.find(tag => tag[0] === 'title')
    const title = titleTag?.[1] || 'Untitled Discussion'
    content = (
      <>
        <h3 className="mt-2 text-lg font-semibold leading-tight break-words">{title}</h3>
        <MarkdownArticle className="mt-2" event={event} hideMetadata={true} />
      </>
    )
  } else if (
    event.kind === ExtendedKind.CITATION_INTERNAL ||
    event.kind === ExtendedKind.CITATION_EXTERNAL ||
    event.kind === ExtendedKind.CITATION_HARDCOPY ||
    event.kind === ExtendedKind.CITATION_PROMPT
  ) {
    content = <CitationCard className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.POLL) {
    content = (
      <>
        <MarkdownArticle className="mt-2" event={event} hideMetadata={true} />
        <Poll className="mt-2" event={event} />
      </>
    )
  } else if (event.kind === ExtendedKind.ZAP_POLL) {
    content = (
      <>
        <MarkdownArticle className="mt-2" event={event} hideMetadata={true} />
        <ZapPoll
          className="mt-2"
          event={event}
          voteHighlightOptionIndex={zapPollVoteHighlightOption}
        />
      </>
    )
  } else if (event.kind === ExtendedKind.VOICE) {
    content = <AudioPlayer className="mt-2" src={event.content} />
  } else if (event.kind === ExtendedKind.VOICE_COMMENT) {
    const voiceArticleUrl = getHttpUrlFromITags(event)
    content = (
      <>
        {voiceArticleUrl && (
          <div className="mt-2 not-prose max-w-full">
            <WebPreview url={voiceArticleUrl} className="w-full" />
          </div>
        )}
        <AudioPlayer className="mt-2" src={event.content} />
      </>
    )
  } else if (event.kind === ExtendedKind.PICTURE) {
    content = <PictureNote className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.VIDEO || event.kind === ExtendedKind.SHORT_VIDEO) {
    content = <VideoNote className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.RELAY_REVIEW) {
    content = <RelayReview className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.CALENDAR_EVENT_TIME || event.kind === ExtendedKind.CALENDAR_EVENT_DATE) {
    content = <CalendarEventContent event={event} className="mt-2" showRsvp />
  } else if (event.kind === ExtendedKind.PUBLIC_MESSAGE) {
    content = (
      <MarkdownArticle
        className="mt-2"
        event={event}
        hideMetadata={true}
        fullCalendarInvite={fullCalendarInvite}
      />
    )
  } else if (event.kind === ExtendedKind.ZAP_REQUEST || event.kind === ExtendedKind.ZAP_RECEIPT) {
    content = <Zap className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.FOLLOW_PACK) {
    content = <FollowPackPreview className="mt-2" event={event} />
  } else if (event.kind === kinds.ShortTextNote || event.kind === ExtendedKind.COMMENT) {
    // Plain text notes use MarkdownArticle for proper markdown rendering
    content = <MarkdownArticle className="mt-2" event={event} hideMetadata={true} />
  } else {
    // Use MarkdownArticle for all other kinds
    content = <MarkdownArticle className="mt-2" event={event} />
  }

  const isSyntheticRssParent = isRssThreadSyntheticParentEvent(event)

  const wrappedContent = isHighlightableKind ? (
    <SelectionHighlightTrigger event={event}>{content}</SelectionHighlightTrigger>
  ) : (
    content
  )

  return (
    <CreateHighlightContext.Provider value={openHighlight}>
      <div
        className={`${className} ${disableClick ? '' : 'clickable'}`}
        onClick={disableClick ? undefined : (e) => {
          // Don't navigate if clicking on interactive elements
          const target = e.target as HTMLElement
          if (target.closest('button') || target.closest('[role="button"]') || target.closest('a') || target.closest('[data-embedded-note]') || target.closest('[data-parent-note-preview]') || target.closest('[data-user-avatar]') || target.closest('[data-username]')) {
            return
          }
          e.stopPropagation()
          client.addEventToCache(event)
          navigateToNote(toNote(event), event)
        }}
      >
        <div className="flex justify-between items-start gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isNip25ReactionKind(event.kind) ? (
              <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
                {reactionDisplay.status === 'pending' ? (
                  <Skeleton
                    className={cn('shrink-0 rounded-sm', size === 'small' ? 'size-7' : 'size-8')}
                    aria-hidden
                  />
                ) : reactionDisplay.status === 'vote_up' ? (
                  <span
                    className={cn(
                      'inline-flex shrink-0 select-none leading-none',
                      size === 'small' ? 'text-xl' : 'text-2xl'
                    )}
                    aria-hidden
                  >
                    {DISCUSSION_UPVOTE_DISPLAY}
                  </span>
                ) : reactionDisplay.status === 'vote_down' ? (
                  <span
                    className={cn(
                      'inline-flex shrink-0 select-none leading-none',
                      size === 'small' ? 'text-xl' : 'text-2xl'
                    )}
                    aria-hidden
                  >
                    {DISCUSSION_DOWNVOTE_DISPLAY}
                  </span>
                ) : (
                  <ReactionEmojiDisplay event={event} />
                )}
                <UserAvatar userId={event.pubkey} size={size === 'small' ? 'medium' : 'normal'} />
                <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
                  <Username
                    userId={event.pubkey}
                    className={`max-w-[min(12rem,40vw)] shrink font-semibold truncate ${size === 'small' ? 'text-sm' : ''}`}
                    skeletonClassName={size === 'small' ? 'h-3' : 'h-4'}
                  />
                  <ClientTag event={event} />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {t(notificationReactionSummaryKey(reactionDisplay))}
                  </span>
                </div>
                <FormattedTimestamp
                  timestamp={event.created_at}
                  className="shrink-0 text-sm text-muted-foreground"
                  short={isSmallScreen}
                />
              </div>
            ) : isSyntheticRssParent ? (
              <>
                <div
                  className={`shrink-0 rounded-full bg-muted overflow-hidden flex items-center justify-center ${
                    size === 'small' ? 'w-9 h-9' : 'w-10 h-10'
                  }`}
                >
                  <img
                    src="/pwa-192x192.png"
                    alt=""
                    className="w-full h-full object-cover"
                    width={size === 'small' ? 36 : 40}
                    height={size === 'small' ? 36 : 40}
                  />
                </div>
                <div className="flex-1 w-0">
                  <div className="flex gap-2 items-center">
                    <span
                      data-username
                      className={`font-semibold truncate text-foreground ${size === 'small' ? 'text-sm' : ''}`}
                    >
                      {t('Jumble Imwald synthetic event')}
                    </span>
                    <ClientTag event={event} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <UserAvatar userId={event.pubkey} size={size === 'small' ? 'medium' : 'normal'} />
                <div className="flex-1 w-0">
                  <div className="flex gap-2 items-center">
                    <Username
                      userId={event.pubkey}
                      className={`font-semibold flex truncate ${size === 'small' ? 'text-sm' : ''}`}
                      skeletonClassName={size === 'small' ? 'h-3' : 'h-4'}
                    />
                    <ClientTag event={event} />
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Nip05 pubkey={event.pubkey} append="·" />
                    <FormattedTimestamp
                      timestamp={event.created_at}
                      className="shrink-0"
                      short={isSmallScreen}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {event.kind === ExtendedKind.DISCUSSION && (
              <button
                className="p-1 hover:bg-muted rounded transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  client.addEventToCache(event)
                  navigateToNote(toNote(event), event)
                }}
                title="View in Discussions"
              >
                <MessageSquare className="w-4 h-4 text-blue-500" />
              </button>
            )}
            {(size === 'normal' ||
              event.kind === ExtendedKind.ZAP_REQUEST ||
              event.kind === ExtendedKind.ZAP_RECEIPT) && (
              <NoteOptions
                event={event}
                className={cn(
                  'py-1 shrink-0',
                  size === 'small' ? '[&_svg]:size-4' : '[&_svg]:size-5'
                )}
                initialHighlightData={highlightData}
                highlightDefaultContent={highlightDefaultContent}
                isPostEditorOpen={postEditorOpen}
                onPostEditorClose={() => {
                  setPostEditorOpen(false)
                  setHighlightData(undefined)
                  setHighlightDefaultContent('')
                  setPublicMessageTo(null)
                  setCallInviteContent(null)
                }}
                onOpenPublicMessage={openPublicMessage}
                initialPublicMessageTo={publicMessageTo}
                onOpenCallInvite={openCallInvite}
                initialDefaultContent={callInviteContent}
              />
            )}
          </div>
        </div>
        <NoteKindLabel kind={event.kind} event={event} size={size} className="mt-1" />
        {webReactionParentUrl ? (
          <div className="mt-2 not-prose max-w-full" data-parent-note-preview>
            <WebPreview url={webReactionParentUrl} className="w-full" />
          </div>
        ) : parentEventId ? (
          <ParentNotePreview
            eventId={parentEventId}
            className="mt-2"
            onClick={(e) => {
              e.stopPropagation()
              navigateToNote(toNote(parentEventId))
            }}
          />
        ) : null}
        <IValue event={event} className="mt-2" />
        {wrappedContent}
      </div>
    </CreateHighlightContext.Provider>
  )
}
