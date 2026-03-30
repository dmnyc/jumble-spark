import { E_TAG_FILTER_BLOCKED_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import type { Filter } from 'nostr-tools'

let blockedLowerMemo: Set<string> | null = null

function extendedTagReqBlockedLowerSet(): Set<string> {
  if (!blockedLowerMemo) {
    blockedLowerMemo = new Set(
      E_TAG_FILTER_BLOCKED_RELAY_URLS.map((u) => (normalizeUrl(u) || u).toLowerCase()).filter(Boolean)
    )
  }
  return blockedLowerMemo
}

/** NIP-01 tag filters are `#` + tag name; keys like `#E` / `#A` / `#I` are uppercase variants. */
const CAPITAL_LEADING_TAG_FILTER_KEY = /^#[A-Z]/

function filterUsesCapitalLetterTagKey(f: Filter): boolean {
  for (const k of Object.keys(f as Record<string, unknown>)) {
    if (CAPITAL_LEADING_TAG_FILTER_KEY.test(k)) return true
  }
  return false
}

/**
 * True if any filter object includes a tag filter whose key starts with `#` and an uppercase ASCII letter
 * (e.g. `#E`, `#A`, `#I`). Some relays (notably nostr.sovbit.host) reject those keys entirely.
 */
export function relayFiltersUseCapitalLetterTagKeys(filter: Filter | Filter[]): boolean {
  const filters = Array.isArray(filter) ? filter : [filter]
  return filters.some(filterUsesCapitalLetterTagKey)
}

/**
 * Relays in {@link E_TAG_FILTER_BLOCKED_RELAY_URLS} reject `#e`-style queries and, on some stacks, any tag
 * filter key that uses a capital letter after `#`. Drop them before REQ so we do not spam NOTICE/rate-limit responses.
 */
export function relayUrlsStripExtendedTagReqBlocked(urls: string[]): string[] {
  const blocked = extendedTagReqBlockedLowerSet()
  return urls.filter((u) => {
    const n = normalizeUrl(u) || u.trim()
    return n && !blocked.has(n.toLowerCase())
  })
}
