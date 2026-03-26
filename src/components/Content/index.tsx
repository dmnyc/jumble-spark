import { useMediaExtraction } from '@/hooks'
import { parseContent, PARSE_CONTENT_PARSERS_NOTE_TEXT } from '@/lib/content-parser'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import { logContentSpacing, reprString } from '@/lib/content-spacing-debug'
import logger from '@/lib/logger'
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { cn } from '@/lib/utils'
import { getHttpUrlFromITags } from '@/lib/event'
import { cleanUrl, isImage, isMedia, isAudio, isVideo, isPseudoNostrHttpsUrl } from '@/lib/url'
import { TImetaInfo } from '@/types'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import {
  EmbeddedHashtag,
  EmbeddedLNInvoice,
  EmbeddedMention,
  EmbeddedNormalUrl,
  EmbeddedNote,
  EmbeddedWebsocketUrl
} from '../Embedded'
import PaytoLink from '../PaytoLink'
import Emoji from '../Emoji'
import ImageGallery from '../ImageGallery'
import MediaPlayer from '../MediaPlayer'
import YoutubeEmbeddedPlayer from '../YoutubeEmbeddedPlayer'
import WebPreview from '../WebPreview'
import { toNote } from '@/lib/link'
import { YOUTUBE_URL_REGEX } from '@/constants'

// Helper function to check if a URL is a YouTube URL
function isYouTubeUrl(url: string): boolean {
  if (!url) return false
  // Create a new regex instance without global flag for testing
  const flags = YOUTUBE_URL_REGEX.flags.replace('g', '')
  const regex = new RegExp(YOUTUBE_URL_REGEX.source, flags)
  return regex.test(url)
}

const REDIRECT_REGEX = /Read (naddr1[a-z0-9]+) instead\./i

function renderRedirectText(text: string, key: number) {
  const match = text.match(REDIRECT_REGEX)
  if (!match) {
    return text
  }
  const [fullMatch, naddr] = match
  const [prefix, suffix] = text.split(fullMatch)
  const href = toNote(naddr)
  return (
    <span key={`redirect-${key}`}>
      {prefix}
      Read{' '}
      <a
        className="text-primary hover:underline"
        href={href}
        onClick={(e) => e.stopPropagation()}
      >
        {naddr}
      </a>{' '}
      instead.{suffix}
    </span>
  )
}

export default function Content({
  event,
  content,
  className,
  mustLoadMedia
}: {
  event?: Event
  content?: string
  className?: string
  mustLoadMedia?: boolean
}) {
  const _content = event?.content ?? content
  const iArticleUrl = useMemo(() => (event ? getHttpUrlFromITags(event) : undefined), [event])
  const iArticleCleaned = useMemo(
    () => (iArticleUrl ? cleanUrl(iArticleUrl) || iArticleUrl : ''),
    [iArticleUrl]
  )

  // Use unified media extraction service
  const extractedMedia = useMediaExtraction(event, _content)
  
  const { nodes, emojiInfos } = useMemo(() => {
    if (!_content) return {}

    const emojiInfos = getEmojiInfosFromEmojiTags(event?.tags)
    const customShortcodes = emojiInfos.map((e) => e.shortcode)
    const normalized = replaceStandardEmojiShortcodesInContent(_content, customShortcodes)
    if (normalized.includes('nostr:')) {
      logContentSpacing('Content:useMemo', {
        rawRepr: reprString(_content),
        normalizedRepr: reprString(normalized),
        same: _content === normalized
      })
    }

    const nodes = parseContent(normalized, PARSE_CONTENT_PARSERS_NOTE_TEXT)

    return { nodes, emojiInfos }
  }, [_content, event])

  // Extract HTTP/HTTPS links from content nodes (in order of appearance) for WebPreview cards at bottom
  // Exclude YouTube URLs, images, and media (they're rendered separately)
  const contentLinks = useMemo(() => {
    if (!nodes) return []
    const links: string[] = []
    const seenUrls = new Set<string>()
    
    nodes.forEach((node) => {
      if (node.type === 'url') {
        const url = node.data
        if (
          (url.startsWith('http://') || url.startsWith('https://')) &&
          !isPseudoNostrHttpsUrl(url) &&
          !isImage(url) &&
          !isMedia(url) &&
          !isYouTubeUrl(url)
        ) {
          const cleaned = cleanUrl(url)
          if (cleaned && !seenUrls.has(cleaned) && !(iArticleCleaned && cleaned === iArticleCleaned)) {
            links.push(cleaned)
            seenUrls.add(cleaned)
          }
        }
      }
    })
    
    return links
  }, [nodes, iArticleCleaned])

  // Extract YouTube URLs from r tags to render as players
  const youtubeUrlsFromTags = useMemo(() => {
    if (!event) return []
    const urls: string[] = []
    const seenUrls = new Set<string>()
    
    // Check if YouTube URL is already in content
    const hasYouTubeInContent = nodes?.some(node => node.type === 'youtube') || false
    
    event.tags
      .filter(tag => tag[0] === 'r' && tag[1])
      .forEach(tag => {
        const url = tag[1]
        if (isYouTubeUrl(url)) {
          const cleaned = cleanUrl(url)
          // Only include if not already in content and not already seen
          if (cleaned && !hasYouTubeInContent && !seenUrls.has(cleaned)) {
            urls.push(cleaned)
            seenUrls.add(cleaned)
          }
        }
      })
    
    return urls
  }, [event, nodes])
  
  // Extract HTTP/HTTPS links from r tags (excluding those already in content, YouTube URLs, images, and media)
  const tagLinks = useMemo(() => {
    if (!event) return []
    const links: string[] = []
    const seenUrls = new Set<string>()
    
    // Create a set of content link URLs for quick lookup
    const contentLinkUrls = new Set(contentLinks)
    
    event.tags
      .filter(tag => tag[0] === 'r' && tag[1])
      .forEach(tag => {
        const url = tag[1]
        if (
          (url.startsWith('http://') || url.startsWith('https://')) &&
          !isPseudoNostrHttpsUrl(url) &&
          !isImage(url) &&
          !isMedia(url) &&
          !isYouTubeUrl(url)
        ) {
          const cleaned = cleanUrl(url)
          // Only include if not already in content links and not already seen in tags
          if (cleaned && !contentLinkUrls.has(cleaned) && !seenUrls.has(cleaned)) {
            links.push(cleaned)
            seenUrls.add(cleaned)
          }
        }
      })
    
    return links
  }, [event, contentLinks])

  // Create maps for quick lookup of images/media by cleaned URL
  const imageMap = new Map<string, TImetaInfo>()
  const mediaMap = new Map<string, TImetaInfo>()
  extractedMedia.all.forEach((img: TImetaInfo) => {
    const cleaned = cleanUrl(img.url)
    if (!cleaned) return
    if (img.m?.startsWith('image/')) {
      imageMap.set(cleaned, img)
    } else if (img.m?.startsWith('video/') || img.m?.startsWith('audio/') || img.m === 'media/*') {
      mediaMap.set(cleaned, img)
    } else if (isImage(cleaned)) {
      imageMap.set(cleaned, img)
    } else if (isMedia(cleaned)) {
      mediaMap.set(cleaned, img)
    }
  })

  // If no nodes but we have media from tags, still render the media (or i-tag article preview)
  if (!nodes || nodes.length === 0) {
    if (
      extractedMedia.images.length === 0 &&
      extractedMedia.videos.length === 0 &&
      extractedMedia.audio.length === 0 &&
      !iArticleUrl
    ) {
      return null
    }
  }

  // First pass: find which media appears in content (will be rendered in carousels or inline)
  const mediaInContent = new Set<string>()
  const imagesInContent: TImetaInfo[] = []
  const videosInContent: TImetaInfo[] = []
  const audioInContent: TImetaInfo[] = []
  
  // Only process nodes if they exist and are not empty
  if (nodes && nodes.length > 0) {
    nodes.forEach((node) => {
    if (node.type === 'image') {
      const cleanedUrl = cleanUrl(node.data)
      mediaInContent.add(cleanedUrl)
      const imageInfo = imageMap.get(cleanedUrl) || { url: cleanedUrl, pubkey: event?.pubkey }
      if (!imagesInContent.find(img => img.url === cleanedUrl)) {
        imagesInContent.push(imageInfo)
      }
    } else if (node.type === 'images') {
      const urls = Array.isArray(node.data) ? node.data : [node.data]
      urls.forEach(url => {
        const cleaned = cleanUrl(url)
        mediaInContent.add(cleaned)
        const imageInfo = imageMap.get(cleaned) || { url: cleaned, pubkey: event?.pubkey }
        if (!imagesInContent.find(img => img.url === cleaned)) {
          imagesInContent.push(imageInfo)
        }
      })
    } else if (node.type === 'media') {
      const cleanedUrl = cleanUrl(node.data)
      mediaInContent.add(cleanedUrl)
      const mediaInfo = mediaMap.get(cleanedUrl)
      if (mediaInfo) {
        if (isVideo(cleanedUrl) || mediaInfo.m?.startsWith('video/')) {
          if (!videosInContent.find(v => v.url === cleanedUrl)) {
            videosInContent.push(mediaInfo)
          }
        } else if (isAudio(cleanedUrl) || mediaInfo.m?.startsWith('audio/')) {
          if (!audioInContent.find(a => a.url === cleanedUrl)) {
            audioInContent.push(mediaInfo)
          }
        }
      }
    } else if (node.type === 'url') {
      const cleanedUrl = cleanUrl(node.data)
      if (isImage(cleanedUrl)) {
        mediaInContent.add(cleanedUrl)
        const imageInfo = imageMap.get(cleanedUrl) || { url: cleanedUrl, pubkey: event?.pubkey }
        if (!imagesInContent.find(img => img.url === cleanedUrl)) {
          imagesInContent.push(imageInfo)
        }
      } else if (isVideo(cleanedUrl)) {
        mediaInContent.add(cleanedUrl)
        const videoInfo = mediaMap.get(cleanedUrl) || { url: cleanedUrl, pubkey: event?.pubkey, m: 'video/*' }
        if (!videosInContent.find(v => v.url === cleanedUrl)) {
          videosInContent.push(videoInfo)
        }
      } else if (isAudio(cleanedUrl)) {
        mediaInContent.add(cleanedUrl)
        const audioInfo = mediaMap.get(cleanedUrl) || { url: cleanedUrl, pubkey: event?.pubkey, m: 'audio/*' }
        if (!audioInContent.find(a => a.url === cleanedUrl)) {
          audioInContent.push(audioInfo)
        }
      } else if (isMedia(cleanedUrl)) {
        mediaInContent.add(cleanedUrl)
      }
    }
    })
  }
  
  // Filter: only show media that DON'T appear in content (from tags)
  // Use cleaned URLs for comparison to ensure consistency
  const carouselImages = extractedMedia.images.filter((img: TImetaInfo) => {
    const cleaned = cleanUrl(img.url)
    return cleaned && !mediaInContent.has(cleaned)
  })
  const videosFromTags = extractedMedia.videos.filter((video: TImetaInfo) => {
    const cleaned = cleanUrl(video.url)
    return cleaned && !mediaInContent.has(cleaned)
  })
  const audioFromTags = extractedMedia.audio.filter((audio: TImetaInfo) => {
    const cleaned = cleanUrl(audio.url)
    return cleaned && !mediaInContent.has(cleaned)
  })

  logger.debug('[Content] Parsed content:', { 
    nodeCount: nodes?.length || 0, 
    allMedia: extractedMedia.all.length,
    images: extractedMedia.images.length,
    videos: extractedMedia.videos.length,
    audio: extractedMedia.audio.length,
    imageMapSize: imageMap.size, 
    mediaMapSize: mediaMap.size,
    nodes: nodes?.map(n => ({ type: n.type, data: Array.isArray(n.data) ? n.data.length : n.data })) || [] 
  })
  
  // Track which images/media have been rendered individually to prevent duplicates
  const renderedUrls = new Set<string>()
  
  return (
    <div className={cn('text-wrap break-words whitespace-pre-wrap', className)}>
      {iArticleUrl && (
        <div className="mb-2 max-w-full">
          <WebPreview url={iArticleUrl} className="w-full" />
        </div>
      )}
      {/* Render images that appear in content in a single carousel at the top */}
      {imagesInContent.length > 0 && (
        <ImageGallery
          className="mt-2 mb-4"
          key="content-images-gallery"
          images={imagesInContent}
          start={0}
          end={imagesInContent.length}
          mustLoad={mustLoadMedia}
        />
      )}
      
      {/* Render images/media that aren't in content in a single carousel */}
      {/* This includes images from imeta tags when content is empty */}
      {carouselImages.length > 0 && (
        <ImageGallery
          className="mt-2 mb-4"
          key="tag-images-gallery"
          images={carouselImages}
          start={0}
          end={carouselImages.length}
          mustLoad={mustLoadMedia}
        />
      )}
      
      {/* Render videos from tags that don't appear in content */}
      {videosFromTags.map((video) => (
        <div key={`tag-video-${video.url}`} className="mt-2 w-full max-w-full overflow-hidden">
          <MediaPlayer
            src={video.url}
            className="w-full max-w-full"
            mustLoad={mustLoadMedia}
          />
        </div>
      ))}
      
      {/* Render audio from tags that don't appear in content */}
      {audioFromTags.map((audio) => (
        <MediaPlayer
          key={`tag-audio-${audio.url}`}
          src={audio.url}
          className="mt-2"
          mustLoad={mustLoadMedia}
        />
      ))}
      
      {/* Render YouTube URLs from r tags that don't appear in content */}
      {youtubeUrlsFromTags.map((url) => (
        <YoutubeEmbeddedPlayer
          key={`tag-youtube-${url}`}
          url={url}
          className="mt-2"
          mustLoad={mustLoadMedia}
        />
      ))}
      
      {nodes && nodes.length > 0 && nodes.map((node, index) => {
        if (node.type === 'text') {
          // Skip only completely empty text nodes, but preserve whitespace (important for spacing)
          if (!node.data || node.data.length === 0) {
            return null
          }
          return renderRedirectText(node.data, index)
        }
        // Skip image nodes - they're rendered in the carousel at the top
        if (node.type === 'image' || node.type === 'images') {
          return null
        }
        // Render media individually in their content position
        if (node.type === 'media') {
          const cleanedUrl = cleanUrl(node.data)
          // Skip if already rendered
          if (renderedUrls.has(cleanedUrl)) {
            return null
          }
          renderedUrls.add(cleanedUrl)
          return (
            <MediaPlayer 
              className="mt-2" 
              key={index} 
              src={cleanedUrl} 
              mustLoad={mustLoadMedia} 
            />
          )
        }
        if (node.type === 'url') {
          const cleanedUrl = cleanUrl(node.data)
          // Check if it's an image, video, or audio that should be rendered inline
          const isImageUrl = isImage(cleanedUrl)
          const isVideoUrl = isVideo(cleanedUrl)
          const isAudioUrl = isAudio(cleanedUrl)
          
          // Skip if already rendered (regardless of type)
          if (renderedUrls.has(cleanedUrl)) {
            return null
          }
          
          // Check video/audio first - never put them in ImageGallery
          if (isVideoUrl || isAudioUrl || mediaMap.has(cleanedUrl)) {
            renderedUrls.add(cleanedUrl)
            const mediaInfo = mediaMap.get(cleanedUrl)
            const poster = mediaInfo?.image
            return (
              <MediaPlayer 
                className="mt-2" 
                key={`url-media-${index}`} 
                src={cleanedUrl} 
                mustLoad={mustLoadMedia}
                poster={poster}
              />
            )
          }
          
          // Skip image URLs - they're rendered in the carousel at the top if they're in content
          // Only render if they're NOT in content (from r tags, etc.)
          if (isImageUrl) {
            // If it's in content, skip it (already in carousel)
            if (mediaInContent.has(cleanedUrl)) {
              return null
            }
            // Otherwise it's an image from r tags not in content, render it
            renderedUrls.add(cleanedUrl)
            const imageInfo = imageMap.get(cleanedUrl) || { url: cleanedUrl, pubkey: event?.pubkey }
            return (
              <ImageGallery
                className="mt-2"
                key={`url-img-${index}`}
                images={[imageInfo]}
                start={0}
                end={1}
                mustLoad={mustLoadMedia}
              />
            )
          }
          // Regular URL, not an image or media - show WebPreview (skip if same as i-tag article)
          if (iArticleCleaned && cleanedUrl === iArticleCleaned) {
            return null
          }
          return <EmbeddedNormalUrl url={node.data} key={index} />
        }
        if (node.type === 'invoice') {
          return <EmbeddedLNInvoice invoice={node.data} key={index} className="mt-2" />
        }
        if (node.type === 'payto') {
          return (
            <PaytoLink
              key={index}
              paytoUri={node.data}
              className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
            />
          )
        }
        if (node.type === 'websocket-url') {
          return <EmbeddedWebsocketUrl url={node.data} key={index} />
        }
        if (node.type === 'event') {
          const id = node.data.split(':')[1]
          return <EmbeddedNote key={index} noteId={id} className="mt-2" containingEvent={event} />
        }
        if (node.type === 'mention') {
          return <EmbeddedMention key={index} userId={node.data.split(':')[1]} />
        }
        if (node.type === 'hashtag') {
          return <EmbeddedHashtag hashtag={node.data} key={index} />
        }
        if (node.type === 'emoji') {
          const shortcode = node.data.slice(1, -1).trim()
          const emoji = emojiInfos.find((e) => e.shortcode === shortcode)
          if (emoji) return <Emoji classNames={{ img: 'mb-1' }} emoji={emoji} key={index} />
          const native = shortcodeToEmoji(shortcode, emojis) ?? shortcodeToEmoji(shortcode.replace(/\s+/g, '_'), emojis)
          if (native?.emoji) return <Emoji classNames={{ img: 'mb-1' }} emoji={native.emoji} key={index} />
          return <span key={index}>{node.data}</span>
        }
        if (node.type === 'youtube') {
          return (
            <YoutubeEmbeddedPlayer
              key={index}
              url={node.data}
              className="mt-2"
              mustLoad={mustLoadMedia}
            />
          )
        }
        return null
      })}

      {/* WebPreview cards for links from content (in order of appearance) */}
      {contentLinks.length > 0 && (
        <div className="space-y-3 mt-6 pt-4 border-t">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Links</h3>
          {contentLinks.map((url, index) => (
            <WebPreview key={`content-${index}-${url}`} url={url} className="w-full" />
          ))}
        </div>
      )}

      {/* WebPreview cards for links from tags */}
      {tagLinks.length > 0 && (
        <div className="space-y-3 mt-6 pt-4 border-t">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Related Links</h3>
          {tagLinks.map((url, index) => (
            <WebPreview key={`tag-${index}-${url}`} url={url} className="w-full" />
          ))}
        </div>
      )}
    </div>
  )
}
