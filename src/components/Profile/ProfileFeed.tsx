import { ExtendedKind } from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { kinds, Event } from 'nostr-tools'
import { forwardRef, useMemo } from 'react'
import { useZap } from '@/providers/ZapProvider'
import ProfileTimeline from './ProfileTimeline'

const POST_KIND_LIST = [
  kinds.ShortTextNote,
  kinds.Repost,
  ExtendedKind.COMMENT,
  ExtendedKind.DISCUSSION,
  ExtendedKind.POLL,
  ExtendedKind.CALENDAR_EVENT_DATE,
  ExtendedKind.CALENDAR_EVENT_TIME,
  ExtendedKind.ZAP_RECEIPT,
  ExtendedKind.VOICE,
  ExtendedKind.VOICE_COMMENT
]

interface ProfileFeedProps {
  pubkey: string
  topSpace?: number
  searchQuery?: string
  kindFilter?: string
  onEventsChange?: (events: Event[]) => void
}

const ProfileFeed = forwardRef<{ refresh: () => void; getEvents?: () => Event[] }, ProfileFeedProps>(
  ({ pubkey, topSpace, searchQuery = '', kindFilter = 'all', onEventsChange }, ref) => {
    const { zapReplyThreshold } = useZap()

    const filterPredicate = useMemo(
      () => (event: Event) => {
        if (event.kind === ExtendedKind.ZAP_RECEIPT) {
          const zapInfo = getZapInfoFromEvent(event)
          if (!zapInfo?.amount || zapInfo.amount < zapReplyThreshold) {
            return false
          }
        }
        return true
      },
      [zapReplyThreshold]
    )

    const cacheKey = useMemo(() => `${pubkey}-posts-${zapReplyThreshold}`, [pubkey, zapReplyThreshold])

    const getKindLabel = (kindValue: string) => {
      if (!kindValue || kindValue === 'all') return 'posts'
      const kindNum = parseInt(kindValue, 10)
      if (kindNum === kinds.ShortTextNote) return 'notes'
      if (kindNum === kinds.Repost) return 'reposts'
      if (kindNum === ExtendedKind.COMMENT) return 'comments'
      if (kindNum === ExtendedKind.DISCUSSION) return 'discussions'
      if (kindNum === ExtendedKind.POLL) return 'polls'
      if (kindNum === ExtendedKind.CALENDAR_EVENT_TIME || kindNum === ExtendedKind.CALENDAR_EVENT_DATE)
        return 'calendar events'
      if (kindNum === ExtendedKind.ZAP_RECEIPT) return 'zaps'
      if (kindNum === ExtendedKind.VOICE) return 'voice posts'
      if (kindNum === ExtendedKind.VOICE_COMMENT) return 'voice comments'
      return 'posts'
    }

    return (
      <ProfileTimeline
        ref={ref}
        pubkey={pubkey}
        topSpace={topSpace}
        searchQuery={searchQuery}
        kindFilter={kindFilter}
        onEventsChange={onEventsChange}
        kinds={POST_KIND_LIST}
        cacheKey={cacheKey}
        filterPredicate={filterPredicate}
        getKindLabel={getKindLabel}
        refreshLabel="Refreshing posts..."
        emptyLabel="No posts found"
        emptySearchLabel="No posts match your search"
      />
    )
  }
)

ProfileFeed.displayName = 'ProfileFeed'

export default ProfileFeed
