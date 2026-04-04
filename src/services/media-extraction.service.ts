import { Event } from 'nostr-tools'
import { getImetaInfosFromEvent } from '@/lib/event'
import { cleanUrl, isImage, isMedia, isAudio, isVideo } from '@/lib/url'
import { TImetaInfo } from '@/types'
import mediaUpload from './media-upload.service'
import { getImetaInfoFromImetaTag } from '@/lib/tag'

export interface ExtractedMedia {
  images: TImetaInfo[]
  videos: TImetaInfo[]
  audio: TImetaInfo[]
  all: TImetaInfo[]
}

/**
 * Unified service for extracting all media (images, videos, audio) from an event
 * Sources: imeta tags, image tags, and content field (not `r` tags — those are references, not media embeds)
 */
export function extractAllMediaFromEvent(
  event: Event,
  content?: string
): ExtractedMedia {
  const seenUrls = new Set<string>()
  const allMedia: TImetaInfo[] = []

  // Helper to add media if not already seen (using cleaned URL for comparison)
  const addMedia = (url: string, pubkey?: string, mimeType?: string) => {
    if (!url) return
    const cleaned = cleanUrl(url)
    if (!cleaned || seenUrls.has(cleaned)) return

    // Only add if it's actually an image or media file
    if (!isImage(cleaned) && !isMedia(cleaned)) return

    seenUrls.add(cleaned)

    // Determine mime type if not provided
    let mime = mimeType
    if (!mime) {
      if (isImage(cleaned)) {
        mime = 'image/*'
      } else if (isAudio(cleaned)) {
        mime = 'audio/*'
      } else if (isVideo(cleaned)) {
        mime = 'video/*'
      } else {
        mime = 'media/*'
      }
    }

    allMedia.push({
      url: cleaned,
      pubkey: pubkey || event.pubkey,
      m: mime
    })
  }

  // 1. Extract from imeta tags (keep full metadata: alt, dim, blurHash, etc.)
  const imetaInfos = getImetaInfosFromEvent(event)
  imetaInfos.forEach((info) => {
    const cleaned = cleanUrl(info.url)
    if (!cleaned || seenUrls.has(cleaned)) return
    if (
      info.m?.startsWith('image/') ||
      info.m?.startsWith('video/') ||
      info.m?.startsWith('audio/') ||
      isImage(info.url) ||
      isMedia(info.url)
    ) {
      seenUrls.add(cleaned)
      allMedia.push({ ...info, url: cleaned })
    }
  })

  // 2. Extract from image tag
  const imageTag = event.tags.find((tag) => tag[0] === 'image' && tag[1])
  if (imageTag?.[1]) {
    addMedia(imageTag[1])
  }

  // 3. Extract from content (if provided)
  if (content) {
    // First, extract from markdown image syntax: ![alt](url) or [![](url)](link)
    // This handles images inside links
    const markdownImageRegex = /!\[[^\]]*\]\(([^)]+)\)/g
    let imgMatch
    while ((imgMatch = markdownImageRegex.exec(content)) !== null) {
      if (imgMatch[1]) {
        const url = imgMatch[1]
        if (isImage(url) || isMedia(url)) {
          addMedia(url)
        }
      }
    }
    
    // Then extract directly from raw content (catch any URLs that weren't parsed)
    const urlRegex = /https?:\/\/[^\s<>"']+/g
    const urlMatches = content.matchAll(urlRegex)
    for (const match of urlMatches) {
      const url = match[0]
      if (isImage(url) || isMedia(url)) {
        addMedia(url)
      }
    }
  }

  // 5. Try to match content URLs with imeta tags for better metadata (alt, dim, blurHash, m)
  imetaInfos.forEach((imeta) => {
    const imetaUrl = cleanUrl(imeta.url)
    allMedia.forEach((media, index) => {
      if (imetaUrl === media.url) {
        allMedia[index] = { ...media, ...imeta, url: media.url }
      } else {
        // Try to get imeta from media upload service
        const tag = mediaUpload.getImetaTagByUrl(media.url)
        if (tag) {
          const parsedImeta = getImetaInfoFromImetaTag(tag, event.pubkey)
          if (parsedImeta) {
            allMedia[index] = { ...media, ...parsedImeta, url: media.url }
          }
        }
      }
    })
  })

  // Categorize media
  const images: TImetaInfo[] = []
  const videos: TImetaInfo[] = []
  const audio: TImetaInfo[] = []

  allMedia.forEach((media) => {
    if (media.m?.startsWith('image/') || isImage(media.url)) {
      images.push(media)
    } else if (media.m?.startsWith('video/') || isVideo(media.url)) {
      videos.push(media)
    } else if (media.m?.startsWith('audio/') || isAudio(media.url)) {
      audio.push(media)
    } else {
      // Fallback: try to determine by URL extension
      if (isImage(media.url)) {
        images.push(media)
      } else if (isVideo(media.url)) {
        videos.push(media)
      } else if (isAudio(media.url)) {
        audio.push(media)
      }
    }
  })

  return {
    images,
    videos,
    audio,
    all: allMedia
  }
}

