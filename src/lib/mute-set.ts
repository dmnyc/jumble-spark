/**
 * Mute pubkey sets use lowercase hex so lookups match Nostr events and `p` tags regardless of casing.
 */
export function muteSetHas(mutePubkeySet: Set<string>, pubkey: string | undefined | null): boolean {
  if (!pubkey) return false
  return mutePubkeySet.has(pubkey.toLowerCase())
}
