import { isLocalNetworkUrl, normalizeUrl } from '@/lib/url'
import type { TRelayList } from '@/types'

/**
 * Remove LAN / loopback relay URLs (e.g. ws://localhost:4869, 192.168.x.x).
 * Use for **another user's** NIP-65 list so we never open their private cache relays;
 * the viewer's own list should not be passed through this (they may use local cache relays).
 */
export function stripLocalNetworkRelaysFromRelayList(list: TRelayList): TRelayList {
  const keepUrl = (u: string): boolean => {
    const n = normalizeUrl(u) || u
    return Boolean(n && !isLocalNetworkUrl(n))
  }
  return {
    write: list.write.filter(keepUrl),
    read: list.read.filter(keepUrl),
    originalRelays: list.originalRelays.filter((r) => keepUrl(r.url))
  }
}
