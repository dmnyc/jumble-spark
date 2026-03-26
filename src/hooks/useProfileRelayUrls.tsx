import {
  profileAccordionGetCachedRelayUrls,
  profileAccordionInvalidate,
  profileAccordionSetRelayUrls
} from '@/lib/profile-accordion-session-cache'
import { buildProfileRelayUrls } from '@/lib/profile-relay-urls'
import { useCallback, useEffect, useState } from 'react'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'

/** Returns profile relay URLs (outboxes + PROFILE_FETCH). Use for sharing relays across profile fetches. */
export function useProfileRelayUrls(pubkey: string | undefined, enabled: boolean) {
  const { blockedRelays } = useFavoriteRelays()
  const [relayUrls, setRelayUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(
    async (force = false) => {
      if (!pubkey) {
        setRelayUrls([])
        setLoading(false)
        return
      }

      if (!force) {
        const cached = profileAccordionGetCachedRelayUrls(pubkey)
        if (cached?.length) {
          setRelayUrls(cached)
          setLoading(false)
          return
        }
      }

      setLoading(true)
      try {
        const urls = await buildProfileRelayUrls(pubkey, blockedRelays)
        profileAccordionSetRelayUrls(pubkey, urls)
        setRelayUrls(urls)
      } catch {
        setRelayUrls([])
      } finally {
        setLoading(false)
      }
    },
    [pubkey, blockedRelays]
  )

  const refresh = useCallback(() => {
    if (pubkey) profileAccordionInvalidate(pubkey, 'relayUrls')
    if (!pubkey) return Promise.resolve()
    return fetch(true)
  }, [pubkey, fetch])

  useEffect(() => {
    if (!pubkey) {
      setRelayUrls([])
      setLoading(false)
      return
    }
    if (!enabled) {
      const cached = profileAccordionGetCachedRelayUrls(pubkey)
      setRelayUrls(cached ?? [])
      setLoading(false)
      return
    }
    void fetch(false)
  }, [pubkey, enabled, fetch])

  return { relayUrls, loading, refresh }
}
