import { ExtendedKind, NOTIFICATION_LIST_STYLE, FAST_READ_RELAY_URLS } from '@/constants'
import { compareEvents } from '@/lib/event'
import logger from '@/lib/logger'
import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import noteStatsService from '@/services/note-stats.service'
import { TNotificationType } from '@/types'
import dayjs from 'dayjs'
import { NostrEvent, kinds, matchFilter } from 'nostr-tools'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from 'react-simple-pull-to-refresh'
import { NotificationItem } from './NotificationItem'
import { NotificationSkeleton } from './NotificationItem/Notification'
import { isTouchDevice } from '@/lib/utils'
const LIMIT = 500 // Increased from 100 to load more notifications per request
const SHOW_COUNT = 50 // Increased from 30 to show more notifications at once

const NotificationList = forwardRef(
  (
    {
      notificationType
    }: {
      notificationType: TNotificationType
    },
    ref
  ) => {
  const { t } = useTranslation()
  const { current, display } = usePrimaryPage()
  const active = useMemo(() => current === 'notifications' && display, [current, display])
  const { pubkey, relayList } = useNostr()
  const { notificationListStyle } = useUserPreferences()
  const { favoriteRelays } = useFavoriteRelays()
  const [refreshCount, setRefreshCount] = useState(0)
  const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState<NostrEvent[]>([])
  const [visibleNotifications, setVisibleNotifications] = useState<NostrEvent[]>([])
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const [until, setUntil] = useState<number | undefined>(dayjs().unix())
  const supportTouch = useMemo(() => isTouchDevice(), [])
  const topRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const consecutiveEmptyRef = useRef(0) // Track consecutive empty results to prevent premature stopping
  const filterKinds = useMemo(() => {
    switch (notificationType) {
      case 'mentions':
        return [
          kinds.ShortTextNote,
          ExtendedKind.COMMENT,
          ExtendedKind.VOICE_COMMENT,
          ExtendedKind.POLL,
          ExtendedKind.PUBLIC_MESSAGE,
          11 // Discussion threads
        ]
      case 'reactions':
        return [kinds.Reaction, kinds.Repost, ExtendedKind.POLL_RESPONSE]
      case 'zaps':
        return [kinds.Zap]
      default:
        return [
          kinds.ShortTextNote,
          kinds.Repost,
          kinds.Reaction,
          kinds.Zap,
          ExtendedKind.COMMENT,
          ExtendedKind.POLL_RESPONSE,
          ExtendedKind.VOICE_COMMENT,
          ExtendedKind.POLL,
          ExtendedKind.PUBLIC_MESSAGE,
          11 // Discussion threads
        ]
    }
  }, [notificationType])
  useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        if (loading) return
        setRefreshCount((count) => count + 1)
      }
    }),
    [loading]
  )

  // Reset visible count when tab changes (parent owns tab state)
  useEffect(() => {
    setShowCount(SHOW_COUNT)
  }, [notificationType])

  // Batch stats updates to avoid calling updateNoteStatsByEvents for every single event
  const pendingStatsEventsRef = useRef<NostrEvent[]>([])
  const statsBatchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const flushStatsBatch = useCallback(() => {
    if (pendingStatsEventsRef.current.length > 0) {
      noteStatsService.updateNoteStatsByEvents(pendingStatsEventsRef.current)
      pendingStatsEventsRef.current = []
    }
    if (statsBatchTimeoutRef.current) {
      clearTimeout(statsBatchTimeoutRef.current)
      statsBatchTimeoutRef.current = null
    }
  }, [])

  const handleNewEvent = useCallback(
    (event: NostrEvent) => {
      if (event.pubkey === pubkey) return
      setNotifications((oldEvents) => {
        // Check if event already exists
        const existingIndex = oldEvents.findIndex((oldEvent) => oldEvent.id === event.id)
        if (existingIndex !== -1) {
          return oldEvents // Already exists, don't update
        }
        
        const index = oldEvents.findIndex((oldEvent) => compareEvents(oldEvent, event) <= 0)
        
        // Batch stats updates instead of calling for each event
        pendingStatsEventsRef.current.push(event)
        if (!statsBatchTimeoutRef.current) {
          statsBatchTimeoutRef.current = setTimeout(flushStatsBatch, 500) // Batch every 500ms
        }
        
        if (index === -1) {
          return [...oldEvents, event]
        }
        return [...oldEvents.slice(0, index), event, ...oldEvents.slice(index)]
      })
    },
    [pubkey, flushStatsBatch]
  )

  useEffect(() => {
    if (current !== 'notifications') return

    if (!pubkey) {
      setUntil(undefined)
      return
    }

    const init = async () => {
      setLoading(true)
      setNotifications([])
      setShowCount(SHOW_COUNT)
      // Use proper fallback hierarchy: user's read/inbox relays → favorite relays → fast read relays
      const userRelayList = relayList || { read: [], write: [] }
      const userReadRelays = userRelayList.read || []
      const userFavoriteRelays = favoriteRelays || []
      
      // Build relay list with proper fallback hierarchy
      let primaryRelays: string[] = []
      
      if (userReadRelays.length > 0) {
        // Priority 1: User's read/inbox relays (kind 10002)
        primaryRelays = userReadRelays.slice(0, 5)
        logger.component('NotificationList', 'Using user read relays', { 
          count: primaryRelays.length, 
          relays: primaryRelays.slice(0, 3) // Show first 3 for brevity
        })
      } else if (userFavoriteRelays.length > 0) {
        // Priority 2: User's favorite relays (kind 10012)
        primaryRelays = userFavoriteRelays.slice(0, 5)
        logger.component('NotificationList', 'Using user favorite relays', { 
          count: primaryRelays.length, 
          relays: primaryRelays.slice(0, 3) // Show first 3 for brevity
        })
      } else {
        // Priority 3: Fast read relays (reliable defaults)
        primaryRelays = FAST_READ_RELAY_URLS.slice(0, 5)
        logger.component('NotificationList', 'Using fast read relays fallback', { 
          count: primaryRelays.length, 
          relays: primaryRelays.slice(0, 3) // Show first 3 for brevity
        })
      }

      // Create a single optimized subscription for all notification types
      const subscriptions = [{
        urls: primaryRelays,
        filter: {
          kinds: filterKinds,
          limit: LIMIT,
          '#p': [pubkey] // Always filter for mentions to the current user
        }
      }]

      const { closer, timelineKey } = await client.subscribeTimeline(
        subscriptions,
        {
          onEvents: (events, eosed) => {
            if (events.length > 0) {
              setNotifications(events.filter((event) => event.pubkey !== pubkey))
            }
            if (eosed) {
              setLoading(false)
              setUntil(events.length > 0 ? events[events.length - 1].created_at - 1 : undefined)
              // Batch stats update for initial load - only process events that don't have stats yet
              // This avoids redundant processing since updateNoteStatsByEvents is idempotent but still expensive
              if (events.length > 0) {
                noteStatsService.updateNoteStatsByEvents(events)
              }
            }
          },
          onNew: (event) => {
            handleNewEvent(event)
          }
        },
        {
          useCache: false // Notifications should always fetch fresh from relays, not use cache
        }
      )
      setTimelineKey(timelineKey)
      return closer
    }

    const promise = init()
    return () => {
      promise.then((closer) => closer?.())
      // Clean up stats batch timeout on unmount
      if (statsBatchTimeoutRef.current) {
        clearTimeout(statsBatchTimeoutRef.current)
        statsBatchTimeoutRef.current = null
      }
      flushStatsBatch() // Flush any pending stats updates
      consecutiveEmptyRef.current = 0 // Reset counter on refresh
    }
  }, [pubkey, refreshCount, filterKinds, current, flushStatsBatch])

  useEffect(() => {
    if (!active || !pubkey) return

    const handler = (data: Event) => {
      const customEvent = data as CustomEvent<NostrEvent>
      const evt = customEvent.detail
      if (
        matchFilter(
          {
            kinds: filterKinds,
            '#p': [pubkey]
          },
          evt
        )
      ) {
        handleNewEvent(evt)
      }
    }

    client.addEventListener('newEvent', handler)
    return () => {
      client.removeEventListener('newEvent', handler)
    }
  }, [pubkey, active, filterKinds, handleNewEvent])

  useEffect(() => {
    setVisibleNotifications(notifications.slice(0, showCount))
  }, [notifications, showCount])

  // Use refs to avoid infinite loops from dependency changes
  const notificationsRef = useRef(notifications)
  const showCountRef = useRef(showCount)
  const loadingRef = useRef(loading)
  
  useEffect(() => {
    notificationsRef.current = notifications
  }, [notifications])
  
  useEffect(() => {
    showCountRef.current = showCount
  }, [showCount])
  
  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 1
    }

    const loadMore = async () => {
      // Use refs to avoid dependency on notifications/showCount/loading
      const currentNotifications = notificationsRef.current
      const currentShowCount = showCountRef.current
      const currentLoading = loadingRef.current

      if (currentShowCount < currentNotifications.length) {
        // Show more aggressively: increase by SHOW_COUNT, but also check if we should show even more
        const remaining = currentNotifications.length - currentShowCount
        const increment = Math.min(SHOW_COUNT * 2, remaining) // Show up to 2x SHOW_COUNT if available
        setShowCount((count) => count + increment)
        // Only preload more if we have plenty cached (more than 3/4 of LIMIT)
        // BUT: Always try to load more if we have very few notifications (might be due to filtering)
        if (currentNotifications.length - currentShowCount > LIMIT * 0.75 && currentNotifications.length >= 50) {
          return
        }
        // If we have very few notifications, always try to load more (might be aggressive filtering)
        if (currentNotifications.length < 50) {
          // Continue to loadMore below even if we have cached notifications
          // This ensures we keep loading when filtering is aggressive
        }
      }

      if (!pubkey || !timelineKey || !until || currentLoading) return
      setLoading(true)
      try {
        const newNotifications = await client.loadMoreTimeline(timelineKey, until, LIMIT)
        // CRITICAL FIX: Don't stop immediately on empty results - might be temporary relay issues
        // Only stop if we've tried many times with no results
        if (newNotifications.length === 0) {
          // Check if timeline has more cached refs that we haven't loaded yet
          const hasMoreCached = client.hasMoreTimelineEvents?.(timelineKey, until) ?? false
          if (hasMoreCached) {
            // There are more cached notifications, keep trying
            consecutiveEmptyRef.current = 0 // Reset counter when we have cached events
            setLoading(false)
            // Retry after a short delay to allow IndexedDB to catch up
            setTimeout(() => {
              if (until) {
                loadMore()
              }
            }, 300)
            return
          }
          // No cached notifications and network returned empty
          // Be patient - don't stop too early, especially when we have few notifications
          consecutiveEmptyRef.current += 1
          // Only stop after MANY consecutive empty results (similar to NoteList)
          if (consecutiveEmptyRef.current >= 20) {
            // After 20 consecutive empty results, assume we've reached the end
            setUntil(undefined)
            setLoading(false)
            return
          }
          // Otherwise, keep trying on next scroll
          setLoading(false)
          return
        }

        // Reset consecutive empty counter on success
        consecutiveEmptyRef.current = 0

        if (newNotifications.length > 0) {
          setNotifications((oldNotifications) => [
            ...oldNotifications,
            ...newNotifications.filter((event) => event.pubkey !== pubkey)
          ])
        }

        setUntil(newNotifications[newNotifications.length - 1].created_at - 1)
      } catch (error) {
        // On error, don't stop immediately - might be temporary network issue
        logger.error('[NotificationList] Error loading more notifications', { error })
        consecutiveEmptyRef.current += 1
        // Only stop after MANY consecutive errors - be very patient with network issues
        if (consecutiveEmptyRef.current >= 25) {
          setUntil(undefined)
        }
      } finally {
        setLoading(false)
      }
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore()
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
  }, [pubkey, timelineKey, until]) // Removed notifications, showCount, loading to prevent infinite loops

  const refresh = () => {
    topRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
    consecutiveEmptyRef.current = 0 // Reset counter on refresh
    setTimeout(() => {
      setRefreshCount((count) => count + 1)
    }, 500)
  }

  const list = (
    <div className={notificationListStyle === NOTIFICATION_LIST_STYLE.COMPACT ? 'pt-2' : ''}>
      {visibleNotifications.map((notification) => (
        <NotificationItem key={notification.id} notification={notification} />
      ))}
      <div className="text-center text-sm text-muted-foreground">
        {until || loading ? (
          <div ref={bottomRef}>
            <NotificationSkeleton />
          </div>
        ) : (
          t('no more notifications')
        )}
      </div>
    </div>
  )

  return (
    <div>
      <div ref={topRef} />
      {supportTouch ? (
        <PullToRefresh
          onRefresh={async () => {
            refresh()
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }}
          pullingContent=""
        >
          {list}
        </PullToRefresh>
      ) : (
        list
      )}
    </div>
  )
  }
)
NotificationList.displayName = 'NotificationList'
export default NotificationList
