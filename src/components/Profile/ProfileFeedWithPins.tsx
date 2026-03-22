import NoteCard from '@/components/NoteCard'
import ProfileSearchBar from '@/components/ui/ProfileSearchBar'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind, PROFILE_FEED_KINDS } from '@/constants'
import { isReplyNoteEvent } from '@/lib/event'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { useProfilePins } from '@/hooks/useProfilePins'
import { useProfileTimeline } from '@/hooks/useProfileTimeline'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useZap } from '@/providers/ZapProvider'
import storage from '@/services/local-storage.service'
import { Event, kinds } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const INITIAL_SHOW_COUNT = 25
const LOAD_MORE_COUNT = 25

function useHideRepliesLikeMainFeed() {
  const [hideReplies, setHideReplies] = useState(() => {
    const m = storage.getNoteListMode()
    return m !== 'postsAndReplies'
  })

  useEffect(() => {
    const sync = () => {
      const m = storage.getNoteListMode()
      setHideReplies(m !== 'postsAndReplies')
    }
    window.addEventListener('noteListModeChanged', sync)
    return () => window.removeEventListener('noteListModeChanged', sync)
  }, [])

  return hideReplies
}

const ProfileFeedWithPins = forwardRef<{ refresh: () => void }, { pubkey: string }>(({ pubkey }, ref) => {
  const { t } = useTranslation()
  const { zapReplyThreshold } = useZap()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111 } = useKindFilter()
  const hideReplies = useHideRepliesLikeMainFeed()
  const [searchQuery, setSearchQuery] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showCount, setShowCount] = useState(INITIAL_SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { pinEvents, loadingPins, refreshPins } = useProfilePins(pubkey)

  const filterPredicate = useCallback(
    (event: Event) => {
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

  const cacheKey = useMemo(() => `${pubkey}-profile-unified-${zapReplyThreshold}`, [pubkey, zapReplyThreshold])

  const { events: timelineEvents, isLoading: loadingTimeline, refresh: refreshTimeline } = useProfileTimeline({
    pubkey,
    cacheKey,
    kinds: PROFILE_FEED_KINDS,
    limit: 200,
    filterPredicate
  })

  const pinIds = useMemo(() => new Set(pinEvents.map((e) => e.id)), [pinEvents])

  const passesMainFeedTimelineRules = useCallback(
    (event: Event) => {
      if (!showKinds.includes(event.kind)) return false
      if (event.kind === kinds.ShortTextNote) {
        const isReply = isReplyNoteEvent(event)
        if (hideReplies && isReply) return false
        if (isReply && !showKind1Replies) return false
        if (!isReply && !showKind1OPs) return false
      }
      if (event.kind === ExtendedKind.COMMENT && !showKind1111) return false
      return true
    },
    [showKinds, showKind1OPs, showKind1Replies, showKind1111, hideReplies]
  )

  const restTimeline = useMemo(
    () => timelineEvents.filter((e) => !pinIds.has(e.id)).filter(passesMainFeedTimelineRules),
    [timelineEvents, pinIds, passesMainFeedTimelineRules]
  )

  const applySearch = useCallback(
    (events: Event[]) => {
      const q = searchQuery.trim().toLowerCase()
      if (!q) return events
      return events.filter((event) => {
        if (event.content.toLowerCase().includes(q)) return true
        return event.tags.some((tag) => tag.length > 1 && tag[1]?.toLowerCase().includes(q))
      })
    },
    [searchQuery]
  )

  const filteredPins = useMemo(() => applySearch(pinEvents), [pinEvents, applySearch])
  const filteredRest = useMemo(() => applySearch(restTimeline), [restTimeline, applySearch])

  const mergedDisplay = useMemo(() => [...filteredPins, ...filteredRest], [filteredPins, filteredRest])

  const pinnedDisplayIds = useMemo(() => new Set(filteredPins.map((e) => e.id)), [filteredPins])

  useEffect(() => {
    setShowCount(INITIAL_SHOW_COUNT)
  }, [searchQuery, pubkey])

  useEffect(() => {
    if (!loadingPins && !loadingTimeline) {
      setIsRefreshing(false)
    }
  }, [loadingPins, loadingTimeline])

  const refreshAll = useCallback(() => {
    setIsRefreshing(true)
    refreshPins()
    refreshTimeline()
  }, [refreshPins, refreshTimeline])

  useImperativeHandle(ref, () => ({ refresh: refreshAll }), [refreshAll])

  const displayedEvents = useMemo(
    () => mergedDisplay.slice(0, showCount),
    [mergedDisplay, showCount]
  )

  useEffect(() => {
    if (!bottomRef.current || displayedEvents.length >= mergedDisplay.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && displayedEvents.length < mergedDisplay.length) {
          setShowCount((prev) => Math.min(prev + LOAD_MORE_COUNT, mergedDisplay.length))
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(bottomRef.current)
    return () => observer.disconnect()
  }, [displayedEvents.length, mergedDisplay.length])

  const loading = (loadingPins || loadingTimeline) && mergedDisplay.length === 0

  if (loading) {
    return (
      <div className="mt-4 space-y-2 px-1">
        <div className="flex flex-wrap items-center gap-2 px-2">
          <ProfileSearchBar
            onSearch={setSearchQuery}
            placeholder={t('Search posts...')}
            className="w-64 max-w-full"
          />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (!mergedDisplay.length && !loadingPins && !loadingTimeline) {
    return (
      <div className="mt-4 px-2">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <ProfileSearchBar
            onSearch={setSearchQuery}
            placeholder={t('Search posts...')}
            className="w-64 max-w-full"
          />
        </div>
        <div className="flex justify-center py-8 text-sm text-muted-foreground">
          {searchQuery.trim() ? t('No posts match your search') : t('No posts found')}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2 px-2 mb-2">
        <ProfileSearchBar
          onSearch={setSearchQuery}
          placeholder={t('Search posts...')}
          className="w-64 max-w-full"
        />
      </div>
      {isRefreshing && (
        <div className="px-4 py-2 text-center text-sm text-green-500">🔄 {t('Refreshing posts...')}</div>
      )}
      {searchQuery.trim() && (
        <div className="px-4 py-2 text-sm text-muted-foreground">
          {t('Showing {{filtered}} of {{total}} items', {
            filtered: displayedEvents.length,
            total: mergedDisplay.length
          })}
        </div>
      )}
      <div className="space-y-2">
        {displayedEvents.map((event, index) => (
          <div key={event.id}>
            {index === filteredPins.length && filteredPins.length > 0 && filteredRest.length > 0 && (
              <div className="text-xs text-muted-foreground px-2 py-1 border-t border-border/60 mt-2 pt-2">
                {t('Feed')}
              </div>
            )}
            <NoteCard
              className="w-full"
              event={event}
              filterMutedNotes={false}
              pinned={pinnedDisplayIds.has(event.id)}
            />
          </div>
        ))}
      </div>
      {displayedEvents.length < mergedDisplay.length && (
        <div ref={bottomRef} className="flex h-10 items-center justify-center">
          <div className="text-sm text-muted-foreground">{t('Loading more...')}</div>
        </div>
      )}
    </div>
  )
})

ProfileFeedWithPins.displayName = 'ProfileFeedWithPins'

export default ProfileFeedWithPins
