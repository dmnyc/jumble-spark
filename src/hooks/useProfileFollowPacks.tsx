import { ExtendedKind } from '@/constants'
import {
  profileAccordionGetCachedFollowPacks,
  profileAccordionInvalidate,
  profileAccordionRelayUrlsKey,
  profileAccordionSetFollowPacks
} from '@/lib/profile-accordion-session-cache'
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

    const urls =
      force || !(relayUrls && relayUrls.length > 0)
        ? await buildProfileRelayUrls(pubkey, blockedRelays)
        : relayUrls
    const relayKey = profileAccordionRelayUrlsKey(urls)

    if (!force && urls.length > 0) {
      const cached = profileAccordionGetCachedFollowPacks(pubkey, relayKey)
      if (cached) {
        if (myFetchId !== fetchIdRef.current) return
        setPacks(cached)
        setLoading(false)
        return
      }
    }

    if (myFetchId !== fetchIdRef.current) return
    setLoading(true)

    try {
      if (urls.length === 0) {
        if (myFetchId === fetchIdRef.current) setPacks([])
        return
      }

      const events = await queryService.fetchEvents(
        urls,
        [{ '#p': [pubkey], kinds: [ExtendedKind.FOLLOW_PACK], limit: 50 }],
        { eoseTimeout: 2000, globalTimeout: 15000, firstRelayResultGraceMs: false }
      )

      if (myFetchId !== fetchIdRef.current) return

      const result: TProfileFollowPack[] = events.map((evt) => ({
        event: evt,
        title: getPackTitle(evt)
      }))
      setPacks(result)
      profileAccordionSetFollowPacks(pubkey, relayKey, result)
    } catch {
      if (myFetchId !== fetchIdRef.current) return
      setPacks([])
    } finally {
      if (myFetchId === fetchIdRef.current) setLoading(false)
    }
  }, [pubkey, blockedRelays, relayUrls])

  const refresh = useCallback(() => {
    if (pubkey) profileAccordionInvalidate(pubkey, 'followPacks')
    void fetchPacks(true)
  }, [pubkey, fetchPacks])

  useEffect(() => {
    void fetchPacks(false)
  }, [fetchPacks])

  return { packs, loading, refresh }
}
