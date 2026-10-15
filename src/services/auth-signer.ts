// src/services/auth-signer.ts
//
// Pure helper for AUTH-paths signer selection (NIP-98 HTTP auth + NIP-42
// challenge sign). Used by client.subscribe()'s auth-required handler and
// the Lazarus scan to pick the right ISigner when an action belongs to
// a specific account.
//
// Rules:
//   - If `pubkey` is a non-empty string AND the registry has a signer for it,
//     return that signer.
//   - Otherwise fall back to `activeSigner` (preserves single-account behavior).
//   - Returns `undefined` when neither is available; callers decide what to do
//     (throw "please login", surface a login prompt, etc.).
import type { ISigner } from '@/types'

export function selectAuthSigner(
  registry: (pubkey: string) => ISigner | undefined,
  activeSigner: ISigner | undefined,
  pubkey?: string
): ISigner | undefined {
  if (pubkey) {
    const registered = registry(pubkey)
    if (registered) return registered
  }
  return activeSigner
}
