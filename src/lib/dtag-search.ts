import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'

export function getDTagValue(event: Event): string | undefined {
  const t = event.tags.find((x) => x[0] === 'd' && x[1])?.[1]
  return t
}

const TEXT_META_TAG_NAMES = new Set(['title', 'summary', 'description', 'subject', 'name'])

/**
 * d-tag, content, or common text metadata tags (title, summary, description, subject, name)
 * contain the needle (case-insensitive).
 *
 * NIP-50 full-text search can match on metadata tags not in the `d` tag or `content` field,
 * so we check them here to avoid incorrectly hiding those results.
 *
 * Also checks a space-separated variant of the needle so that a hyphenated d-tag slug like
 * "bitcoin-wallet" matches content/titles written as "Bitcoin Wallet".
 */
export function eventMatchesDTagLooseQuery(needle: string, event: Event): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  // Also try the space-separated variant (e.g. "bitcoin-wallet" → "bitcoin wallet")
  const qSpace = q.replace(/-/g, ' ')
  const checks = qSpace !== q ? [q, qSpace] : [q]

  const d = getDTagValue(event)?.toLowerCase() ?? ''
  for (const c of checks) {
    if (d.includes(c)) return true
  }
  const content = (event.content ?? '').toLowerCase()
  for (const c of checks) {
    if (content.includes(c)) return true
  }
  for (const tag of event.tags) {
    if (tag[1] && TEXT_META_TAG_NAMES.has(tag[0])) {
      const val = tag[1].toLowerCase()
      for (const c of checks) {
        if (val.includes(c)) return true
      }
    }
  }
  return false
}

/** Sort key: exact d-tag match first, then prefix, substring, then non-d / content-only. */
export function dTagMatchRank(needle: string, dVal: string | undefined): number {
  if (!dVal) return 4
  const nl = needle.trim().toLowerCase()
  const dl = dVal.toLowerCase()
  if (dl === nl) return 0
  if (dl.startsWith(nl)) return 1
  if (dl.includes(nl)) return 2
  return 3
}

/** For merged lists: better d-tag match first; tie-break newest first. Kind 30041 sinks unless `d` equals the needle. */
export function compareEventsForDTagQuery(needle: string, a: Event, b: Event): number {
  const nl = needle.trim().toLowerCase()
  const ra = dTagMatchRank(needle, getDTagValue(a))
  const rb = dTagMatchRank(needle, getDTagValue(b))

  if (nl.length > 0) {
    const kCh = ExtendedKind.PUBLICATION_CONTENT
    const aExact = getDTagValue(a)?.toLowerCase() === nl
    const bExact = getDTagValue(b)?.toLowerCase() === nl
    const aBottom = a.kind === kCh && !aExact
    const bBottom = b.kind === kCh && !bExact
    if (aBottom !== bBottom) return aBottom ? 1 : -1
  }

  if (ra !== rb) return ra - rb
  return b.created_at - a.created_at
}
