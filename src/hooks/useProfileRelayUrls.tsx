import {
  profileAccordionGetCachedRelayUrls,
  profileAccordionRelayUrlsKey,
  profileAccordionSetRelayUrls
} from '@/lib/profile-accordion-session-cache'
import { buildProfileRelayUrls, getProfileRelayUrlsProvisional } from '@/lib/profile-relay-urls'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'

/** Returns profile relay URLs (outboxes + PROFILE_FETCH). Use for sharing relays across profile fetches. */
export function useProfileRelayUrls(pubkey: string | undefined, enabled: boolean) {
  const { blockedRelays } = useFavoriteRelays()
  const blockedRelaysRef = useRef(blockedRelays)
  blockedRelaysRef.current = blockedRelays
  const blockedRelaysKey = profileAccordionRelayUrlsKey(blockedRelays)

  const [relayUrls, setRelayUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  /** Stale-while-revalidate: avoid accordion skeleton when refreshing relays but URLs already visible */
  const relayUrlsRef = useRef<string[]>([])
  relayUrlsRef.current = relayUrls

  const fetch = useCallback(
    async (force = false): Promise<string[]> => {
      if (!pubkey) {
        setRelayUrls((prev) => (prev.length === 0 ? prev : []))
        setLoading(false)
        return []
      }

      if (!force) {
        const cached = profileAccordionGetCachedRelayUrls(pubkey)
        if (cached?.length) {
          setRelayUrls(cached)
          setLoading(false)
          return cached
        }
      }

      const provisional = getProfileRelayUrlsProvisional(blockedRelaysRef.current)
      const revalidateWithVisibleUrls = force && relayUrlsRef.current.length > 0
      if (!revalidateWithVisibleUrls) {
        if (provisional.length > 0) {
          profileAccordionSetRelayUrls(pubkey, provisional)
          setRelayUrls(provisional)
          setLoading(false)
        } else {
          setLoading(true)
        }
      } else {
        setLoading(true)
      }
      try {
        const urls = await buildProfileRelayUrls(pubkey, blockedRelaysRef.current)
        profileAccordionSetRelayUrls(pubkey, urls)
        setRelayUrls(urls)
        return urls
      } catch {
        setRelayUrls((prev) => (prev.length === 0 ? prev : []))
        return []
      } finally {
        setLoading(false)
      }
    },
    [pubkey, blockedRelaysKey]
  )

  const refresh = useCallback(() => {
    if (!pubkey) return Promise.resolve([] as string[])
    /** Do not invalidate: that wipes interactions/badges/follow-packs cache and forces empty refetches */
    return fetch(true)
  }, [pubkey, fetch])

  useEffect(() => {
    if (!pubkey) {
      setRelayUrls((prev) => (prev.length === 0 ? prev : []))
      setLoading(false)
      return
    }
    if (!enabled) {
      const cached = profileAccordionGetCachedRelayUrls(pubkey)
      setRelayUrls((prev) => {
        if (cached && cached.length > 0) return cached
        if (prev.length === 0) return prev
        return []
      })
      setLoading(false)
      return
    }
    void fetch(false)
  }, [pubkey, enabled, fetch])

  return { relayUrls, loading, refresh }
}
