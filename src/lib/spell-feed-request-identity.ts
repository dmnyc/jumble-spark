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
