import { ExtendedKind } from '@/constants'
import { cleanUrl } from '@/lib/url'
import { bytesToHex } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'
import type { Event } from 'nostr-tools'

/** Encode article URL for a single path segment (UTF-8 → base64url, no padding). */
export function encodeRssArticlePathSegment(articleUrl: string): string {
  const bytes = new TextEncoder().encode(articleUrl)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeRssArticlePathSegment(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const binary = atob(b64 + pad)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(out)
}

/** Stable fake event id for caching / stats keys (not a published note id). */
export function rssArticleStableEventId(articleUrl: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`rss-thread-root:${articleUrl}`)))
}

/** Strip tracking params from http(s) article URLs; leave other values unchanged. */
export function canonicalizeRssArticleUrl(url: string): string {
  const t = url.trim()
  if (!t.startsWith('http://') && !t.startsWith('https://')) return t
  return cleanUrl(t) || t
}

/** Normalize user input to an http(s) URL for manual article threads; returns null if invalid. */
export function normalizeHttpArticleUrl(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s}`
  }
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return canonicalizeRssArticleUrl(u.href)
  } catch {
    return null
  }
}

/**
 * Synthetic parent event for kind 1111 comments on an RSS article.
 * Thread is keyed by the article URL in both `i` and `I` tags (no e/a root).
 */
export function createRssThreadRootEvent(articleUrl: string): Event {
  const canonical = canonicalizeRssArticleUrl(articleUrl)
  return {
    id: rssArticleStableEventId(canonical),
    pubkey: '0'.repeat(64),
    created_at: 0,
    kind: ExtendedKind.RSS_THREAD_ROOT,
    tags: [
      ['i', canonical],
      ['I', canonical]
    ],
    content: '',
    sig: ''
  }
}

export function getArticleUrlFromCommentITags(event: Event): string | undefined {
  const upper = event.tags.find((t) => t[0] === 'I')?.[1]
  if (upper) return upper
  return event.tags.find((t) => t[0] === 'i')?.[1]
}

/** Client-only RSS thread parent (non-standard kind); not a real relay event. */
export function isRssThreadSyntheticParentEvent(event: Pick<Event, 'kind'>): boolean {
  return event.kind === ExtendedKind.RSS_THREAD_ROOT
}
