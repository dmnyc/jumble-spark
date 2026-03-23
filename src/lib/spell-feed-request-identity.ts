import type { TFeedSubRequest } from '@/types'
import { normalizeUrl } from '@/lib/url'
import type { Filter } from 'nostr-tools'

/** Canonical JSON for a REQ filter so subscription identity ignores object identity / key order. */
export function stableSpellFeedFilterKey(filter: Filter): string {
  const entries = Object.entries(filter)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(Object.fromEntries(entries))
}

/**
 * Single string identity for spell / faux-spell `subRequests`.
 * Pass from SpellsPage into NoteList as `feedSubscriptionKey` so timeline subscription does not
 * restart when parent passes a new `subRequests` array reference with identical REQ shape.
 */
export function computeSpellSubRequestsIdentityKey(subRequests: TFeedSubRequest[]): string {
  if (!subRequests.length) return ''
  return JSON.stringify(
    subRequests.map((req) => ({
      urls: [...req.urls].map((u) => normalizeUrl(u) || u).filter(Boolean).sort(),
      filter: stableSpellFeedFilterKey(req.filter)
    }))
  )
}

/**
 * True when `nextKey` is the same REQ filters as `prevKey` but with a strict superset of relay URLs
 * in at least one request slot (e.g. Explore relay reviews: bootstrap relays → full list).
 */
export function isRelayUrlStrictSupersetIdentityKey(prevKey: string | null, nextKey: string): boolean {
  if (!prevKey || prevKey === nextKey) return false
  try {
    type Item = { urls: string[]; filter: string }
    const prev = JSON.parse(prevKey) as Item[]
    const next = JSON.parse(nextKey) as Item[]
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false
    let sawStrictGrowth = false
    for (let i = 0; i < prev.length; i++) {
      if (prev[i].filter !== next[i].filter) return false
      const ps = new Set(prev[i].urls)
      const ns = new Set(next[i].urls)
      for (const u of ps) {
        if (!ns.has(u)) return false
      }
      if (ns.size > ps.size) sawStrictGrowth = true
    }
    return sawStrictGrowth
  } catch {
    return false
  }
}

/**
 * True when parsed {@link computeSpellSubRequestsIdentityKey} payloads match per-slot REQ `filter` strings
 * but relay URL lists may differ (reorder, NIP-65 refinement, different cap slices).
 * Use with {@link preserveTimelineOnSubRequestsChange} so a provisional relay stack can hand off to a refined
 * stack without clearing rows or flashing the loading state.
 */
export function isSpellSubRequestsSameFiltersDifferentRelays(
  prevKey: string | null,
  nextKey: string
): boolean {
  if (!prevKey || prevKey === nextKey) return false
  try {
    type Item = { urls: string[]; filter: string }
    const prev = JSON.parse(prevKey) as Item[]
    const next = JSON.parse(nextKey) as Item[]
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false
    for (let i = 0; i < prev.length; i++) {
      if (prev[i].filter !== next[i].filter) return false
    }
    return true
  } catch {
    return false
  }
}
