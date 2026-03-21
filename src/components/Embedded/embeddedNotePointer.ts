import { nip19 } from 'nostr-tools'

export type EmbeddedNoteIdValidation =
  | { valid: true }
  | {
      valid: false
      reason: 'empty' | 'invalid_hex' | 'invalid_bech32' | 'wrong_nip19_type'
      decodedType?: string
    }

/**
 * Only hex (64), note1, nevent1, and naddr1 are valid embedded note targets.
 * Malformed bech32, wrong kinds (npub, …), or bad hex length fail before fetch/search UI.
 */
export function validateEmbeddedNotePointer(noteId: string): EmbeddedNoteIdValidation {
  const s = noteId.trim()
  if (!s) return { valid: false, reason: 'empty' }

  if (/^[0-9a-f]{64}$/i.test(s)) return { valid: true }

  if (/^[0-9a-f]+$/i.test(s)) {
    return { valid: false, reason: 'invalid_hex' }
  }

  const looksLikeNostrBech32 =
    s.startsWith('n') && s.includes('1') && /^[a-z0-9]+$/i.test(s) && s.length >= 10

  if (looksLikeNostrBech32) {
    try {
      const { type } = nip19.decode(s)
      if (type === 'note' || type === 'nevent' || type === 'naddr') return { valid: true }
      return { valid: false, reason: 'wrong_nip19_type', decodedType: type }
    } catch {
      return { valid: false, reason: 'invalid_bech32' }
    }
  }

  try {
    const { type } = nip19.decode(s)
    if (type === 'note' || type === 'nevent' || type === 'naddr') return { valid: true }
    return { valid: false, reason: 'wrong_nip19_type', decodedType: type }
  } catch {
    return { valid: false, reason: 'invalid_bech32' }
  }
}
