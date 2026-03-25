import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useCurrentRelayUrlsOptional } from '@/providers/CurrentRelaysProvider'
import { useMemo } from 'react'

/**
 * Relays to hint for note-stats REQ construction: user favorites plus any “current” relays
 * (e.g. single-relay feed), deduped.
 */
export function useNoteStatsRelayHints(): { relays: string[]; key: string } {
  const { favoriteRelays } = useFavoriteRelays()
  const currentRelayUrls = useCurrentRelayUrlsOptional()

  return useMemo(() => {
    const relays = [...new Set([...(favoriteRelays ?? []), ...currentRelayUrls])]
    const key = relays.slice().sort().join('|')
    return { relays, key }
  }, [favoriteRelays, currentRelayUrls])
}
