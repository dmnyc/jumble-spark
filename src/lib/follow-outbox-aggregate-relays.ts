import {
  DEFAULT_FAVORITE_RELAYS,
  FAST_READ_RELAY_URLS,
  READ_ONLY_RELAY_URLS
} from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { relayUrlsLocalsFirst } from '@/lib/relay-url-priority'
import type { TRelayList } from '@/types'

/** First N NIP-65 `write` (outbox) URLs per followed pubkey, follow-list order; locals first per author. */
export const FOLLOW_OUTBOX_AGGREGATE_PER_AUTHOR = 2

/** Plain `ws://` relays are almost always someone else's LAN; the client cannot use them for third-party reads. */
function isNonPublicWsRelayUrl(normalizedUrl: string): boolean {
  return normalizedUrl.toLowerCase().startsWith('ws://')
}

function addLayer(
  out: string[],
  seen: Set<string>,
  blocked: Set<string>,
  urls: readonly string[]
): void {
  for (const u of urls) {
    const n = normalizeUrl(u) || u
    if (!n || isNonPublicWsRelayUrl(n) || blocked.has(n) || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
}

/**
 * Merge each author's outboxes (capped per author) with {@link READ_ONLY_RELAY_URLS},
 * {@link FAST_READ_RELAY_URLS}, and user favorites: normalized, blocked-stripped,
 * deduped (first occurrence wins).
 */
export function buildFollowOutboxAggregateReadUrls(
  relayLists: readonly TRelayList[],
  blockedRelays: readonly string[],
  favoriteRelays: readonly string[] = []
): string[] {
  const blocked = new Set(blockedRelays.map((b) => normalizeUrl(b) || b).filter(Boolean))
  const seen = new Set<string>()
  const out: string[] = []

  for (const rl of relayLists) {
    const writes = relayUrlsLocalsFirst(rl.write ?? [])
    for (const u of writes.slice(0, FOLLOW_OUTBOX_AGGREGATE_PER_AUTHOR)) {
      const n = normalizeUrl(u) || u
      if (!n || isNonPublicWsRelayUrl(n) || blocked.has(n) || seen.has(n)) continue
      seen.add(n)
      out.push(n)
    }
  }

  addLayer(out, seen, blocked, READ_ONLY_RELAY_URLS)
  addLayer(out, seen, blocked, FAST_READ_RELAY_URLS)
  addLayer(out, seen, blocked, favoriteRelays.length > 0 ? favoriteRelays : DEFAULT_FAVORITE_RELAYS)

  return out
}
