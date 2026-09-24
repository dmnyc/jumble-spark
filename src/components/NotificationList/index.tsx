import { SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import { useInfiniteScroll } from '@/hooks'
import { useNotificationFilter } from '@/hooks/useNotificationFilter'
import { prefersTouchInteraction } from '@/lib/device'
import { getNotificationFilterType } from '@/lib/notification'
import { cn } from '@/lib/utils'
import { usePrimaryPage } from '@/PageManager'
import { useDeepBrowsing } from '@/providers/DeepBrowsingProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useNotification } from '@/providers/NotificationProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import notificationService from '@/services/notification.service'
import dayjs from 'dayjs'
import { NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from '../PullToRefresh'
import { LoadingBar } from '../LoadingBar'
import NotificationTabsCustomizeDialog from '../NotificationTabsCustomizeDialog'
import { RefreshButton } from '../RefreshButton'
import Tabs from '../Tabs'
import TrustScoreFilter from '../TrustScoreFilter'
import { NotificationItem } from './NotificationItem'
import { NotificationSkeleton } from './NotificationItem/Notification'

const SHOW_COUNT = 30
const LOAD_MORE_LIMIT = 100

export default function NotificationList() {
  const { t } = useTranslation()
  const { current } = usePrimaryPage()
  const { pubkey } = useNostr()
  const { getNotificationsSeenAt } = useNotification()
  const { notificationTabs } = useUserPreferences()
  const filterFn = useNotificationFilter()
  const visibleTabs = useMemo(
    () => notificationTabs.filter((tab) => !tab.hidden),
    [notificationTabs]
  )
  const [notificationType, setNotificationType] = useState(visibleTabs[0].id)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [lastReadTime, setLastReadTime] = useState(0)
  const [filteredEvents, setFilteredEvents] = useState<NostrEvent[]>([])
  const [initialLoading, setInitialLoading] = useState(notificationService.getInitialLoading())
  const prefersTouch = useMemo(() => prefersTouchInteraction(), [])
  const topRef = useRef<HTMLDivElement | null>(null)
  const selectedTab = visibleTabs.find((tab) => tab.id === notificationType) ?? visibleTabs[0]

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === notificationType)) {
      setNotificationType(visibleTabs[0].id)
    }
  }, [notificationType, visibleTabs])

  // Snapshot the page-level last-read marker only when this page becomes
  // current. We deliberately don't react to subsequent changes of
  // `notificationsSeenAt` (e.g. the global update fired on entering this
  // page) — otherwise items would flip from unread to read mid-view.
  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (current !== 'notifications' || !pubkey) {
      wasActiveRef.current = false
      return
    }
    if (wasActiveRef.current) return
    wasActiveRef.current = true
    setLastReadTime(getNotificationsSeenAt())
  }, [current, pubkey, getNotificationsSeenAt])

  // Track service loading state.
  useEffect(() => {
    setInitialLoading(notificationService.getInitialLoading())
    const unsub = notificationService.onLoadingChanged(setInitialLoading)
    return unsub
  }, [])

  // Recompute filtered events whenever the underlying data or filter inputs change.
  useEffect(() => {
    if (!pubkey) {
      setFilteredEvents([])
      return
    }

    let cancelled = false
    const cache = new Map<string, boolean>()

    const recompute = async () => {
      const events = notificationService.getEvents()
      const seenIds = new Set<string>()
      const passed: NostrEvent[] = []
      for (const evt of events) {
        if (seenIds.has(evt.id)) continue
        seenIds.add(evt.id)
        let ok = cache.get(evt.id)
        if (ok === undefined) {
          ok = await filterFn(evt)
          if (cancelled) return
          cache.set(evt.id, ok)
        }
        if (ok) passed.push(evt)
      }
      if (!cancelled) {
        setFilteredEvents(passed)
      }
    }

    recompute()
    const unsub = notificationService.onDataChanged(recompute)
    return () => {
      cancelled = true
      unsub()
    }
  }, [pubkey, filterFn])

  const handleLoadMore = useCallback(async () => {
    return notificationService.loadMore(LOAD_MORE_LIMIT)
  }, [])

  const notifications = useMemo(() => {
    const enabledFilters = new Set(selectedTab.filters)
    return filteredEvents.filter((event) => {
      const filter = getNotificationFilterType(event, pubkey)
      return filter !== null && enabledFilters.has(filter)
    })
  }, [filteredEvents, selectedTab, pubkey])

  const { visibleItems, shouldShowLoadingIndicator, bottomRef, setShowCount } = useInfiniteScroll({
    items: notifications,
    showCount: SHOW_COUNT,
    onLoadMore: handleLoadMore,
    initialLoading
  })

  const groupedNotifications = useMemo(() => groupNotifications(visibleItems), [visibleItems])

  const refresh = () => {
    topRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
    setTimeout(() => {
      notificationService.restart()
    }, 500)
  }

  const list = (
    <div>
      {groupedNotifications.map((group) => (
        <NotificationGroup key={group.key} group={group} lastReadTime={lastReadTime} />
      ))}
      <div ref={bottomRef} />
      <div className="text-muted-foreground text-center text-sm">
        {notificationService.hasMore() || shouldShowLoadingIndicator ? (
          <NotificationSkeleton />
        ) : (
          t('no more notifications')
        )}
      </div>
    </div>
  )

  return (
    <div>
      <Tabs
        value={notificationType}
        tabs={visibleTabs.map((tab) => ({ value: tab.id, label: tab.label }))}
        onTabChange={(type) => {
          setShowCount(SHOW_COUNT)
          setNotificationType(type as typeof notificationType)
          topRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
        }}
        onCustomize={() => setCustomizeOpen(true)}
        options={
          <>
            {!prefersTouch ? <RefreshButton onClick={() => refresh()} /> : null}
            <TrustScoreFilter filterId={SPECIAL_TRUST_SCORE_FILTER_ID.NOTIFICATIONS} />
          </>
        }
      />
      <div ref={topRef} className="scroll-mt-24.25" />
      {initialLoading && shouldShowLoadingIndicator && <LoadingBar />}
      <PullToRefresh
        onRefresh={async () => {
          refresh()
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }}
      >
        {list}
      </PullToRefresh>
      <NotificationTabsCustomizeDialog open={customizeOpen} onOpenChange={setCustomizeOpen} />
    </div>
  )
}

type TNotificationGroupKey = 'today' | 'week' | 'month' | 'earlier'

const GROUP_LABELS: Record<TNotificationGroupKey, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  earlier: 'Earlier'
}

function groupNotifications(events: NostrEvent[]) {
  const now = dayjs()
  const todayStart = now.startOf('day').unix()
  const weekStart = now.startOf('week').unix()
  const monthStart = now.startOf('month').unix()

  const groups: { key: TNotificationGroupKey; label: string; items: NostrEvent[] }[] = []
  let current: { key: TNotificationGroupKey; label: string; items: NostrEvent[] } | null = null

  for (const evt of events) {
    let key: TNotificationGroupKey
    if (evt.created_at >= todayStart) key = 'today'
    else if (evt.created_at >= weekStart) key = 'week'
    else if (evt.created_at >= monthStart) key = 'month'
    else key = 'earlier'

    if (!current || current.key !== key) {
      current = { key, label: GROUP_LABELS[key], items: [] }
      groups.push(current)
    }
    current.items.push(evt)
  }
  return groups
}

type TNotificationGroup = ReturnType<typeof groupNotifications>[number]

function NotificationGroup({
  group,
  lastReadTime
}: {
  group: TNotificationGroup
  lastReadTime: number
}) {
  const [visibleNotificationIds, setVisibleNotificationIds] = useState<Set<string>>(() => new Set())

  const handleVisibilityChange = useCallback((notificationId: string, isVisible: boolean) => {
    setVisibleNotificationIds((previousIds) => {
      const wasVisible = previousIds.has(notificationId)
      if (wasVisible === isVisible) return previousIds

      const nextIds = new Set(previousIds)
      if (isVisible) {
        nextIds.add(notificationId)
      } else {
        nextIds.delete(notificationId)
      }
      return nextIds
    })
  }, [])

  const hasVisibleNotification = group.items.some(({ id }) => visibleNotificationIds.has(id))

  return (
    <>
      {hasVisibleNotification && <NotificationGroupHeader label={group.label} />}
      {group.items.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          isNew={notification.created_at > lastReadTime}
          onVisibilityChange={(isVisible) => handleVisibilityChange(notification.id, isVisible)}
        />
      ))}
    </>
  )
}

function NotificationGroupHeader({ label }: { label: string }) {
  const { t } = useTranslation()
  const { deepBrowsing } = useDeepBrowsing()

  return (
    <div
      className={cn(
        'bg-border text-muted-foreground sticky z-20 border-b px-4 py-1 text-sm font-semibold backdrop-blur-md transition-[top] duration-300',
        deepBrowsing ? 'top-12' : 'top-24.25'
      )}
    >
      {t(label)}
    </div>
  )
}
