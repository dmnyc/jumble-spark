import {
  fetchProfileAccordionBundle,
  profileAccordionBundleCacheKey,
  type ProfileAccordionBundle
} from '@/lib/profile-accordion-fetch'
import {
  profileAccordionGetCachedBadges,
  profileAccordionGetCachedFollowPacks,
  profileAccordionGetCachedInteractions,
  profileAccordionGetCachedReports
} from '@/lib/profile-accordion-session-cache'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

const EMPTY: ProfileAccordionBundle = {
  zaps: [],
  reactions: [],
  comments: [],
  badges: [],
  followPacks: [],
  reports: []
}

function readFullCache(
  pubkey: string,
  relayKey: string,
  viewerPubkey: string | null | undefined
): ProfileAccordionBundle | null {
  const zi = profileAccordionGetCachedInteractions(pubkey, relayKey)
  const zb = profileAccordionGetCachedBadges(pubkey, relayKey)
  const zf = profileAccordionGetCachedFollowPacks(pubkey, relayKey)
  const viewer = viewerPubkey?.trim()
  const reportsReady = !viewer || profileAccordionGetCachedReports(pubkey, viewer) !== undefined
  if (!zi || zb === undefined || zf === undefined || !reportsReady) return null
  const reports =
    viewer ? profileAccordionGetCachedReports(pubkey, viewer) ?? [] : []
  return {
    zaps: zi.zaps,
    reactions: zi.reactions,
    comments: zi.comments,
    badges: zb,
    followPacks: zf,
    reports
  }
}

/**
 * Loads profile accordion data only when `enabled` (accordion open); hydrates from session cache first.
 * Use {@link refresh} for manual network refresh.
 */
export function useProfileAccordionData(opts: {
  pubkey: string | undefined
  relayUrls: string[] | undefined
  enabled: boolean
  viewerPubkey: string | null | undefined
}) {
  const { pubkey, relayUrls, enabled, viewerPubkey } = opts
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [data, setData] = useState<ProfileAccordionBundle>(EMPTY)
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  const relayKey = useMemo(
    () => profileAccordionBundleCacheKey(relayUrls ?? []),
    [relayUrls]
  )

  const runFetch = useCallback(
    async (force: boolean, overrideUrls?: string[]) => {
      const urls = (overrideUrls?.length ? overrideUrls : relayUrls) ?? []
      if (!pubkey?.trim() || !urls.length) return
      const id = ++reqId.current
      setLoading(true)
      try {
        const bundle = await fetchProfileAccordionBundle({
          pubkey: pubkey.trim(),
          urls,
          viewerPubkey,
          favoriteRelays: favoriteRelays ?? [],
          blockedRelays,
          force,
          onPartial: (partial) => {
            if (id !== reqId.current) return
            setData(partial)
          }
        })
        if (id !== reqId.current) return
        setData(bundle)
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    },
    [pubkey, relayUrls, viewerPubkey, favoriteRelays, blockedRelays]
  )

  const refresh = useCallback(
    (overrideUrls?: string[]) => {
      void runFetch(true, overrideUrls)
    },
    [runFetch]
  )

  useLayoutEffect(() => {
    if (!enabled || !pubkey?.trim() || !relayUrls?.length) {
      return
    }
    const pk = pubkey.trim()
    const cached = readFullCache(pk, relayKey, viewerPubkey)
    if (cached) {
      setData(cached)
      setLoading(false)
      return
    }
    setLoading(true)
    void runFetch(false)
  }, [enabled, pubkey, relayKey, relayUrls, viewerPubkey, runFetch])

  return {
    ...data,
    loading,
    refresh
  }
}
