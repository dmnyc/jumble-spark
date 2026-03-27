import { NOSTR_URI_INLINE_REGEX } from '@/lib/content-patterns'

/** Bare NIP-19 entities (no `nostr:` prefix) often pasted in note text */
const BARE_BECH32 = /\b(npub|nprofile|note|nevent|naddr|nrelay)1[a-z0-9]+\b/gi

/**
 * Remove `nostr:` NIP-21 URIs, bare bech32 ids, and 64-char hex event ids so one-line UI snippets
 * (e.g. thread backlinks) do not show raw addresses when the quoted note is mostly references.
 */
export function stripNostrIdsFromPlainTextSnippet(text: string): string {
  let s = text.replace(NOSTR_URI_INLINE_REGEX, ' ')
  s = s.replace(BARE_BECH32, ' ')
  s = s.replace(/\b[0-9a-f]{64}\b/gi, ' ')
  return s.replace(/\s+/g, ' ').trim()
}
