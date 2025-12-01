import { useSecondaryPage, useSmartHashtagNavigation, useSmartRelayNavigation } from '@/PageManager'
import Image from '@/components/Image'
import MediaPlayer from '@/components/MediaPlayer'
import YoutubeEmbeddedPlayer from '@/components/YoutubeEmbeddedPlayer'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNoteList } from '@/lib/link'
import { useMediaExtraction } from '@/hooks'
import { cleanUrl, isImage, isMedia, isVideo, isAudio, isWebsocketUrl } from '@/lib/url'
import { getImetaInfosFromEvent } from '@/lib/event'
import { Event, kinds } from 'nostr-tools'
import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, Root } from 'react-dom/client'
import Lightbox from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import { EmbeddedNote, EmbeddedMention } from '@/components/Embedded'
import EmbeddedCitation from '@/components/EmbeddedCitation'
import Wikilink from '@/components/UniversalContent/Wikilink'
import { BookstrContent } from '@/components/Bookstr'
import { preprocessAsciidocMediaLinks } from '../MarkdownArticle/preprocessMarkup'
import logger from '@/lib/logger'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { ExtendedKind } from '@/constants'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { WS_URL_REGEX, YOUTUBE_URL_REGEX } from '@/constants'

/**
 * Truncate link display text to 200 characters, adding ellipsis if truncated
 */
function truncateLinkText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) {
    return text
  }
  return text.substring(0, maxLength) + '...'
}

/**
 * Check if a URL is a YouTube URL
 */
function isYouTubeUrl(url: string): boolean {
  // Create a new regex instance to avoid state issues with global regex
  // Keep the 'i' flag for case-insensitivity but remove 'g' to avoid state issues
  const flags = YOUTUBE_URL_REGEX.flags.replace('g', '')
  const regex = new RegExp(YOUTUBE_URL_REGEX.source, flags)
  return regex.test(url)
}

/**
 * Convert markdown syntax to AsciiDoc syntax
 * This converts all markdown elements to their AsciiDoc equivalents before processing
 */
function convertMarkdownToAsciidoc(content: string): string {
  let asciidoc = content
  
  // Note: We don't remove front matter here because the user's content uses --- as horizontal rules
  // If there's actual YAML front matter, it should be handled separately
  // For now, we'll convert --- to horizontal rules (except table separators)
  
  // Convert nostr addresses directly to AsciiDoc link format
  // Do this early so they're protected from other markdown conversions
  // naddr addresses can be 200+ characters, so we use + instead of specific length
  asciidoc = asciidoc.replace(/nostr:(npub1[a-z0-9]{58,}|nprofile1[a-z0-9]+|note1[a-z0-9]{58,}|nevent1[a-z0-9]+|naddr1[a-z0-9]+)/g, (_match, bech32Id) => {
    // Convert directly to AsciiDoc link format
    // This will be processed later in HTML post-processing to render as React components
    return `link:nostr:${bech32Id}[${bech32Id}]`
  })
  
  // Protect code blocks - we'll process them separately
  const codeBlockPlaceholders: string[] = []
  asciidoc = asciidoc.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlockPlaceholders.length}__`
    codeBlockPlaceholders.push(`[source${lang ? ',' + lang : ''}]\n----\n${code.trim()}\n----`)
    return placeholder
  })
  
  // Protect inline code - but handle LaTeX math separately
  const inlineCodePlaceholders: string[] = []
  
  // Handle LaTeX math in inline code blocks like `$...$`
  // The content may have escaped backslashes: `$\\frac{\\infty}{21,000,000} = \\infty$`
  // We need to detect LaTeX math and convert it to AsciiDoc stem: syntax
  asciidoc = asciidoc.replace(/`([^`\n]+)`/g, (_match, content) => {
    // Check if this is LaTeX math - pattern: $...$ where ... contains LaTeX syntax
    // Match the full pattern: $ followed by LaTeX expression and ending with $
    const latexMatch = content.match(/^\$([^$]+)\$$/)
    if (latexMatch) {
      // This is pure LaTeX math - convert to AsciiDoc stem syntax
      const latexExpr = latexMatch[1]
      // The latexExpr contains the LaTeX code (backslashes are already in the string)
      // AsciiDoc stem:[...] will process this with the stem processor
      return `stem:[${latexExpr}]`
    }
    
    // Check if content contains LaTeX math mixed with other text
    if (content.includes('$') && content.match(/\$[^$]+\$/)) {
      // Replace $...$ parts with stem:[...]
      const processed = content.replace(/\$([^$]+)\$/g, 'stem:[$1]')
      // If it's now just stem, return it directly, otherwise it needs to be in code
      if (processed.startsWith('stem:[') && processed.endsWith(']') && !processed.includes('`')) {
        return processed
      }
      // Mixed content - keep as code but with stem inside (won't work well, but preserve it)
      const placeholder = `__INLINE_CODE_${inlineCodePlaceholders.length}__`
      inlineCodePlaceholders.push(`\`${processed}\``)
      return placeholder
    }
    
    // Regular inline code - preserve it
    const placeholder = `__INLINE_CODE_${inlineCodePlaceholders.length}__`
    inlineCodePlaceholders.push(`\`${content}\``)
    return placeholder
  })
  
  // Convert headers (must be at start of line)
  asciidoc = asciidoc.replace(/^#{6}\s+(.+)$/gm, '====== $1 ======')
  asciidoc = asciidoc.replace(/^#{5}\s+(.+)$/gm, '===== $1 =====')
  asciidoc = asciidoc.replace(/^#{4}\s+(.+)$/gm, '==== $1 ====')
  asciidoc = asciidoc.replace(/^#{3}\s+(.+)$/gm, '=== $1 ===')
  asciidoc = asciidoc.replace(/^#{2}\s+(.+)$/gm, '== $1 ==')
  asciidoc = asciidoc.replace(/^#{1}\s+(.+)$/gm, '= $1 =')
  
  // Convert tables BEFORE horizontal rules (to avoid converting table separators)
  // Markdown tables: | col1 | col2 |\n|------|------|\n| data1 | data2 |
  // Use a simpler approach: match lines with pipes, separator row, and data rows
  asciidoc = asciidoc.replace(/(\|[^\n]+\|\s*\n\|[\s\-\|:]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)/gm, (match) => {
    const lines = match.trim().split('\n').map(line => line.trim()).filter(line => line)
    if (lines.length < 2) return match
    
    // First line is header, second is separator, rest are data
    const headerRow = lines[0]
    const separatorRow = lines[1]
    
    // Verify it's a table separator (has dashes)
    if (!separatorRow.match(/[\-:]/)) return match
    
    // Parse header cells - markdown format: | col1 | col2 | col3 |
    // When split by |, we get: ['', ' col1 ', ' col2 ', ' col3 ', '']
    // We need to extract all non-empty cells
    const headerParts = headerRow.split('|')
    const headerCells: string[] = []
    for (let i = 0; i < headerParts.length; i++) {
      const cell = headerParts[i].trim()
      // Skip empty cells only at the very start and end
      if (cell === '' && (i === 0 || i === headerParts.length - 1)) continue
      headerCells.push(cell)
    }
    
    if (headerCells.length < 2) return match
    
    const colCount = headerCells.length
    const dataRows = lines.slice(2)
    
    // Build AsciiDoc table - use equal width columns
    let tableAsciidoc = `[cols="${Array(colCount).fill('*').join(',')}"]\n|===\n`
    
    // Header row - prefix each cell with . to make it a header cell in AsciiDoc
    // Ensure cells are properly formatted (no leading/trailing spaces, escape special chars)
    const headerRowCells = headerCells.map(cell => {
      // Clean up the cell content
      let cleanCell = cell.trim()
      // Escape pipe characters if any
      cleanCell = cleanCell.replace(/\|/g, '\\|')
      // Return with . prefix for header
      return `.${cleanCell}`
    })
    tableAsciidoc += headerRowCells.join('|') + '\n\n'
    
    // Data rows
    dataRows.forEach(row => {
      if (!row.includes('|')) return
      const rowParts = row.split('|')
      const rowCells: string[] = []
      
      // Parse data row cells the same way as header
      for (let i = 0; i < rowParts.length; i++) {
        const cell = rowParts[i].trim()
        // Skip empty cells only at the very start and end
        if (cell === '' && (i === 0 || i === rowParts.length - 1)) continue
        rowCells.push(cell)
      }
      
      // Ensure we have the right number of cells
      while (rowCells.length < colCount) {
        rowCells.push('')
      }
      
      // Take only the number of columns we need
      const finalCells = rowCells.slice(0, colCount)
      tableAsciidoc += finalCells.map(cell => cell.replace(/\|/g, '\\|')).join('|') + '\n'
    })
    
    tableAsciidoc += '|==='
    return tableAsciidoc
  })
  
  // Convert horizontal rules (but not table separators, which are already processed)
  // Convert standalone --- lines to AsciiDoc horizontal rule
  // We do this after table processing to avoid interfering with table separators
  asciidoc = asciidoc.replace(/^---\s*$/gm, (match, offset, string) => {
    // Check if this is part of a table separator (would have been processed already)
    const lines = string.split('\n')
    const lineIndex = string.substring(0, offset).split('\n').length - 1
    const prevLine = lines[lineIndex - 1]?.trim() || ''
    const nextLine = lines[lineIndex + 1]?.trim() || ''
    
    // If it looks like a table separator (has pipes nearby), don't convert
    if (prevLine.includes('|') || nextLine.includes('|')) {
      return match
    }
    
    // Convert to AsciiDoc horizontal rule (three single quotes)
    return '\'\'\''
  })
  
  // Convert blockquotes - handle multi-line blockquotes
  // Match consecutive lines starting with >
  asciidoc = asciidoc.replace(/(^>\s+.+(?:\n>\s+.+)*)/gm, (match) => {
    const lines = match.split('\n').map((line: string) => line.replace(/^>\s*/, ''))
    const content = lines.join('\n').trim()
    return `____\n${content}\n____`
  })
  
  // Convert lists (must be at start of line)
  // Unordered lists: *, -, +
  asciidoc = asciidoc.replace(/^(\s*)[\*\-\+]\s+(.+)$/gm, '$1* $2')
  // Ordered lists: 1., 2., etc.
  asciidoc = asciidoc.replace(/^(\s*)\d+\.\s+(.+)$/gm, '$1. $2')
  
  // Protect existing AsciiDoc links (both url[text] and link:url[text] formats)
  // Do this FIRST before any other processing to avoid double-processing
  const asciidocLinkPlaceholders: string[] = []
  // Match AsciiDoc link format: url[text] or link:url[text]
  // Pattern matches: http(s)://url[text] or link:url[text]
  // URL can contain dots, slashes, hyphens, etc., but stops at whitespace or [
  // Then we match [text] where text can contain anything except ]
  // Use a more permissive pattern - match URL until [ then match [text]
  // The URL part can contain most characters except whitespace and [
  asciidoc = asciidoc.replace(/(https?:\/\/[^\s\[\]]+\[[^\]]+\])/g, (_match, link) => {
    // This is an AsciiDoc link format (url[text]), protect it
    const placeholder = `__ASCIIDOC_LINK_${asciidocLinkPlaceholders.length}__`
    asciidocLinkPlaceholders.push(link)
    return placeholder
  })
  // Also protect link:url[text] format
  asciidoc = asciidoc.replace(/(link:[^\s\[\]]+\[[^\]]+\])/g, (_match, link) => {
    const placeholder = `__ASCIIDOC_LINK_${asciidocLinkPlaceholders.length}__`
    asciidocLinkPlaceholders.push(link)
    return placeholder
  })
  
  // Convert images: ![alt](url) -> image:url[alt] (single colon for inline, but AsciiDoc will render as block)
  // For block images in AsciiDoc, we can use image:: or just ensure it's on its own line
  asciidoc = asciidoc.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    // Escape brackets in alt text and URL if needed
    const escapedAlt = alt.replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/"/g, '&quot;')
    // Use image:: for block-level images (double colon)
    // Add width attribute to make it responsive
    return `image::${url}[${escapedAlt},width=100%]`
  })
  
  // Convert links: [text](url) -> link:url[text]
  asciidoc = asciidoc.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    // Skip if it was an image (shouldn't happen after image conversion, but safety check)
    if (match.startsWith('![')) return match
    // Escape brackets in link text
    const escapedText = text.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
    return `link:${url}[${escapedText}]`
  })
  
  // Restore AsciiDoc links
  asciidocLinkPlaceholders.forEach((link, index) => {
    asciidoc = asciidoc.replace(`__ASCIIDOC_LINK_${index}__`, link)
  })
  
  // Nostr addresses are already converted to link: format above, no need to restore
  
  // Convert strikethrough: ~~text~~ -> [line-through]#text#
  // Also handle single tilde strikethrough: ~text~ -> [line-through]#text#
  asciidoc = asciidoc.replace(/~~([^~\n]+?)~~/g, '[line-through]#$1#')
  // Single tilde strikethrough (common in some markdown flavors)
  asciidoc = asciidoc.replace(/(?<!~)~([^~\n]+?)~(?!~)/g, '[line-through]#$1#')
  
  // Note: Subscript ~text~ is now handled as strikethrough above
  // If you need subscript, use a different syntax or handle it differently
  
  // Convert superscript: ^text^
  asciidoc = asciidoc.replace(/\^([^\^\n]+?)\^/g, '[superscript]#$1#')
  
  // Convert bold: **text** or __text__
  asciidoc = asciidoc.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*')
  asciidoc = asciidoc.replace(/__(?!_)([^_\n]+?)(?<!_)__/g, '*$1*')
  
  // Convert italic: *text* or _text_ (but not if already bold)
  // Process single asterisk for italic (but not if it's part of **bold**)
  asciidoc = asciidoc.replace(/(?<!\*)\*(?![\*\s])([^\*\n]+?)(?<!\*)\*(?!\*)/g, (match, text) => {
    // Skip if it looks like a list item
    if (/^\s*\*\s/.test(match)) return match
    // Skip if already processed as bold (shouldn't happen, but safety)
    if (match.includes('*$1*')) return match
    return `_${text}_`
  })
  // Process single underscore for italic
  asciidoc = asciidoc.replace(/(?<!_)_(?!_)([^_\n]+?)(?<!_)_(?!_)/g, (match, text) => {
    // Skip if already processed as bold
    if (match.includes('*$1*')) return match
    return `_${text}_`
  })
  
  // Restore inline code
  inlineCodePlaceholders.forEach((code, index) => {
    asciidoc = asciidoc.replace(`__INLINE_CODE_${index}__`, code)
  })
  
  // Restore code blocks
  codeBlockPlaceholders.forEach((block, index) => {
    asciidoc = asciidoc.replace(`__CODE_BLOCK_${index}__`, block)
  })
  
  return asciidoc
}

export default function AsciidocArticle({
  event,
  className,
  hideImagesAndInfo = false
}: {
  event: Event
  className?: string
  hideImagesAndInfo?: boolean
}) {
  const { push } = useSecondaryPage()
  const { navigateToHashtag } = useSmartHashtagNavigation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const bookMetadata = useMemo(() => extractBookMetadata(event), [event])
  const isBookstrEvent = (event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata.book
  const contentRef = useRef<HTMLDivElement>(null)
  
  // Preprocess content: convert all markdown to AsciiDoc syntax
  const processedContent = useMemo(() => {
    let content = event.content
    
    // Normalize excessive newlines (reduce 3+ to 2)
    content = content.replace(/\n\s*\n\s*\n+/g, '\n\n')
    
    // PROTECT WIKILINKS FIRST before any other processing
    // This prevents AsciiDoc or other processors from converting them to regular links
    // First, protect bookstr wikilinks by converting them to passthrough format
    // Don't use [[...]] inside passthrough as AsciiDoc processes it - use a plain marker instead
    content = content.replace(/\[\[book::([^\]]+)\]\]/g, (_match, bookContent) => {
      const cleanContent = bookContent.trim()
      // Use AsciiDoc passthrough without brackets - AsciiDoc processes [[...]] even in passthrough
      // Use a unique marker format that won't conflict with other content
      return `+++BOOKSTR_MARKER:${cleanContent}:BOOKSTR_END+++`
    })
    
    // Then protect regular wikilinks by converting them to passthrough format
    // This prevents AsciiDoc from processing them and prevents URLs inside from being processed
    content = content.replace(/\[\[([^\]]+)\]\]/g, (_match, linkContent) => {
      // Skip if this was already processed as a bookstr wikilink (shouldn't happen, but safety check)
      if (linkContent.startsWith('book::')) {
        return _match
      }
      // Convert to AsciiDoc passthrough format so it's preserved
      return `+++WIKILINK:${linkContent}+++`
    })
    
    // Convert all markdown syntax to AsciiDoc syntax
    content = convertMarkdownToAsciidoc(content)
    
    // Now process raw URLs that aren't already in AsciiDoc syntax
    content = preprocessAsciidocMediaLinks(content)
    
    // Convert "Read naddr... instead." patterns to AsciiDoc links
    const redirectRegex = /Read (naddr1[a-z0-9]+) instead\./gi
    content = content.replace(redirectRegex, (_match, naddr) => {
      return `Read link:/notes/${naddr}[${naddr}] instead.`
    })
    
    return content
  }, [event.content])
  
  // Extract all media from event
  const extractedMedia = useMediaExtraction(event, event.content)
  
  // Extract media from tags only (for display at top)
  const tagMedia = useMemo(() => {
    const seenUrls = new Set<string>()
    const media: Array<{ url: string; type: 'image' | 'video' | 'audio'; poster?: string }> = []
    
    // Extract from imeta tags
    const imetaInfos = getImetaInfosFromEvent(event)
    imetaInfos.forEach((info) => {
      const cleaned = cleanUrl(info.url)
      if (!cleaned || seenUrls.has(cleaned)) return
      if (!isImage(cleaned) && !isMedia(cleaned)) return
      
      seenUrls.add(cleaned)
      if (info.m?.startsWith('image/') || isImage(cleaned)) {
        media.push({ url: info.url, type: 'image' })
      } else if (info.m?.startsWith('video/') || isVideo(cleaned)) {
        media.push({ url: info.url, type: 'video', poster: info.image })
      } else if (info.m?.startsWith('audio/') || isAudio(cleaned)) {
        media.push({ url: info.url, type: 'audio' })
      }
    })
    
    // Extract from r tags
    event.tags.filter(tag => tag[0] === 'r' && tag[1]).forEach(tag => {
      const url = tag[1]
      const cleaned = cleanUrl(url)
      if (!cleaned || seenUrls.has(cleaned)) return
      if (!isImage(cleaned) && !isMedia(cleaned)) return
      
      seenUrls.add(cleaned)
      if (isImage(cleaned)) {
        media.push({ url, type: 'image' })
      } else if (isVideo(cleaned)) {
        media.push({ url, type: 'video' })
      } else if (isAudio(cleaned)) {
        media.push({ url, type: 'audio' })
      }
    })
    
    // Extract from image tag
    const imageTag = event.tags.find(tag => tag[0] === 'image' && tag[1])
    if (imageTag?.[1]) {
      const cleaned = cleanUrl(imageTag[1])
      if (cleaned && !seenUrls.has(cleaned) && isImage(cleaned)) {
        seenUrls.add(cleaned)
        media.push({ url: imageTag[1], type: 'image' })
      }
    }
    
    return media
  }, [event.id, JSON.stringify(event.tags)])
  
  // Extract YouTube URLs from tags (for display at top)
  const tagYouTubeUrls = useMemo(() => {
    const youtubeUrls: string[] = []
    const seenUrls = new Set<string>()
    
    event.tags
      .filter(tag => tag[0] === 'r' && tag[1])
      .forEach(tag => {
        const url = tag[1]
        if (!url.startsWith('http://') && !url.startsWith('https://')) return
        if (!isYouTubeUrl(url)) return
        
        const cleaned = cleanUrl(url)
        if (cleaned && !seenUrls.has(cleaned)) {
          youtubeUrls.push(cleaned)
          seenUrls.add(cleaned)
        }
      })
    
    return youtubeUrls
  }, [event.id, JSON.stringify(event.tags)])
  
  // Note: tagLinks removed - WebPreview is disabled for AsciiDoc articles
  
  // Get all images for gallery (deduplicated)
  const allImages = useMemo(() => {
    const seenUrls = new Set<string>()
    const images: Array<{ url: string; alt?: string }> = []
    
    // Add images from extractedMedia
    extractedMedia.images.forEach(img => {
      const cleaned = cleanUrl(img.url)
      if (cleaned && !seenUrls.has(cleaned)) {
        seenUrls.add(cleaned)
        images.push({ url: img.url, alt: img.alt })
      }
    })
    
    // Add metadata image if it exists
    if (metadata.image) {
      const cleaned = cleanUrl(metadata.image)
      if (cleaned && !seenUrls.has(cleaned) && isImage(cleaned)) {
        seenUrls.add(cleaned)
        images.push({ url: metadata.image })
      }
    }
    
    return images
  }, [extractedMedia.images, metadata.image])
  
  // Create image index map for lightbox
  const imageIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    allImages.forEach((img, index) => {
      const cleaned = cleanUrl(img.url)
      if (cleaned) map.set(cleaned, index)
    })
    return map
  }, [allImages])
  
  // Parse content to find media URLs that are already rendered
  const mediaUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    const urlRegex = /https?:\/\/[^\s<>"']+/g
    let match
    while ((match = urlRegex.exec(event.content)) !== null) {
      const url = match[0]
      const cleaned = cleanUrl(url)
      if (cleaned && (isImage(cleaned) || isVideo(cleaned) || isAudio(cleaned))) {
        urls.add(cleaned)
      }
    }
    return urls
  }, [event.content])
  
  // Extract YouTube URLs from content
  const youtubeUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    const urlRegex = /https?:\/\/[^\s<>"']+/g
    let match
    while ((match = urlRegex.exec(event.content)) !== null) {
      const url = match[0]
      const cleaned = cleanUrl(url)
      if (cleaned && isYouTubeUrl(cleaned)) {
        urls.add(cleaned)
      }
    }
    return urls
  }, [event.content])
  
  // Note: contentLinks removed - WebPreview is disabled for AsciiDoc articles
  
  // Image gallery state
  const [lightboxIndex, setLightboxIndex] = useState(-1)
  
  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index)
  }, [])
  
  // Filter tag media to only show what's not in content
  const leftoverTagMedia = useMemo(() => {
    const metadataImageUrl = metadata.image ? cleanUrl(metadata.image) : null
    return tagMedia.filter(media => {
      const cleaned = cleanUrl(media.url)
      if (!cleaned) return false
      // Skip if already in content
      if (mediaUrlsInContent.has(cleaned)) return false
      // Skip if this is the metadata image (shown separately)
      if (metadataImageUrl && cleaned === metadataImageUrl && !hideImagesAndInfo) return false
      return true
    })
  }, [tagMedia, mediaUrlsInContent, metadata.image, hideImagesAndInfo])
  
  // Filter tag YouTube URLs to only show what's not in content
  const leftoverTagYouTubeUrls = useMemo(() => {
    return tagYouTubeUrls.filter(url => {
      const cleaned = cleanUrl(url)
      return cleaned && !youtubeUrlsInContent.has(cleaned)
    })
  }, [tagYouTubeUrls, youtubeUrlsInContent])
  
  // Note: leftoverTagLinks removed - WebPreview is disabled for AsciiDoc articles
  
  // Extract hashtags from content (for deduplication with metadata tags)
  const hashtagsInContent = useMemo(() => {
    const tags = new Set<string>()
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g
    let match
    while ((match = hashtagRegex.exec(event.content)) !== null) {
      tags.add(match[1].toLowerCase())
    }
    return tags
  }, [event.content])
  
  // Filter metadata tags to only show what's not already in content
  const leftoverMetadataTags = useMemo(() => {
    return metadata.tags.filter(tag => !hashtagsInContent.has(tag.toLowerCase()))
  }, [metadata.tags, hashtagsInContent])
  
  // Parse AsciiDoc content and post-process for nostr: links and hashtags
  const [parsedHtml, setParsedHtml] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  
  useEffect(() => {
    let cancelled = false
    
    const parseAsciidoc = async () => {
      setIsLoading(true)
      try {
        const Asciidoctor = await import('@asciidoctor/core')
        const asciidoctor = Asciidoctor.default()
        
        if (cancelled) return
        
        const html = asciidoctor.convert(processedContent, {
          safe: 'safe',
          backend: 'html5',
          doctype: 'article',
          attributes: {
            'showtitle': true,
            'sectanchors': true,
            'sectlinks': true,
            'toc': 'left',
            'toclevels': 6,
            'toc-title': 'Table of Contents',
            'source-highlighter': 'highlight.js',
            'stem': 'latexmath',
            'data-uri': true,
            'imagesdir': '',
            'linkcss': false,
            'stylesheet': '',
            'stylesdir': '',
            'prewrap': true,
            'sectnums': false,
            'sectnumlevels': 6,
            'experimental': true,
            'compat-mode': false,
            'attribute-missing': 'warn',
            'attribute-undefined': 'warn',
            'skip-front-matter': true
          }
        })
        
        if (cancelled) return
        
        let htmlString = typeof html === 'string' ? html : html.toString()
        
        // Debug: log HTML to check if passthrough markers are preserved
        if (process.env.NODE_ENV === 'development') {
          const hasBookstrMarker = htmlString.includes('BOOKSTR_START') || htmlString.includes('BOOKSTR')
          const hasWikilinkMarker = htmlString.includes('WIKILINK')
          logger.debug('AsciidocArticle: HTML contains markers', { 
            hasBookstrMarker, 
            hasWikilinkMarker,
            htmlPreview: htmlString.substring(0, 2000)
          })
        }
        
        // Note: Markdown is now converted to AsciiDoc in preprocessing,
        // so post-processing markdown should not be necessary
        
        // Post-process HTML to handle nostr: links
        // Mentions (npub/nprofile) should be inline, events (note/nevent/naddr) should be block-level
        // First, handle nostr: links in <a> tags (from AsciiDoc link: syntax)
        // Match the full bech32 address format - addresses can vary in length
        // npub: 58 chars, nprofile: variable, note: 58 chars, nevent: variable, naddr: 200+ chars
        // Use a more flexible pattern that matches any valid bech32 address
        htmlString = htmlString.replace(/<a[^>]*href=["']nostr:((?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]{20,})["'][^>]*>([^<]*)<\/a>/gi, (_match, bech32Id, _linkText) => {
          // Validate bech32 ID and create appropriate placeholder
          if (!bech32Id) return _match
          
          // Escape the bech32 ID for HTML attributes
          const escapedId = bech32Id.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          
          if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
            return `<span data-nostr-mention="${escapedId}" class="nostr-mention-placeholder"></span>`
          } else if (bech32Id.startsWith('note') || bech32Id.startsWith('nevent') || bech32Id.startsWith('naddr')) {
            return `<div data-nostr-note="${escapedId}" class="nostr-note-placeholder"></div>`
          }
          return _match
        })
        
        // Also handle nostr: addresses in plain text nodes (not already in <a> tags)
        // Process text nodes by replacing content between > and <
        // Use more flexible regex that matches any valid bech32 address
        htmlString = htmlString.replace(/>([^<]*nostr:((?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+)[^<]*)</g, (_match, textContent) => {
          // Extract nostr addresses from the text content - use the same flexible pattern
          const nostrRegex = /nostr:((?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+)/g
          let processedText = textContent
          const replacements: Array<{ start: number; end: number; replacement: string }> = []
          
          let m
          while ((m = nostrRegex.exec(textContent)) !== null) {
            const bech32Id = m[1]
            const start = m.index
            const end = m.index + m[0].length
            
            if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
              replacements.push({
                start,
                end,
                replacement: `<span data-nostr-mention="${bech32Id}" class="nostr-mention-placeholder"></span>`
              })
            } else if (bech32Id.startsWith('note') || bech32Id.startsWith('nevent') || bech32Id.startsWith('naddr')) {
              replacements.push({
                start,
                end,
                replacement: `<div data-nostr-note="${bech32Id}" class="nostr-note-placeholder"></div>`
              })
            }
          }
          
          // Apply replacements in reverse order to preserve indices
          for (let i = replacements.length - 1; i >= 0; i--) {
            const r = replacements[i]
            processedText = processedText.substring(0, r.start) + r.replacement + processedText.substring(r.end)
          }
          
          return `>${processedText}<`
        })
        
        // Handle LaTeX math expressions from AsciiDoc stem processor
        // AsciiDoc with stem: latexmath outputs \(...\) for inline and \[...\] for block math
        // In HTML, these appear as literal \( and \) characters (backslash + parenthesis)
        // We need to match the literal backslash-paren sequence
        // In regex: \\ matches a literal backslash, \( matches a literal (
        htmlString = htmlString.replace(/\\\(([^)]+?)\\\)/g, (_match, latex) => {
          // Inline math - escape for HTML attribute
          // Unescape any HTML entities that might have been created
          const unescaped = latex.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
          const escaped = unescaped.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          return `<span data-latex-inline="${escaped}" class="latex-inline-placeholder"></span>`
        })
        htmlString = htmlString.replace(/\\\[([^\]]+?)\\\]/g, (_match, latex) => {
          // Block math - escape for HTML attribute
          const unescaped = latex.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
          const escaped = unescaped.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          return `<div data-latex-block="${escaped}" class="latex-block-placeholder my-4"></div>`
        })
        
        // Handle citation markup: [[citation::type::nevent...]]
        // AsciiDoc passthrough +++[[citation::type::nevent...]]+++ outputs just [[citation::type::nevent...]] in HTML
        htmlString = htmlString.replace(/\[\[citation::(end|foot|foot-end|inline|quote|prompt-end|prompt-inline)::([^\]]+)\]\]/g, (_match, citationType, citationId) => {
          const escapedId = citationId.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          return `<div data-citation="${escapedId}" data-citation-type="${citationType}" class="citation-placeholder"></div>`
        })
        
        // Handle bookstr markers - convert passthrough markers to placeholders
        // AsciiDoc passthrough +++BOOKSTR_MARKER:...:BOOKSTR_END+++ outputs BOOKSTR_MARKER:...:BOOKSTR_END in HTML
        // Match the delimited format to extract the exact content
        // IMPORTANT: Process this BEFORE any other pattern matching
        htmlString = htmlString.replace(/BOOKSTR_MARKER:\s*(.+?)\s*:BOOKSTR_END/g, (_match, bookContent) => {
          // Trim whitespace and escape special characters for HTML attributes
          const cleanContent = bookContent.trim()
          const escaped = cleanContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          logger.debug('BookstrContent: Found bookstr marker in HTML', { cleanContent, escaped })
          return `<span data-bookstr="${escaped}" class="bookstr-placeholder"></span>`
        })
        
        // Also handle if AsciiDoc converted it to WIKILINK: format (fallback)
        htmlString = htmlString.replace(/WIKILINK:bookstr::([^<>\s]+)/g, (_match, bookContent) => {
          const cleanContent = bookContent.trim()
          const escaped = cleanContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          logger.debug('BookstrContent: Found bookstr in WIKILINK format', { cleanContent, escaped })
          return `<span data-bookstr="${escaped}" class="bookstr-placeholder"></span>`
        })
        
        // Handle wikilinks - convert passthrough markers to placeholders
        // AsciiDoc passthrough +++WIKILINK:link|display+++ outputs just WIKILINK:link|display in HTML
        // Match WIKILINK: followed by any characters (including |) until end of text or HTML tag
        // IMPORTANT: Skip any [[bookstr::...]] patterns that might have been missed
        htmlString = htmlString.replace(/WIKILINK:([^<>\s]+)/g, (_match, linkContent) => {
          // Skip if this is a bookstr wikilink
          if (linkContent.includes('bookstr::')) {
            return _match
          }
          // Escape special characters for HTML attributes
          const escaped = linkContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          return `<span data-wikilink="${escaped}" class="wikilink-placeholder"></span>`
        })
        
        // Handle YouTube URLs and relay URLs in links
        // Also check for bookstr content that might have been converted to links
        // Only replace links that need special handling - leave AsciiDoc-generated links alone
        const linkMatches: Array<{ match: string; href: string; linkText: string; index: number }> = []
        const bookstrLinkMatches: Array<{ match: string; bookContent: string; index: number }> = []
        const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/g
        let linkMatch
        while ((linkMatch = linkRegex.exec(htmlString)) !== null) {
          const match = linkMatch[0]
          const href = linkMatch[1]
          const linkText = linkMatch[2]
          const index = linkMatch.index
          
          // Check if this link contains bookstr content (might have been converted by AsciiDoc)
          if (linkText.includes('bookstr::') || href.includes('bookstr::')) {
            // Extract bookstr content from link text or href
            const bookstrMatch = linkText.match(/bookstr::([^\]]+)/) || href.match(/bookstr::([^\]]+)/)
            if (bookstrMatch) {
              const bookContent = bookstrMatch[1].trim()
              bookstrLinkMatches.push({ match, bookContent, index })
              continue
            }
          }
          
          // Only process links that need special handling (YouTube, relay URLs)
          // Leave regular HTTP/HTTPS links as-is since AsciiDoc already formatted them correctly
          if (isYouTubeUrl(href) || isWebsocketUrl(href)) {
            linkMatches.push({ match, href, linkText, index })
          }
        }
        
        // Replace bookstr links in reverse order to preserve indices
        for (let i = bookstrLinkMatches.length - 1; i >= 0; i--) {
          const { match, bookContent, index } = bookstrLinkMatches[i]
          const escaped = bookContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          logger.debug('BookstrContent: Found bookstr in converted link', { bookContent, escaped })
          htmlString = htmlString.substring(0, index) + 
            `<span data-bookstr="${escaped}" class="bookstr-placeholder"></span>` + 
            htmlString.substring(index + match.length)
        }
        
        // Replace only special links in reverse order to preserve indices
        for (let i = linkMatches.length - 1; i >= 0; i--) {
          const { match, href, linkText } = linkMatches[i]
          let replacement = match
          
          // Check if the href is a YouTube URL
          if (isYouTubeUrl(href)) {
            const cleanedUrl = cleanUrl(href)
            replacement = `<div data-youtube-url="${cleanedUrl.replace(/"/g, '&quot;')}" class="youtube-placeholder my-2"></div>`
          }
          // Check if the href is a relay URL
          else if (isWebsocketUrl(href)) {
            const relayPath = `/relays/${encodeURIComponent(href)}`
            replacement = `<a href="${relayPath}" class="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words cursor-pointer" data-relay-url="${href}" data-original-text="${linkText.replace(/"/g, '&quot;')}">${linkText}</a>`
          }
          
          htmlString = htmlString.substring(0, linkMatches[i].index) + replacement + htmlString.substring(linkMatches[i].index + match.length)
        }
        
        // Handle YouTube URLs in plain text (not in <a> tags)
        // Create a new regex instance to avoid state issues
        const youtubeRegex = new RegExp(YOUTUBE_URL_REGEX.source, YOUTUBE_URL_REGEX.flags)
        htmlString = htmlString.replace(youtubeRegex, (match) => {
          // Only replace if not already in a tag (basic check)
          if (!match.includes('<') && !match.includes('>') && isYouTubeUrl(match)) {
            const cleanedUrl = cleanUrl(match)
            return `<div data-youtube-url="${cleanedUrl.replace(/"/g, '&quot;')}" class="youtube-placeholder my-2"></div>`
          }
          return match
        })
        
        // Handle relay URLs in plain text (not in <a> tags) - convert to relay page links
        htmlString = htmlString.replace(WS_URL_REGEX, (match) => {
          // Only replace if not already in a tag (basic check)
          if (!match.includes('<') && !match.includes('>') && isWebsocketUrl(match)) {
            const relayPath = `/relays/${encodeURIComponent(match)}`
            return `<a href="${relayPath}" class="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words cursor-pointer" data-relay-url="${match}" data-original-text="${match.replace(/"/g, '&quot;')}">${match}</a>`
          }
          return match
        })
        
        // Handle plain HTTP/HTTPS URLs in text (not in <a> tags, not YouTube, not relay) - convert to regular links
        // NO WebPreview conversion for AsciiDoc articles
        const httpUrlRegex = /https?:\/\/[^\s<>"']+/g
        htmlString = htmlString.replace(httpUrlRegex, (match) => {
          // Only replace if not already in a tag (basic check)
          if (!match.includes('<') && !match.includes('>')) {
            // Skip if it's a YouTube URL or relay URL (already handled)
            if (isYouTubeUrl(match) || isWebsocketUrl(match)) {
              return match
            }
            // Skip if it's an image or media URL (handled separately)
            if (isImage(match) || isVideo(match) || isAudio(match)) {
              return match
            }
            // Convert to regular link - NO WebPreview
            const cleanedUrl = cleanUrl(match)
            return `<a href="${cleanedUrl}" class="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words" target="_blank" rel="noopener noreferrer">${match}</a>`
          }
          return match
        })
        
        setParsedHtml(htmlString)
      } catch (error) {
        logger.error('Failed to parse AsciiDoc', error as Error)
        setParsedHtml('<p>Error parsing AsciiDoc content</p>')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }
    
    parseAsciidoc()
    
    return () => {
      cancelled = true
    }
  }, [processedContent])
  
  // Store React roots for cleanup
  const reactRootsRef = useRef<Map<Element, Root>>(new Map())
  // Track which placeholders have been processed to avoid re-processing
  const processedPlaceholdersRef = useRef<Set<string>>(new Set())
  
  // Post-process rendered HTML to inject React components for nostr: links and handle hashtags
  useEffect(() => {
    if (!contentRef.current || !parsedHtml || isLoading) return
    
    // Only clean up roots that are no longer in the DOM
    const rootsToCleanup: Array<[Element, Root]> = []
    reactRootsRef.current.forEach((root, element) => {
      if (!element.isConnected) {
        rootsToCleanup.push([element, root])
        reactRootsRef.current.delete(element)
      }
    })
    
    // Unmount disconnected roots asynchronously to avoid race conditions
    if (rootsToCleanup.length > 0) {
      setTimeout(() => {
        rootsToCleanup.forEach(([, root]) => {
          try {
            root.unmount()
          } catch (err) {
            // Ignore errors during cleanup
          }
        })
      }, 0)
    }
    
    // Process nostr: mentions - replace placeholders with React components (inline)
    const nostrMentions = contentRef.current.querySelectorAll('.nostr-mention-placeholder[data-nostr-mention]')
    nostrMentions.forEach((element) => {
      const bech32Id = element.getAttribute('data-nostr-mention')
      if (!bech32Id) {
        logger.warn('Nostr mention placeholder found but no bech32Id attribute')
        return
      }
      
      // Create an inline container for React component (mentions should be inline)
      const container = document.createElement('span')
      container.className = 'inline-block'
      const parent = element.parentNode
      if (!parent) {
        logger.warn('Nostr mention placeholder has no parent node')
        return
      }
      parent.replaceChild(container, element)
      
      // Use React to render the component
      const root = createRoot(container)
      root.render(<EmbeddedMention userId={bech32Id} />)
      reactRootsRef.current.set(container, root)
    })
    
    // Process nostr: notes - replace placeholders with React components
    const nostrNotes = contentRef.current.querySelectorAll('.nostr-note-placeholder[data-nostr-note]')
    nostrNotes.forEach((element) => {
      const bech32Id = element.getAttribute('data-nostr-note')
      if (!bech32Id) {
        logger.warn('Nostr note placeholder found but no bech32Id attribute')
        return
      }
      
      // Create a block-level container for React component that fills width
      const container = document.createElement('div')
      container.className = 'w-full my-2'
      const parent = element.parentNode
      if (!parent) {
        logger.warn('Nostr note placeholder has no parent node')
        return
      }
      parent.replaceChild(container, element)
      
      // Use React to render the component
      const root = createRoot(container)
      root.render(<EmbeddedNote noteId={bech32Id} />)
      reactRootsRef.current.set(container, root)
    })
    
    // Process citations - replace placeholders with React components
    const citationPlaceholders = contentRef.current.querySelectorAll('.citation-placeholder[data-citation]')
    citationPlaceholders.forEach((element) => {
      const citationId = element.getAttribute('data-citation')
      const citationType = element.getAttribute('data-citation-type') || 'end'
      if (!citationId) {
        logger.warn('Citation placeholder found but no citation ID attribute')
        return
      }
      
      // Determine container class based on citation type
      const isInline = citationType === 'inline' || citationType === 'prompt-inline'
      const container = document.createElement(isInline ? 'span' : 'div')
      container.className = isInline ? 'inline' : 'w-full my-2'
      const parent = element.parentNode
      if (!parent) {
        logger.warn('Citation placeholder has no parent node')
        return
      }
      parent.replaceChild(container, element)
      
      // Use React to render the component
      const root = createRoot(container)
      root.render(
        <EmbeddedCitation
          citationId={citationId}
          displayType={citationType as 'end' | 'foot' | 'foot-end' | 'inline' | 'quote' | 'prompt-end' | 'prompt-inline'}
        />
      )
      reactRootsRef.current.set(container, root)
    })
    
    // Process LaTeX math expressions - render with KaTeX
    const latexInlinePlaceholders = contentRef.current.querySelectorAll('.latex-inline-placeholder[data-latex-inline]')
    latexInlinePlaceholders.forEach((element) => {
      const latex = element.getAttribute('data-latex-inline')
      if (!latex) return
      
      try {
        // Render LaTeX with KaTeX
        const rendered = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: false
        })
        // Replace the placeholder with the rendered HTML
        element.outerHTML = rendered
      } catch (error) {
        logger.error('Error rendering LaTeX inline math:', error)
        // On error, show the raw LaTeX
        element.outerHTML = `<span>$${latex}$</span>`
      }
    })
    
    const latexBlockPlaceholders = contentRef.current.querySelectorAll('.latex-block-placeholder[data-latex-block]')
    latexBlockPlaceholders.forEach((element) => {
      const latex = element.getAttribute('data-latex-block')
      if (!latex) return
      
      try {
        // Render LaTeX with KaTeX in display mode
        const rendered = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: true
        })
        // Replace the placeholder with the rendered HTML
        element.outerHTML = rendered
      } catch (error) {
        logger.error('Error rendering LaTeX block math:', error)
        // On error, show the raw LaTeX
        element.outerHTML = `<div>$$${latex}$$</div>`
      }
    })
    
    // Process YouTube URLs - replace placeholders with React components
    const youtubePlaceholders = contentRef.current.querySelectorAll('.youtube-placeholder[data-youtube-url]')
    youtubePlaceholders.forEach((element) => {
      const youtubeUrl = element.getAttribute('data-youtube-url')
      if (!youtubeUrl) return
      
      // Create a container for React component
      const container = document.createElement('div')
      container.className = 'my-2'
      element.parentNode?.replaceChild(container, element)
      
      // Use React to render the component
      const root = createRoot(container)
      root.render(<YoutubeEmbeddedPlayer url={youtubeUrl} className="max-w-[400px]" mustLoad={false} />)
      reactRootsRef.current.set(container, root)
    })
    
    // Process bookstr wikilinks - replace placeholders with React components
    // Only process elements that are still placeholders (not already converted to containers)
    const bookstrPlaceholders = contentRef.current.querySelectorAll('.bookstr-placeholder[data-bookstr]')
    bookstrPlaceholders.forEach((element) => {
      const bookstrContent = element.getAttribute('data-bookstr')
      if (!bookstrContent) return
      
      // Create a unique key for this placeholder
      const placeholderKey = `bookstr-${bookstrContent}`
      
      // Check if this placeholder has already been converted to a container
      // Look for a sibling or nearby container with the same key
      const parent = element.parentElement
      if (parent) {
        const existingContainer = parent.querySelector(`.bookstr-container[data-bookstr-key="${placeholderKey}"]`)
        if (existingContainer) {
          // Container already exists - check if it has a React root
          if (reactRootsRef.current.has(existingContainer)) {
            // Already has a React root, just remove this duplicate placeholder
            element.remove()
            return
          } else {
            // Container exists but no root - this shouldn't happen, but clean it up
            existingContainer.remove()
          }
        }
      }
      
      // Skip if already processed (to avoid duplicate processing)
      if (processedPlaceholdersRef.current.has(placeholderKey)) {
        // If we've processed this but the element still exists, remove it
        element.remove()
        return
      }
      
      // Mark as processed
      processedPlaceholdersRef.current.add(placeholderKey)
      
      // Prepend book:: prefix since BookstrContent expects it
      const wikilink = `book::${bookstrContent}`
      
      logger.debug('BookstrContent: Rendering component', { bookstrContent, wikilink })
      
      // Create a container for React component
      const container = document.createElement('div')
      container.className = 'bookstr-container'
      container.setAttribute('data-bookstr-key', placeholderKey)
      element.parentNode?.replaceChild(container, element)
      
      // Use React to render the component - only render once per container
      // Check if this container already has a root to avoid re-rendering
      if (!reactRootsRef.current.has(container)) {
        const root = createRoot(container)
        root.render(<BookstrContent wikilink={wikilink} />)
        reactRootsRef.current.set(container, root)
      }
    })
    
    // Process wikilinks - replace placeholders with React components
    const wikilinks = contentRef.current.querySelectorAll('.wikilink-placeholder[data-wikilink]')
    wikilinks.forEach((element) => {
      const linkContent = element.getAttribute('data-wikilink')
      if (!linkContent) return
      
      // Skip if this is a bookstr wikilink (already processed)
      if (linkContent.startsWith('book::')) {
        return
      }
      
      // Parse wikilink: extract target and display text
      let target = linkContent.includes('|') ? linkContent.split('|')[0].trim() : linkContent.trim()
      let displayText = linkContent.includes('|') ? linkContent.split('|')[1].trim() : linkContent.trim()
      
      // Convert to d-tag format (same as MarkdownArticle)
      const dtag = target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      
      // Create a container for React component
      const container = document.createElement('span')
      container.className = 'inline-block'
      element.parentNode?.replaceChild(container, element)
      
      // Use React to render the component
      const root = createRoot(container)
      root.render(<Wikilink dTag={dtag} displayText={displayText} />)
      reactRootsRef.current.set(container, root)
    })
    
    // Process hashtags in text nodes - convert #tag to links
    const walker = document.createTreeWalker(
      contentRef.current,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip if parent is a link, code, or pre tag
          const parent = node.parentElement
          if (!parent) return NodeFilter.FILTER_ACCEPT
          if (parent.tagName === 'A' || parent.tagName === 'CODE' || parent.tagName === 'PRE') {
            return NodeFilter.FILTER_REJECT
          }
          return NodeFilter.FILTER_ACCEPT
        }
      }
    )
    
    const textNodes: Text[] = []
    let node
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        textNodes.push(node as Text)
      }
    }
    
    textNodes.forEach((textNode) => {
      const text = textNode.textContent || ''
      const hashtagRegex = /#([a-zA-Z0-9_]+)/g
      const matches = Array.from(text.matchAll(hashtagRegex))
      
      if (matches.length > 0) {
        const fragment = document.createDocumentFragment()
        let lastIndex = 0
        
        matches.forEach((match) => {
          if (match.index === undefined) return
          
          // Add text before hashtag
          if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
          }
          
          // Create hashtag link
          const link = document.createElement('a')
          link.href = `/notes?t=${match[1].toLowerCase()}`
          link.className = 'inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline cursor-pointer'
          link.textContent = `#${match[1]}`
          link.addEventListener('click', (e) => {
            e.stopPropagation()
            e.preventDefault()
            navigateToHashtag(`/notes?t=${match[1].toLowerCase()}`)
          })
          fragment.appendChild(link)
          
          lastIndex = match.index + match[0].length
        })
        
        // Add remaining text
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
        }
        
        textNode.parentNode?.replaceChild(fragment, textNode)
      }
    })
    
    // Handle all links - truncate display text and add click handlers for relay URLs
    const allLinks = contentRef.current.querySelectorAll('a[href]')
    allLinks.forEach((link) => {
      const href = link.getAttribute('href')
      if (!href) return
      
      // Get current link text (this might be the full URL or custom text)
      const linkText = link.textContent || ''
      
      // Truncate link text if it's longer than 200 characters
      if (linkText.length > 200) {
        const truncatedText = truncateLinkText(linkText)
        link.textContent = truncatedText
        // Store full text as title for tooltip
        if (!link.getAttribute('title')) {
          link.setAttribute('title', linkText)
        }
      }
      
      // Handle relay URL links - add click handlers to navigate to relay page
      const relayUrl = link.getAttribute('data-relay-url')
      if (relayUrl) {
        const relayPath = `/relays/${encodeURIComponent(relayUrl)}`
        link.setAttribute('href', relayPath)
        link.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          navigateToRelay(relayPath)
        })
      }
    })
    
    // No cleanup needed here - we only clean up disconnected roots above
    // Full cleanup happens on component unmount
  }, [parsedHtml, isLoading, navigateToHashtag, navigateToRelay])
  
  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      const rootsToCleanup = Array.from(reactRootsRef.current.values())
      reactRootsRef.current.clear()
      processedPlaceholdersRef.current.clear()
      
      // Unmount asynchronously
      setTimeout(() => {
        rootsToCleanup.forEach((root) => {
          try {
            root.unmount()
          } catch (err) {
            // Ignore errors during cleanup
          }
        })
      }, 0)
    }
  }, [])
  
  // Initialize syntax highlighting
  useEffect(() => {
    const initHighlight = async () => {
      if (typeof window !== 'undefined') {
        const hljs = await import('highlight.js')
        if (contentRef.current) {
          contentRef.current.querySelectorAll('pre code').forEach((block) => {
            const element = block as HTMLElement
            element.style.color = 'inherit'
            element.classList.add('text-gray-900', 'dark:text-gray-100')
            hljs.default.highlightElement(element)
            element.style.color = 'inherit'
          })
        }
      }
    }
    
    const timeoutId = setTimeout(initHighlight, 100)
    return () => clearTimeout(timeoutId)
  }, [parsedHtml])
  
  return (
    <>
      <style>{`
        .hljs {
          background: transparent !important;
        }
        .hljs-keyword,
        .hljs-selector-tag,
        .hljs-literal,
        .hljs-title,
        .hljs-section,
        .hljs-doctag,
        .hljs-type,
        .hljs-name,
        .hljs-strong {
          color: #dc2626 !important;
          font-weight: bold !important;
        }
        .hljs-string,
        .hljs-title.class_,
        .hljs-attr,
        .hljs-symbol,
        .hljs-bullet,
        .hljs-addition,
        .hljs-code,
        .hljs-regexp,
        .hljs-selector-pseudo,
        .hljs-selector-attr,
        .hljs-selector-class,
        .hljs-selector-id {
          color: #0284c7 !important;
        }
        .hljs-comment,
        .hljs-quote {
          color: #6b7280 !important;
        }
        .hljs-number,
        .hljs-deletion {
          color: #0d9488 !important;
        }
        .dark .hljs-keyword,
        .dark .hljs-selector-tag,
        .dark .hljs-literal,
        .dark .hljs-title,
        .dark .hljs-section,
        .dark .hljs-doctag,
        .dark .hljs-type,
        .dark .hljs-name,
        .dark .hljs-strong {
          color: #f87171 !important;
        }
        .dark .hljs-string,
        .dark .hljs-title.class_,
        .dark .hljs-attr,
        .dark .hljs-symbol,
        .dark .hljs-bullet,
        .dark .hljs-addition,
        .dark .hljs-code,
        .dark .hljs-regexp,
        .dark .hljs-selector-pseudo,
        .dark .hljs-selector-attr,
        .dark .hljs-selector-class,
        .dark .hljs-selector-id {
          color: #38bdf8 !important;
        }
        .dark .hljs-comment,
        .dark .hljs-quote {
          color: #9ca3af !important;
        }
        .dark .hljs-number,
        .dark .hljs-deletion {
          color: #5eead4 !important;
        }
        .asciidoc-content img {
          display: block;
          max-width: 400px;
          height: auto;
          border-radius: 0.5rem;
          cursor: zoom-in;
          margin: 0.5rem 0;
        }
        .asciidoc-content a[href^="/notes?t="] {
          color: #16a34a !important;
          text-decoration: none !important;
        }
        .asciidoc-content a[href^="/notes?t="]:hover {
          color: #15803d !important;
          text-decoration: underline !important;
        }
        .dark .asciidoc-content a[href^="/notes?t="] {
          color: #4ade80 !important;
        }
        .dark .asciidoc-content a[href^="/notes?t="]:hover {
          color: #86efac !important;
        }
      `}</style>
      <div className={`prose prose-zinc max-w-none dark:prose-invert break-words overflow-wrap-anywhere ${className || ''}`}>
        {/* Metadata */}
        {!hideImagesAndInfo && metadata.title && <h1 className="break-words">{metadata.title}</h1>}
        {!hideImagesAndInfo && !metadata.title && isBookstrEvent && (
          <h1 className="break-words">
            {bookMetadata.book
              ? bookMetadata.book
                  .split('-')
                  .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                  .join(' ')
              : 'Bookstr Publication'}
          </h1>
        )}
        {!hideImagesAndInfo && isBookstrEvent && (
          <div className="text-xs text-muted-foreground space-x-2 mb-2">
            {bookMetadata.type && <span>Type: {bookMetadata.type}</span>}
            {bookMetadata.book && <span>Book: {bookMetadata.book
              .split('-')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ')}</span>}
            {bookMetadata.chapter && <span>Chapter: {bookMetadata.chapter}</span>}
            {bookMetadata.verse && <span>Verse: {bookMetadata.verse}</span>}
            {bookMetadata.version && <span>Version: {bookMetadata.version.toUpperCase()}</span>}
          </div>
        )}
        {!hideImagesAndInfo && metadata.summary && (
          <blockquote>
            <p className="break-words">{metadata.summary}</p>
          </blockquote>
        )}
        {hideImagesAndInfo && metadata.title && (
          <h2 className="text-2xl font-bold mb-4 leading-tight break-words">{metadata.title}</h2>
        )}
        {hideImagesAndInfo && !metadata.title && isBookstrEvent && (
          <h2 className="text-2xl font-bold mb-4 leading-tight break-words">
            {bookMetadata.book
              ? bookMetadata.book
                  .split('-')
                  .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                  .join(' ')
              : 'Bookstr Publication'}
          </h2>
        )}
        {hideImagesAndInfo && isBookstrEvent && (
          <div className="text-xs text-muted-foreground space-x-2 mb-2">
            {bookMetadata.type && <span>Type: {bookMetadata.type}</span>}
            {bookMetadata.book && <span>Book: {bookMetadata.book
              .split('-')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ')}</span>}
            {bookMetadata.chapter && <span>Chapter: {bookMetadata.chapter}</span>}
            {bookMetadata.verse && <span>Verse: {bookMetadata.verse}</span>}
            {bookMetadata.version && <span>Version: {bookMetadata.version.toUpperCase()}</span>}
          </div>
        )}
        
        {/* Metadata image */}
        {!hideImagesAndInfo && metadata.image && (() => {
          const cleanedMetadataImage = cleanUrl(metadata.image)
          // Don't show if already in content
          if (cleanedMetadataImage && mediaUrlsInContent.has(cleanedMetadataImage)) {
            return null
          }
          
          const metadataImageIndex = imageIndexMap.get(cleanedMetadataImage)
          
          return (
            <Image
              image={{ url: metadata.image, pubkey: event.pubkey }}
              className="max-w-[400px] w-full h-auto my-0 cursor-zoom-in"
              classNames={{
                wrapper: 'rounded-lg',
                errorPlaceholder: 'aspect-square h-[30vh]'
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (metadataImageIndex !== undefined) {
                  openLightbox(metadataImageIndex)
                }
              }}
            />
          )
        })()}
        
        {/* Media from tags (only if not in content) */}
        {leftoverTagMedia.length > 0 && (
          <div className="space-y-4 mb-6">
            {leftoverTagMedia.map((media) => {
              const cleaned = cleanUrl(media.url)
              const mediaIndex = imageIndexMap.get(cleaned)
              
              if (media.type === 'image') {
                return (
                  <div key={`tag-media-${cleaned}`} className="my-2">
                    <Image
                      image={{ url: media.url, pubkey: event.pubkey }}
                      className="max-w-[400px] rounded-lg cursor-zoom-in"
                      classNames={{
                        wrapper: 'rounded-lg',
                        errorPlaceholder: 'aspect-square h-[30vh]'
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (mediaIndex !== undefined) {
                          openLightbox(mediaIndex)
                        }
                      }}
                    />
                  </div>
                )
              } else if (media.type === 'video' || media.type === 'audio') {
                return (
                  <div key={`tag-media-${cleaned}`} className="my-2 w-full max-w-full overflow-hidden">
                    <MediaPlayer
                      src={media.url}
                      className="max-w-full sm:max-w-[400px] w-full"
                      mustLoad={true}
                      poster={media.poster}
                    />
                  </div>
                )
              }
              return null
            })}
          </div>
        )}
        
        {/* YouTube URLs from tags (only if not in content) */}
        {leftoverTagYouTubeUrls.length > 0 && (
          <div className="space-y-4 mb-6">
            {leftoverTagYouTubeUrls.map((url) => {
              const cleaned = cleanUrl(url)
              return (
                <div key={`tag-youtube-${cleaned}`} className="my-2">
                  <YoutubeEmbeddedPlayer
                    url={url}
                    className="max-w-[400px]"
                    mustLoad={false}
                  />
                </div>
              )
            })}
          </div>
        )}
        
        {/* Parsed AsciiDoc content */}
        {isLoading ? (
          <div>Loading content...</div>
        ) : (
          <div
            ref={contentRef}
            className="asciidoc-content break-words"
            dangerouslySetInnerHTML={{ __html: parsedHtml }}
          />
        )}
        
        {/* Hashtags from metadata (only if not already in content) */}
        {!hideImagesAndInfo && leftoverMetadataTags.length > 0 && (
          <div className="flex gap-2 flex-wrap pb-2 mt-4">
            {leftoverMetadataTags.map((tag) => (
              <div
                key={tag}
                title={tag}
                className="flex items-center rounded-full px-3 bg-muted text-muted-foreground max-w-44 cursor-pointer hover:bg-accent hover:text-accent-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  push(toNoteList({ hashtag: tag, kinds: [kinds.LongFormArticle] }))
                }}
              >
                #<span className="truncate">{tag}</span>
              </div>
            ))}
          </div>
        )}

      </div>
      
      {/* Image gallery lightbox */}
      {allImages.length > 0 && lightboxIndex >= 0 && createPortal(
        <div onClick={(e) => e.stopPropagation()}>
          <Lightbox
            index={lightboxIndex}
            slides={allImages.map(({ url, alt }) => ({ 
              src: url, 
              alt: alt || url 
            }))}
            plugins={[Zoom]}
            open={lightboxIndex >= 0}
            close={() => setLightboxIndex(-1)}
            controller={{
              closeOnBackdropClick: true,
              closeOnPullUp: true,
              closeOnPullDown: true
            }}
            styles={{
              toolbar: { paddingTop: '2.25rem' }
            }}
            carousel={{
              finite: false
            }}
          />
        </div>,
        document.body
      )}
    </>
  )
}

