import { stableSpellFeedFilterKey } from '@/lib/spell-feed-request-identity'
import type { TFeedSubRequest } from '@/types'
import { normalizeUrl, subtractNormalizedRelayUrls } from '@/lib/url'
import type { Filter } from 'nostr-tools'

function normalizedRelayUrlSet(requests: TFeedSubRequest[]): Set<string> {
  const s = new Set<string>()
  for (const r of requests) {
    for (const u of r.urls) {
      const n = normalizeUrl(u) || u.trim()
      if (n) s.add(n)
    }
  }
  return s
}

function dedupeShardKey(urls: string[], filter: Filter): string {
  const nu = [...urls].map((u) => normalizeUrl(u) || u).filter(Boolean).sort()
  return `${nu.join('\0')}|${stableSpellFeedFilterKey(filter)}`
}

/**
 * Second-wave REQ shards for the home following feed: relays and/or author groups not covered by the
 * provisional (kind-3 tags) subscription. Keeps the first subscription open and avoids "closed by caller" churn.
 */
export function buildFollowingFeedDeltaSubRequests(
  fullAugmented: TFeedSubRequest[],
  provisionalAugmented: TFeedSubRequest[],
  provisionalAuthorHexes: string[]
): TFeedSubRequest[] {
  if (fullAugmented.length === 0) return []

  const rProv = normalizedRelayUrlSet(provisionalAugmented)
  const rProvList = [...rProv]
  const aProv = new Set(provisionalAuthorHexes.map((p) => p.toLowerCase()))

  const out: TFeedSubRequest[] = []
  const seen = new Set<string>()

  for (const req of fullAugmented) {
    const filter = req.filter as Filter
    const authorsRaw = Array.isArray(filter.authors) ? filter.authors : []
    const authors = authorsRaw.map((x) => (typeof x === 'string' ? x.toLowerCase() : x)) as string[]

    const uDelta = subtractNormalizedRelayUrls(req.urls, rProvList)
    const authorsNew = authors.filter((a) => typeof a === 'string' && a.length === 64 && !aProv.has(a))

    const pushIfNew = (urls: string[], f: Filter) => {
      if (urls.length === 0) return
      const k = dedupeShardKey(urls, f)
      if (seen.has(k)) return
      seen.add(k)
      out.push({ ...req, urls, filter: f })
    }

    if (uDelta.length > 0) {
      pushIfNew(uDelta, { ...filter, authors } as Filter)
    }
    if (authorsNew.length > 0) {
      pushIfNew(req.urls, { ...filter, authors: authorsNew } as Filter)
    }
  }

  return out
}
