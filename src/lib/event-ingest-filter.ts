import { ExtendedKind } from '@/constants'
import { getRelayUrlFromRelayReviewEvent, getStarsFromRelayReviewEvent } from '@/lib/event-metadata'
import type { Event as NEvent } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/**
 * Detects **kind-1 note** spam where `content` is a stringified JSON **object** (game/app payloads, etc.)
 * instead of human-readable text. Scoped to {@link kinds.ShortTextNote} only.
 */
export function isStringifiedJsonObjectContentNostrEvent(
  event: Pick<NEvent, 'kind' | 'content'>
): boolean {
  if (event.kind !== kinds.ShortTextNote) return false

  const c = typeof event.content === 'string' ? event.content.trim() : ''
  if (c.length < 2 || c[0] !== '{' || c[c.length - 1] !== '}') return false
  try {
    const v = JSON.parse(c) as unknown
    return v !== null && typeof v === 'object' && !Array.isArray(v)
  } catch {
    return false
  }
}

/**
 * Kind-31987 noise: missing `d` (relay URL) or a parseable `rating` tag (see {@link getStarsFromRelayReviewEvent}).
 * Content may be JSON or prose; structure is validated on tags, not `content`.
 */
export function isIncompleteRelayReviewIngest(event: NEvent): boolean {
  if (event.kind !== ExtendedKind.RELAY_REVIEW) return false
  if (!getRelayUrlFromRelayReviewEvent(event)) return true
  if (!getStarsFromRelayReviewEvent(event)) return true
  return false
}

/** Single gate for subscribe/cache/IDB read paths: drop kind-1 JSON-object spam and malformed relay reviews. */
export function shouldDropEventOnIngest(event: NEvent): boolean {
  return isStringifiedJsonObjectContentNostrEvent(event) || isIncompleteRelayReviewIngest(event)
}
