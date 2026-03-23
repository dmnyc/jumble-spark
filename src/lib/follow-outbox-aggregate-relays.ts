import { READ_ONLY_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { relayUrlsLocalsFirst } from '@/lib/relay-url-priority'
import type { TRelayList } from '@/types'

/** First N NIP-65 `write` (outbox) URLs per followed pubkey, follow-list order; locals first per author. */
export const FOLLOW_OUTBOX_AGGREGATE_PER_AUTHOR = 2

/** Plain `ws://` relays are almost always someone else's LAN; the client cannot use them for third-party reads. */
function isNonPublicWsRelayUrl(normalizedUrl: string): boolean {
  return normalizedUrl.toLowerCase().startsWith('ws://')
}

/**
 * Merge each author's outboxes (capped per author) with {@link READ_ONLY_RELAY_URLS}:
 * normalized, blocked-stripped, deduped (first occurrence wins).
 */
export function buildFollowOutboxAggregateReadUrls(
  relayLists: readonly TRelayList[],
  blockedRelays: readonly string[]
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

  for (const u of READ_ONLY_RELAY_URLS) {
    const n = normalizeUrl(u) || u
    if (!n || isNonPublicWsRelayUrl(n) || blocked.has(n) || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }

  return out
}
