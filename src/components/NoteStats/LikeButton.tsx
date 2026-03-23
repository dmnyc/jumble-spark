import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerOverlay } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { createDeletionRequestDraftEvent, createReactionDraftEvent } from '@/lib/draft-event'
import { getRootEventHexId } from '@/lib/event'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import { eventService } from '@/services/client.service'
import noteStatsService from '@/services/note-stats.service'
import { TEmoji } from '@/types'
import { SmilePlus } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import logger from '@/lib/logger'
import { useTranslation } from 'react-i18next'
import Emoji from '../Emoji'
import EmojiPicker from '../EmojiPicker'
import SuggestedEmojis from '../SuggestedEmojis'
import { formatCount } from './utils'
import { showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'

const DISCUSSION_EMOJIS = ['⬆️', '⬇️']

export default function LikeButton({ event, hideCount = false }: { event: Event; hideCount?: boolean }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { pubkey, publish, checkLogin } = useNostr()
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const [liking, setLiking] = useState(false)
  const [isEmojiReactionsOpen, setIsEmojiReactionsOpen] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const noteStats = useNoteStatsById(event.id)
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  const inQuietMode = shouldHideInteractions(event)
  
  // Check if this is a reply to a discussion event
  const [isReplyToDiscussion, setIsReplyToDiscussion] = useState(false)
  
  useMemo(() => {
    if (isDiscussion) return // Already a discussion event
    
    const rootEventId = getRootEventHexId(event)
    if (rootEventId) {
      // Fetch the root event to check if it's a discussion
      eventService.fetchEvent(rootEventId).then(rootEvent => {
        if (rootEvent && rootEvent.kind === ExtendedKind.DISCUSSION) {
          setIsReplyToDiscussion(true)
        }
      }).catch(() => {
        // If we can't fetch the root event, assume it's not a discussion reply
        setIsReplyToDiscussion(false)
      })
    }
  }, [event.id, isDiscussion])
  const { myLastEmoji, likeCount, upVoteCount, downVoteCount } = useMemo(() => {
    const stats = noteStats || {}
    const myLike = stats.likes?.find((like) => like.pubkey === pubkey)
    const likes = hideUntrustedInteractions
      ? stats.likes?.filter((like) => isUserTrusted(like.pubkey))
      : stats.likes
    
    // Calculate separate up/down vote counts for discussions
    let upVoteCount = 0
    let downVoteCount = 0
    if (isDiscussion || isReplyToDiscussion) {
      upVoteCount = likes?.filter(like => like.emoji === '⬆️').length || 0
      downVoteCount = likes?.filter(like => like.emoji === '⬇️').length || 0
    }
    
    return { myLastEmoji: myLike?.emoji, likeCount: likes?.length, upVoteCount, downVoteCount }
  }, [noteStats, pubkey, hideUntrustedInteractions, isDiscussion, isReplyToDiscussion])

  const like = async (emoji: string | TEmoji) => {
    checkLogin(async () => {
      if (liking || !pubkey) return

      setLiking(true)
      const timer = setTimeout(() => setLiking(false), 10_000)

      try {
        if (!noteStats?.updatedAt) {
          await noteStatsService.fetchNoteStats(event, pubkey)
        }

        // Check if user is clicking the same emoji they already reacted with
        const emojiString = typeof emoji === 'string' ? emoji : emoji.shortcode
        
        // Normalize myLastEmoji for comparison
        const myLastEmojiString = typeof myLastEmoji === 'string' ? myLastEmoji : typeof myLastEmoji === 'object' ? myLastEmoji.shortcode : undefined
        const isTogglingOff = myLastEmojiString === emojiString

        logger.debug('Like toggle check', {
          myLastEmoji,
          myLastEmojiString,
          emojiString,
          isTogglingOff,
          myLikes: noteStats?.likes?.filter(like => like.pubkey === pubkey)
        })

        if (isTogglingOff) {
          // User wants to toggle off - find their previous reaction and delete it
          const myReaction = noteStats?.likes?.find((like) => {
            if (like.pubkey !== pubkey) return false
            const likeEmojiString = typeof like.emoji === 'string' ? like.emoji : like.emoji.shortcode
            return likeEmojiString === emojiString
          })
          
          if (myReaction) {
            // Optimistically update the UI immediately
            noteStatsService.removeLike(event.id, myReaction.id)
            
            // Fetch the actual reaction event
            const reactionEvent = await eventService.fetchEvent(myReaction.id)
            if (reactionEvent) {
              // Create and publish a deletion request (kind 5)
              const deletionRequest = createDeletionRequestDraftEvent(reactionEvent)
              const deletedEvent = await publish(deletionRequest)
              
              // Show publishing feedback
              if ((deletedEvent as any)?.relayStatuses) {
                showPublishingFeedback({
                  success: true,
                  relayStatuses: (deletedEvent as any).relayStatuses,
                  successCount: (deletedEvent as any).relayStatuses.filter((s: any) => s.success).length,
                  totalCount: (deletedEvent as any).relayStatuses.length
                }, {
                  message: t('Reaction removed'),
                  duration: 4000
                })
              } else {
                showSimplePublishSuccess(t('Reaction removed'))
              }
            }
          }
        } else {
          // User is adding a new reaction
          const reaction = createReactionDraftEvent(event, emoji)
          const evt = await publish(reaction)
          
          // Show publishing feedback
          if ((evt as any)?.relayStatuses) {
            showPublishingFeedback({
              success: true,
              relayStatuses: (evt as any).relayStatuses,
              successCount: (evt as any).relayStatuses.filter((s: any) => s.success).length,
              totalCount: (evt as any).relayStatuses.length
            }, {
              message: t('Reaction published'),
              duration: 4000
            })
          } else {
            showSimplePublishSuccess(t('Reaction published'))
          }
          
          noteStatsService.updateNoteStatsByEvents([evt], undefined, {
            interactionTargetNoteId: event.id
          })
        }
      } catch (error) {
        logger.error('Like failed', { error, eventId: event.id })
      } finally {
        setLiking(false)
        clearTimeout(timer)
      }
    })
  }

  const trigger = (
    <button
      className="flex items-center enabled:hover:text-primary gap-1 px-3 h-full text-muted-foreground"
      title={t('Like')}
      disabled={liking}
      onClick={() => {
        // If user has already reacted, clicking the button again should toggle it off
        if (myLastEmoji && !isEmojiReactionsOpen) {
          like(myLastEmoji)
          return
        }
        
        // Otherwise, open the emoji picker
        setIsEmojiReactionsOpen(true)
      }}
    >
      {liking ? (
        <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
      ) : myLastEmoji ? (
        <>
          <Emoji emoji={inQuietMode ? '+' : myLastEmoji} classNames={{ img: 'size-4' }} />
          {!hideCount && !!likeCount && <div className="text-sm">{formatCount(likeCount)}</div>}
        </>
      ) : (
        <>
          <SmilePlus />
          {!hideCount && !!likeCount && <div className="text-sm">{formatCount(likeCount)}</div>}
        </>
      )}
    </button>
  )

  // For discussions, show the two arrow emojis directly as buttons
  if (isDiscussion || isReplyToDiscussion) {
    return (
      <div className="flex items-center gap-1">
        {DISCUSSION_EMOJIS.map((emoji, index) => {
          const isSelected = myLastEmoji === emoji
          const count = index === 0 ? upVoteCount : downVoteCount
          return (
            <button
              key={index}
              className={`flex items-center enabled:hover:text-primary gap-1 px-2 h-full text-muted-foreground rounded ${
                isSelected ? 'text-primary bg-muted' : ''
              }`}
              title={emoji === '⬆️' ? t('Upvote') : t('Downvote')}
              disabled={liking}
              onClick={() => {
                like(emoji)
              }}
            >
              {liking && index === 0 ? (
                <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
              ) : (
                <>
                  <span className="text-base">{emoji}</span>
                  {!hideCount && !!count && (
                    <div className="text-sm">{formatCount(count)}</div>
                  )}
                </>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  if (isSmallScreen) {
    return (
      <>
        {trigger}
        <Drawer open={isEmojiReactionsOpen} onOpenChange={setIsEmojiReactionsOpen}>
          <DrawerOverlay onClick={() => setIsEmojiReactionsOpen(false)} />
          <DrawerContent hideOverlay>
            <DrawerHeader className="sr-only">
              <DrawerTitle>React</DrawerTitle>
            </DrawerHeader>
            <EmojiPicker
              onEmojiClick={(emoji) => {
                setIsEmojiReactionsOpen(false)
                if (!emoji) return

                like(emoji)
              }}
            />
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <DropdownMenu
      open={isEmojiReactionsOpen}
      onOpenChange={(open) => {
        setIsEmojiReactionsOpen(open)
        if (open) {
          setIsPickerOpen(false)
        }
      }}
    >
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="p-0 w-fit">
        {isPickerOpen ? (
          <EmojiPicker
            onEmojiClick={(emoji, e) => {
              e.stopPropagation()
              setIsEmojiReactionsOpen(false)
              if (!emoji) return

              like(emoji)
            }}
          />
        ) : (
          <SuggestedEmojis
            onEmojiClick={(emoji) => {
              setIsEmojiReactionsOpen(false)
              like(emoji)
            }}
            onMoreButtonClick={() => {
              setIsPickerOpen(true)
            }}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
