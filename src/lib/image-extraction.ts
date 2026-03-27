import { Event } from 'nostr-tools'
import { TImetaInfo } from '@/types'
import { getImetaInfosFromEvent } from '@/lib/event'

/**
 * Extract and normalize all images from an event
 * This includes images from:
 * - imeta tags
 * - content (markdown images, HTML img tags, etc.)
 * - metadata (title image, etc.)
 */
export function extractAllImagesFromEvent(event: Event): TImetaInfo[] {
  const images: TImetaInfo[] = []
  const seenUrls = new Set<string>()

  // Helper function to add media if not already seen
  const addMedia = (url: string, pubkey: string = event.pubkey) => {
    if (!url || seenUrls.has(url)) return
    
    // Normalize URL
    const normalizedUrl = normalizeImageUrl(url)
    if (!normalizedUrl) return

    // Check if it's media (image or video)
    const isVideo = isVideoUrl(normalizedUrl)
    const isImage = isImageUrl(normalizedUrl)
    
    if (!isImage && !isVideo) return

    images.push({
      url: normalizedUrl,
      pubkey,
      m: isVideo ? 'video/*' : 'image/*'
    })
    seenUrls.add(normalizedUrl)
  }

  // 1. Extract from imeta tags
  const imetaMedia = getImetaInfosFromEvent(event)
  imetaMedia.forEach((item: TImetaInfo) => {
    if (item.m?.startsWith('image/') || item.m?.startsWith('video/')) {
      addMedia(item.url, item.pubkey)
    }
  })

  // 2. Extract from content - markdown images
  const markdownImageRegex = /!\[.*?\]\((.*?)\)/g
  let match
  while ((match = markdownImageRegex.exec(event.content)) !== null) {
    addMedia(match[1])
  }

  // 3. Extract from content - HTML img tags
  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  while ((match = htmlImgRegex.exec(event.content)) !== null) {
    addMedia(match[1])
  }

  // 4. Extract from content - HTML video tags
  const htmlVideoRegex = /<video[^>]+src=["']([^"']+)["'][^>]*>/gi
  while ((match = htmlVideoRegex.exec(event.content)) !== null) {
    addMedia(match[1])
  }

  // 5. Extract from content - AsciiDoc images
  const asciidocImageRegex = /image::([^\s\[]+)(?:\[.*?\])?/g
  while ((match = asciidocImageRegex.exec(event.content)) !== null) {
    addMedia(match[1])
  }

  // 6. Extract from metadata
  const imageTag = event.tags.find(tag => tag[0] === 'image' && tag[1])
  
  if (imageTag?.[1]) {
    addMedia(imageTag[1])
  }

  // 7. Extract from content - general URL patterns that look like media
  const mediaUrlRegex = /https?:\/\/[^\s<>"']+\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico|mp4|webm|ogg|avi|mov|wmv|flv|mkv)(?:\?[^\s<>"']*)?/gi
  while ((match = mediaUrlRegex.exec(event.content)) !== null) {
    addMedia(match[0])
  }

  return images
}

/**
 * Normalize image URL
 */
function normalizeImageUrl(url: string): string | null {
  if (!url) return null

  // Remove common tracking parameters
  const cleanUrl = url
    .replace(/[?&](utm_[^&]*)/g, '')
    .replace(/[?&](fbclid|gclid|msclkid)=[^&]*/g, '')
    .replace(/[?&]w=\d+/g, '')
    .replace(/[?&]h=\d+/g, '')
    .replace(/[?&]q=\d+/g, '')
    .replace(/[?&]f=\w+/g, '')
    .replace(/[?&]auto=\w+/g, '')
    .replace(/[?&]format=\w+/g, '')
    .replace(/[?&]fit=\w+/g, '')
    .replace(/[?&]crop=\w+/g, '')
    .replace(/[?&]&+/g, '&')
    .replace(/[?&]$/, '')
    .replace(/\?$/, '')

  // Ensure it's a valid URL
  try {
    new URL(cleanUrl)
    return cleanUrl
  } catch {
    return null
  }
}

/**
 * Check if URL is likely an image (extension or known image host).
 */
export function isImageUrl(url: string): boolean {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico)(\?.*)?$/i
  const imageDomains = [
    'i.nostr.build',
    'image.nostr.build',
    'nostr.build',
    'imgur.com',
    'imgur.io',
    'i.imgur.com',
    'cdn.discordapp.com',
    'media.discordapp.net',
    'pbs.twimg.com',
    'abs.twimg.com',
    'images.unsplash.com',
    'source.unsplash.com',
    'picsum.photos',
    'via.placeholder.com',
    'placehold.co',
    'placehold.it'
  ]

  // Check file extension
  if (imageExtensions.test(url)) {
    return true
  }

  // Check known image domains
  try {
    const urlObj = new URL(url)
    return imageDomains.some(domain => 
      urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}

/**
 * Check if URL is likely a video
 */
function isVideoUrl(url: string): boolean {
  const videoExtensions = /\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv|m4v|3gp|ogv)(\?.*)?$/i
  const videoDomains = [
    'youtube.com',
    'youtu.be',
    'vimeo.com',
    'dailymotion.com',
    'twitch.tv',
    'streamable.com',
    'gfycat.com',
    'redgifs.com',
    'cdn.discordapp.com',
    'media.discordapp.net'
  ]

  // Check file extension
  if (videoExtensions.test(url)) {
    return true
  }

  // Check known video domains
  try {
    const urlObj = new URL(url)
    return videoDomains.some(domain => 
      urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}
