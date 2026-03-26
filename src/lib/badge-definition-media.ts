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

/** Resolve `image` / `thumb` / `imeta` URLs from a NIP-58 badge definition (kind 30009). */
export function extractBadgeDefinitionMedia(defEvent: Event | undefined): {
  image?: string
  thumb?: string
} {
  if (!defEvent) return {}
  const tagImage = defEvent.tags.find(tagNameEquals('image'))?.[1]
  const tagThumb = defEvent.tags.find(tagNameEquals('thumb'))?.[1]
  const imetaUrls = getImetaInfosFromEvent(defEvent)
    .map((i) => i.url)
    .filter(Boolean) as string[]
  const orderedThumb = [tagThumb, tagImage, ...imetaUrls].map(resolveHttpMediaUrl).find(Boolean)
  const orderedImage = [tagImage, tagThumb, ...imetaUrls].map(resolveHttpMediaUrl).find(Boolean)
  return {
    thumb: orderedThumb ?? orderedImage,
    image: orderedImage ?? orderedThumb
  }
}
