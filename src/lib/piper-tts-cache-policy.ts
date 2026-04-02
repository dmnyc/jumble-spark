import { isImwaldElectron, isMobileBrowserProfile } from '@/lib/client-platform'

/** How long we keep Piper WAV blobs (per device class). */
export function getPiperTtsCacheTtlMs(): number {
  if (isImwaldElectron()) return 7 * 24 * 60 * 60 * 1000
  if (isMobileBrowserProfile()) return 24 * 60 * 60 * 1000
  return 48 * 60 * 60 * 1000
}

/** Caps so TTS audio cannot grow without bound (evicts oldest after TTL pass). */
export function getPiperTtsCacheBudget(): { maxEntries: number; maxBytes: number } {
  if (isImwaldElectron()) return { maxEntries: 400, maxBytes: 400 * 1024 * 1024 }
  if (isMobileBrowserProfile()) return { maxEntries: 80, maxBytes: 45 * 1024 * 1024 }
  return { maxEntries: 200, maxBytes: 180 * 1024 * 1024 }
}

/**
 * Stable key for a Piper request: same URL + text + speed → same audio.
 * Server upgrades / voice changes require a new endpoint URL or speed to bust the cache.
 */
export async function buildPiperTtsCacheKey(
  endpointUrl: string,
  text: string,
  speed: number
): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify({ u: endpointUrl, t: text, s: speed }))
  const digest = await crypto.subtle.digest('SHA-256', payload)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
