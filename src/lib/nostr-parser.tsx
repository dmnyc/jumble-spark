/**
 * Nostr address parser that converts nostr: addresses to embedded content
 */

import { nip19 } from 'nostr-tools'
import { EmbeddedMention, EmbeddedNote } from '@/components/Embedded'
import ImageGallery from '@/components/ImageGallery'
import WebPreview from '@/components/WebPreview'
import { BookstrContent } from '@/components/Bookstr/BookstrContent'
import { cleanUrl, isImage, isMedia } from '@/lib/url'
import { getImetaInfosFromEvent } from '@/lib/event'
import { TImetaInfo } from '@/types'
import { Event } from 'nostr-tools'
import logger from '@/lib/logger'

export interface ParsedNostrContent {
  elements: Array<{
    type: 'text' | 'nostr' | 'image' | 'video' | 'audio' | 'hashtag' | 'wikilink' | 'bookstr-wikilink' | 'gallery' | 'url' | 'jumble-note'
    content: string
    bech32Id?: string
    nostrType?: 'npub' | 'nprofile' | 'nevent' | 'naddr' | 'note'
    mediaUrl?: string
    hashtag?: string
    wikilink?: string
    displayText?: string
    bookstrWikilink?: string
    images?: TImetaInfo[]
    url?: string
    noteId?: string
  }>
}

/**
 * Parse content and convert nostr: addresses and media URLs to embedded components
 */
export function parseNostrContent(content: string, event?: Event): ParsedNostrContent {
  const elements: ParsedNostrContent['elements'] = []
  
  // Regex to match nostr: addresses that are not inside URLs or other contexts
  const nostrRegex = /(?:^|\s|>|\[)nostr:(npub1[a-z0-9]{58}|nprofile1[a-z0-9]+|note1[a-z0-9]{58}|nevent1[a-z0-9]+|naddr1[a-z0-9]+)(?=\s|$|>|\]|,|\.|!|\?|;|:)/g
  
  // Regex to match all URLs (we'll filter by type later)
  const urlRegex = /(https?:\/\/[^\s]+)/gi
  
  
  // Regex to match hashtags
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g
  
  // Regex to match wikilinks: [[target]] or [[target|display text]] or [[book::...]]
  const wikilinkRegex = /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g
  
  // Regex to match Jumble note URLs: https://jumble.imwald.eu/notes/noteId
  const jumbleNoteRegex = /(https:\/\/jumble\.imwald\.eu\/notes\/([a-zA-Z0-9]+))/g
  
  // Collect all matches (nostr, URLs, hashtags, wikilinks, and jumble notes) and sort by position
  const allMatches: Array<{
    type: 'nostr' | 'image' | 'video' | 'audio' | 'hashtag' | 'wikilink' | 'bookstr-wikilink' | 'url' | 'jumble-note'
    match: RegExpExecArray
    start: number
    end: number
    url?: string
    hashtag?: string
    wikilink?: string
    displayText?: string
    bookstrWikilink?: string
    noteId?: string
  }> = []
  
  // Find nostr matches
  let nostrMatch
  while ((nostrMatch = nostrRegex.exec(content)) !== null) {
    if (isNostrAddressInValidContext(content, nostrMatch.index, nostrMatch.index + nostrMatch[0].length)) {
      allMatches.push({
        type: 'nostr',
        match: nostrMatch,
        start: nostrMatch.index,
        end: nostrMatch.index + nostrMatch[0].length
      })
    }
  }
  
  // Find URL matches and categorize them
  let urlMatch
  while ((urlMatch = urlRegex.exec(content)) !== null) {
    const url = urlMatch[1]
    const cleanedUrl = cleanUrl(url)
    
    // Check if it's an image
    if (isImage(cleanedUrl)) {
      allMatches.push({
        type: 'image',
        match: urlMatch,
        start: urlMatch.index,
        end: urlMatch.index + urlMatch[0].length,
        url: cleanedUrl
      })
    }
    // Check if it's media (video/audio)
    else if (isMedia(cleanedUrl)) {
      // Determine if it's video or audio based on extension
      const isVideo = /\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv|m4v)$/i.test(cleanedUrl)
      allMatches.push({
        type: isVideo ? 'video' : 'audio',
        match: urlMatch,
        start: urlMatch.index,
        end: urlMatch.index + urlMatch[0].length,
        url: cleanedUrl
      })
    }
    // Regular URL (not media)
    else {
      allMatches.push({
        type: 'url',
        match: urlMatch,
        start: urlMatch.index,
        end: urlMatch.index + urlMatch[0].length,
        url: cleanedUrl
      })
    }
  }
  
  // Find hashtag matches
  let hashtagMatch
  while ((hashtagMatch = hashtagRegex.exec(content)) !== null) {
    allMatches.push({
      type: 'hashtag',
      match: hashtagMatch,
      start: hashtagMatch.index,
      end: hashtagMatch.index + hashtagMatch[0].length,
      hashtag: hashtagMatch[1]
    })
  }
  
  // Find wikilink matches (including bookstr wikilinks)
  let wikilinkMatch
  while ((wikilinkMatch = wikilinkRegex.exec(content)) !== null) {
    const linkContent = wikilinkMatch[1]
    const displayText = wikilinkMatch[2] || linkContent
    
    // Check if this is a bookstr wikilink (NKBIP-08 format: book::...)
    if (linkContent.startsWith('book::')) {
      allMatches.push({
        type: 'bookstr-wikilink',
        match: wikilinkMatch,
        start: wikilinkMatch.index,
        end: wikilinkMatch.index + wikilinkMatch[0].length,
        bookstrWikilink: linkContent.trim()
      })
    } else {
      allMatches.push({
        type: 'wikilink',
        match: wikilinkMatch,
        start: wikilinkMatch.index,
        end: wikilinkMatch.index + wikilinkMatch[0].length,
        wikilink: linkContent,
        displayText: displayText
      })
    }
  }
  
  // Find Jumble note URL matches
  let jumbleNoteMatch
  while ((jumbleNoteMatch = jumbleNoteRegex.exec(content)) !== null) {
    allMatches.push({
      type: 'jumble-note',
      match: jumbleNoteMatch,
      start: jumbleNoteMatch.index,
      end: jumbleNoteMatch.index + jumbleNoteMatch[0].length,
      url: jumbleNoteMatch[1],
      noteId: jumbleNoteMatch[2]
    })
  }
  
  // Sort matches by position
  allMatches.sort((a, b) => a.start - b.start)
  
  let lastIndex = 0
  
  for (const { type, match, start, end, url, hashtag, wikilink, displayText, bookstrWikilink, noteId } of allMatches) {
    // Add text before the match
    if (start > lastIndex) {
      const textContent = content.slice(lastIndex, start)
      if (textContent) {
        elements.push({
          type: 'text',
          content: textContent
        })
      }
    }
    
    if (type === 'nostr') {
      const bech32Id = match[1]
      const nostrType = getNostrType(bech32Id)
      
      // Add spacing around handles if they're not at the beginning or end of a line
      const isAtStart = start === 0 || content[start - 1] === '\n'
      const isAtEnd = end === content.length || content[end] === '\n'
      const needsSpaceBefore = !isAtStart && content[start - 1] !== ' '
      const needsSpaceAfter = !isAtEnd && content[end] !== ' '
      
      if (needsSpaceBefore) {
        elements.push({
          type: 'text',
          content: ' '
        })
      }
      
      elements.push({
        type: 'nostr',
        content: match[0],
        bech32Id,
        nostrType: nostrType || undefined
      })
      
      if (needsSpaceAfter) {
        elements.push({
          type: 'text',
          content: ' '
        })
      }
      
    } else if (['image', 'video', 'audio'].includes(type) && url) {
      elements.push({
        type: type as 'image' | 'video' | 'audio',
        content: match[0],
        mediaUrl: url
      })
    } else if (type === 'hashtag' && hashtag) {
      elements.push({
        type: 'hashtag',
        content: match[0],
        hashtag: hashtag
      })
    } else if (type === 'bookstr-wikilink' && bookstrWikilink) {
      elements.push({
        type: 'bookstr-wikilink',
        content: match[0],
        bookstrWikilink: bookstrWikilink
      })
    } else if (type === 'wikilink' && wikilink) {
      elements.push({
        type: 'wikilink',
        content: match[0],
        wikilink: wikilink,
        displayText: displayText
      })
    } else if (type === 'url' && url) {
      elements.push({
        type: 'url',
        content: match[0],
        url: url
      })
    } else if (type === 'jumble-note' && url && noteId) {
      elements.push({
        type: 'jumble-note',
        content: match[0],
        url: url,
        noteId: noteId
      })
    }
    
    lastIndex = end
  }
  
  // Add remaining text after the last match
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex)
    if (textContent) {
      elements.push({
        type: 'text',
        content: textContent
      })
    }
  }
  
  // Collect all images from content and imeta tags
  const allImages: TImetaInfo[] = []
  const processedUrls = new Set<string>()
  
  // Add imeta images first (they have priority) - only actual images, not videos
  if (event) {
    const imetaInfos = getImetaInfosFromEvent(event)
    imetaInfos.forEach(imageInfo => {
      // Only add if it's actually an image (not video/audio)
      if (!processedUrls.has(imageInfo.url) && isImage(imageInfo.url)) {
        allImages.push(imageInfo)
        processedUrls.add(imageInfo.url)
      }
    })
  }
  
  // Add content images that aren't already in imeta
  elements.forEach(element => {
    if (element.type === 'image' && element.mediaUrl) {
      if (!processedUrls.has(element.mediaUrl)) {
        allImages.push({ url: element.mediaUrl, pubkey: event?.pubkey })
        processedUrls.add(element.mediaUrl)
      }
    }
  })
  
  // Process imeta videos separately
  if (event) {
    const imetaInfos = getImetaInfosFromEvent(event)
    imetaInfos.forEach(imetaInfo => {
      // Check if it's a video that hasn't been processed yet
      if (isMedia(imetaInfo.url) && !isImage(imetaInfo.url)) {
        // Check if this video is already in elements
        const alreadyProcessed = elements.some(element => 
          element.type === 'video' && element.mediaUrl === imetaInfo.url
        )
        
        if (!alreadyProcessed) {
          // Determine if it's video or audio based on extension
          const isVideo = /\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv|m4v)$/i.test(imetaInfo.url)
          elements.push({
            type: isVideo ? 'video' : 'audio',
            content: imetaInfo.url,
            mediaUrl: imetaInfo.url
          })
        }
      }
    })
  }

  // If we have images, add a gallery element and remove individual image elements
  if (allImages.length > 0) {
    // Remove individual image elements
    const filteredElements = elements.filter(element => element.type !== 'image')
    
    // Add gallery element at the end
    filteredElements.push({
      type: 'gallery',
      content: '',
      images: allImages
    })
    
    return { elements: filteredElements }
  }
  
  // If no special content found, return the whole content as text
  if (elements.length === 0) {
    elements.push({
      type: 'text',
      content
    })
  }
  
  return { elements }
}

/**
 * Check if a nostr address is in a valid context (not inside URLs, etc.)
 */
function isNostrAddressInValidContext(content: string, start: number, _end: number): boolean {
  // Don't parse if it's inside a URL (preceded by http://, https://, or www.)
  const beforeContext = content.slice(Math.max(0, start - 20), start)
  if (beforeContext.match(/(https?:\/\/|www\.)[^\s]*$/)) {
    return false
  }
  
  // Don't parse if it's inside markdown links [text](url) or images ![text](url)
  const beforeMatch = content.slice(Math.max(0, start - 10), start)
  if (beforeMatch.match(/[!]?\[[^\]]*\]\([^)]*$/)) {
    return false
  }
  
  // Don't parse if it's inside HTML tags
  const beforeTag = content.slice(Math.max(0, start - 50), start)
  if (beforeTag.match(/<[^>]*$/)) {
    return false
  }
  
  // Don't parse if it's inside code blocks or inline code
  const beforeCode = content.slice(Math.max(0, start - 10), start)
  if (beforeCode.match(/`[^`]*$/)) {
    return false
  }
  
  // Don't parse if it's inside a code block (```)
  const beforeCodeBlock = content.slice(0, start)
  const codeBlockMatches = beforeCodeBlock.match(/```/g)
  if (codeBlockMatches && codeBlockMatches.length % 2 === 1) {
    return false
  }
  
  return true
}

/**
 * Get the nostr type from a bech32 ID
 */
function getNostrType(bech32Id: string): 'npub' | 'nprofile' | 'nevent' | 'naddr' | 'note' | null {
  try {
    const { type } = nip19.decode(bech32Id)
    if (['npub', 'nprofile', 'nevent', 'naddr', 'note'].includes(type)) {
      return type as 'npub' | 'nprofile' | 'nevent' | 'naddr' | 'note'
    }
  } catch (error) {
    logger.error('Invalid bech32 ID', { bech32Id, error })
  }
  return null
}

/**
 * Render parsed nostr content as React elements
 */
export function renderNostrContent(parsedContent: ParsedNostrContent, className?: string): JSX.Element {
  return (
    <div className={className}>
      {parsedContent.elements.map((element, index) => {
        if (element.type === 'text') {
          return (
            <span key={index} className="whitespace-pre-wrap break-words">
              {element.content}
            </span>
          )
        }
        
        if (element.type === 'gallery' && element.images) {
          return (
            <div key={index} className="my-2">
              <ImageGallery
                images={element.images}
                className="max-w-[400px]"
              />
            </div>
          )
        }
        
        if (element.type === 'video' && element.mediaUrl) {
          return (
            <video
              key={index}
              src={element.mediaUrl}
              controls
              className="max-w-full sm:max-w-[400px] w-full h-auto rounded-lg my-2 block"
              preload="metadata"
              onError={(e) => {
                // Fallback to text if video fails to load
                const target = e.target as HTMLVideoElement
                target.style.display = 'none'
                const textSpan = document.createElement('span')
                textSpan.className = 'whitespace-pre-wrap break-words text-primary hover:underline'
                textSpan.textContent = element.content
                target.parentNode?.insertBefore(textSpan, target.nextSibling)
              }}
            >
              Your browser does not support the video tag.
            </video>
          )
        }
        
        if (element.type === 'audio' && element.mediaUrl) {
          return (
            <audio
              key={index}
              src={element.mediaUrl}
              controls
              className="w-full my-2 block"
              preload="metadata"
              onError={(e) => {
                // Fallback to text if audio fails to load
                const target = e.target as HTMLAudioElement
                target.style.display = 'none'
                const textSpan = document.createElement('span')
                textSpan.className = 'whitespace-pre-wrap break-words text-primary hover:underline'
                textSpan.textContent = element.content
                target.parentNode?.insertBefore(textSpan, target.nextSibling)
              }}
            >
              Your browser does not support the audio tag.
            </audio>
          )
        }
        
        if (element.type === 'hashtag' && element.hashtag) {
          const normalizedHashtag = element.hashtag.toLowerCase()
          // Only render as green link if this hashtag was parsed from the content
          // (parseNostrContent already only extracts hashtags from content, not t-tags)
          const nextElement = parsedContent.elements[index + 1]
          const shouldAddSpace = nextElement && nextElement.type === 'hashtag'
          
          return (
            <>
              <a
                key={index}
                href={`/notes?t=${normalizedHashtag}`}
                className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words cursor-pointer"
              >
                #{element.hashtag}
              </a>
              {shouldAddSpace && <span> </span>}
            </>
          )
        }
        
        if (element.type === 'bookstr-wikilink' && element.bookstrWikilink) {
          return (
            <BookstrContent
              key={index}
              wikilink={element.bookstrWikilink}
              className="my-2"
            />
          )
        }
        
        if (element.type === 'wikilink' && element.wikilink && element.displayText) {
          const normalizedWikilink = element.wikilink.toLowerCase()
          return (
            <a
              key={index}
              href={`/wiki/${encodeURIComponent(normalizedWikilink)}`}
              className="text-primary hover:text-primary/80 hover:underline break-words"
            >
              {element.displayText}
            </a>
          )
        }
        
        if (element.type === 'url' && element.url) {
          // Use WebPreview for URLs to show OpenGraph cards
          return (
            <WebPreview
              key={index}
              url={element.url}
              className="mt-2"
            />
          )
        }
        
        if (element.type === 'jumble-note' && element.noteId) {
          return (
            <EmbeddedNote
              key={index}
              noteId={element.noteId}
              className="not-prose inline-block"
            />
          )
        }
        
        if (element.type === 'nostr' && element.bech32Id && element.nostrType) {
          // Render as embedded content
          if (element.nostrType === 'npub' || element.nostrType === 'nprofile') {
            return (
              <EmbeddedMention 
                key={index} 
                userId={element.bech32Id} 
                className="inline" 
              />
            )
          } else if (['nevent', 'naddr', 'note'].includes(element.nostrType)) {
            return (
              <EmbeddedNote 
                key={index} 
                noteId={element.bech32Id} 
                className="not-prose inline-block" 
              />
            )
          }
        }
        
        // Fallback to text if something goes wrong
        return (
          <span key={index} className="whitespace-pre-wrap break-words">
            {element.content}
          </span>
        )
      })}
    </div>
  )
}
