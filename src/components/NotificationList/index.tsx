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
const LIMIT = 100
const SHOW_COUNT = 30

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
        noteStatsService.updateNoteStatsByEvents([event])
        if (index === -1) {
          return [...oldEvents, event]
        }
        return [...oldEvents.slice(0, index), event, ...oldEvents.slice(index)]
      })
    },
    [pubkey]
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
              noteStatsService.updateNoteStatsByEvents(events)
            }
          },
          onNew: (event) => {
            handleNewEvent(event)
          }
        }
      )
      setTimelineKey(timelineKey)
      return closer
    }

    const promise = init()
    return () => {
      promise.then((closer) => closer?.())
    }
  }, [pubkey, refreshCount, filterKinds, current])

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
        setShowCount((count) => count + SHOW_COUNT)
        // preload more
        if (currentNotifications.length - currentShowCount > LIMIT / 2) {
          return
        }
      }

      if (!pubkey || !timelineKey || !until || currentLoading) return
      setLoading(true)
      try {
        const newNotifications = await client.loadMoreTimeline(timelineKey, until, LIMIT)
        if (newNotifications.length === 0) {
          setUntil(undefined)
          return
        }

        if (newNotifications.length > 0) {
          setNotifications((oldNotifications) => [
            ...oldNotifications,
            ...newNotifications.filter((event) => event.pubkey !== pubkey)
          ])
        }

        setUntil(newNotifications[newNotifications.length - 1].created_at - 1)
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
