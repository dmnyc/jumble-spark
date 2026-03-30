import {
  buildLiveActivitiesRelayUrls,
  LIVE_ACTIVITY_KINDS,
  mergeLiveActivityEvents,
  msUntilNextQuarterHour,
  resolveParentSpacesForLiveActivities,
  type TLiveActivityItem
} from '@/lib/live-activities'
import logger from '@/lib/logger'
import client from '@/services/client.service'
import { registerLiveActivitiesPrewarmCallback } from '@/services/live-activities-prewarm-bridge'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import { useFollowListOptional } from './FollowListProvider'
import { useNostr } from './NostrProvider'
import { useUserPreferences } from './UserPreferencesProvider'

type TLiveActivitiesContext = {
  items: TLiveActivityItem[]
  loading: boolean
}

const LiveActivitiesContext = createContext<TLiveActivitiesContext | undefined>(undefined)

export function useLiveActivities(): TLiveActivitiesContext {
  const ctx = useContext(LiveActivitiesContext)
  if (!ctx) {
    throw new Error('useLiveActivities must be used within LiveActivitiesProvider')
  }
  return ctx
}

export function useLiveActivitiesOptional(): TLiveActivitiesContext | undefined {
  return useContext(LiveActivitiesContext)
}

export function LiveActivitiesProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, relayList, isInitialized, isAccountSessionHydrating } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const followListCtx = useFollowListOptional()
  const followings = followListCtx?.followings ?? []
  const { showLiveActivitiesBanner } = useUserPreferences()

  const [items, setItems] = useState<TLiveActivityItem[]>([])
  const [loading, setLoading] = useState(false)

  const relayRead = relayList?.read ?? []
  const relayWrite = relayList?.write ?? []

  const refresh = useCallback(async () => {
    if (!showLiveActivitiesBanner) {
      setItems([])
      return
    }
    const loggedIn = Boolean(pubkey)
    const urls = buildLiveActivitiesRelayUrls({
      loggedIn,
      favoriteRelays,
      blockedRelays,
      relayListRead: relayRead,
      relayListWrite: relayWrite
    })
    if (loggedIn && urls.length === 0) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      const events = await client.fetchEvents(
        urls,
        { kinds: [...LIVE_ACTIVITY_KINDS], limit: 500 },
        { eoseTimeout: 6000, globalTimeout: 14_000 }
      )
      const parentByAddress = await resolveParentSpacesForLiveActivities(events, urls, (u, f, o) =>
        client.fetchEvents(u, f, o)
      )
      const merged = mergeLiveActivityEvents(events, followings, parentByAddress)
      setItems(merged)
      logger.debug('[LiveActivities] poll done', { relayCount: urls.length, raw: events.length, merged: merged.length })
    } catch (e) {
      logger.warn('[LiveActivities] poll failed', { err: e })
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [
    showLiveActivitiesBanner,
    pubkey,
    favoriteRelays,
    blockedRelays,
    relayRead,
    relayWrite,
    followings
  ])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    registerLiveActivitiesPrewarmCallback(() => {
      void refreshRef.current()
    })
    return () => registerLiveActivitiesPrewarmCallback(null)
  }, [])

  useEffect(() => {
    if (!showLiveActivitiesBanner) {
      setItems([])
      return
    }
    if (!isInitialized) return
    if (pubkey && isAccountSessionHydrating) return
    void refresh()
  }, [
    showLiveActivitiesBanner,
    isInitialized,
    pubkey,
    isAccountSessionHydrating,
    refresh
  ])

  useEffect(() => {
    if (!showLiveActivitiesBanner) return
    const id = window.setTimeout(() => {
      void refreshRef.current()
    }, msUntilNextQuarterHour())
    const interval = window.setInterval(
      () => {
        void refreshRef.current()
      },
      15 * 60 * 1000
    )
    return () => {
      window.clearTimeout(id)
      window.clearInterval(interval)
    }
  }, [showLiveActivitiesBanner])

  const value = useMemo(() => ({ items, loading }), [items, loading])

  return <LiveActivitiesContext.Provider value={value}>{children}</LiveActivitiesContext.Provider>
}
