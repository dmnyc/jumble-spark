/**
 * Fetch GIFs from Nostr NIP-94 file metadata events (kind 1063).
 * Same approach as aitherboard: query GIF relays, parse file/imeta/image/url tags.
 */

import { ExtendedKind, GIF_RELAY_URLS } from '@/constants'
import type { Event as NEvent } from 'nostr-tools'
import client from './client.service'

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

const CACHE_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes in-memory cache
let cachedGifs: GifMetadata[] = []
let cacheTime = 0

/**
 * Fetch GIFs from Nostr kind 1063 (NIP-94) events on GIF relays.
 * Optionally filter by search query (content + tags).
 */
export async function fetchGifs(
  searchQuery?: string,
  limit: number = 50,
  forceRefresh: boolean = false
): Promise<GifMetadata[]> {
  const useCache = !forceRefresh && cachedGifs.length > 0 && Date.now() - cacheTime < CACHE_MAX_AGE_MS
  if (useCache && !searchQuery) {
    return cachedGifs.slice(0, limit)
  }

  const filter = {
    kinds: [ExtendedKind.FILE_METADATA],
    limit: Math.max(limit * 3, 150)
  }

  const events = await client.fetchEvents(GIF_RELAY_URLS, filter, {
    eoseTimeout: 8000
  })

  const seenUrls = new Set<string>()
  const gifs: GifMetadata[] = []

  for (const event of events) {
    const gif = parseGifFromEvent(event)
    if (!gif) continue
    const normalizedUrl = gif.url.split('?')[0].split('#')[0]
    if (seenUrls.has(normalizedUrl)) continue
    seenUrls.add(normalizedUrl)

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim()
      const content = event.content.toLowerCase()
      const tags = event.tags.flat().join(' ').toLowerCase()
      if (!content.includes(q) && !tags.includes(q)) continue
    }
    gifs.push(gif)
  }

  gifs.sort((a, b) => b.createdAt - a.createdAt)
  const result = gifs.slice(0, limit)

  if (result.length > 0 && !searchQuery) {
    cachedGifs = result
    cacheTime = Date.now()
  }

  return result
}

/** Search GIFs by query (same as fetchGifs with query). */
export async function searchGifs(
  query: string,
  limit: number = 50,
  forceRefresh: boolean = false
): Promise<GifMetadata[]> {
  return fetchGifs(query, limit, forceRefresh)
}
