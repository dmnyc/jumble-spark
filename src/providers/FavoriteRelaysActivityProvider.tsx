import logger from '@/lib/logger'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFollowListOptional } from '@/providers/FollowListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { queryService, replaceableEventService } from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FavoriteRelaysActivityContext,
  type TFavoriteRelaysActivityContext
} from './favorite-relays-activity-context'

const ACTIVE_WINDOW_SEC = 3600
/** Wall-clock cadence while the tab is visible */
const POLL_INTERVAL_MS = 60 * 60 * 1000
/** Enough events to surface many distinct authors without overloading relays */
const REQ_LIMIT = 400

function aggregatePubkeysByRecency(events: { pubkey: string; created_at: number }[]): string[] {
  const lastByPk = new Map<string, number>()
  for (const e of events) {
    const prev = lastByPk.get(e.pubkey) ?? 0
    if (e.created_at > prev) lastByPk.set(e.pubkey, e.created_at)
  }
  return [...lastByPk.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([pk]) => pk)
}

function partitionByFollows(orderedPubkeys: string[], followings: string[]) {
  if (followings.length === 0) {
    return {
      followPubkeys: [] as string[],
      otherPubkeys: orderedPubkeys,
      followCount: 0,
      otherCount: orderedPubkeys.length
    }
  }
  const followSet = new Set(
    followings.map((p) => normalizeHexPubkey(p)).filter((p) => p.length === 64)
  )
  const followPubkeys: string[] = []
  const otherPubkeys: string[] = []
  for (const pk of orderedPubkeys) {
    const normalized = normalizeHexPubkey(pk)
    if (normalized.length === 64 && followSet.has(normalized)) followPubkeys.push(pk)
    else otherPubkeys.push(pk)
  }
  return {
    followPubkeys,
    otherPubkeys,
    followCount: followPubkeys.length,
    otherCount: otherPubkeys.length
  }
}

export function FavoriteRelaysActivityProvider({ children }: { children: React.ReactNode }) {
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const followList = useFollowListOptional()
  const followings = followList?.followings ?? []
  const { pubkey: viewerPubkey } = useNostr()
  const [orderedPubkeys, setOrderedPubkeys] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [relayActivityReady, setRelayActivityReady] = useState(false)
  const [lastFetchedAtMs, setLastFetchedAtMs] = useState<number | null>(null)
  const [profileKind0ByPubkey, setProfileKind0ByPubkey] = useState<Record<string, Event>>({})
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [activeNpubsDrawerOpen, setActiveNpubsDrawerOpen] = useState(false)
  const lastCompletedFetchAtRef = useRef(Date.now())
  const relayKey = useMemo(
    () => getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays).join('\n'),
    [favoriteRelays, blockedRelays]
  )

  const fetchActive = useCallback(async () => {
    const urls = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)
    if (urls.length === 0) {
      setOrderedPubkeys([])
      setProfileKind0ByPubkey({})
      setLoading(false)
      setRelayActivityReady(true)
      const now = Date.now()
      lastCompletedFetchAtRef.current = now
      setLastFetchedAtMs(now)
      return
    }
    setLoading(true)
    const since = Math.floor(Date.now() / 1000) - ACTIVE_WINDOW_SEC
    try {
      const events = await queryService.fetchEvents(
        urls,
        { since, limit: REQ_LIMIT },
        {
          firstRelayResultGraceMs: false,
          eoseTimeout: 1800,
          globalTimeout: 14_000
        }
      )
      setOrderedPubkeys(aggregatePubkeysByRecency(events))
    } catch (error) {
      logger.debug('[FavoriteRelaysActivity] fetch failed', { error })
      setOrderedPubkeys([])
      setProfileKind0ByPubkey({})
    } finally {
      setLoading(false)
      setRelayActivityReady(true)
      const now = Date.now()
      lastCompletedFetchAtRef.current = now
      setLastFetchedAtMs(now)
    }
  }, [favoriteRelays, blockedRelays])

  const fetchRef = useRef(fetchActive)
  fetchRef.current = fetchActive

  /** Reset pulse state when account or relay set changes so we show loading until fresh data. */
  const resetForRefetch = useCallback(() => {
    setRelayActivityReady(false)
    setOrderedPubkeys([])
    setProfileKind0ByPubkey({})
  }, [])

  /** Initial fetch on mount and when relay set changes (refresh snapshot, not hourly cadence). */
  const prevRelayKeyRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (prevRelayKeyRef.current === undefined) {
      prevRelayKeyRef.current = relayKey
      void fetchRef.current()
      return
    }
    if (prevRelayKeyRef.current === relayKey) return
    prevRelayKeyRef.current = relayKey
    resetForRefetch()
    void fetchRef.current()
  }, [relayKey, resetForRefetch])

  /** Logged-in user changed — refetch for the new account. Follow list changes update partition via useMemo. */
  const prevViewerRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (prevViewerRef.current !== undefined && prevViewerRef.current !== viewerPubkey) {
      resetForRefetch()
      void fetchRef.current()
    }
    prevViewerRef.current = viewerPubkey ?? undefined
  }, [viewerPubkey, resetForRefetch])

  /** While the document is visible: poll once per hour; when returning after a long background, catch up if due. */
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined

    const runTick = () => {
      void fetchRef.current()
    }

    const syncPolling = () => {
      if (document.visibilityState !== 'visible') {
        if (intervalId !== undefined) {
          clearInterval(intervalId)
          intervalId = undefined
        }
        return
      }
      if (intervalId === undefined) {
        intervalId = setInterval(runTick, POLL_INTERVAL_MS)
      }
      if (Date.now() - lastCompletedFetchAtRef.current >= POLL_INTERVAL_MS) {
        runTick()
      }
    }

    syncPolling()
    document.addEventListener('visibilitychange', syncPolling)
    return () => {
      document.removeEventListener('visibilitychange', syncPolling)
      if (intervalId !== undefined) clearInterval(intervalId)
    }
  }, [])

  const profileFetchKeys = useMemo(() => {
    if (!viewerPubkey) return orderedPubkeys
    return orderedPubkeys.filter((pk) => !hexPubkeysEqual(pk, viewerPubkey))
  }, [orderedPubkeys, viewerPubkey])

  useEffect(() => {
    if (profileFetchKeys.length === 0) {
      setProfileKind0ByPubkey({})
      setProfilesLoading(false)
      return
    }
    let cancelled = false
    setProfilesLoading(true)
    ;(async () => {
      try {
        const events = await replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(
          profileFetchKeys,
          kinds.Metadata
        )
        if (cancelled) return
        const next: Record<string, Event> = {}
        profileFetchKeys.forEach((pk, i) => {
          const e = events[i]
          if (e) next[pk] = e
        })
        setProfileKind0ByPubkey(next)
      } catch (err) {
        logger.debug('[FavoriteRelaysActivity] profile batch failed', { err })
        if (!cancelled) setProfileKind0ByPubkey({})
      } finally {
        if (!cancelled) setProfilesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profileFetchKeys])

  const displayPubkeys = useMemo(() => {
    if (!viewerPubkey) return orderedPubkeys
    return orderedPubkeys.filter((pk) => !hexPubkeysEqual(pk, viewerPubkey))
  }, [orderedPubkeys, viewerPubkey])

  const { followPubkeys, otherPubkeys, followCount, otherCount } = useMemo(
    () => partitionByFollows(displayPubkeys, followings),
    [displayPubkeys, followings]
  )

  const pubkeys = useMemo(
    () => [...followPubkeys, ...otherPubkeys],
    [followPubkeys, otherPubkeys]
  )

  const value: TFavoriteRelaysActivityContext = useMemo(
    () => ({
      followPubkeys,
      otherPubkeys,
      followCount,
      otherCount,
      pubkeys,
      totalCount: displayPubkeys.length,
      loading,
      relayActivityReady,
      lastFetchedAtMs,
      profileKind0ByPubkey,
      profilesLoading,
      activeNpubsDrawerOpen,
      setActiveNpubsDrawerOpen,
      refetch: fetchActive
    }),
    [
      followPubkeys,
      otherPubkeys,
      followCount,
      otherCount,
      pubkeys,
      displayPubkeys.length,
      loading,
      relayActivityReady,
      lastFetchedAtMs,
      profileKind0ByPubkey,
      profilesLoading,
      activeNpubsDrawerOpen,
      fetchActive
    ]
  )

  return <FavoriteRelaysActivityContext.Provider value={value}>{children}</FavoriteRelaysActivityContext.Provider>
}
