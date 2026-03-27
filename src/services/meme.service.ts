/**
 * Fetch meme templates from Nostr kind 1063 (NIP-94) with hashtag `memeamigo` only.
 *
 * Unlike GIFs (where `.gif` in a note is a strong signal), arbitrary JPEG/PNG links in kind 1/1111 are
 * usually normal photos, so we do not scrape notes for the meme picker.
 *
 * @see https://github.com/happylemonprogramming/gifbuddy — nip98.decentralizeGifUrl adds `t` memeamigo for non-GIF URLs.
 */

import { ExtendedKind, FAST_READ_RELAY_URLS, GIF_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import type { Event as NEvent } from 'nostr-tools'
import { queryService } from './client.service'
import indexedDb from './indexed-db.service'

export interface MemeMetadata {
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

const STATIC_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Mirrors gif.service `isGif` so note parsing stays parallel (GIF picker vs meme picker). */
function isGifLike(mimeType: string | undefined, url: string): boolean {
  const urlLower = url.toLowerCase()
  return (
    mimeType === 'image/gif' ||
    urlLower.endsWith('.gif') ||
    urlLower.includes('.gif?') ||
    urlLower.includes('/gif') ||
    urlLower.includes('gif')
  )
}

function inferStaticMimeFromUrl(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes('.png')) return 'image/png'
  if (lower.includes('.webp')) return 'image/webp'
  return 'image/jpeg'
}

function isStaticMemeUrl(mimeType: string | undefined, url: string): boolean {
  if (isGifLike(mimeType, url)) return false
  if (mimeType && STATIC_IMAGE_MIMES.has(mimeType.toLowerCase())) return true
  return /\.(jpe?g|png|webp)(\?|$)/i.test(url)
}

function normalizeMemeUrl(url: string): string {
  try {
    const withoutFragment = url.split('#')[0].trim()
    const withoutQuery = withoutFragment.split('?')[0].trim()
    const lower = withoutQuery.toLowerCase()
    return lower || url
  } catch {
    return url
  }
}

const MEME_PRIORITY = {
  OWN_EVENT: 2,
  OTHER_EVENT: 1,
  NON_EVENT: 0
} as const

function eventHasMemeamigoTag(event: NEvent): boolean {
  return event.tags.some((t) => t[0] === 't' && t[1] === 'memeamigo')
}

function parseDim(tagVal: string | undefined): { width?: number; height?: number } {
  if (!tagVal) return {}
  const dims = tagVal.split('x')
  if (dims.length < 2) return {}
  const width = parseInt(dims[0], 10)
  const height = parseInt(dims[1], 10)
  return {
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined
  }
}

/** Pull main file URL + mime from kind 1063 / imeta (same shape as gif.service, without requiring .gif). */
function parseMemeFileUrlFromEvent(event: NEvent): {
  url?: string
  mimeType?: string
  width?: number
  height?: number
} {
  let url: string | undefined
  let mimeType: string | undefined
  let width: number | undefined
  let height: number | undefined

  const imetaTags = event.tags.filter((t) => t[0] === 'imeta')
  for (const imetaTag of imetaTags) {
    const mimeField = imetaTag.find((f) => f?.startsWith('m '))
    const imetaMime = mimeField?.substring(2).trim().toLowerCase()
    const isStatic = imetaMime && STATIC_IMAGE_MIMES.has(imetaMime)
    for (let i = 1; i < imetaTag.length; i++) {
      const field = imetaTag[i]
      if (field?.startsWith('url ')) {
        const candidateUrl = field.substring(4).trim()
        if (!candidateUrl) continue
        if (isStatic || /\.(jpe?g|png|webp)(\?|$)/i.test(candidateUrl)) {
          url = candidateUrl
          if (mimeField) mimeType = imetaMime
          const dimField = imetaTag.find((f) => f?.startsWith('dim '))
          const d = parseDim(dimField?.substring(4).trim())
          width = d.width
          height = d.height
          break
        }
      }
    }
    if (url) break
  }

  if (!url) {
    const fileTags = event.tags.filter((t) => t[0] === 'file' && t[1])
    for (const fileTag of fileTags) {
      const candidateUrl = fileTag[1]
      const candidateMime = fileTag[2]?.toLowerCase()
      if (
        candidateUrl &&
        candidateMime &&
        STATIC_IMAGE_MIMES.has(candidateMime) &&
        candidateMime !== 'image/gif'
      ) {
        url = candidateUrl
        mimeType = candidateMime
        break
      }
    }
  }

  if (!url) {
    const imageTags = event.tags.filter((t) => t[0] === 'image' && t[1])
    for (const imageTag of imageTags) {
      const candidateUrl = imageTag[1]
      if (candidateUrl && /\.(jpe?g|png|webp)(\?|$)/i.test(candidateUrl)) {
        url = candidateUrl
        break
      }
    }
  }

  if (!url) {
    const urlTag = event.tags.find((t) => t[0] === 'url' && t[1])
    if (urlTag?.[1]) {
      url = urlTag[1]
      const mTag = event.tags.find((t) => t[0] === 'm' && t[1])
      if (mTag?.[1]) mimeType = mTag[1]
    }
  }

  if (!url) {
    const md = event.content.match(
      /!\[[^\]]*\]\((https?:\/\/[^\s<>"')]+\.(?:jpe?g|png|webp)[^\s<>"')]*)\)/i
    )
    if (md) url = md[1]
    else {
      const plain = event.content.match(/https?:\/\/[^\s<>"']+\.(?:jpe?g|png|webp)(\?[^\s<>"']*)?/i)
      if (plain) url = plain[0]
    }
  }

  if (!url || !/^https?:\/\//i.test(url)) return {}

  if (!mimeType) {
    const mTag = event.tags.find((t) => t[0] === 'm' && t[1])
    mimeType = mTag?.[1]
  }

  if (!width || !height) {
    const dimTag = event.tags.find((t) => t[0] === 'dim' && t[1])
    const d = parseDim(dimTag?.[1])
    width = width ?? d.width
    height = height ?? d.height
  }

  return { url, mimeType, width, height }
}

function parseMemeFrom1063(event: NEvent): MemeMetadata | null {
  if (!eventHasMemeamigoTag(event)) return null

  const { url, mimeType: parsedMime, width, height } = parseMemeFileUrlFromEvent(event)
  if (!url) return null

  let mimeType = parsedMime?.toLowerCase()
  if (!mimeType || mimeType === 'application/octet-stream') {
    mimeType = inferStaticMimeFromUrl(url)
  }

  if (!isStaticMemeUrl(mimeType, url)) return null

  const sha256Tag = event.tags.find((t) => t[0] === 'x' && t[1])
  const fallbackTag = event.tags.find((t) => t[0] === 'fallback' && t[1])

  return {
    url,
    fallbackUrl: fallbackTag?.[1],
    sha256: sha256Tag?.[1],
    mimeType,
    width,
    height,
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at
  }
}

function parseMemeFromEvent(event: NEvent): MemeMetadata | null {
  if (event.kind !== ExtendedKind.FILE_METADATA) return null
  return parseMemeFrom1063(event)
}

const CACHE_MAX_AGE_MS = 5 * 60 * 1000
const MIN_MEME_CACHE_ENTRIES = 6

const THECITADEL_FOR_FILE_METADATA =
  normalizeUrl('wss://thecitadel.nostr1.com') || 'wss://thecitadel.nostr1.com'

export async function fetchMemes(
  searchQuery?: string,
  limit: number = 50,
  forceRefresh: boolean = false,
  extraReadRelayUrls: string[] = [],
  userPubkey: string | null = null
): Promise<MemeMetadata[]> {
  if (!forceRefresh && !searchQuery) {
    const cached = await indexedDb.getMemeCache()
    if (
      cached &&
      cached.memes.length >= MIN_MEME_CACHE_ENTRIES &&
      Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS
    ) {
      return cached.memes.slice(0, limit) as MemeMetadata[]
    }
  }

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

  const relays1063 = dedupedUrls.some(
    (u) => (normalizeUrl(u) || u).toLowerCase() === THECITADEL_FOR_FILE_METADATA.toLowerCase()
  )
    ? dedupedUrls
    : [...dedupedUrls, THECITADEL_FOR_FILE_METADATA]

  const events = await queryService.fetchEvents(
    relays1063,
    { kinds: [ExtendedKind.FILE_METADATA], limit: limit1063 },
    fetchOpts
  )
  const byUrl = new Map<string, { meme: MemeMetadata; priority: number }>()

  for (const event of events) {
    const meme = parseMemeFromEvent(event)
    if (!meme) continue

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim()
      const content = event.content.toLowerCase()
      const tags = event.tags.flat().join(' ').toLowerCase()
      if (!content.includes(q) && !tags.includes(q)) continue
    }

    const key = normalizeMemeUrl(meme.url)
    const priority =
      userPubkey && event.pubkey === userPubkey ? MEME_PRIORITY.OWN_EVENT : MEME_PRIORITY.OTHER_EVENT
    const existing = byUrl.get(key)
    if (!existing || priority > existing.priority) {
      byUrl.set(key, { meme, priority })
    }
  }

  const memes = Array.from(byUrl.values()).map((v) => v.meme)
  memes.sort((a, b) => b.createdAt - a.createdAt)
  const result = memes.slice(0, limit)

  if (result.length >= MIN_MEME_CACHE_ENTRIES && !searchQuery) {
    await indexedDb.setMemeCache(result, Date.now())
  }

  return result
}

export async function searchMemes(
  query: string,
  limit: number = 50,
  forceRefresh: boolean = false,
  extraReadRelayUrls: string[] = [],
  userPubkey: string | null = null
): Promise<MemeMetadata[]> {
  return fetchMemes(query, limit, forceRefresh, extraReadRelayUrls, userPubkey)
}
