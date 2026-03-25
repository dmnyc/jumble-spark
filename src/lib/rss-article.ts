import { bytesToHex } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'
import { ExtendedKind } from '@/constants'
import { cleanUrl } from '@/lib/url'
import type { Event } from 'nostr-tools'

/** NIP-22: `K` / `k` value for http(s) URL comment scopes (web pages, articles). */
export const NIP22_URL_SCOPE_KIND = 'web'

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
      ['I', canonical],
      ['i', canonical],
      ['K', NIP22_URL_SCOPE_KIND],
      ['k', NIP22_URL_SCOPE_KIND]
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

/** HTTP(S) URL from kind 39701 web bookmarks (`i`/`I`/`r` tags). */
export function getWebBookmarkArticleUrl(event: Pick<Event, 'kind' | 'tags'>): string | undefined {
  if (event.kind !== ExtendedKind.WEB_BOOKMARK) return undefined
  const fromII = getArticleUrlFromCommentITags(event as Event)
  if (fromII && (fromII.startsWith('http://') || fromII.startsWith('https://'))) {
    return canonicalizeRssArticleUrl(fromII)
  }
  const fromR = getHighlightSourceHttpUrl(event as Event)
  if (fromR) return fromR
  for (const t of event.tags) {
    if (t[0] === 'r' && t[1]?.trim()) {
      const u = t[1].trim()
      if (u.startsWith('http://') || u.startsWith('https://')) return canonicalizeRssArticleUrl(u)
    }
  }
  return undefined
}

/** HTTP(S) page URL from kind 9802 `r` tags (`source` marker or bare `r`). */
export function getHighlightSourceHttpUrl(event: Pick<Event, 'tags'>): string | undefined {
  for (const t of event.tags) {
    if (t[0] !== 'r' || !t[1]) continue
    const u = t[1].trim()
    if (!u.startsWith('http://') && !u.startsWith('https://')) continue
    const marker = (t[2] ?? '').trim().toLowerCase()
    // NIP-84: non-source URL refs use `mention`; only `source` (any casing) or legacy bare `r` is the page.
    if (marker === 'mention') continue
    if (marker === 'source' || marker === '') return canonicalizeRssArticleUrl(u)
  }
  return undefined
}

/**
 * Values for a REQ `#r` filter on kind 9802 when the thread key is a canonical article URL.
 * Relay matching is exact on the tag string, so we include common variants (slash, stripped query).
 */
export function computeRTagFilterValuesForArticleThread(canonicalUrl: string): string[] {
  const s = canonicalUrl.trim()
  if (!s.startsWith('http://') && !s.startsWith('https://')) return []
  const out = new Set<string>([s])
  try {
    const u = new URL(s)
    if (u.search) {
      out.add(`${u.origin}${u.pathname}`)
    }
    const p = u.pathname
    if (p.length > 1 && p.endsWith('/')) {
      out.add(`${u.origin}${p.slice(0, -1)}${u.search}`)
    } else if (p.length > 0 && !p.endsWith('/')) {
      out.add(`${u.origin}${p}/${u.search}`)
    }
  } catch {
    /* ignore */
  }
  return [...out]
}

/** Strip anchors whose href targets https://clawstr.com/… (incl. subdomains, http(s), protocol-relative). */
export function isClawstrDotComHttpHref(href: string): boolean {
  const t = href.trim()
  if (!t) return false
  try {
    const u = t.startsWith('//') ? new URL(`https:${t}`) : new URL(t)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return host === 'clawstr.com' || host.endsWith('.clawstr.com')
  } catch {
    return false
  }
}

/**
 * NIP-25 kind 17 + NIP-73: resolve http(s) target URL for a `k: web` external reaction.
 * Stops at the next `k` tag so podcast-style multi-scope reactions are not mis-parsed as web.
 */
export function getWebExternalReactionTargetUrl(event: Pick<Event, 'kind' | 'tags'>): string | undefined {
  if (event.kind !== ExtendedKind.EXTERNAL_REACTION) return undefined
  const tags = event.tags
  for (let i = 0; i < tags.length; i++) {
    const row = tags[i]
    if (row[0] !== 'k' || row[1] !== NIP22_URL_SCOPE_KIND) continue
    for (let j = i + 1; j < tags.length; j++) {
      const t = tags[j]
      if (t[0] === 'k') break
      if (t[0] === 'i' && t[1]) {
        const url = t[1]
        if (url.startsWith('http://') || url.startsWith('https://')) {
          return canonicalizeRssArticleUrl(url)
        }
      }
    }
  }
  return undefined
}

/** Client-only RSS thread parent (non-standard kind); not a real relay event. */
export function isRssThreadSyntheticParentEvent(event: Pick<Event, 'kind'>): boolean {
  return event.kind === ExtendedKind.RSS_THREAD_ROOT
}
