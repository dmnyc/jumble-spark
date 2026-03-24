import { buildProfileRelayUrls } from '@/lib/profile-relay-urls'
import { useCallback, useEffect, useState } from 'react'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'

/** Returns profile relay URLs (outboxes + PROFILE_FETCH). Use for sharing relays across profile fetches. */
export function useProfileRelayUrls(pubkey: string | undefined, enabled: boolean) {
  const { blockedRelays } = useFavoriteRelays()
  const [relayUrls, setRelayUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!pubkey || !enabled) {
      setRelayUrls([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const urls = await buildProfileRelayUrls(pubkey, blockedRelays)
      setRelayUrls(urls)
    } catch {
      setRelayUrls([])
    } finally {
      setLoading(false)
    }
  }, [pubkey, enabled, blockedRelays])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { relayUrls, loading, refresh: fetch }
}
