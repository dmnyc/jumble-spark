import { getImetaInfosFromEvent } from '@/lib/event'
import { tagNameEquals } from '@/lib/tag'
import { cleanUrl } from '@/lib/url'
import { Event } from 'nostr-tools'

export function resolveHttpMediaUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  const s = raw.trim()
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return cleanUrl(u.toString()) || u.toString()
  } catch {
    return undefined
  }
}

/** NIP-58 allows multiple `thumb` tags; prefer a medium size for grid tiles when dimensions are tagged. */
function pickThumbFromDefinitionTags(defEvent: Event): string | undefined {
  const thumbTags = defEvent.tags.filter(tagNameEquals('thumb'))
  if (thumbTags.length === 0) return undefined
  const preferredDims = ['256x256', '512x512', '128x128', '64x64', '32x32', '16x16', '1024x1024']
  for (const dim of preferredDims) {
    const row = thumbTags.find((t) => t[2] === dim)
    const u = row && resolveHttpMediaUrl(row[1])
    if (u) return u
  }
  for (const t of thumbTags) {
    const u = resolveHttpMediaUrl(t[1])
    if (u) return u
  }
  return undefined
}

/** Resolve `image` / `thumb` / `imeta` URLs from a NIP-58 badge definition (kind 30009). */
export function extractBadgeDefinitionMedia(defEvent: Event | undefined): {
  image?: string
  thumb?: string
} {
  if (!defEvent) return {}
  const tagImage = defEvent.tags.find(tagNameEquals('image'))?.[1]
  const tagThumb = pickThumbFromDefinitionTags(defEvent)
  const imetaUrls = getImetaInfosFromEvent(defEvent)
    .map((i) => i.url)
    .filter(Boolean) as string[]
  const imageResolved = [tagImage, ...imetaUrls].map(resolveHttpMediaUrl).find(Boolean)
  const thumbResolved = [tagThumb, tagImage, ...imetaUrls].map(resolveHttpMediaUrl).find(Boolean)
  return {
    thumb: thumbResolved ?? imageResolved,
    image: imageResolved ?? thumbResolved
  }
}
