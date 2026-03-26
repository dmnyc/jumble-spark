import { FAST_READ_RELAY_URLS } from '@/constants'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { buildRssWebNostrQueryRelayUrls } from '@/lib/rss-web-feed'
import { useEffect, useMemo, useState } from 'react'
import { useNoteStatsRelayHints } from './useNoteStatsRelayHints'

/**
 * Relay set for RSS+Web article URL thread REQs: inbox/favorites/fast-read merge (same as URL discovery)
 * plus {@link useNoteStatsRelayHints} (current relay context).
 */
export function useRssUrlThreadQueryRelays(): { relayUrls: string[]; key: string } {
  const { pubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { relays: hintRelays, key: hintKey } = useNoteStatsRelayHints()
  const [baseUrls, setBaseUrls] = useState<string[]>([])
  const [baseKey, setBaseKey] = useState('')

  useEffect(() => {
    let cancelled = false
    void buildRssWebNostrQueryRelayUrls({
      accountPubkey: pubkey,
      favoriteRelays: favoriteRelays ?? [],
      blockedRelays: blockedRelays ?? []
    }).then((urls) => {
      if (cancelled) return
      setBaseUrls(urls)
      setBaseKey(urls.join('|'))
    })
    return () => {
      cancelled = true
    }
  }, [pubkey, favoriteRelays, blockedRelays])

  return useMemo(() => {
    const merged = [...new Set([...baseUrls, ...hintRelays])]
    const relayUrls = merged.length > 0 ? merged : [...FAST_READ_RELAY_URLS]
    return { relayUrls, key: `${baseKey}::${hintKey}::${relayUrls.length}` }
  }, [baseUrls, baseKey, hintRelays, hintKey])
}
