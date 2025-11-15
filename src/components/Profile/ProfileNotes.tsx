import { ExtendedKind } from '@/constants'
import { Event } from 'nostr-tools'
import { forwardRef, useMemo, useEffect, useImperativeHandle, useState, useRef } from 'react'
import { useProfileNotesTimeline } from '@/hooks/useProfileNotesTimeline'
import NoteCard from '@/components/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'

const INITIAL_SHOW_COUNT = 25
const LOAD_MORE_COUNT = 25

const NOTES_KIND_LIST = [
  ExtendedKind.PUBLICATION_CONTENT, // 30041
  ExtendedKind.CITATION_INTERNAL,    // 30
  ExtendedKind.CITATION_EXTERNAL,    // 31
  ExtendedKind.CITATION_HARDCOPY,    // 32
  ExtendedKind.CITATION_PROMPT       // 33
]

interface ProfileNotesProps {
  pubkey: string
  topSpace?: number
  searchQuery?: string
  kindFilter?: string
  onEventsChange?: (events: Event[]) => void
}

const ProfileNotes = forwardRef<{ refresh: () => void; getEvents?: () => Event[] }, ProfileNotesProps>(
  ({ pubkey, topSpace, searchQuery = '', kindFilter = 'all', onEventsChange }, ref) => {
    const cacheKey = useMemo(() => `${pubkey}-notes`, [pubkey])
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [showCount, setShowCount] = useState(INITIAL_SHOW_COUNT)
    const bottomRef = useRef<HTMLDivElement>(null)

    const { events: timelineEvents, isLoading, refresh } = useProfileNotesTimeline({
      pubkey,
      cacheKey,
      kinds: NOTES_KIND_LIST,
      limit: 200,
      filterPredicate: undefined
    })

    useEffect(() => {
      onEventsChange?.(timelineEvents)
    }, [timelineEvents, onEventsChange])

    useEffect(() => {
      if (!isLoading) {
        setIsRefreshing(false)
      }
    }, [isLoading])

    useImperativeHandle(
      ref,
      () => ({
        refresh: () => {
          setIsRefreshing(true)
          refresh()
        },
        getEvents: () => timelineEvents
      }),
      [refresh, timelineEvents]
    )

    const getKindLabel = (kindValue: string) => {
      if (!kindValue || kindValue === 'all') return 'notes'
      const kindNum = parseInt(kindValue, 10)
      if (kindNum === ExtendedKind.PUBLICATION_CONTENT) return 'notes'
      if (kindNum === ExtendedKind.CITATION_INTERNAL) return 'internal citations'
      if (kindNum === ExtendedKind.CITATION_EXTERNAL) return 'external citations'
      if (kindNum === ExtendedKind.CITATION_HARDCOPY) return 'hardcopy citations'
      if (kindNum === ExtendedKind.CITATION_PROMPT) return 'prompt citations'
      return 'notes'
    }

    const eventsFilteredByKind = useMemo(() => {
      if (kindFilter === 'all') {
        return timelineEvents
      }
      const kindNumber = parseInt(kindFilter, 10)
      if (Number.isNaN(kindNumber)) {
        return timelineEvents
      }
      return timelineEvents.filter((event) => event.kind === kindNumber)
    }, [timelineEvents, kindFilter])

    const filteredEvents = useMemo(() => {
      if (!searchQuery.trim()) {
        return eventsFilteredByKind
      }
      const query = searchQuery.toLowerCase().trim()
      return eventsFilteredByKind.filter((event) => {
        const contentLower = event.content.toLowerCase()
        if (contentLower.includes(query)) return true
        return event.tags.some((tag) => {
          if (tag.length <= 1) return false
          const tagValue = tag[1]
          return tagValue && tagValue.toLowerCase().includes(query)
        })
      })
    }, [eventsFilteredByKind, searchQuery])

    // Reset showCount when filters change
    useEffect(() => {
      setShowCount(INITIAL_SHOW_COUNT)
    }, [searchQuery, kindFilter, pubkey])

    // Pagination: slice to showCount for display
    const displayedEvents = useMemo(() => {
      return filteredEvents.slice(0, showCount)
    }, [filteredEvents, showCount])

    // IntersectionObserver for infinite scroll
    useEffect(() => {
      if (!bottomRef.current || displayedEvents.length >= filteredEvents.length) return

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && displayedEvents.length < filteredEvents.length) {
            setShowCount((prev) => Math.min(prev + LOAD_MORE_COUNT, filteredEvents.length))
          }
        },
        { threshold: 0.1 }
      )

      observer.observe(bottomRef.current)

      return () => {
        observer.disconnect()
      }
    }, [displayedEvents.length, filteredEvents.length])

    if (!pubkey) {
      return (
        <div className="flex justify-center items-center py-8">
          <div className="text-sm text-muted-foreground">No profile selected</div>
        </div>
      )
    }

    if (isLoading && timelineEvents.length === 0) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )
    }

    if (!filteredEvents.length && !isLoading) {
      return (
        <div className="flex justify-center items-center py-8">
          <div className="text-sm text-muted-foreground">
            {searchQuery.trim() ? 'No notes match your search' : 'No notes found'}
          </div>
        </div>
      )
    }

    return (
      <div style={{ marginTop: topSpace || 0 }}>
        {isRefreshing && (
          <div className="px-4 py-2 text-sm text-green-500 text-center">🔄 Refreshing notes...</div>
        )}
        {(searchQuery.trim() || (kindFilter && kindFilter !== 'all')) && (
          <div className="px-4 py-2 text-sm text-muted-foreground">
            Showing {displayedEvents.length} of {filteredEvents.length} {getKindLabel(kindFilter)}
          </div>
        )}
        <div className="space-y-2">
          {displayedEvents.map((event) => (
            <NoteCard key={event.id} className="w-full" event={event} filterMutedNotes={false} />
          ))}
        </div>
        {displayedEvents.length < filteredEvents.length && (
          <div ref={bottomRef} className="h-10 flex items-center justify-center">
            <div className="text-sm text-muted-foreground">Loading more...</div>
          </div>
        )}
      </div>
    )
  }
)

ProfileNotes.displayName = 'ProfileNotes'

export default ProfileNotes

