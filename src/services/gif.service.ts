/**
 * Fetch GIFs from Nostr: kind 1063 (NIP-94 file metadata) and from kind 1 / 1111 (notes/comments that contain GIF URLs).
 * Same approach as aitherboard for 1063; for 1/1111 we parse content and tags for .gif URLs.
 */

import { ExtendedKind, FAST_READ_RELAY_URLS, GIF_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { kinds } from 'nostr-tools'
import type { Event as NEvent } from 'nostr-tools'
import { queryService } from './client.service'
import indexedDb from './indexed-db.service'

export interface GifMetadata {
  url: string
  fallbackUrl?: string
  sha256?: string
  mimeType?: string
  width?: number
  height?: number
  eventId: string
  pubkey: string
  createdAt: number
}

/** Normalize a GIF URL for deduplication: strip fragment and query, lowercase. */
function normalizeGifUrl(url: string): string {
  try {
    const withoutFragment = url.split('#')[0].trim()
    const withoutQuery = withoutFragment.split('?')[0].trim()
    const lower = withoutQuery.toLowerCase()
    return lower || url
  } catch {
    return url
  }
}

/** Priority for deduplication: higher wins. Own event > other's event > non-event. */
const GIF_PRIORITY = {
  OWN_EVENT: 2,
  OTHER_EVENT: 1,
  NON_EVENT: 0
} as const

function parseGifFromEvent(event: NEvent): GifMetadata | null {
  let url: string | undefined
  let mimeType: string | undefined
  let width: number | undefined
  let height: number | undefined
  let fallbackUrl: string | undefined
  let sha256: string | undefined

  // imeta tags (NIP-92): accept url when it contains .gif or when m is image/gif
  const imetaTags = event.tags.filter((t) => t[0] === 'imeta')
  for (const imetaTag of imetaTags) {
    const mimeField = imetaTag.find((f) => f?.startsWith('m '))
    const imetaMime = mimeField?.substring(2).trim()
    const isGifMime = imetaMime === 'image/gif'
    for (let i = 1; i < imetaTag.length; i++) {
      const field = imetaTag[i]
      if (field?.startsWith('url ')) {
        const candidateUrl = field.substring(4).trim()
        if (!candidateUrl) continue
        const urlHasGif = candidateUrl.toLowerCase().includes('.gif')
        if (urlHasGif || isGifMime) {
          url = candidateUrl
          if (mimeField) mimeType = imetaMime
          const dimField = imetaTag.find((f) => f?.startsWith('dim '))
          if (dimField) {
            const dims = dimField.substring(4).trim().split('x')
            if (dims.length >= 2) {
              width = parseInt(dims[0], 10)
              height = parseInt(dims[1], 10)
            }
          }
          break
        }
      }
    }
    if (url) break
  }

  // file tags (NIP-94 kind 1063)
  if (!url) {
    const fileTags = event.tags.filter((t) => t[0] === 'file' && t[1])
    for (const fileTag of fileTags) {
      const candidateUrl = fileTag[1]
      const candidateMimeType = fileTag[2]
      const isGifUrl =
        candidateUrl &&
        (candidateUrl.toLowerCase().includes('.gif') ||
          candidateUrl.toLowerCase().startsWith('data:image/gif') ||
          candidateMimeType === 'image/gif')
      if (isGifUrl) {
        url = candidateUrl
        if (candidateMimeType) mimeType = candidateMimeType
        break
      }
    }
  }

  // image tags
  if (!url) {
    const imageTags = event.tags.filter((t) => t[0] === 'image' && t[1])
    for (const imageTag of imageTags) {
      const candidateUrl = imageTag[1]
      if (candidateUrl && candidateUrl.toLowerCase().includes('.gif')) {
        url = candidateUrl
        break
      }
    }
  }

  // url tag (accept any URL; isGif check below uses mime from 'm' tag if URL has no .gif)
  if (!url) {
    const urlTag = event.tags.find((t) => t[0] === 'url' && t[1])
    if (urlTag?.[1]) {
      url = urlTag[1]
      if (!mimeType) {
        const mTag = event.tags.find((t) => t[0] === 'm' && t[1])
        mimeType = mTag?.[1]
      }
    }
  }

  // content: markdown image or plain URL
  if (!url) {
    const markdownMatch = event.content.match(
      /!\[[^\]]*\]\((https?:\/\/[^\s<>"')]+\.gif[^\s<>"')]*)\)/i
    )
    if (markdownMatch) {
      url = markdownMatch[1]
    } else {
      const urlMatch = event.content.match(/https?:\/\/[^\s<>"']+\.gif(\?[^\s<>"']*)?/i)
      if (urlMatch) url = urlMatch[0]
    }
  }

  if (!url) return null

  const urlLower = url.toLowerCase()
  const isGif =
    mimeType === 'image/gif' ||
    urlLower.endsWith('.gif') ||
    urlLower.includes('.gif?') ||
    urlLower.includes('/gif') ||
    urlLower.includes('gif')
  if (!isGif) return null

  if (!mimeType) {
    const mimeTag = event.tags.find((t) => t[0] === 'm' && t[1])
    mimeType = mimeTag?.[1] || 'image/gif'
  }

  if (!width || !height) {
    const dimTag = event.tags.find((t) => t[0] === 'dim' && t[1])
    if (dimTag?.[1]) {
      const dims = dimTag[1].split('x')
      if (dims.length >= 2) {
        width = parseInt(dims[0], 10)
        height = parseInt(dims[1], 10)
      }
    }
  }

  const sha256Tag = event.tags.find((t) => t[0] === 'x' && t[1])
  sha256 = sha256Tag?.[1]
  const fallbackTag = event.tags.find((t) => t[0] === 'fallback' && t[1])
  fallbackUrl = fallbackTag?.[1]

  return {
    url,
    fallbackUrl,
    sha256,
    mimeType: mimeType || 'image/gif',
    width,
    height,
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at
  }
}

const CACHE_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes; cache lives in IndexedDB
/** Partial fetches (timeouts, relay issues) used to get cached as-is and hide the grid for 5 minutes. */
const MIN_GIF_CACHE_ENTRIES = 8

/** Ensured on the kind 1063 (NIP-94) relay set even if absent from merged read lists. */
const THECITADEL_FOR_GIF_METADATA =
  normalizeUrl('wss://thecitadel.nostr1.com') || 'wss://thecitadel.nostr1.com'

/**
 * Fetch GIFs from Nostr kind 1063 (NIP-94) events on GIF relays.
 * Deduplicates by normalized URL; when the same GIF appears from multiple sources,
 * keeps: 1) user's own events, 2) other users' events, 3) non-event sources.
 * @param extraReadRelayUrls - Logged-in user's read relays (inboxes) and local relays to include when fetching.
 * @param userPubkey - Current user's pubkey; entries from this pubkey get highest priority when deduping.
 */
export async function fetchGifs(
  searchQuery?: string,
  limit: number = 50,
  forceRefresh: boolean = false,
  extraReadRelayUrls: string[] = [],
  userPubkey: string | null = null
): Promise<GifMetadata[]> {
  if (!forceRefresh && !searchQuery) {
    const cached = await indexedDb.getGifCache()
    if (
      cached &&
      cached.gifs.length >= MIN_GIF_CACHE_ENTRIES &&
      Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS
    ) {
      return cached.gifs.slice(0, limit) as GifMetadata[]
    }
  }

  // GIF-focused relays often fail (e.g. gifbuddy/damus down); merge fast read indexers so kind 1063 / GIF notes still resolve.
  const readUrls = [
    ...GIF_RELAY_URLS,
    ...FAST_READ_RELAY_URLS,
    ...extraReadRelayUrls.map((u) => normalizeUrl(u)).filter((u): u is string => !!u)
  ]
  const seen = new Set<string>()
  const dedupedUrls = readUrls
    .map((u) => normalizeUrl(u) || u)
    .filter(Boolean)
    .filter((u) => {
      const n = u.toLowerCase()
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })

  const fetchOpts = { eoseTimeout: 20000, globalTimeout: 28000 }

  const limit1063 = Math.max(limit * 15, 400)
  const limitNotes = Math.max(limit * 15, 500)

  const relays1063 = dedupedUrls.some(
    (u) => (normalizeUrl(u) || u).toLowerCase() === THECITADEL_FOR_GIF_METADATA.toLowerCase()
  )
    ? dedupedUrls
    : [...dedupedUrls, THECITADEL_FOR_GIF_METADATA]

  // Kind 1063 (incl. thecitadel) + kind 1/1111 on the broad list (thecitadel omitted for kind 1 via KIND_1_BLOCKED).
  const [events1063, eventsNotes] = await Promise.all([
    queryService.fetchEvents(
      relays1063,
      { kinds: [ExtendedKind.FILE_METADATA], limit: limit1063 },
      fetchOpts
    ),
    queryService.fetchEvents(
      dedupedUrls,
      {
        kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT],
        limit: limitNotes
      },
      fetchOpts
    )
  ])

  const events = [...events1063, ...eventsNotes]

  // Map: normalized URL -> { gif, priority }. Higher priority wins when same URL appears multiple times.
  const byUrl = new Map<string, { gif: GifMetadata; priority: number }>()

  for (const event of events) {
    const gif = parseGifFromEvent(event)
    if (!gif) continue

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim()
      const content = event.content.toLowerCase()
      const tags = event.tags.flat().join(' ').toLowerCase()
      if (!content.includes(q) && !tags.includes(q)) continue
    }

    const key = normalizeGifUrl(gif.url)
    const priority =
      userPubkey && event.pubkey === userPubkey ? GIF_PRIORITY.OWN_EVENT : GIF_PRIORITY.OTHER_EVENT
    const existing = byUrl.get(key)
    if (!existing || priority > existing.priority) {
      byUrl.set(key, { gif, priority })
    }
  }

  const gifs = Array.from(byUrl.values()).map((v) => v.gif)
  gifs.sort((a, b) => b.createdAt - a.createdAt)
  const result = gifs.slice(0, limit)

  if (result.length >= MIN_GIF_CACHE_ENTRIES && !searchQuery) {
    await indexedDb.setGifCache(result, Date.now())
  }

  return result
}

/** Search GIFs by query (same as fetchGifs with query). */
export async function searchGifs(
  query: string,
  limit: number = 50,
  forceRefresh: boolean = false,
  extraReadRelayUrls: string[] = [],
  userPubkey: string | null = null
): Promise<GifMetadata[]> {
  return fetchGifs(query, limit, forceRefresh, extraReadRelayUrls, userPubkey)
}
