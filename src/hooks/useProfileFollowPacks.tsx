import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import {
  profileAccordionGetCachedFollowPacks,
  profileAccordionGetCachedRelayUrls,
  profileAccordionRelayUrlsKey,
  profileAccordionSetFollowPacks
} from '@/lib/profile-accordion-session-cache'
import { replaceableEventDedupeKey } from '@/lib/event'
import { queryService } from '@/services/client.service'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { buildProfileRelayUrls } from '@/lib/profile-relay-urls'

export type TProfileFollowPack = {
  event: Event
  title: string
}

function getPackTitle(event: Event): string {
  const titleTag = event.tags.find((tag) => tag[0] === 'title' || tag[0] === 'name')
  return titleTag?.[1] || 'Follow Pack'
}

/** Fetches follow packs (kind 39089) that contain this pubkey in #p tags. */
export function useProfileFollowPacks(
  pubkey: string | undefined,
  relayUrls?: string[]
) {
  const { blockedRelays } = useFavoriteRelays()
  const blockedRelaysRef = useRef(blockedRelays)
  blockedRelaysRef.current = blockedRelays
  const relayUrlsRef = useRef(relayUrls)
  relayUrlsRef.current = relayUrls
  const blockedRelaysKey = profileAccordionRelayUrlsKey(blockedRelays)
  const relayUrlsKey = profileAccordionRelayUrlsKey(relayUrls ?? [])

  const [packs, setPacks] = useState<TProfileFollowPack[]>([])
  const [loading, setLoading] = useState(false)
  const fetchIdRef = useRef(0)

  const fetchPacks = useCallback(async (force = false) => {
    const myFetchId = (fetchIdRef.current += 1)

    if (!pubkey) {
      if (myFetchId === fetchIdRef.current) {
        setPacks([])
        setLoading(false)
      }
      return
    }

    const relayUrlsLatest = relayUrlsRef.current
    let urls =
      relayUrlsLatest && relayUrlsLatest.length > 0
        ? relayUrlsLatest
        : profileAccordionGetCachedRelayUrls(pubkey) ?? []

    if (force || urls.length === 0) {
      urls = await buildProfileRelayUrls(pubkey, blockedRelaysRef.current)
    }
    const queryUrls = urls.length > 0 ? urls : [...FAST_READ_RELAY_URLS]
    const relayKey = profileAccordionRelayUrlsKey(queryUrls)

    if (!force) {
      const cached = profileAccordionGetCachedFollowPacks(pubkey, relayKey)
      if (cached) {
        if (myFetchId !== fetchIdRef.current) return
        setPacks(cached)
        setLoading(false)
        return
      }
    }

    const seed = profileAccordionGetCachedFollowPacks(pubkey, relayKey)
    if (seed?.length && myFetchId === fetchIdRef.current) {
      setPacks(seed)
    }

    if (myFetchId !== fetchIdRef.current) return
    if (!seed?.length) {
      setLoading(true)
    }

    try {
      const events = await queryService.fetchEvents(
        queryUrls,
        [{ '#p': [pubkey], kinds: [ExtendedKind.FOLLOW_PACK], limit: 50 }],
        { eoseTimeout: 2000, globalTimeout: 15000, firstRelayResultGraceMs: false }
      )

      if (myFetchId !== fetchIdRef.current) return

      const network: TProfileFollowPack[] = events.map((evt) => ({
        event: evt,
        title: getPackTitle(evt)
      }))
      const byDedupeKey = new Map<string, TProfileFollowPack>()
      const put = (p: TProfileFollowPack) => {
        const k = replaceableEventDedupeKey(p.event)
        const prev = byDedupeKey.get(k)
        if (!prev || p.event.created_at > prev.event.created_at) {
          byDedupeKey.set(k, p)
        }
      }
      for (const p of seed ?? []) put(p)
      for (const p of network) put(p)
      const merged = [...byDedupeKey.values()].sort((a, b) => b.event.created_at - a.event.created_at)
      setPacks(merged)
      profileAccordionSetFollowPacks(pubkey, relayKey, merged)
    } catch {
      if (myFetchId !== fetchIdRef.current) return
      if (!seed?.length) setPacks([])
    } finally {
      if (myFetchId === fetchIdRef.current) setLoading(false)
    }
  }, [pubkey, blockedRelaysKey, relayUrlsKey])

  const refresh = useCallback(() => {
    void fetchPacks(true)
  }, [pubkey, fetchPacks])

  useEffect(() => {
    void fetchPacks(false)
  }, [fetchPacks])

  return { packs, loading, refresh }
}
