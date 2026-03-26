import { LRUCache } from 'lru-cache'
import { nip19 } from 'nostr-tools'
import logger from '@/lib/logger'

export function formatPubkey(pubkey: string) {
  const npub = pubkeyToNpub(pubkey)
  if (npub) {
    return formatNpub(npub)
  }
  return pubkey.slice(0, 4) + '...' + pubkey.slice(-4)
}

export function formatNpub(npub: string, length = 12) {
  if (length < 12) {
    length = 12
  }

  if (length >= 63) {
    return npub
  }

  const prefixLength = Math.floor((length - 5) / 2) + 5
  const suffixLength = length - prefixLength
  return npub.slice(0, prefixLength) + '...' + npub.slice(-suffixLength)
}

export function formatUserId(userId: string) {
  if (userId.startsWith('npub1')) {
    return formatNpub(userId)
  }
  return formatPubkey(userId)
}

export function pubkeyToNpub(pubkey: string) {
  try {
    return nip19.npubEncode(pubkey)
  } catch {
    return null
  }
}

export function userIdToPubkey(userId: string) {
  if (userId.startsWith('npub1') || userId.startsWith('nprofile1')) {
    try {
      const { type, data } = nip19.decode(userId)
      if (type === 'npub') {
        return data
      } else if (type === 'nprofile') {
        return data.pubkey
      }
    } catch (error) {
      logger.error('Error decoding userId', { userId, error })
    }
  }
  const trimmed = userId.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  return userId
}

/** Lowercase 64-char hex pubkeys for stable Maps, REQ filters, and tag comparison. */
export function normalizeHexPubkey(pubkey: string): string {
  const t = pubkey.trim()
  return /^[0-9a-f]{64}$/i.test(t) ? t.toLowerCase() : t
}

export function hexPubkeysEqual(a: string, b: string): boolean {
  if (a === b) return true
  const na = normalizeHexPubkey(a)
  const nb = normalizeHexPubkey(b)
  return (
    na.length === 64 &&
    nb.length === 64 &&
    /^[0-9a-f]{64}$/.test(na) &&
    na === nb
  )
}

export function isValidPubkey(pubkey: string) {
  return /^[0-9a-f]{64}$/i.test(pubkey)
}

/** Hex pubkey from pasted npub / nprofile / hex / `nostr:` URL (e.g. invite lists). */
export function inviteInputToHexPubkey(raw: string): string | null {
  const t = raw.trim().replace(/^nostr:/i, '').trim()
  if (!t) return null
  const pk = userIdToPubkey(t)
  return isValidPubkey(pk) ? pk.toLowerCase() : null
}

const pubkeyImageCache = new LRUCache<string, string>({ max: 1000 })

// Version identifier to force cache invalidation when algorithm changes
const CACHE_VERSION = 'v2'

export function generateImageByPubkey(pubkey: string): string {
  const cacheKey = `${CACHE_VERSION}:${pubkey}`
  if (pubkeyImageCache.has(cacheKey)) {
    return pubkeyImageCache.get(cacheKey)!
  }

  const paddedPubkey = pubkey.padEnd(66, '0')

  // Split into 3 parts for colors and the rest for control points
  const colors: string[] = []
  const controlPoints: string[] = []
  for (let i = 0; i < 11; i++) {
    const part = paddedPubkey.slice(i * 6, (i + 1) * 6)
    if (i < 3) {
      colors.push(`#${part}`)
    } else {
      controlPoints.push(part)
    }
  }

  // Generate SVG with multiple radial gradients
  const gradients = controlPoints
    .map((point, index) => {
      const cx = parseInt(point.slice(0, 2), 16) % 100
      const cy = parseInt(point.slice(2, 4), 16) % 100
      const r = (parseInt(point.slice(4, 6), 16) % 35) + 30
      const c = colors[index % (colors.length - 1)]

      return `
        <radialGradient id="grad${index}-${pubkey}" cx="${cx}%" cy="${cy}%" r="${r}%">
          <stop offset="0%" style="stop-color:${c};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${c};stop-opacity:0" />
        </radialGradient>
        <rect width="100%" height="100%" fill="url(#grad${index}-${pubkey})" />
      `
    })
    .join('')

  const image = `
    <svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${colors[2]}" fill-opacity="0.3" />
      ${gradients}
    </svg>
  `
  const imageData = `data:image/svg+xml;base64,${btoa(image)}`

  pubkeyImageCache.set(cacheKey, imageData)

  return imageData
}
