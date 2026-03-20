import NoteCard from '@/components/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { Event, kinds } from 'nostr-tools'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState, useRef, useCallback } from 'react'
import { queryService } from '@/services/client.service'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { useZap } from '@/providers/ZapProvider'
import logger from '@/lib/logger'

const INITIAL_SHOW_COUNT = 25
const LOAD_MORE_COUNT = 25
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

type InteractionsCacheEntry = {
  events: Event[]
  lastUpdated: number
}

const interactionsCache = new Map<string, InteractionsCacheEntry>()

interface ProfileInteractionsProps {
  accountPubkey: string
  profilePubkey: string
  topSpace?: number
  searchQuery?: string
  onEventsChange?: (events: Event[]) => void
}

const ProfileInteractions = forwardRef<
  { refresh: () => void; getEvents?: () => Event[] },
  ProfileInteractionsProps
>(
  (
    {
      accountPubkey,
      profilePubkey,
      topSpace,
      searchQuery = '',
      onEventsChange
    },
    ref
  ) => {
    const { zapReplyThreshold } = useZap()
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [showCount, setShowCount] = useState(INITIAL_SHOW_COUNT)
  const [events, setEvents] = useState<Event[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshToken, setRefreshToken] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Create cache key based on account and profile pubkeys
  const cacheKey = useMemo(() => `${accountPubkey}-${profilePubkey}-${zapReplyThreshold}`, [accountPubkey, profilePubkey, zapReplyThreshold])

  const fetchInteractions = useCallback(async () => {
      // Check cache first
      const cachedEntry = interactionsCache.get(cacheKey)
      const cacheAge = cachedEntry ? Date.now() - cachedEntry.lastUpdated : Infinity
      const isCacheFresh = cacheAge < CACHE_DURATION
      
      // If cache is fresh, show it immediately
      if (isCacheFresh && cachedEntry) {
        setEvents(cachedEntry.events)
        setIsLoading(false)
        // Still fetch in background to get updates
      } else {
        setIsLoading(!cachedEntry)
      }
      try {
        const relayUrls = FAST_READ_RELAY_URLS.map(url => normalizeUrl(url) || url)
        
        // Fetch events where accountPubkey interacted with profilePubkey
        // 1. Replies: accountPubkey replied to profilePubkey's notes
        // 2. Zaps: accountPubkey zapped profilePubkey
        // 3. Mentions: accountPubkey mentioned profilePubkey
        // 4. Replies to accountPubkey: profilePubkey replied to accountPubkey's notes
        
        const filters: any[] = []
        
        // Get profilePubkey's notes to find replies to them
        const profileNotes = await queryService.fetchEvents(relayUrls, [{
          authors: [profilePubkey],
          kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.POLL, ExtendedKind.DISCUSSION],
          limit: 100
        }])
        
        const profileNoteIds = profileNotes.map(e => e.id)
        
        // Replies from accountPubkey to profilePubkey's notes
        if (profileNoteIds.length > 0) {
          filters.push({
            authors: [accountPubkey],
            kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
            '#e': profileNoteIds,
            limit: 100
          })
        }
        
        // Zaps from accountPubkey to profilePubkey
        filters.push({
          authors: [accountPubkey],
          kinds: [kinds.Zap],
          '#p': [profilePubkey],
          limit: 100
        })
        
        // Mentions: accountPubkey mentioned profilePubkey
        filters.push({
          authors: [accountPubkey],
          kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.POLL, ExtendedKind.PUBLIC_MESSAGE],
          '#p': [profilePubkey],
          limit: 100
        })
        
        // Get accountPubkey's notes to find replies from profilePubkey
        const accountNotes = await queryService.fetchEvents(relayUrls, [{
          authors: [accountPubkey],
          kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.POLL, ExtendedKind.DISCUSSION],
          limit: 100
        }])
        
        const accountNoteIds = accountNotes.map(e => e.id)
        
        // Replies from profilePubkey to accountPubkey's notes
        if (accountNoteIds.length > 0) {
          filters.push({
            authors: [profilePubkey],
            kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
            '#e': accountNoteIds,
            limit: 100
          })
        }
        
        // Zaps from profilePubkey to accountPubkey
        filters.push({
          authors: [profilePubkey],
          kinds: [kinds.Zap],
          '#p': [accountPubkey],
          limit: 100
        })
        
        // Mentions: profilePubkey mentioned accountPubkey
        filters.push({
          authors: [profilePubkey],
          kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.POLL, ExtendedKind.PUBLIC_MESSAGE],
          '#p': [accountPubkey],
          limit: 100
        })
        
        const allEvents = await queryService.fetchEvents(relayUrls, filters)
        
        // Deduplicate and filter
        const seenIds = new Set<string>()
        const uniqueEvents = allEvents.filter(event => {
          if (seenIds.has(event.id)) return false
          seenIds.add(event.id)
          
          // Filter zap receipts below threshold
          if (event.kind === ExtendedKind.ZAP_RECEIPT) {
            const zapInfo = getZapInfoFromEvent(event)
            if (!zapInfo?.amount || zapInfo.amount < zapReplyThreshold) {
              return false
            }
          }
          
          return true
        })
        
        // Sort by created_at descending
        uniqueEvents.sort((a, b) => b.created_at - a.created_at)
        
        // Update cache
        interactionsCache.set(cacheKey, {
          events: uniqueEvents,
          lastUpdated: Date.now()
        })
        
        setEvents(uniqueEvents)
      } catch (error) {
        logger.error('Failed to fetch interactions', error)
        setEvents([])
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }, [accountPubkey, profilePubkey, zapReplyThreshold, cacheKey])

    useEffect(() => {
      if (!accountPubkey || !profilePubkey) return
      fetchInteractions()
    }, [accountPubkey, profilePubkey, refreshToken, fetchInteractions])

    useEffect(() => {
      onEventsChange?.(events)
    }, [events, onEventsChange])

    useImperativeHandle(
      ref,
      () => ({
        refresh: () => {
          setIsRefreshing(true)
          // Clear cache on refresh
          interactionsCache.delete(cacheKey)
          setRefreshToken((prev) => prev + 1)
        },
        getEvents: () => events
      }),
      [events]
    )

    const filteredEvents = useMemo(() => {
      if (!searchQuery.trim()) {
        return events
      }
      const query = searchQuery.toLowerCase().trim()
      return events.filter((event) => {
        const contentLower = event.content.toLowerCase()
        if (contentLower.includes(query)) return true
        return event.tags.some((tag) => {
          if (tag.length <= 1) return false
          const tagValue = tag[1]
          return tagValue && tagValue.toLowerCase().includes(query)
        })
      })
    }, [events, searchQuery])

    // Reset showCount when filters change
    useEffect(() => {
      setShowCount(INITIAL_SHOW_COUNT)
    }, [searchQuery])

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

    if (!accountPubkey || !profilePubkey) {
      return (
        <div className="flex justify-center items-center py-8">
          <div className="text-sm text-muted-foreground">No interactions to show</div>
        </div>
      )
    }

    if (isLoading && events.length === 0) {
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
            {searchQuery.trim() ? 'No interactions match your search' : 'No interactions found'}
          </div>
        </div>
      )
    }

    return (
      <div style={{ marginTop: topSpace || 0 }}>
        {isRefreshing && (
          <div className="px-4 py-2 text-sm text-green-500 text-center">🔄 Refreshing interactions...</div>
        )}
        {searchQuery.trim() && (
          <div className="px-4 py-2 text-sm text-muted-foreground">
            Showing {displayedEvents.length} of {filteredEvents.length} interactions
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

ProfileInteractions.displayName = 'ProfileInteractions'

export default ProfileInteractions

