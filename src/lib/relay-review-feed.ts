import { ExtendedKind } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import type { Event } from 'nostr-tools'

/**
 * `d` tag values on kind 31987 vary by client (trailing slash, scheme, etc.). REQ `#d` is OR-matched;
 * include every variant we care about for the relay being viewed.
 */
export function relayReviewDTagsForRelayUrl(url: string): string[] {
  const raw = url?.trim()
  if (!raw) return []
  const norm = normalizeUrl(raw) || raw
  const uniq: string[] = []
  const add = (s: string | undefined) => {
    const t = s?.trim()
    if (t && !uniq.includes(t)) uniq.push(t)
  }
  add(raw)
  add(norm)
  return uniq
}

/** Same key as {@link RelayReviewsPage} / NoteList session snapshot. */
export function relayReviewsFeedSnapshotKey(normalizedRelayUrl: string): string {
  return `relay-reviews:v1|${normalizedRelayUrl}|k=${ExtendedKind.RELAY_REVIEW}`
}

/** Whether a cached or live event is a review for this relay (handles `d` vs URL normalization drift). */
export function relayReviewEventTargetsRelay(event: Event, relayUrl: string): boolean {
  if (event.kind !== ExtendedKind.RELAY_REVIEW) return false
  const d = event.tags.find((t) => t[0] === 'd')?.[1]?.trim()
  if (!d) return false
  const candidates = relayReviewDTagsForRelayUrl(relayUrl)
  if (candidates.includes(d)) return true
  const dNorm = normalizeUrl(d) || d
  const targetNorm = normalizeUrl(relayUrl) || relayUrl
  return dNorm === targetNorm
}
