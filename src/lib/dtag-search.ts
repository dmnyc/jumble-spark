import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'

export function getDTagValue(event: Event): string | undefined {
  const t = event.tags.find((x) => x[0] === 'd' && x[1])?.[1]
  return t
}

/** d-tag contains needle or note content contains needle (case-insensitive). */
export function eventMatchesDTagLooseQuery(needle: string, event: Event): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  const d = getDTagValue(event)?.toLowerCase() ?? ''
  if (d.includes(q)) return true
  if ((event.content ?? '').toLowerCase().includes(q)) return true
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
