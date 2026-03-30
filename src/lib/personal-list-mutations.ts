import { nip19 } from 'nostr-tools'

/** Decoded target for one bookmark/pin list entry (NIP-19 nevent/note or naddr). */
export type TPersonalListBech32Ref = { eIdLower?: string; aCoordLower?: string }

export function decodePersonalListBech32Ref(bech32Id: string): TPersonalListBech32Ref | null {
  try {
    const dec = nip19.decode(bech32Id.trim())
    if (dec.type === 'nevent') {
      return { eIdLower: dec.data.id.toLowerCase() }
    }
    if (dec.type === 'note') {
      return { eIdLower: dec.data.toLowerCase() }
    }
    if (dec.type === 'naddr') {
      const { kind, pubkey, identifier } = dec.data
      return { aCoordLower: `${kind}:${pubkey}:${identifier}`.toLowerCase() }
    }
  } catch {
    return null
  }
  return null
}

/**
 * Next bookmark list (kind 10003) tags after dropping one `e` or `a` ref.
 * Returns null if nothing matched (list unchanged).
 */
export function bookmarkListTagsAfterRemovingRef(
  tags: string[][],
  ref: TPersonalListBech32Ref
): string[][] | null {
  if (!ref.eIdLower && !ref.aCoordLower) return null
  const next = tags.filter((tag) => {
    if (ref.eIdLower && tag[0] === 'e' && tag[1]?.toLowerCase() === ref.eIdLower) return false
    if (ref.aCoordLower && tag[0] === 'a' && tag[1]?.toLowerCase() === ref.aCoordLower) return false
    return true
  })
  return next.length === tags.length ? null : next
}
