import { nip19 } from 'nostr-tools'

/** Find npub1 / nprofile1 / note1 / nevent1 / naddr1 tokens in text. */
const BECH32_NOSTR_RE = /(?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+/gi

export type NostrUrlExtract = { kind: 'event' | 'profile'; id: string }

function classifyBech32(id: string): NostrUrlExtract | null {
  try {
    const { type } = nip19.decode(id)
    if (type === 'npub' || type === 'nprofile') return { kind: 'profile', id }
    if (type === 'note' || type === 'nevent' || type === 'naddr') return { kind: 'event', id }
  } catch {
    // ignore
  }
  return null
}

function firstNostrExtractInString(s: string): NostrUrlExtract | null {
  const re = new RegExp(BECH32_NOSTR_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const hit = classifyBech32(m[0])
    if (hit) return hit
  }
  return null
}

function isValidEmbeddedNotePointer(id: string): boolean {
  const s = id.trim()
  if (/^[0-9a-f]{64}$/i.test(s)) return true
  const hit = classifyBech32(s)
  return hit?.kind === 'event'
}

function isProfilePointer(id: string): boolean {
  const s = id.trim()
  if (/^[0-9a-f]{64}$/i.test(s)) return true
  const hit = classifyBech32(s)
  return hit?.kind === 'profile'
}

function extractHex64(s: string): string | null {
  const m = s.match(/\b[0-9a-f]{64}\b/i)
  return m ? m[0].toLowerCase() : null
}

/**
 * True if this hostname serves this web app: current tab origin and/or known production/dev hosts.
 * Needed so `https://jumble.imwald.eu/.../notes/nevent…` embeds while the dev server runs on localhost.
 */
export function urlHostnameIsKnownImwaldWebHost(
  urlHostname: string,
  appOrigin: string | null
): boolean {
  const h = urlHostname.toLowerCase()
  if (h === 'jumble.imwald.eu') return true
  if (h === 'localhost' || h === '127.0.0.1') return true
  if (appOrigin) {
    try {
      if (h === new URL(appOrigin).hostname.toLowerCase()) return true
    } catch {
      // ignore
    }
  }
  return false
}

/**
 * In-app HTTP(S) links to our routes → embed like `nostr:…` (same tab origin or known Imwald/localhost host).
 */
export function parseSameOriginAppNostrUrl(urlStr: string, appOrigin: string | null): NostrUrlExtract | null {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    return null
  }
  if (!urlHostnameIsKnownImwaldWebHost(u.hostname, appOrigin)) return null

  let path = u.pathname
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  if (!path) path = '/'

  const usersMatch = path.match(/^\/users\/([^/?#]+)$/i)
  if (usersMatch) {
    const id = decodeURIComponent(usersMatch[1])
    if (isProfilePointer(id)) {
      return { kind: 'profile', id }
    }
    return null
  }

  const notesMatch = path.match(/\/notes\/([^/?#]+)$/i)
  if (notesMatch) {
    const id = decodeURIComponent(notesMatch[1])
    if (isValidEmbeddedNotePointer(id)) {
      return { kind: 'event', id }
    }
    return null
  }

  return null
}

const QUERY_KEYS_PRIORITY = [
  'id',
  'nevent',
  'note',
  'naddr',
  'event',
  'e',
  'npub',
  'nprofile',
  'pubkey',
  'user',
  'p',
  'author'
]

/**
 * Third-party URLs: Nostr id in query or path — offer chevron-expand embed (not auto).
 */
export function extractExternalUrlNostrForExpandable(
  urlStr: string,
  appOrigin: string | null
): NostrUrlExtract | null {
  if (parseSameOriginAppNostrUrl(urlStr, appOrigin)) return null

  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    return null
  }

  const tryPiece = (raw: string): NostrUrlExtract | null => {
    const s = raw.trim()
    if (!s) return null
    const hex = extractHex64(s)
    if (hex) return { kind: 'event', id: hex }
    const b = firstNostrExtractInString(s)
    if (b) return b
    return null
  }

  for (const key of QUERY_KEYS_PRIORITY) {
    const v = u.searchParams.get(key)
    if (!v) continue
    let decoded = v
    try {
      decoded = decodeURIComponent(v)
    } catch {
      // use raw
    }
    const hit = tryPiece(decoded)
    if (hit) return hit
  }

  for (const [, v] of u.searchParams.entries()) {
    let decoded = v
    try {
      decoded = decodeURIComponent(v)
    } catch {
      // use raw
    }
    const hit = tryPiece(decoded)
    if (hit) return hit
  }

  const pathHit = tryPiece(u.pathname)
  if (pathHit) return pathHit

  const hash = u.hash ? u.hash.slice(1) : ''
  if (hash) {
    const hashHit = tryPiece(hash)
    if (hashHit) return hashHit
  }

  return firstNostrExtractInString(u.href) ?? null
}

export function getBrowserAppOrigin(): string | null {
  if (typeof window === 'undefined') return null
  return window.location.origin
}

/** Skip duplicate WebPreview at bottom of note when URL is handled as embed / expandable. */
export function httpUrlSkipsBottomWebPreview(urlStr: string, appOrigin: string | null): boolean {
  return (
    parseSameOriginAppNostrUrl(urlStr, appOrigin) != null ||
    extractExternalUrlNostrForExpandable(urlStr, appOrigin) != null
  )
}
