import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import noteStatsService from '@/services/note-stats.service'
import { ExtendedKind } from '@/constants'
import { getRootEventHexId } from '@/lib/event'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { eventService } from '@/services/client.service'
import { Event } from 'nostr-tools'
import { useEffect, useState, useMemo } from 'react'
import BookmarkButton from '../BookmarkButton'
import LikeButton from './LikeButton'
import Likes from './Likes'
import ReplyButton from './ReplyButton'
import RepostButton from './RepostButton'
import SeenOnButton from './SeenOnButton'
import TopZaps from './TopZaps'
import ZapButton from './ZapButton'

export default function NoteStats({
  event,
  className,
  classNames,
  fetchIfNotExisting = false,
  displayTopZapsAndLikes = false
}: {
  event: Event
  className?: string
  classNames?: {
    buttonBar?: string
  }
  fetchIfNotExisting?: boolean
  displayTopZapsAndLikes?: boolean
}) {
  const { isSmallScreen } = useScreenSize()
  const { pubkey } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const [loading, setLoading] = useState(false)
  
  // Hide boost button for discussion events and replies to discussions
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  const [isReplyToDiscussion, setIsReplyToDiscussion] = useState(false)
  
  // Hide interaction counts if event is in quiet mode
  const hideInteractions = shouldHideInteractions(event)
  
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

  useEffect(() => {
    if (!fetchIfNotExisting) return
    setLoading(true)
    noteStatsService.fetchNoteStats(event, pubkey, favoriteRelays).finally(() => setLoading(false))
  }, [event, fetchIfNotExisting])

  if (isSmallScreen) {
    return (
      <div className={cn('select-none', className)} data-note-stats onClick={(e) => e.stopPropagation()}>
        {displayTopZapsAndLikes && (
          <>
            <TopZaps event={event} />
            {/* Kind 11: LikeButton already shows ⬆️/⬇️; Likes row would duplicate those pills */}
            {!isDiscussion && <Likes event={event} />}
          </>
        )}
        <div
          className={cn(
            'flex justify-between items-center h-5 [&_svg]:size-5',
            loading ? 'animate-pulse' : '',
            classNames?.buttonBar
          )}
        >
          <ReplyButton event={event} hideCount={hideInteractions} />
          {!isDiscussion && !isReplyToDiscussion && <RepostButton event={event} hideCount={hideInteractions} />}
          <LikeButton event={event} hideCount={hideInteractions} />
          <ZapButton event={event} hideCount={hideInteractions} />
          <BookmarkButton event={event} />
          <SeenOnButton event={event} />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('select-none', className)} data-note-stats onClick={(e) => e.stopPropagation()}>
      {displayTopZapsAndLikes && (
        <>
          <TopZaps event={event} />
          {!isDiscussion && <Likes event={event} />}
        </>
      )}
      <div className="flex justify-between h-5 [&_svg]:size-4">
        <div
          className={cn('flex items-center', loading ? 'animate-pulse' : '')}
        >
          <ReplyButton event={event} hideCount={hideInteractions} />
          {!isDiscussion && !isReplyToDiscussion && <RepostButton event={event} hideCount={hideInteractions} />}
          <LikeButton event={event} hideCount={hideInteractions} />
          <ZapButton event={event} hideCount={hideInteractions} />
        </div>
        <div className="flex items-center">
          <BookmarkButton event={event} />
          <SeenOnButton event={event} />
        </div>
      </div>
    </div>
  )
}
