import NoteCard, { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { queryService } from '@/services/client.service'
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

const SHOW_COUNT = 25
const CACHE_DURATION = 30 * 60 * 1000 // 30 minutes

let cachedCustomEvents: {
  events: Array<{ event: NostrEvent; score: number }>
  timestamp: number
} | null = null

let isInitializing = false

type SortOrder = 'newest' | 'oldest' | 'most-popular' | 'least-popular'

export default function TrendingNotes() {
  const { t } = useTranslation()
  const { isEventDeleted } = useDeletedEvent()
  const { hideUntrustedNotes, isUserTrusted } = useUserTrust()
  const { pubkey, relayList } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const { zapReplyThreshold } = useZap()
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const [sortOrder, setSortOrder] = useState<SortOrder>('most-popular')
  const [cacheEvents, setCacheEvents] = useState<NostrEvent[]>([])
  const [cacheLoading, setCacheLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const trendingRelaySource = useMemo<'favorites' | 'default'>(() => {
    if (!pubkey) return 'default'
    const hasFavorites = favoriteRelays.length > 0
    const hasRead = (relayList?.read?.length ?? 0) > 0
    if (hasFavorites || hasRead) return 'favorites'
    return 'default'
  }, [pubkey, favoriteRelays, relayList])

  const getRelays = useMemo(() => {
    const relays: string[] = []

    if (pubkey) {
      relays.push(...favoriteRelays)
      if (relayList?.read) {
        relays.push(...relayList.read)
      }
      if (relays.length === 0) {
        relays.push(...FAST_READ_RELAY_URLS)
      }
    } else {
      relays.push(...FAST_READ_RELAY_URLS)
    }

    const normalized = relays.map((url) => normalizeUrl(url)).filter((url): url is string => !!url)

    return Array.from(new Set(normalized))
  }, [pubkey, favoriteRelays, relayList])

  useEffect(() => {
    const initializeCache = async () => {
      if (isInitializing) return
      if (cacheEvents.length > 0) {
        logger.debug('[TrendingNotes] Cache already populated, skipping initialization')
        return
      }

      const now = Date.now()

      if (cachedCustomEvents && now - cachedCustomEvents.timestamp < CACHE_DURATION) {
        const allEvents = cachedCustomEvents.events.map((item) => item.event)
        logger.debug('[TrendingNotes] Using existing cache - loading', allEvents.length, 'events')
        setCacheEvents(allEvents)
        setCacheLoading(false)
        return
      }

      isInitializing = true
      setCacheLoading(true)
      const relays = getRelays

      const timeoutId = setTimeout(() => {
        logger.debug('[TrendingNotes] Cache initialization timeout - forcing completion')
        isInitializing = false
        setCacheLoading(false)
      }, 180000)

      if (relays.length === 0) {
        clearTimeout(timeoutId)
        isInitializing = false
        setCacheLoading(false)
        return
      }

      try {
        const allEvents: NostrEvent[] = []
        const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60
        const batchSize = 3
        const recentEvents: NostrEvent[] = []

        for (let i = 0; i < relays.length; i += batchSize) {
          const batch = relays.slice(i, i + batchSize)
          const batchPromises = batch.map(async (relay) => {
            try {
              const events = await queryService.fetchEvents([relay], {
                kinds: [1, 11, 30023, 9802, 20, 21, 22],
                since: twentyFourHoursAgo,
                limit: 200
              })
              return events
            } catch (error) {
              logger.warn(`[TrendingNotes] Error fetching from relay ${relay}:`, error)
              return []
            }
          })

          const batchResults = await Promise.all(batchPromises)
          recentEvents.push(...batchResults.flat())

          if (i + batchSize < relays.length) {
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
        }

        allEvents.push(...recentEvents)

        const topLevelEvents = allEvents.filter((event) => {
          const eTags = event.tags.filter((tag) => tag[0] === 'e')
          return eTags.length === 0
        })

        const filteredEvents = topLevelEvents.filter((event) => {
          const hasNsfwTag = event.tags.some(
            (tag) => tag[0] === 't' && tag[1] && tag[1].toLowerCase() === 'nsfw'
          )
          const hasSensitiveTag = event.tags.some(
            (tag) => tag[0] === 't' && tag[1] && tag[1].toLowerCase() === 'sensitive'
          )
          const hasNsfwHashtag = event.content.toLowerCase().includes('#nsfw')
          const hasContentWarning = event.tags.some((tag) => tag[0] === 'content-warning')
          const hasContentWarningL = event.tags.some(
            (tag) => tag[0] === 'L' && tag[1] && tag[1].toLowerCase() === 'content-warning'
          )
          const hasContentWarningl = event.tags.some(
            (tag) => tag[0] === 'l' && tag[1] && tag[1].toLowerCase() === 'content-warning'
          )
          return (
            !hasNsfwTag &&
            !hasSensitiveTag &&
            !hasNsfwHashtag &&
            !hasContentWarning &&
            !hasContentWarningL &&
            !hasContentWarningl
          )
        })

        const eventsNeedingStats = filteredEvents.filter((event) => !noteStatsService.getNoteStats(event.id))

        if (eventsNeedingStats.length > 0) {
          const statsBatchSize = 10
          for (let i = 0; i < eventsNeedingStats.length; i += statsBatchSize) {
            const batch = eventsNeedingStats.slice(i, i + statsBatchSize)
            await Promise.all(
              batch.map((event) => noteStatsService.fetchNoteStats(event, undefined, favoriteRelays).catch(() => {}))
            )
            if (i + statsBatchSize < eventsNeedingStats.length) {
              await new Promise((resolve) => setTimeout(resolve, 200))
            }
          }
        }

        const scoredEvents = filteredEvents.map((event) => {
          const stats = noteStatsService.getNoteStats(event.id)
          let score = 0
          if (stats?.likes) score += stats.likes.length
          if (stats?.zaps) {
            stats.zaps.forEach((zap) => {
              score += zap.amount >= zapReplyThreshold ? 8 : 1
            })
          }
          if (stats?.replies) score += stats.replies.length * 3
          if (stats?.reposts) score += stats.reposts.length * 5
          if (stats?.quotes) score += stats.quotes.length * 8
          if (stats?.highlights) score += stats.highlights.length * 10
          return { event, score }
        })

        cachedCustomEvents = {
          events: scoredEvents,
          timestamp: now
        }

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
  }, [])

  const relaysFilteredEventsAll = useMemo(() => {
    const idSet = new Set<string>()

    const filtered = cacheEvents.filter((evt) => {
      if (isEventDeleted(evt)) return false
      if (hideUntrustedNotes && !isUserTrusted(evt.pubkey)) return false
      const id = isReplaceableEvent(evt.kind) ? getReplaceableCoordinateFromEvent(evt) : evt.id
      if (idSet.has(id)) return false
      idSet.add(id)
      return true
    })

    filtered.sort((a, b) => {
      if (sortOrder === 'newest') return b.created_at - a.created_at
      if (sortOrder === 'oldest') return a.created_at - b.created_at
      if (sortOrder === 'most-popular' || sortOrder === 'least-popular') {
        const statsA = noteStatsService.getNoteStats(a.id)
        const statsB = noteStatsService.getNoteStats(b.id)
        let scoreA = 0
        let scoreB = 0
        if (statsA) {
          scoreA += statsA.likes?.length || 0
          scoreA += (statsA.replies?.length || 0) * 3
          scoreA += (statsA.reposts?.length || 0) * 5
          scoreA += (statsA.quotes?.length || 0) * 8
          scoreA += (statsA.highlights?.length || 0) * 10
          if (statsA.zaps) {
            statsA.zaps.forEach((zap) => {
              scoreA += zap.amount >= zapReplyThreshold ? 8 : 1
            })
          }
        }
        if (statsB) {
          scoreB += statsB.likes?.length || 0
          scoreB += (statsB.replies?.length || 0) * 3
          scoreB += (statsB.reposts?.length || 0) * 5
          scoreB += (statsB.quotes?.length || 0) * 8
          scoreB += (statsB.highlights?.length || 0) * 10
          if (statsB.zaps) {
            statsB.zaps.forEach((zap) => {
              scoreB += zap.amount >= zapReplyThreshold ? 8 : 1
            })
          }
        }
        return sortOrder === 'most-popular' ? scoreB - scoreA : scoreA - scoreB
      }
      return 0
    })

    return filtered
  }, [cacheEvents, hideUntrustedNotes, isEventDeleted, isUserTrusted, sortOrder, zapReplyThreshold])

  const relaysFilteredEvents = useMemo(
    () => relaysFilteredEventsAll.slice(0, showCount),
    [relaysFilteredEventsAll, showCount]
  )

  useEffect(() => {
    const totalLength = relaysFilteredEventsAll.length
    if (showCount >= totalLength) return

    const options = { root: null, rootMargin: '10px', threshold: 0.1 }
    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setShowCount((prev) => prev + SHOW_COUNT)
      }
    }, options)

    const currentBottomRef = bottomRef.current
    if (currentBottomRef) observerInstance.observe(currentBottomRef)

    return () => {
      if (currentBottomRef) observerInstance.unobserve(currentBottomRef)
    }
  }, [relaysFilteredEventsAll.length, showCount, cacheLoading])

  const headerTitle =
    trendingRelaySource === 'favorites'
      ? t('Trending on Your Favorite Relays')
      : t('Trending on the Default Relays')

  return (
    <div className="min-h-screen">
      <div className="sticky top-12 z-30 border-b bg-background">
        <div className="px-4 pb-3 pt-3">
          <h2 className="text-lg font-bold leading-tight">{headerTitle}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <span className="text-xs text-muted-foreground">{t('Sort')}:</span>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setSortOrder('newest')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                sortOrder === 'newest'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('newest')}
            </button>
            <button
              type="button"
              onClick={() => setSortOrder('oldest')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                sortOrder === 'oldest'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('oldest')}
            </button>
            <button
              type="button"
              onClick={() => setSortOrder('most-popular')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                sortOrder === 'most-popular'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('most popular')}
            </button>
            <button
              type="button"
              onClick={() => setSortOrder('least-popular')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                sortOrder === 'least-popular'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('least popular')}
            </button>
          </div>
        </div>
      </div>

      {cacheLoading && cacheEvents.length === 0 ? (
        <div className="mt-8 text-center text-sm text-muted-foreground">
          {t('Loading trending notes from your relays...')}
        </div>
      ) : null}

      {relaysFilteredEvents.map((event) => (
        <NoteCard
          key={
            isReplaceableEvent((event as NostrEvent).kind)
              ? getReplaceableCoordinateFromEvent(event as NostrEvent)
              : (event as NostrEvent).id
          }
          className="w-full"
          event={event}
        />
      ))}

      {cacheLoading || showCount < relaysFilteredEventsAll.length ? (
        <div ref={bottomRef}>
          <NoteCardLoadingSkeleton />
        </div>
      ) : (
        <div className="mt-2 text-center text-sm text-muted-foreground">{t('no more notes')}</div>
      )}
    </div>
  )
}
