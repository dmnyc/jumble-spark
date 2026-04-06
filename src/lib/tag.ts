import { TEmoji, TImetaInfo } from '@/types'
import { cleanUrl } from './url'
import { isBlurhashValid } from 'blurhash'
import { nip19 } from 'nostr-tools'
import { isValidPubkey } from './pubkey'
import { normalizeHttpUrl } from './url'

export function isSameTag(tag1: string[], tag2: string[]) {
  if (tag1.length !== tag2.length) return false
  for (let i = 0; i < tag1.length; i++) {
    if (tag1[i] !== tag2[i]) return false
  }
  return true
}

export function tagNameEquals(tagName: string) {
  return (tag: string[]) => tag[0] === tagName
}

const NOTE_HEX_ID_RE = /^[0-9a-f]{64}$/i

/** First hex event id on an `e` / `E` tag (reactions, reposts, replies). */
export function getFirstHexEventIdFromETags(tags: string[][]): string | undefined {
  for (const t of tags) {
    if (t[0] !== 'e' && t[0] !== 'E') continue
    const id = t[1]
    if (id && NOTE_HEX_ID_RE.test(id)) return id
  }
  return undefined
}

export function generateBech32IdFromETag(tag: string[]) {
  try {
    const [, id, relay, markerOrPubkey, pubkey] = tag
    let author: string | undefined
    if (markerOrPubkey && isValidPubkey(markerOrPubkey)) {
      author = markerOrPubkey
    } else if (pubkey && isValidPubkey(pubkey)) {
      author = pubkey
    }
    return nip19.neventEncode({ id, relays: relay ? [relay] : undefined, author })
  } catch {
    return undefined
  }
}

export function generateBech32IdFromATag(tag: string[]) {
  try {
    const [, coordinate, relay] = tag
    const [kind, pubkey, identifier] = coordinate.split(':')
    return nip19.naddrEncode({
      kind: Number(kind),
      pubkey,
      identifier,
      relays: relay ? [relay] : undefined
    })
  } catch {
    return undefined
  }
}

export function getImetaInfoFromImetaTag(tag: string[], pubkey?: string): TImetaInfo | null {
  if (tag[0] !== 'imeta') return null
  
  // Handle different imeta tag structures:
  // Structure 1: ["imeta", "url https://example.com/image.jpg", "alt text", ...]
  // Structure 2: ["imeta", "url", "https://example.com/image.jpg", "alt", "text", ...]
  let url: string | undefined
  
  // First try the space-separated format
  const urlItem = tag.find((item) => item.startsWith('url '))
  if (urlItem) {
    url = urlItem.slice(4)
  } else {
    // Try the separate element format
    const urlIndex = tag.findIndex((item) => item === 'url')
    if (urlIndex !== -1 && urlIndex + 1 < tag.length) {
      url = tag[urlIndex + 1]
    }
  }
  
  if (!url) return null

  // Clean the URL to remove tracking parameters
  const cleanedUrl = cleanUrl(url)
  const imeta: TImetaInfo = { url: cleanedUrl, pubkey }
  
  // Parse blurhash
  const blurHashItem = tag.find((item) => item.startsWith('blurhash '))
  const blurHash = blurHashItem?.slice(9)
  if (blurHash) {
    const validRes = isBlurhashValid(blurHash)
    if (validRes.result) {
      imeta.blurHash = blurHash
    }
  }
  
  // Parse dimensions
  const dimItem = tag.find((item) => item.startsWith('dim '))
  const dim = dimItem?.slice(4)
  if (dim) {
    const [width, height] = dim.split('x').map(Number)
    if (width && height) {
      imeta.dim = { width, height }
    }
  }
  
  // Parse MIME type
  let mimeType: string | undefined
  
  // First try the space-separated format
  const mItem = tag.find((item) => item.startsWith('m '))
  if (mItem) {
    mimeType = mItem.slice(2)
  } else {
    // Try the separate element format
    const mIndex = tag.findIndex((item) => item === 'm')
    if (mIndex !== -1 && mIndex + 1 < tag.length) {
      mimeType = tag[mIndex + 1]
    }
  }
  
  if (mimeType) {
    imeta.m = mimeType
  }
  
  // Parse alt text
  let altText: string | undefined
  
  // First try the space-separated format
  const altItem = tag.find((item) => item.startsWith('alt '))
  if (altItem) {
    altText = altItem.slice(4)
  } else {
    // Try the separate element format
    const altIndex = tag.findIndex((item) => item === 'alt')
    if (altIndex !== -1 && altIndex + 1 < tag.length) {
      altText = tag[altIndex + 1]
    }
  }
  
  if (altText) {
    imeta.alt = altText
  }
  
  // Parse SHA256 hash
  let hash: string | undefined
  
  // First try the space-separated format
  const xItem = tag.find((item) => item.startsWith('x '))
  if (xItem) {
    hash = xItem.slice(2)
  } else {
    // Try the separate element format
    const xIndex = tag.findIndex((item) => item === 'x')
    if (xIndex !== -1 && xIndex + 1 < tag.length) {
      hash = tag[xIndex + 1]
    }
  }
  
  if (hash) {
    imeta.x = hash
  }
  
  // Parse fallback URLs
  const fallbackUrls: string[] = []
  
  // First try the space-separated format
  const fallbackItems = tag.filter((item) => item.startsWith('fallback '))
  fallbackItems.forEach((item) => {
    const url = item.slice(9)
    if (url) fallbackUrls.push(cleanUrl(url))
  })
  
  // Also try the separate element format
  let fallbackIndex = 0
  while (fallbackIndex < tag.length) {
    const index = tag.findIndex((item, i) => i >= fallbackIndex && item === 'fallback')
    if (index === -1 || index + 1 >= tag.length) break
    
    const url = tag[index + 1]
    if (url) {
      const cleanedUrl = cleanUrl(url)
      if (!fallbackUrls.includes(cleanedUrl)) {
        fallbackUrls.push(cleanedUrl)
      }
    }
    fallbackIndex = index + 1
  }
  
  if (fallbackUrls.length > 0) {
    imeta.fallback = fallbackUrls
  }
  
  // Parse image/poster URL (for videos)
  let imageUrl: string | undefined
  
  // First try the space-separated format
  const imageItem = tag.find((item) => item.startsWith('image '))
  if (imageItem) {
    imageUrl = imageItem.slice(6)
  } else {
    // Try the separate element format
    const imageIndex = tag.findIndex((item) => item === 'image')
    if (imageIndex !== -1 && imageIndex + 1 < tag.length) {
      imageUrl = tag[imageIndex + 1]
    }
  }
  
  if (imageUrl) {
    imeta.image = cleanUrl(imageUrl)
  }
  
  // Parse thumbnail URL (for images)
  let thumbUrl: string | undefined
  
  // First try the space-separated format
  const thumbItem = tag.find((item) => item.startsWith('thumb '))
  if (thumbItem) {
    thumbUrl = thumbItem.slice(6)
  } else {
    // Try the separate element format
    const thumbIndex = tag.findIndex((item) => item === 'thumb')
    if (thumbIndex !== -1 && thumbIndex + 1 < tag.length) {
      thumbUrl = tag[thumbIndex + 1]
    }
  }
  
  if (thumbUrl) {
    imeta.thumb = cleanUrl(thumbUrl)
  }

  // Parse file size (bytes)
  let fileSize: number | undefined
  const sizeItem = tag.find((item) => item.startsWith('size '))
  if (sizeItem) {
    fileSize = parseInt(sizeItem.slice(5), 10)
  } else {
    const sizeIndex = tag.findIndex((item) => item === 'size')
    if (sizeIndex !== -1 && sizeIndex + 1 < tag.length) {
      fileSize = parseInt(tag[sizeIndex + 1], 10)
    }
  }
  if (fileSize && !isNaN(fileSize)) {
    imeta.size = fileSize
  }
  
  return imeta
}

export function getPubkeysFromPTags(tags: string[][]) {
  return Array.from(
    new Set(
      tags
        .filter(tagNameEquals('p'))
        .map(([, pubkey]) => pubkey)
        .filter((pubkey) => !!pubkey && isValidPubkey(pubkey))
        .reverse()
    )
  )
}

export function getEmojiInfosFromEmojiTags(tags: string[][] = []) {
  return tags
    .map((tag) => {
      if (tag.length < 3 || tag[0] !== 'emoji') return null
      return { shortcode: tag[1], url: tag[2] }
    })
    .filter(Boolean) as TEmoji[]
}

export function getServersFromServerTags(tags: string[][] = []) {
  return tags
    .filter(tagNameEquals('server'))
    .map(([, url]) => (url ? normalizeHttpUrl(url) : ''))
    .filter(Boolean)
}
