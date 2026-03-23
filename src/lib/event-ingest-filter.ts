import type { Event as NEvent } from 'nostr-tools'

/**
 * Kinds whose `content` is conventionally a JSON object string per Nostr usage (not treated as app-protocol spam).
 * Extend when another NIP documents JSON-in-content for a kind.
 */
export const NOSTR_KINDS_ALLOWED_STRINGIFIED_JSON_OBJECT_CONTENT = new Set<number>([0])

/**
 * True when `content` is a stringified JSON **object** (not arrays/primitives) on a kind that should carry human text
 * or other non-JSON payloads — e.g. game/app data published as kind 31987 relay reviews.
 */
export function isStringifiedJsonObjectContentNostrEvent(
  event: Pick<NEvent, 'kind' | 'content'>
): boolean {
  if (NOSTR_KINDS_ALLOWED_STRINGIFIED_JSON_OBJECT_CONTENT.has(event.kind)) return false
  const c = typeof event.content === 'string' ? event.content.trim() : ''
  if (c.length < 2 || c[0] !== '{' || c[c.length - 1] !== '}') return false
  try {
    const v = JSON.parse(c) as unknown
    return v !== null && typeof v === 'object' && !Array.isArray(v)
  } catch {
    return false
  }
}
