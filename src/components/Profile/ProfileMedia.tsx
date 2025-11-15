import { Event } from 'nostr-tools'
import { forwardRef, useMemo } from 'react'
import { ExtendedKind } from '@/constants'
import ProfileTimeline from './ProfileTimeline'

const MEDIA_KIND_LIST = [
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO
]

interface ProfileMediaProps {
  pubkey: string
  topSpace?: number
  searchQuery?: string
  kindFilter?: string
  onEventsChange?: (events: Event[]) => void
}

const ProfileMedia = forwardRef<{ refresh: () => void; getEvents: () => Event[] }, ProfileMediaProps>(
  ({ pubkey, topSpace, searchQuery = '', kindFilter = 'all', onEventsChange }, ref) => {
    const cacheKey = useMemo(() => `${pubkey}-media`, [pubkey])

    const getKindLabel = (kindValue: string) => {
      if (!kindValue || kindValue === 'all') return 'media items'
      const kindNum = parseInt(kindValue, 10)
      if (kindNum === ExtendedKind.PICTURE) return 'photos'
      if (kindNum === ExtendedKind.VIDEO) return 'videos'
      if (kindNum === ExtendedKind.SHORT_VIDEO) return 'short videos'
      if (kindNum === ExtendedKind.VOICE) return 'voice posts'
      if (kindNum === ExtendedKind.VOICE_COMMENT) return 'voice comments'
      return 'media'
    }

    return (
      <ProfileTimeline
        ref={ref}
        pubkey={pubkey}
        topSpace={topSpace}
        searchQuery={searchQuery}
        kindFilter={kindFilter}
        onEventsChange={onEventsChange}
        kinds={MEDIA_KIND_LIST}
        cacheKey={cacheKey}
        getKindLabel={getKindLabel}
        refreshLabel="Refreshing media..."
        emptyLabel="No media found"
        emptySearchLabel="No media match your search"
      />
    )
  }
)

ProfileMedia.displayName = 'ProfileMedia'

export default ProfileMedia

