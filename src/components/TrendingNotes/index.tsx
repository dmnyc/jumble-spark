import NoteCard, { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import { ExtendedKind } from '@/constants'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import client from '@/services/client.service'
import { NostrEvent } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useZap } from '@/providers/ZapProvider'
import noteStatsService from '@/services/note-stats.service'
import { FAST_READ_RELAY_URLS } from '@/constants'
import logger from '@/lib/logger'
import { normalizeUrl } from '@/lib/url'
import { getCalendarEventMeta } from '@/lib/calendar-event'

const SHOW_COUNT = 25
const CACHE_DURATION = 30 * 60 * 1000 // 30 minutes

// Unified cache for all custom trending feeds
let cachedCustomEvents: {
  events: Array<{ event: NostrEvent; score: number }>
  timestamp: number
  hashtags: string[]
} | null = null

// Flag to prevent concurrent initialization
let isInitializing = false

type TrendingTab = 'relays' | 'hashtags' | 'calendar'
type SortOrder = 'newest' | 'oldest' | 'most-popular' | 'least-popular'
type HashtagFilter = 'popular'

/** Sort key for calendar events: time-based use start (unix), date-based use startDate as timestamp. */
function calendarEventSortKey(evt: NostrEvent): number {
  const meta = getCalendarEventMeta(evt as any)
  if (meta.start != null && !isNaN(meta.start)) return meta.start
  if (meta.startDate) return new Date(meta.startDate + 'T00:00:00').getTime() / 1000
  return evt.created_at
}

const CALENDAR_MONTHS_AHEAD = 6

/** YYYY-MM for grouping; derived from calendar event start. */
function calendarEventMonthKey(evt: NostrEvent): string {
  const ts = calendarEventSortKey(evt)
  const d = new Date(ts * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** Filter calendar events: from start of today (or 1 month ago if in past) through the next CALENDAR_MONTHS_AHEAD months. */
function filterCalendarEventsToNextMonths(events: NostrEvent[], monthsAhead: number): NostrEvent[] {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const oneMonthAgo = new Date(startOfToday)
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
  const minSec = Math.floor(oneMonthAgo.getTime() / 1000)
  const end = new Date()
  end.setMonth(end.getMonth() + monthsAhead)
  const endSec = Math.floor(end.getTime() / 1000)
  return events.filter((evt) => {
    const k = calendarEventSortKey(evt)
    return k >= minSec && k <= endSec
  })
}

export default function TrendingNotes() {
  const { t } = useTranslation()
  const { isEventDeleted } = useDeletedEvent()
  const { hideUntrustedNotes, isUserTrusted } = useUserTrust()
  const { pubkey, relayList } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const { zapReplyThreshold } = useZap()
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const [activeTab, setActiveTab] = useState<TrendingTab>('relays')
  const [sortOrder, setSortOrder] = useState<SortOrder>('most-popular')
  const [hashtagFilter] = useState<HashtagFilter>('popular')
  const [selectedHashtag, setSelectedHashtag] = useState<string | null>(null)
  const [popularHashtags, setPopularHashtags] = useState<string[]>([])
  const [cacheEvents, setCacheEvents] = useState<NostrEvent[]>([])
  const [cacheLoading, setCacheLoading] = useState(false)
  const [calendarEvents, setCalendarEvents] = useState<NostrEvent[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Listen for tab restoration from PageManager
  useEffect(() => {
    const handleRestore = (e: CustomEvent<{ page: string, tab: string }>) => {
      if (e.detail.page === 'search' && e.detail.tab && ['relays', 'hashtags', 'calendar'].includes(e.detail.tab)) {
        setActiveTab(e.detail.tab as TrendingTab)
      }
    }
    window.addEventListener('restorePageTab', handleRestore as EventListener)
    return () => window.removeEventListener('restorePageTab', handleRestore as EventListener)
  }, [])

  // Debug: Track cacheEvents changes
  useEffect(() => {
    logger.debug('[TrendingNotes] cacheEvents state changed:', cacheEvents.length, 'events')
  }, [cacheEvents])

  // Debug: Track cacheLoading changes
  useEffect(() => {
    logger.debug('[TrendingNotes] cacheLoading state changed:', cacheLoading)
  }, [cacheLoading])




  // Calculate popular hashtags from cache events (all events from relays)
  const calculatePopularHashtags = useMemo(() => {
    logger.debug('[TrendingNotes] calculatePopularHashtags - cacheEvents.length:', cacheEvents.length)
    
    const eventsToAnalyze = cacheEvents
    
    if (eventsToAnalyze.length === 0) {
      return []
    }
    
    const hashtagCounts = new Map<string, number>()
    let eventsWithHashtags = 0
    
    eventsToAnalyze.forEach((event) => {
      let hasAnyHashtag = false
      
      // Count hashtags from 't' tags
      event.tags.forEach(tag => {
        if (tag[0] === 't' && tag[1]) {
          const hashtag = tag[1].toLowerCase()
          hashtagCounts.set(hashtag, (hashtagCounts.get(hashtag) || 0) + 1)
          hasAnyHashtag = true
        }
      })
      
      // Count hashtags from content (simple regex for #hashtag)
      const contentHashtags = event.content.match(/#[a-zA-Z0-9_]+/g)
      if (contentHashtags) {
        contentHashtags.forEach(hashtag => {
          const cleanHashtag = hashtag.slice(1).toLowerCase() // Remove #
          hashtagCounts.set(cleanHashtag, (hashtagCounts.get(cleanHashtag) || 0) + 1)
          hasAnyHashtag = true
        })
      }
      
      if (hasAnyHashtag) eventsWithHashtags++
    })
    
    // Sort by count and return top 10
    const result = Array.from(hashtagCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([hashtag]) => hashtag)
    
    logger.debug('[TrendingNotes] calculatePopularHashtags - found hashtags:', result)
    logger.debug('[TrendingNotes] calculatePopularHashtags - eventsWithHashtags:', eventsWithHashtags)
    
    return result
  }, [cacheEvents, activeTab, hashtagFilter, pubkey])

  // Get relays based on user login status
  const getRelays = useMemo(() => {
    const relays: string[] = []

    if (pubkey) {
      // User is logged in: favorite relays + inboxes (read relays)
      relays.push(...favoriteRelays)
      if (relayList?.read) {
        relays.push(...relayList.read)
      }
      
      // If user has no favorites and no read relays, fallback to FAST_READ_RELAY_URLS
      if (relays.length === 0) {
        relays.push(...FAST_READ_RELAY_URLS)
      }
    } else {
      // User is not logged in: use FAST_READ_RELAY_URLS (includes all BIG_RELAY_URLS)
      relays.push(...FAST_READ_RELAY_URLS)
    }

    // Normalize and deduplicate
    const normalized = relays
      .map(url => normalizeUrl(url))
      .filter((url): url is string => !!url)
    
    return Array.from(new Set(normalized))
  }, [pubkey, favoriteRelays, relayList])

  // Update popular hashtags when trending notes change
  useEffect(() => {
    logger.debug('[TrendingNotes] calculatePopularHashtags result:', calculatePopularHashtags)
    setPopularHashtags(calculatePopularHashtags)
  }, [calculatePopularHashtags])

  // Initialize cache only once on mount
  useEffect(() => {
    const initializeCache = async () => {
      // Prevent concurrent initialization
      if (isInitializing) {
        return
      }
      
      // Prevent re-initialization if cache is already populated
      if (cacheEvents.length > 0) {
        logger.debug('[TrendingNotes] Cache already populated, skipping initialization')
        return
      }
      
      const now = Date.now()
      
      // Check if cache is still valid
      if (cachedCustomEvents && (now - cachedCustomEvents.timestamp) < CACHE_DURATION) {
        // If cache is valid, set cacheEvents to ALL events from cache
        const allEvents = cachedCustomEvents.events.map(item => item.event)
        logger.debug('[TrendingNotes] Using existing cache - loading', allEvents.length, 'events')
        setCacheEvents(allEvents)
        setCacheLoading(false) // Ensure loading state is cleared
        return
      }

      isInitializing = true
      setCacheLoading(true)
      const relays = getRelays // Get current relays value
      
      // Set a timeout to prevent infinite loading
      const timeoutId = setTimeout(() => {
        logger.debug('[TrendingNotes] Cache initialization timeout - forcing completion')
        isInitializing = false
        setCacheLoading(false)
      }, 180000) // 3 minute timeout
      
      // Prevent running if we have no relays
      if (relays.length === 0) {
        logger.debug('[TrendingNotes] No relays available, skipping cache initialization')
        clearTimeout(timeoutId)
        isInitializing = false
        setCacheLoading(false)
        return
      }

      try {
        const allEvents: NostrEvent[] = []
        const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60
        
        logger.debug('[TrendingNotes] Starting cache initialization with', relays.length, 'relays:', relays)
        
        // 1. Fetch top-level posts from last 24 hours from ALL relays for comprehensive statistics
        // Relay list: If user logged in = favoriteRelays + user's read relays (fallback to FAST_READ_RELAY_URLS), else = FAST_READ_RELAY_URLS
        const batchSize = 3 // Process 3 relays at a time
        const recentEvents: NostrEvent[] = []
        
        logger.debug('[TrendingNotes] Using full relay set for comprehensive statistics:', relays.length, 'relays')
        logger.debug('[TrendingNotes] Relay source:', pubkey ? 'user favorites + read relays (or FAST_READ_RELAY_URLS fallback)' : 'FAST_READ_RELAY_URLS')
        
        for (let i = 0; i < relays.length; i += batchSize) {
          const batch = relays.slice(i, i + batchSize)
          logger.debug('[TrendingNotes] Processing batch', Math.floor(i/batchSize) + 1, 'of', Math.ceil(relays.length/batchSize), 'relays:', batch)
          const batchPromises = batch.map(async (relay) => {
            try {
              const events = await client.fetchEvents([relay], {
                kinds: [1, 11, 30023, 9802, 20, 21, 22],
                since: twentyFourHoursAgo,
                limit: 200
              })
              logger.debug('[TrendingNotes] Fetched', events.length, 'events from relay', relay)
              return events
            } catch (error) {
              logger.warn(`[TrendingNotes] Error fetching from relay ${relay}:`, error)
              return []
            }
          })
          
          const batchResults = await Promise.all(batchPromises)
          const batchEvents = batchResults.flat()
          recentEvents.push(...batchEvents)
          logger.debug('[TrendingNotes] Batch completed, total events so far:', recentEvents.length)
          
          // Add a small delay between batches to be respectful to relays
          if (i + batchSize < relays.length) {
            await new Promise(resolve => setTimeout(resolve, 200))
          }
        }
        
        allEvents.push(...recentEvents)



        // Filter for top-level posts only (no replies or quotes)
        const topLevelEvents = allEvents.filter(event => {
          const eTags = event.tags.filter(t => t[0] === 'e')
          return eTags.length === 0
        })

        // Filter out NSFW content and content warnings
        const filteredEvents = topLevelEvents.filter(event => {
          // Check for NSFW in 't' tags
          const hasNsfwTag = event.tags.some(tag => 
            tag[0] === 't' && tag[1] && tag[1].toLowerCase() === 'nsfw'
          )
          
          // Check for sensitive content tag
          const hasSensitiveTag = event.tags.some(tag => 
            tag[0] === 't' && tag[1] && tag[1].toLowerCase() === 'sensitive'
          )
          
          // Check for #NSFW hashtag in content
          const hasNsfwHashtag = event.content.toLowerCase().includes('#nsfw')
          
          // Check for content-warning tag (NIP-36)
          const hasContentWarning = event.tags.some(tag => 
            tag[0] === 'content-warning'
          )
          
          // Check for L tag with content-warning namespace
          const hasContentWarningL = event.tags.some(tag => 
            tag[0] === 'L' && tag[1] && tag[1].toLowerCase() === 'content-warning'
          )
          
          // Check for l tag with content-warning namespace
          const hasContentWarningl = event.tags.some(tag => 
            tag[0] === 'l' && tag[1] && tag[1].toLowerCase() === 'content-warning'
          )
          
          // Filter out if any NSFW or content warning indicators are found
          return !hasNsfwTag && !hasSensitiveTag && !hasNsfwHashtag && 
                 !hasContentWarning && !hasContentWarningL && !hasContentWarningl
        })

        // Fetch stats for events in batches with longer delays
        const eventsNeedingStats = filteredEvents.filter(event => !noteStatsService.getNoteStats(event.id))
        logger.debug('[TrendingNotes] Need to fetch stats for', eventsNeedingStats.length, 'events')
        
        if (eventsNeedingStats.length > 0) {
          const batchSize = 10 // Increased batch size to speed up
          const totalBatches = Math.ceil(eventsNeedingStats.length / batchSize)
          logger.debug('[TrendingNotes] Fetching stats in', totalBatches, 'batches')
          
          for (let i = 0; i < eventsNeedingStats.length; i += batchSize) {
            const batch = eventsNeedingStats.slice(i, i + batchSize)
            const batchNum = Math.floor(i / batchSize) + 1
            logger.debug('[TrendingNotes] Fetching stats batch', batchNum, 'of', totalBatches)
            
            await Promise.all(batch.map(event => 
              noteStatsService.fetchNoteStats(event, undefined, favoriteRelays).catch(() => {})
            ))
            
            if (i + batchSize < eventsNeedingStats.length) {
              await new Promise(resolve => setTimeout(resolve, 200)) // Reduced delay
            }
          }
          logger.debug('[TrendingNotes] Stats fetching completed')
        }

        // Score events
        logger.debug('[TrendingNotes] Scoring', filteredEvents.length, 'events')
        const scoredEvents = filteredEvents.map((event) => {
          const stats = noteStatsService.getNoteStats(event.id)
          let score = 0

          if (stats?.likes) score += stats.likes.length
          if (stats?.zaps) {
            // Superzaps (above threshold) count as quotes (8 points)
            // Regular zaps count as reactions (1 point)
            stats.zaps.forEach(zap => {
              if (zap.amount >= zapReplyThreshold) {
                score += 8 // Superzap
              } else {
                score += 1 // Regular zap
              }
            })
          }
          if (stats?.replies) score += stats.replies.length * 3
          if (stats?.reposts) score += stats.reposts.length * 5
          if (stats?.quotes) score += stats.quotes.length * 8
          if (stats?.highlights) score += stats.highlights.length * 10

          return { event, score }
        })

        // Update cache
        logger.debug('[TrendingNotes] Updating cache with', scoredEvents.length, 'scored events')
        cachedCustomEvents = {
          events: scoredEvents,
          timestamp: now,
          hashtags: []
        }

        // Store ALL events from the cache for hashtag analysis
        // This includes all events from relays, not just the trending ones
        logger.debug('[TrendingNotes] Cache initialization complete - storing', filteredEvents.length, 'events')
        setCacheEvents(filteredEvents)
      } catch (error) {
        logger.error('[TrendingNotes] Error initializing cache:', error)
      } finally {
        clearTimeout(timeoutId)
        isInitializing = false
        setCacheLoading(false)
      }
    }

    initializeCache()
     
  }, []) // Only run once on mount to prevent infinite loop

  // Fetch calendar events when calendar tab is active. Use same filters as profile/notifications: by author and by invitee (#p).
  useEffect(() => {
    if (activeTab !== 'calendar') return
    const userRelays = getRelays ?? []
    const relaySet = new Set<string>([
      ...userRelays.map((url) => normalizeUrl(url) || url).filter(Boolean),
      ...FAST_READ_RELAY_URLS.map((url) => normalizeUrl(url) || url).filter(Boolean)
    ])
    if (relayList?.write?.length) {
      relayList.write.forEach((url) => {
        const u = normalizeUrl(url)
        if (u) relaySet.add(u)
      })
    }
    const relays = Array.from(relaySet)
    if (relays.length === 0) {
      setCalendarLoading(false)
      return
    }
    let cancelled = false
    setCalendarLoading(true)
    const run = async () => {
      try {
        const calendarKinds = [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME]
        // Same query pattern as profile timeline: events you created + events you're invited to. Relays respond to these; global kind-only often returns nothing.
        const filters = pubkey
          ? [
              { kinds: calendarKinds, authors: [pubkey], limit: 100 },
              { kinds: calendarKinds, '#p': [pubkey], limit: 100 }
            ]
          : [{ kinds: calendarKinds, limit: 200 }]
        const events = await client.fetchEvents(relays, filters, {
          eoseTimeout: 8000,
          globalTimeout: 20000
        })
        if (cancelled) return
        const seen = new Set<string>()
        const deduped: NostrEvent[] = []
        events.forEach((evt) => {
          const id = isReplaceableEvent((evt as any).kind) ? getReplaceableCoordinateFromEvent(evt as any) : (evt as any).id
          if (!seen.has(id)) {
            seen.add(id)
            deduped.push(evt)
          }
        })
        const inRange = filterCalendarEventsToNextMonths(deduped, CALENDAR_MONTHS_AHEAD)
        inRange.sort((a, b) => calendarEventSortKey(a) - calendarEventSortKey(b))
        setCalendarEvents(inRange)
      } catch (e) {
        if (!cancelled) setCalendarEvents([])
      } finally {
        if (!cancelled) setCalendarLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [activeTab, getRelays, relayList?.write, pubkey])

  // Compute filtered events without slicing (for pagination length check)
  const relaysFilteredEventsAll = useMemo(() => {
    const idSet = new Set<string>()
    const sourceEvents = cacheEvents

    const filtered = sourceEvents.filter((evt) => {
      if (isEventDeleted(evt)) return false
      if (hideUntrustedNotes && !isUserTrusted(evt.pubkey)) return false

      // Filter based on active tab
      if (activeTab === 'hashtags') {
        if (hashtagFilter === 'popular') {
          // Check if event has any hashtags (either in 't' tags or content)
          const eventHashtags = evt.tags
            .filter(tag => tag[0] === 't' && tag[1])
            .map(tag => tag[1].toLowerCase())
          const contentHashtags = evt.content.match(/#[a-zA-Z0-9_]+/g)?.map(h => h.slice(1).toLowerCase()) || []
          const allHashtags = [...eventHashtags, ...contentHashtags]
          
          // Only show events that have at least one hashtag
          if (allHashtags.length === 0) return false
          
          if (selectedHashtag) {
            // Filter by selected popular hashtag - only show events that contain this specific hashtag
            if (!allHashtags.includes(selectedHashtag.toLowerCase())) return false
          }
        }
      }
      
      // Deduplicate events
      const id = isReplaceableEvent(evt.kind) ? getReplaceableCoordinateFromEvent(evt) : evt.id
      if (idSet.has(id)) {
        return false
      }
      idSet.add(id)
      return true
    })

    // Apply sorting
    filtered.sort((a, b) => {
      if (sortOrder === 'newest') {
        return b.created_at - a.created_at
      } else if (sortOrder === 'oldest') {
        return a.created_at - b.created_at
      } else if (sortOrder === 'most-popular' || sortOrder === 'least-popular') {
        const statsA = noteStatsService.getNoteStats(a.id)
        const statsB = noteStatsService.getNoteStats(b.id)
        
        let scoreA = 0
        let scoreB = 0
        
        if (statsA) {
          scoreA += (statsA.likes?.length || 0)
          scoreA += (statsA.replies?.length || 0) * 3
          scoreA += (statsA.reposts?.length || 0) * 5
          scoreA += (statsA.quotes?.length || 0) * 8
          scoreA += (statsA.highlights?.length || 0) * 10
          if (statsA.zaps) {
            statsA.zaps.forEach(zap => {
              scoreA += zap.amount >= zapReplyThreshold ? 8 : 1
            })
          }
        }
        
        if (statsB) {
          scoreB += (statsB.likes?.length || 0)
          scoreB += (statsB.replies?.length || 0) * 3
          scoreB += (statsB.reposts?.length || 0) * 5
          scoreB += (statsB.quotes?.length || 0) * 8
          scoreB += (statsB.highlights?.length || 0) * 10
          if (statsB.zaps) {
            statsB.zaps.forEach(zap => {
              scoreB += zap.amount >= zapReplyThreshold ? 8 : 1
            })
          }
        }
        
        return sortOrder === 'most-popular' ? scoreB - scoreA : scoreA - scoreB
      }
      
      return 0
    })

    return filtered
  }, [
    cacheEvents,
    hideUntrustedNotes,
    isEventDeleted,
    isUserTrusted,
    activeTab,
    hashtagFilter,
    selectedHashtag,
    sortOrder,
    zapReplyThreshold
  ])

  // Slice to showCount for display
  const relaysFilteredEvents = useMemo(() => {
    return relaysFilteredEventsAll.slice(0, showCount)
  }, [relaysFilteredEventsAll, showCount])

  // For calendar tab: group events by month (YYYY-MM), months in order; for others use relays
  const calendarEventsByMonth = useMemo(() => {
    const byMonth = new Map<string, NostrEvent[]>()
    calendarEvents.forEach((evt) => {
      const key = calendarEventMonthKey(evt)
      if (!byMonth.has(key)) byMonth.set(key, [])
      byMonth.get(key)!.push(evt)
    })
    byMonth.forEach((list) => list.sort((a, b) => calendarEventSortKey(a) - calendarEventSortKey(b)))
    const monthKeys = Array.from(byMonth.keys()).sort()
    return { monthKeys, byMonth }
  }, [calendarEvents])

  const filteredEvents = useMemo(() => {
    if (activeTab === 'calendar') {
      return calendarEvents.slice(0, showCount)
    }
    return relaysFilteredEvents
  }, [activeTab, calendarEvents, relaysFilteredEvents, showCount])



  // Reset showCount when tab changes
  useEffect(() => {
    setShowCount(SHOW_COUNT)
  }, [activeTab])

  // Reset filters when switching tabs
  useEffect(() => {
    if (activeTab === 'relays') {
      setSortOrder('most-popular')
      // If cache is empty and not loading, log the issue for debugging
      if (cacheEvents.length === 0 && !cacheLoading && !isInitializing) {
        logger.debug('[TrendingNotes] Relays tab selected but cache is empty - this should not happen if cache initialization completed')
      }
    } else if (activeTab === 'hashtags') {
      setSortOrder('most-popular')
      setSelectedHashtag(null)
    }
  }, [activeTab, pubkey, cacheEvents.length, cacheLoading])


  useEffect(() => {
    const totalLength = relaysFilteredEventsAll.length

    if (showCount >= totalLength) return

    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 0.1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setShowCount((prev) => prev + SHOW_COUNT)
      }
    }, options)

    const currentBottomRef = bottomRef.current

    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [relaysFilteredEventsAll.length, showCount, cacheLoading])

  return (
    <div className="min-h-screen">
      <div className="sticky top-12 bg-background z-30 border-b">
        <div className="h-12 px-4 flex flex-col justify-center text-lg font-bold">
          {t('Trending Notes')}
        </div>
        <div className="flex items-center gap-2 px-4 pb-2">
          <span className="text-sm font-medium text-muted-foreground">Trending:</span>
          <div className="flex gap-1">
            <button
              onClick={() => {
                setActiveTab('relays')
                window.dispatchEvent(new CustomEvent('pageTabChanged', { 
                  detail: { page: 'search', tab: 'relays' } 
                }))
              }}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === 'relays'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              }`}
            >
              on your relays
            </button>
            <button
              onClick={() => {
                setActiveTab('hashtags')
                window.dispatchEvent(new CustomEvent('pageTabChanged', { 
                  detail: { page: 'search', tab: 'hashtags' } 
                }))
              }}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === 'hashtags'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              }`}
            >
              hashtags
            </button>
            <button
              onClick={() => {
                setActiveTab('calendar')
                window.dispatchEvent(new CustomEvent('pageTabChanged', { 
                  detail: { page: 'search', tab: 'calendar' } 
                }))
              }}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === 'calendar'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              }`}
            >
              {t('calendar entries')}
            </button>
          </div>
        </div>
        
        {/* Second row controls for relays / hashtags (calendar has no sort – ordered by datetime) */}
        {(activeTab === 'relays' || activeTab === 'hashtags') && (
          <div className="flex items-center gap-4 px-4 pb-2">
            {/* Sorting controls - not shown for hashtags tab */}
            {activeTab !== 'hashtags' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Sort:</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setSortOrder('newest')}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      sortOrder === 'newest'
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-muted/50 hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    newest
                  </button>
                  <button
                    onClick={() => setSortOrder('oldest')}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      sortOrder === 'oldest'
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-muted/50 hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    oldest
                  </button>
                  <button
                    onClick={() => setSortOrder('most-popular')}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      sortOrder === 'most-popular'
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-muted/50 hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    most popular
                  </button>
                  <button
                    onClick={() => setSortOrder('least-popular')}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      sortOrder === 'least-popular'
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-muted/50 hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    least popular
                  </button>
                </div>
              </div>
            )}


          </div>
        )}



        {/* Popular hashtag buttons for hashtags tab */}
        {activeTab === 'hashtags' && hashtagFilter === 'popular' && popularHashtags.length > 0 && (
          <div className="flex items-center gap-2 px-4 pb-2">
            <span className="text-xs text-muted-foreground">Popular hashtags:</span>
            <div className="flex gap-1 flex-wrap">
              {popularHashtags.map((hashtag) => (
                <button
                  key={hashtag}
                  onClick={() => setSelectedHashtag(selectedHashtag === hashtag ? null : hashtag)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    selectedHashtag === hashtag
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 hover:bg-muted text-muted-foreground'
                  }`}
                >
                  #{hashtag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Show loading message for relays tab when cache is loading */}
      {activeTab === 'relays' && cacheLoading && cacheEvents.length === 0 && (
        <div className="text-center text-sm text-muted-foreground mt-8">
          Loading trending notes from your relays...
        </div>
      )}
      {/* Show loading message for calendar tab */}
      {activeTab === 'calendar' && calendarLoading && calendarEvents.length === 0 && (
        <div className="text-center text-sm text-muted-foreground mt-8">
          {t('Loading calendar events...')}
        </div>
      )}
      {activeTab === 'calendar' && !calendarLoading && calendarEvents.length === 0 && (
        <div className="text-center text-sm text-muted-foreground mt-8">
          {t('No calendar events found')}
        </div>
      )}
      
      {activeTab === 'calendar'
        ? calendarEventsByMonth.monthKeys.map((monthKey) => {
            const eventsInMonth = calendarEventsByMonth.byMonth.get(monthKey) ?? []
            const [y, m] = monthKey.split('-')
            const monthLabel = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric'
            })
            return (
              <div key={monthKey} className="mt-6 first:mt-0">
                <h3 className="text-sm font-semibold text-muted-foreground px-4 py-2 border-b bg-muted/30">
                  {monthLabel}
                </h3>
                <div className="space-y-0">
                  {eventsInMonth.map((event) => (
                    <NoteCard
                      key={isReplaceableEvent((event as any).kind) ? getReplaceableCoordinateFromEvent(event as any) : (event as any).id}
                      className="w-full"
                      event={event}
                    />
                  ))}
                </div>
              </div>
            )
          })
        : filteredEvents.map((event) => (
            <NoteCard
              key={isReplaceableEvent((event as any).kind) ? getReplaceableCoordinateFromEvent(event as any) : (event as any).id}
              className="w-full"
              event={event}
            />
          ))}

      {(() => {
        const actualAvailableLength = activeTab === 'calendar' ? calendarEvents.length : relaysFilteredEventsAll.length
        const isLoading = activeTab === 'relays' ? cacheLoading : activeTab === 'calendar' ? calendarLoading : false
        const calendarShowingAll = activeTab === 'calendar' && !calendarLoading

        const shouldShowLoading =
          isLoading ||
          (activeTab !== 'calendar' && showCount < actualAvailableLength)

        if (shouldShowLoading) {
          return (
            <div ref={bottomRef}>
              <NoteCardLoadingSkeleton />
            </div>
          )
        }
        if (calendarShowingAll && calendarEvents.length > 0) {
          return (
            <div className="text-center text-sm text-muted-foreground mt-4 pb-4">
              {t('Calendar events in the next {{count}} months', { count: CALENDAR_MONTHS_AHEAD })}
            </div>
          )
        }
        return <div className="text-center text-sm text-muted-foreground mt-2">{t('no more notes')}</div>
      })()}
    </div>
  )
}
