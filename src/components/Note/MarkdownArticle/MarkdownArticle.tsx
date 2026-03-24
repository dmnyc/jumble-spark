import { useSecondaryPageOptional, useSmartHashtagNavigationOptional, useSmartRelayNavigationOptional } from '@/PageManager'
import Image from '@/components/Image'
import MediaPlayer from '@/components/MediaPlayer'
import Wikilink from '@/components/UniversalContent/Wikilink'
import { BookstrContent } from '@/components/Bookstr'
import WebPreview from '@/components/WebPreview'
import YoutubeEmbeddedPlayer from '@/components/YoutubeEmbeddedPlayer'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNoteList } from '@/lib/link'
import { useMediaExtraction } from '@/hooks'
import { cleanUrl, isImage, isMedia, isVideo, isAudio, isWebsocketUrl } from '@/lib/url'
import { getHttpUrlFromITags, getImetaInfosFromEvent } from '@/lib/event'
import { Event, kinds } from 'nostr-tools'
import Emoji from '@/components/Emoji'
import { ExtendedKind, WS_URL_REGEX, YOUTUBE_URL_REGEX } from '@/constants'
import { EMOJI_SHORT_CODE_REGEX, NOSTR_URI_INLINE_REGEX } from '@/lib/content-patterns'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { TEmoji } from '@/types'
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji'
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Lightbox from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import CalendarEventContent from '@/components/CalendarEventContent'
import { EmbeddedNote, EmbeddedMention } from '@/components/Embedded'
import EmbeddedCitation from '@/components/EmbeddedCitation'
import { preprocessMarkdownMediaLinks } from './preprocessMarkup'
import { PAYTO_URI_REGEX, parsePaytoUri } from '@/lib/payto'
import PaytoLink from '@/components/PaytoLink'
import katex from 'katex'
import '@/styles/katex-bundle.css'
import { isContentSpacingDebug, reprString } from '@/lib/content-spacing-debug'
import logger from '@/lib/logger'

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
 * Unescape JSON-encoded escape sequences in content
 * Handles cases where content has been JSON-encoded multiple times or has escaped characters
 * Examples: \\n -> \n, \" -> ", \\\n -> \n
 * 
 * The content may have patterns like:
 * - \\\n (three backslashes + n) which should become \n (newline)
 * - \" (escaped quote) which should become " (quote)
 * - \\\" (escaped backslash + escaped quote) which should become \" (backslash + quote)
 */
function unescapeJsonContent(content: string): string {
  // The content may have been JSON-encoded multiple times, resulting in escape sequences.
  // When content is stored in JSON and then parsed, escape sequences can become literal strings.
  // For example, a newline stored as "\\n" in JSON becomes the string "\n" (backslash + n) after parsing.
  // If double-encoded, "\\\\n" in JSON becomes "\\n" (two backslashes + n) after parsing.
  
  // Process in order from most escaped to least escaped to avoid double-processing
  
  // Handle triple-escaped newlines: \\\n -> \n
  // In the actual string, this appears as backslash + backslash + backslash + 'n'
  // Regex: /\\\\\\n/g (in source: four backslashes + backslash + n)
  let unescaped = content.replace(/\\\\\\n/g, '\n')
  
  // Handle double-escaped newlines: \\n -> \n  
  // In the actual string, this appears as backslash + backslash + 'n'
  // Regex: /\\\\n/g (in source: four backslashes + n)
  unescaped = unescaped.replace(/\\\\n/g, '\n')
  
  // Handle single-escaped newlines: \n -> newline
  // This handles cases where the content has literal \n that should be newlines
  // But we need to be careful not to break actual newlines that are already in the content
  // We'll only replace \n that appears as a literal backslash + n sequence
  unescaped = unescaped.replace(/\\n/g, '\n')
  
  // Handle escaped quotes: \" -> "
  unescaped = unescaped.replace(/\\"/g, '"')
  
  // Handle escaped tabs: \t -> tab
  unescaped = unescaped.replace(/\\t/g, '\t')
  
  // Handle escaped carriage returns: \r -> carriage return
  unescaped = unescaped.replace(/\\r/g, '\r')
  
  // Remove any remaining standalone backslashes that aren't part of valid escape sequences
  // This catches any stray backslashes that shouldn't be visible
  // We preserve backslashes that are followed by n, ", t, r, or another backslash
  // BUT: Don't remove backslashes that might be legitimate (like in markdown code blocks)
  // Only remove if it's clearly a stray escape character
  unescaped = unescaped.replace(/\\(?![n"tr\\])/g, '')
  
  // Decode any HTML entities that might have been incorrectly encoded
  // This handles cases where content has HTML entities like &#x43; (which is 'C')
  // We'll decode common numeric entities
  unescaped = unescaped.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => {
    return String.fromCharCode(parseInt(hex, 16))
  })
  unescaped = unescaped.replace(/&#(\d+);/g, (_match, dec) => {
    return String.fromCharCode(parseInt(dec, 10))
  })
  
  return unescaped
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
 * CodeBlock component that renders code with syntax highlighting using highlight.js
 */
function CodeBlock({ id, code, language }: { id: string; code: string; language: string }) {
  const codeRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const initHighlight = async () => {
      if (typeof window !== 'undefined' && codeRef.current) {
        try {
          const hljs = await import('highlight.js')
          const codeElement = codeRef.current.querySelector('code')
          if (codeElement) {
            hljs.default.highlightElement(codeElement)
          }
        } catch (error) {
          logger.error('Error loading highlight.js:', error)
        }
      }
    }
    
    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(initHighlight, 0)
    return () => clearTimeout(timeoutId)
  }, [code, language])
  
  return (
    <div className="my-4 overflow-x-auto">
      <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700 whitespace-pre-wrap">
        <div ref={codeRef}>
          <code
            id={id}
            className={`hljs language-${language || 'plaintext'} text-gray-900 dark:text-gray-100`}
          >
            {code}
          </code>
        </div>
      </pre>
    </div>
  )
}

/**
 * InlineCode component that renders inline code, with LaTeX math detection
 * If the code content is LaTeX math (starts and ends with $), render it with KaTeX
 */
function InlineCode({ code, keyPrefix }: { code: string; keyPrefix: string }) {
  const elementRef = useRef<HTMLElement>(null)
  
  // Check if this is LaTeX math: starts with $ and ends with $
  // Pattern: $...$ where ... may contain LaTeX expressions
  const trimmedCode = code.trim()
  const latexMatch = trimmedCode.match(/^\$([^$]+)\$$/)
  
  useEffect(() => {
    if (latexMatch && elementRef.current) {
      try {
        // Extract the LaTeX expression
        let latexExpr = latexMatch[1]
        
        // Handle escaped backslashes: if the content has double backslashes (\\),
        // they might need to be unescaped to single backslashes (\)
        // This can happen if the content was stored with escaped backslashes
        // In JavaScript strings, "\\" in source represents a single backslash in the actual string
        // So if we see "\\\\" in the string (4 backslashes in source = 2 backslashes in string),
        // we should convert to "\\" (2 backslashes in source = 1 backslash in string)
        // But we need to be careful: we only want to unescape if it's actually double-escaped
        // Try to detect if we have literal double backslashes that should be single
        // Check if there are patterns like \\command that should be \command
        if (latexExpr.includes('\\\\')) {
          // Replace double backslashes with single backslash
          // This handles cases where backslashes are escaped in the source
          latexExpr = latexExpr.replace(/\\\\/g, '\\')
        }
        
        // Render with KaTeX
        katex.render(latexExpr, elementRef.current, {
          throwOnError: false,
          displayMode: false
        })
      } catch (error) {
        logger.error('Error rendering LaTeX inline math:', error)
        // On error, fall back to showing the code as-is
        if (elementRef.current) {
          elementRef.current.textContent = code
          elementRef.current.className = 'bg-muted px-1 py-0.5 rounded text-sm font-mono text-foreground'
        }
      }
    }
  }, [code, latexMatch])
  
  // If it's LaTeX math, render with KaTeX
  if (latexMatch) {
    return (
      <span
        ref={elementRef}
        key={keyPrefix}
        className="katex-inline"
        style={{ display: 'inline' }}
      />
    )
  }
  
  // Regular inline code
  return (
    <code key={keyPrefix} className="bg-muted px-1 py-0.5 rounded text-sm font-mono text-foreground">
      {code}
    </code>
  )
}

/**
 * Normalize backticks in markdown content:
 * - Inline code: normalize to single backtick (`code`)
 * - Code blocks: normalize to triple backticks (```code```)
 * This handles cases where content uses 2, 3, or 4 backticks inconsistently
 */
function normalizeBackticks(content: string): string {
  let normalized = content
  
  // First, protect code blocks by temporarily replacing them
  // Match code blocks with 3 or 4 backticks - need to handle multiline content
  const codeBlockPlaceholders: string[] = []
  const lines = normalized.split('\n')
  const processedLines: string[] = []
  let i = 0
  
  while (i < lines.length) {
    const line = lines[i]
    // Check if this line starts a code block (3 or 4 backticks, optionally with language)
    const codeBlockStartMatch = line.match(/^(`{3,4})(\w*)\s*$/)
    
    if (codeBlockStartMatch) {
      const language = codeBlockStartMatch[2] || ''
      const codeLines: string[] = [line]
      i++
      let foundEnd = false
      
      // Look for the closing backticks
      while (i < lines.length) {
        const codeLine = lines[i]
        codeLines.push(codeLine)
        
        // Check if this line has the closing backticks
        if (codeLine.match(/^`{3,4}\s*$/)) {
          foundEnd = true
          i++
          break
        }
        
        i++
      }
      
      if (foundEnd) {
        // Normalize to triple backticks
        const placeholder = `__CODE_BLOCK_${codeBlockPlaceholders.length}__`
        const normalizedBlock = `\`\`\`${language}\n${codeLines.slice(1, -1).join('\n')}\n\`\`\``
        codeBlockPlaceholders.push(normalizedBlock)
        processedLines.push(placeholder)
        continue
      }
    }
    
    processedLines.push(line)
    i++
  }
  
  normalized = processedLines.join('\n')
  
  // Normalize inline code: replace double backticks with single backticks
  // But only if they're not part of a code block (which we've already protected)
  // Use a more precise regex that doesn't match triple+ backticks
  normalized = normalized.replace(/``([^`\n]+?)``/g, '`$1`')
  
  // Restore code blocks
  codeBlockPlaceholders.forEach((block, index) => {
    normalized = normalized.replace(`__CODE_BLOCK_${index}__`, block)
  })
  
  return normalized
}

/**
 * Convert Setext-style headers to markdown format
 * H1: "Text\n======\n" -> "# Text\n"
 * H2: "Text\n------\n" -> "## Text\n"
 * This handles the Setext-style header format (both equals and dashes)
 * 
 * Note: Only converts if the text line has at least 2 characters to avoid
 * creating headers from fragments like "D\n------" which would become "## D"
 */
/**
 * Normalize excessive newlines - reduce 3+ consecutive newlines (with optional whitespace) to exactly 2
 */
function normalizeNewlines(content: string): string {
  // Match sequences of 3 or more newlines with optional whitespace between them
  // Pattern: newline, optional whitespace, newline, optional whitespace, one or more newlines
  // Replace with exactly 2 newlines
  return content.replace(/\n\s*\n\s*\n+/g, '\n\n')
}

/**
 * Normalize single newlines within bold/italic spans to spaces
 * This allows bold/italic formatting to work across single line breaks
 */
function normalizeInlineFormattingNewlines(content: string): string {
  let normalized = content
  
  // Match bold spans: **text** that may contain single newlines
  // Replace single newlines (but not double newlines) within these spans with spaces
  normalized = normalized.replace(/\*\*([^*]*?)\*\*/g, (match, innerContent) => {
    // Check if this span contains double newlines (paragraph break) - if so, don't modify
    if (innerContent.includes('\n\n')) {
      return match // Keep original if it has paragraph breaks
    }
    // Replace single newlines with spaces
    return '**' + innerContent.replace(/\n/g, ' ') + '**'
  })
  
  // Match bold spans: __text__ that may contain single newlines
  normalized = normalized.replace(/__([^_]*?)__/g, (match, innerContent) => {
    // Check if this span contains double newlines (paragraph break) - if so, don't modify
    if (innerContent.includes('\n\n')) {
      return match // Keep original if it has paragraph breaks
    }
    // Replace single newlines with spaces
    return '__' + innerContent.replace(/\n/g, ' ') + '__'
  })
  
  // Match italic spans: _text_ (single underscore, not part of __bold__)
  // Use a more careful pattern to avoid matching __bold__
  normalized = normalized.replace(/(?<![_*])(?<!__)_([^_\n]+?)_(?!_)/g, (match, innerContent, offset, string) => {
    // Check if preceded by another underscore (would be __bold__)
    if (offset > 0 && string[offset - 1] === '_') {
      return match // Don't modify if part of __bold__
    }
    // Check if this span contains double newlines (paragraph break) - if so, don't modify
    if (innerContent.includes('\n\n')) {
      return match
    }
    // Replace single newlines with spaces (though italic shouldn't have newlines due to [^_\n])
    return '_' + innerContent.replace(/\n/g, ' ') + '_'
  })
  
  return normalized
}

function normalizeSetextHeaders(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let i = 0
  
  while (i < lines.length) {
    const currentLine = lines[i]
    const nextLine = i + 1 < lines.length ? lines[i + 1] : ''
    const currentLineTrimmed = currentLine.trim()
    
    // Check if next line is all equals signs (at least 3) - H1
    const equalsMatch = nextLine.match(/^={3,}\s*$/)
    if (equalsMatch && currentLineTrimmed.length > 0) {
      // Only convert if the text has at least 2 characters (avoid fragments like "D")
      if (currentLineTrimmed.length >= 2) {
        // Convert to markdown H1
        result.push(`# ${currentLineTrimmed}`)
        i += 2 // Skip both lines
        continue
      }
    }
    
    // Check if next line is all dashes (at least 3) - H2
    // But make sure it's not a horizontal rule (which would be on its own line)
    const dashesMatch = nextLine.match(/^-{3,}\s*$/)
    if (dashesMatch && currentLineTrimmed.length > 0) {
      // Only convert if the text has at least 2 characters (avoid fragments like "D")
      if (currentLineTrimmed.length >= 2) {
        // Convert to markdown H2
        result.push(`## ${currentLineTrimmed}`)
        i += 2 // Skip both lines
        continue
      }
    }
    
    result.push(currentLine)
    i++
  }
  
  return result.join('\n')
}

/**
 * Parse markdown content and render with post-processing for nostr: links and hashtags
 * Post-processes:
 * - nostr: links -> EmbeddedNote or EmbeddedMention
 * - #hashtags -> green hyperlinks to /notes?t=hashtag
 * - wss:// and ws:// URLs -> hyperlinks to /relays/{url}
 * Returns both rendered nodes and a set of hashtags found in content (for deduplication)
 */
function parseMarkdownContent(
  content: string,
  options: {
    eventPubkey: string
    imageIndexMap: Map<string, number>
    openLightbox: (index: number) => void
    navigateToHashtag: (href: string) => void
    navigateToRelay: (url: string) => void
    videoPosterMap?: Map<string, string>
    imageThumbnailMap?: Map<string, string>
    getImageIdentifier?: (url: string) => string | null
    emojiInfos?: TEmoji[]
    /** When viewing a kind-24 invite, render full calendar card with RSVP instead of EmbeddedNote for this naddr */
    fullCalendarInvite?: { naddr: string; event: Event }
    /** If set, a standalone markdown link to this cleaned URL renders as inline link (OG shown separately). */
    suppressStandaloneWebPreviewForCleanedUrl?: string
  }
): { nodes: React.ReactNode[]; hashtagsInContent: Set<string>; footnotes: Map<string, string>; citations: Array<{ id: string; type: string; citationId: string }> } {
  const {
    eventPubkey,
    imageIndexMap,
    openLightbox,
    navigateToHashtag,
    navigateToRelay,
    videoPosterMap,
    imageThumbnailMap,
    getImageIdentifier,
    emojiInfos = [],
    fullCalendarInvite,
    suppressStandaloneWebPreviewForCleanedUrl
  } = options
  const parts: React.ReactNode[] = []
  const hashtagsInContent = new Set<string>()
  const footnotes = new Map<string, string>()
  const citations: Array<{ id: string; type: string; citationId: string }> = []
  let lastIndex = 0
  
  // Helper function to check if an index range falls within any block-level pattern
  const isWithinBlockPattern = (start: number, end: number, blockPatterns: Array<{ index: number; end: number }>): boolean => {
    return blockPatterns.some(blockPattern =>
      (start >= blockPattern.index && start < blockPattern.end) ||
      (end > blockPattern.index && end <= blockPattern.end) ||
      (start <= blockPattern.index && end >= blockPattern.end)
    )
  }
  
  // STEP 1: First detect all block-level patterns (headers, lists, blockquotes, tables, etc.)
  // Block-level patterns must be detected first so we can exclude inline patterns within them
  const lines = content.split('\n')
  let currentIndex = 0
  const blockPatterns: Array<{ index: number; end: number; type: string; data: any }> = []
  
  // First pass: extract footnote definitions
  lines.forEach((line) => {
    const footnoteDefMatch = line.match(/^\[\^([^\]]+)\]:\s+(.+)$/)
    if (footnoteDefMatch) {
      const footnoteId = footnoteDefMatch[1]
      const footnoteText = footnoteDefMatch[2]
      footnotes.set(footnoteId, footnoteText)
    }
  })
  
  // Second pass: detect tables and other block-level elements
  let lineIdx = 0
  while (lineIdx < lines.length) {
    const line = lines[lineIdx]
    const lineStartIndex = currentIndex
    const lineEndIndex = currentIndex + line.length
    
    // Tables: detect table rows (must have | characters)
    // GitHub markdown table format: header row, separator row (|---|), data rows
    if (line.includes('|') && line.trim().startsWith('|') && line.trim().endsWith('|')) {
      // Check if this is a table by looking at the next line (separator)
      if (lineIdx + 1 < lines.length) {
        const nextLine = lines[lineIdx + 1]
        const nextLineTrimmed = nextLine.trim()
        // Table separator looks like: |---|---| or |:---|:---:|---:| or | -------- | ------- |
        // Must start and end with |, and contain only spaces, dashes, colons, and pipes
        const isSeparator = nextLineTrimmed.startsWith('|') && 
                           nextLineTrimmed.endsWith('|') &&
                           /^[\|\s\:\-]+$/.test(nextLineTrimmed) &&
                           nextLineTrimmed.includes('-')
        
        if (isSeparator) {
          // This is a table! Collect all table rows
          const tableRows: string[] = []
          const tableStartIndex = lineStartIndex
          let tableEndIndex = lineEndIndex
          let tableLineIdx = lineIdx
          
          // Collect header row
          tableRows.push(line)
          tableLineIdx++
          tableEndIndex += nextLine.length + 1
          tableLineIdx++ // Skip separator
          
          // Collect data rows until we hit a non-table line
          while (tableLineIdx < lines.length) {
            const tableLine = lines[tableLineIdx]
            const tableLineTrimmed = tableLine.trim()
            // Check if it's a table row (starts and ends with |)
            if (tableLineTrimmed.startsWith('|') && tableLineTrimmed.endsWith('|')) {
              // Check if it's another separator row (skip it)
              const isAnotherSeparator = /^[\|\s\:\-]+$/.test(tableLineTrimmed) && tableLineTrimmed.includes('-')
              if (!isAnotherSeparator) {
                tableRows.push(tableLine)
                tableEndIndex += tableLine.length + 1
              }
              tableLineIdx++
            } else {
              break
            }
          }
          
          // Parse table rows into cells
          const parsedRows: string[][] = []
          tableRows.forEach((row) => {
            // Split by |, trim each cell, filter out empty edge cells
            const rawCells = row.split('|')
            const cells = rawCells
              .map(cell => cell.trim())
              .filter((cell, idx) => {
                // Remove empty cells at the very start and end (from leading/trailing |)
                if (idx === 0 && cell === '') return false
                if (idx === rawCells.length - 1 && cell === '') return false
                return true
              })
            if (cells.length > 0) {
              parsedRows.push(cells)
            }
          })
          
          if (parsedRows.length > 0) {
            blockPatterns.push({
              index: tableStartIndex,
              end: tableEndIndex,
              type: 'table',
              data: { rows: parsedRows, lineNum: lineIdx }
            })
            // Update currentIndex to position at the start of the line after the table
            // Calculate by summing all lines up to (but not including) tableLineIdx
            let newCurrentIndex = 0
            for (let i = 0; i < tableLineIdx && i < lines.length; i++) {
              newCurrentIndex += lines[i].length + 1 // +1 for newline
            }
            currentIndex = newCurrentIndex
            lineIdx = tableLineIdx
            continue
          }
        }
      }
    }
    
    // Fenced code blocks (```code```) - detect before headers
    // Check if this line starts a fenced code block
    const codeBlockStartMatch = line.match(/^(`{3,})(\w*)\s*$/)
    if (codeBlockStartMatch) {
      const language = codeBlockStartMatch[2] || ''
      const codeBlockStartIndex = lineStartIndex
      let codeBlockLineIdx = lineIdx + 1
      // Start with the end of the opening line (including newline)
      let codeBlockEndIndex = lineEndIndex + 1 // +1 for newline after opening line
      const codeLines: string[] = []
      let foundEnd = false
      
      // Look for the closing backticks
      while (codeBlockLineIdx < lines.length) {
        const codeLine = lines[codeBlockLineIdx]
        
        // Check if this line has the closing backticks
        if (codeLine.match(/^`{3,}\s*$/)) {
          foundEnd = true
          // Include the closing line and its newline
          codeBlockEndIndex += codeLine.length + 1
          codeBlockLineIdx++
          break
        }
        
        // Add this line to code content
        codeLines.push(codeLine)
        // Add line length + newline to end index
        codeBlockEndIndex += codeLine.length + 1
        codeBlockLineIdx++
      }
      
      if (foundEnd) {
        const codeContent = codeLines.join('\n')
        blockPatterns.push({
          index: codeBlockStartIndex,
          end: codeBlockEndIndex,
          type: 'fenced-code-block',
          data: { code: codeContent, language: language, lineNum: lineIdx }
        })
        // Update currentIndex to position at the start of the line after the code block
        // Calculate by summing all lines up to (but not including) codeBlockLineIdx
        // This way, the next iteration will process codeBlockLineIdx and update currentIndex correctly
        let newCurrentIndex = 0
        for (let i = 0; i < codeBlockLineIdx && i < lines.length; i++) {
          newCurrentIndex += lines[i].length + 1 // +1 for newline
        }
        currentIndex = newCurrentIndex
        lineIdx = codeBlockLineIdx
        continue
      }
    }
    
    // Headers (# Header, ## Header, etc.)
    // Must be at start of line (after any leading whitespace is handled)
    // Require at least one space after # and non-empty text after that
    // Skip if we're inside a code block or table (those are handled separately)
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch) {
      // Check if this line is inside any existing block pattern (code block, table, etc.)
      const isInsideBlock = blockPatterns.some(blockPattern =>
        lineStartIndex >= blockPattern.index && lineStartIndex < blockPattern.end
      )
      
      if (!isInsideBlock) {
        const headerLevel = headerMatch[1].length
        const headerText = headerMatch[2].trim() // Trim the header text to remove trailing whitespace
        // Only create header if we have actual text (not just whitespace)
        // Also require at least 2 characters to avoid matching fragments like "## D" when "D" is part of other text
        if (headerText.length > 1) {
          blockPatterns.push({
            index: lineStartIndex,
            end: lineEndIndex,
            type: 'header',
            data: { level: headerLevel, text: headerText, lineNum: lineIdx }
          })
        }
      }
    }
    // Horizontal rule (***, ---, or ___, at least 3 asterisks/dashes/underscores)
    else if (line.match(/^[\*\-\_]{3,}\s*$/)) {
      blockPatterns.push({
        index: lineStartIndex,
        end: lineEndIndex,
        type: 'horizontal-rule',
        data: { lineNum: lineIdx }
      })
    }
    // Bullet list (* item or - item)
    else if (line.match(/^[\*\-\+]\s+.+$/)) {
      const listMatch = line.match(/^([\*\-\+])\s+(.+)$/)
      if (listMatch) {
        blockPatterns.push({
          index: lineStartIndex,
          end: lineEndIndex,
          type: 'bullet-list-item',
          data: { text: listMatch[2], marker: listMatch[1], lineNum: lineIdx, originalLine: line }
        })
      }
    }
    // Numbered list (1. item, 2. item, etc.)
    else if (line.match(/^\d+\.\s+.+$/)) {
      const listMatch = line.match(/^(\d+\.)\s+(.+)$/)
      if (listMatch) {
        blockPatterns.push({
          index: lineStartIndex,
          end: lineEndIndex,
          type: 'numbered-list-item',
          data: { text: listMatch[2], marker: listMatch[1], lineNum: lineIdx, number: line.match(/^(\d+)/)?.[1], originalLine: line }
        })
      }
    }
    // Blockquotes (> text or >) and Greentext (>text with no space)
    else if (line.match(/^>\s*/)) {
      // Check if this is greentext: >text with no space after >
      // Pattern: > followed immediately by non-whitespace, non-> character
      const greentextMatch = line.match(/^>([^\s>].*)$/)
      const isGreentext = greentextMatch !== null
      
      // Collect consecutive blockquote/greentext lines
      const blockquoteLines: string[] = []
      const blockquoteStartIndex = lineStartIndex
      let blockquoteLineIdx = lineIdx
      let tempIndex = lineStartIndex
      let allGreentext = isGreentext
      
      while (blockquoteLineIdx < lines.length) {
        const blockquoteLine = lines[blockquoteLineIdx]
        const lineGreentextMatch = blockquoteLine.match(/^>([^\s>].*)$/)
        const lineIsGreentext = lineGreentextMatch !== null
        
        if (blockquoteLine.match(/^>\s*/)) {
          // If we started with greentext, only continue if this line is also greentext
          // If we started with regular blockquote, only continue if this line is also regular blockquote
          if (isGreentext && !lineIsGreentext) {
            break
          }
          if (!isGreentext && lineIsGreentext) {
            break
          }
          
          // Strip the > prefix and optional space
          const content = blockquoteLine.replace(/^>\s?/, '')
          blockquoteLines.push(content)
          blockquoteLineIdx++
          tempIndex += blockquoteLine.length + 1 // +1 for newline
          
          // Update allGreentext flag (all lines must be greentext for it to be a greentext block)
          allGreentext = allGreentext && lineIsGreentext
        } else if (blockquoteLine.trim() === '') {
          // Empty line without > - this ALWAYS ends the blockquote/greentext
          // Even if the next line is another blockquote, we want separate blockquotes
          break
        } else {
          // Non-empty line that doesn't start with > - ends the blockquote/greentext
          break
        }
      }
      
      if (blockquoteLines.length > 0) {
        // Filter out trailing empty lines (but keep internal empty lines for spacing)
        while (blockquoteLines.length > 0 && blockquoteLines[blockquoteLines.length - 1].trim() === '') {
          blockquoteLines.pop()
          blockquoteLineIdx--
          // Recalculate tempIndex by subtracting the last line's length
          if (blockquoteLineIdx >= lineIdx) {
            tempIndex -= (lines[blockquoteLineIdx].length + 1)
          }
        }
        
        if (blockquoteLines.length > 0) {
          // Calculate end index: tempIndex - 1 (subtract 1 because we don't want the trailing newline)
          const blockquoteEndIndex = tempIndex - 1
          
          // Use greentext type if all lines are greentext, otherwise use blockquote
          const patternType = allGreentext ? 'greentext' : 'blockquote'
          
          blockPatterns.push({
            index: blockquoteStartIndex,
            end: blockquoteEndIndex,
            type: patternType,
            data: { lines: blockquoteLines, lineNum: lineIdx }
          })
          // Update currentIndex to position at the start of the line after the blockquote
          // Calculate by summing all lines up to (but not including) blockquoteLineIdx
          let newCurrentIndex = 0
          for (let i = 0; i < blockquoteLineIdx && i < lines.length; i++) {
            newCurrentIndex += lines[i].length + 1 // +1 for newline
          }
          currentIndex = newCurrentIndex
          lineIdx = blockquoteLineIdx
          continue
        }
      }
    }
    // Footnote definition (already extracted, but mark it so we don't render it in content)
    else if (line.match(/^\[\^([^\]]+)\]:\s+.+$/)) {
      blockPatterns.push({
        index: lineStartIndex,
        end: lineEndIndex,
        type: 'footnote-definition',
        data: { lineNum: lineIdx }
      })
    }
    
    currentIndex += line.length + 1 // +1 for newline
    lineIdx++
  }
  
  // STEP 2: Now detect inline patterns (images, links, URLs, hashtags, etc.)
  // But exclude any that fall within block-level patterns
  const patterns: Array<{ index: number; end: number; type: string; data: any }> = []
  
  // Add block patterns to main patterns array first
  blockPatterns.forEach(pattern => {
    patterns.push(pattern)
  })
  
  // Markdown image links: [![](image_url)](link_url) - detect FIRST with a specific regex
  // This must be detected before regular markdown links to avoid incorrect parsing of nested brackets
  const linkPatterns: Array<{ index: number; end: number; type: string; data: any }> = []
  
  // Regex to match image links: [![](image_url)](link_url)
  // This matches the full pattern including the nested image syntax
  const imageLinkRegex = /\[(!\[[^\]]*\]\([^)]+\))\]\(([^)]+)\)/g
  const imageLinkMatches = Array.from(content.matchAll(imageLinkRegex))
  
  imageLinkMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Skip if within a block-level pattern
      if (!isWithinBlockPattern(start, end, blockPatterns)) {
        linkPatterns.push({
          index: start,
          end: end,
          type: 'markdown-image-link',
          data: { text: match[1], url: match[2] }
        })
      }
    }
  })
  
  // Regular markdown links: [text](url) - but exclude those already captured as image links
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const linkMatches = Array.from(content.matchAll(markdownLinkRegex))
  
  linkMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Skip if within a block-level pattern
      if (isWithinBlockPattern(start, end, blockPatterns)) {
        return
      }
      
      // Skip if this link is already captured as an image link
      const isImageLink = linkPatterns.some(imgLink =>
        start >= imgLink.index && end <= imgLink.end
      )
      if (isImageLink) {
        return
      }
      
      // Skip if the URL is a bookstr URL (contains book%3A%3A or book::)
      const linkUrl = match[2]
      const isBookstrUrl = /(?:book%3A%3A|book::)/i.test(linkUrl)
      if (isBookstrUrl) {
        return
      }
      
      // Check if link is standalone (on its own line, not part of a sentence/list/quote)
      const isStandalone = (() => {
        // Get the line containing this link
        const lineStart = content.lastIndexOf('\n', start) + 1
        const lineEnd = content.indexOf('\n', end)
        const lineEndIndex = lineEnd === -1 ? content.length : lineEnd
        const line = content.substring(lineStart, lineEndIndex)
        
        // Check if the line is just whitespace + the link (possibly with trailing whitespace)
        const lineTrimmed = line.trim()
        const linkMatch = lineTrimmed.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (linkMatch) {
          // Link is on its own line - check if it's in a list or blockquote
          // Check if previous line starts with list marker or blockquote
          const prevLineStart = content.lastIndexOf('\n', lineStart - 1) + 1
          const prevLine = content.substring(prevLineStart, lineStart - 1).trim()
          
          // Not standalone if it's part of a list or blockquote
          if (prevLine.match(/^[\*\-\+]\s/) || prevLine.match(/^\d+\.\s/) || prevLine.match(/^>\s/)) {
            return false
          }
          
          // Check if there's content immediately before or after on adjacent lines
          // If there's text on the previous line (not blank, not list/blockquote), it's probably not standalone
          if (prevLineStart > 0 && prevLine.length > 0 && !prevLine.match(/^[\*\-\+]\s/) && !prevLine.match(/^\d+\.\s/) && !prevLine.match(/^>\s/)) {
            // Previous line has content and it's not a list/blockquote - probably part of a paragraph
            return false
          }
          
          // Check next line - if it has content immediately after, it's probably not standalone
          if (lineEnd !== -1 && lineEnd < content.length) {
            const nextLineStart = lineEnd + 1
            const nextLineEnd = content.indexOf('\n', nextLineStart)
            const nextLineEndIndex = nextLineEnd === -1 ? content.length : nextLineEnd
            const nextLine = content.substring(nextLineStart, nextLineEndIndex).trim()
            if (nextLine.length > 0 && !nextLine.match(/^[\*\-\+]\s/) && !nextLine.match(/^\d+\.\s/) && !nextLine.match(/^>\s/)) {
              // Next line has content and it's not a list/blockquote - probably part of a paragraph
              return false
            }
          }
          
          // Standalone if it's on its own line, not in list/blockquote, and surrounded by blank lines or list items
          return true
        }
        
        // Not standalone if it's part of a sentence
        return false
      })()
      
      // Only render as WebPreview if it's a standalone HTTP/HTTPS link (not YouTube, not relay)
      // But be more conservative - only treat as standalone if it's clearly separated
      const url = match[2]
      const shouldRenderAsWebPreview = isStandalone && 
        !isYouTubeUrl(url) && 
        !isWebsocketUrl(url) &&
        (url.startsWith('http://') || url.startsWith('https://'))
      
      linkPatterns.push({
        index: start,
        end: end,
        type: shouldRenderAsWebPreview ? 'markdown-link-standalone' : 'markdown-link',
        data: { text: match[1], url: match[2] }
      })
    }
  })
  
  // Markdown images: ![](url) or ![alt](url) - but not if they're inside a markdown link
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  const imageMatches = Array.from(content.matchAll(markdownImageRegex))
  imageMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Skip if within a block-level pattern
      if (isWithinBlockPattern(start, end, blockPatterns)) {
        return
      }
      // Skip if this image is inside a markdown link
      const isInsideLink = linkPatterns.some(linkPattern =>
        start >= linkPattern.index && end <= linkPattern.end
      )
      if (!isInsideLink) {
        patterns.push({
          index: start,
          end: end,
          type: 'markdown-image',
          data: { alt: match[1], url: match[2] }
        })
      }
    }
  })
  
  // Add markdown links to patterns
  linkPatterns.forEach(linkPattern => {
    patterns.push(linkPattern)
  })
  
  // YouTube URLs - not in markdown links
  const youtubeUrlMatches = Array.from(content.matchAll(YOUTUBE_URL_REGEX))
  youtubeUrlMatches.forEach(match => {
    if (match.index !== undefined) {
      const url = match[0]
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by a markdown link/image-link/image and not in block pattern
      const isInMarkdown = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image') && 
        start >= p.index && 
        start < p.end
      )
      if (!isInMarkdown && !isWithinBlockPattern(start, end, blockPatterns) && isYouTubeUrl(url)) {
        patterns.push({
          index: start,
          end: end,
          type: 'youtube-url',
          data: { url }
        })
      }
    }
  })
  
  // Relay URLs (wss:// or ws://) - not in markdown links
  const relayUrlMatches = Array.from(content.matchAll(WS_URL_REGEX))
  relayUrlMatches.forEach(match => {
    if (match.index !== undefined) {
      const url = match[0]
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by a markdown link/image-link/image or YouTube URL and not in block pattern
      const isInMarkdown = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image' || p.type === 'youtube-url') && 
        start >= p.index && 
        start < p.end
      )
      if (!isInMarkdown && !isWithinBlockPattern(start, end, blockPatterns) && isWebsocketUrl(url)) {
        patterns.push({
          index: start,
          end: end,
          type: 'relay-url',
          data: { url }
        })
      }
    }
  })
  
  // Bookstr URLs: detect markdown links containing bookstr URLs first, then standalone bookstr URLs
  // This must be detected before regular markdown links to avoid conflicts
  const markdownLinkWithBookstrRegex = /\[([^\]]+)\]\((https?:\/\/[^\s]*(?:book%3A%3A|book::)([^\/\?\#\&\s]+))\)/gi
  const markdownBookstrMatches = Array.from(content.matchAll(markdownLinkWithBookstrRegex))
  markdownBookstrMatches.forEach(match => {
    if (match.index !== undefined) {
      const fullUrl = match[2]
      const searchTermEncoded = match[3]
      const start = match.index
      const end = match.index + match[0].length
      
      // Only add if not already covered by other patterns and not in block pattern
      const isInOther = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image' || 
         p.type === 'relay-url' || p.type === 'youtube-url') && 
        start >= p.index && 
        start < p.end
      )
      
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        try {
          // Decode the URL-encoded search term
          const decodedSearchTerm = decodeURIComponent(searchTermEncoded)
          
          // Check if it starts with book:: (it should, but handle both cases)
          let bookstrWikilink = decodedSearchTerm
          if (!bookstrWikilink.startsWith('book::')) {
            // If it doesn't start with book::, add it
            bookstrWikilink = `book::${bookstrWikilink}`
          }
          
          patterns.push({
            index: start,
            end: end,
            type: 'bookstr-url',
            data: { wikilink: bookstrWikilink.trim(), sourceUrl: fullUrl }
          })
        } catch (err) {
          // If decoding fails, skip this URL (will be handled as regular URL)
        }
      }
    }
  })
  
  // Standalone bookstr URLs (not in markdown links): any URL containing book%3A%3A or book:: pattern
  const bookstrUrlRegex = /(https?:\/\/[^\s]*(?:book%3A%3A|book::)([^\/\?\#\&\s]+))/gi
  const bookstrUrlMatches = Array.from(content.matchAll(bookstrUrlRegex))
  bookstrUrlMatches.forEach(match => {
    if (match.index !== undefined) {
      const fullUrl = match[1]
      const searchTermEncoded = match[2]
      const start = match.index
      const end = match.index + match[0].length
      
      // Only add if not already covered by other patterns (including markdown links with bookstr URLs) and not in block pattern
      const isInOther = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image' || 
         p.type === 'relay-url' || p.type === 'youtube-url' || p.type === 'bookstr-url') && 
        start >= p.index && 
        start < p.end
      )
      
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        try {
          // Decode the URL-encoded search term
          const decodedSearchTerm = decodeURIComponent(searchTermEncoded)
          
          // Check if it starts with book:: (it should, but handle both cases)
          let bookstrWikilink = decodedSearchTerm
          if (!bookstrWikilink.startsWith('book::')) {
            // If it doesn't start with book::, add it
            bookstrWikilink = `book::${bookstrWikilink}`
          }
          
          patterns.push({
            index: start,
            end: end,
            type: 'bookstr-url',
            data: { wikilink: bookstrWikilink.trim(), sourceUrl: fullUrl }
          })
        } catch (err) {
          // If decoding fails, skip this URL (will be handled as regular URL)
        }
      }
    }
  })
  
  // Citation markup: [[citation::type::nevent...]]
  const citationRegex = /\[\[citation::(end|foot|foot-end|inline|quote|prompt-end|prompt-inline)::([^\]]+)\]\]/g
  const citationMatches = Array.from(content.matchAll(citationRegex))
  citationMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by other patterns and not in block pattern
      const isInOther = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image' || p.type === 'relay-url' || p.type === 'youtube-url' || p.type === 'nostr') && 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        const citationType = match[1]
        let citationId = match[2]
        // Strip nostr: prefix if present
        if (citationId.startsWith('nostr:')) {
          citationId = citationId.substring(6) // Remove 'nostr:' prefix
        }
        const citationIndex = citations.length
        citations.push({ id: `citation-${citationIndex}`, type: citationType, citationId })
        patterns.push({
          index: start,
          end: end,
          type: 'citation',
          data: { type: citationType, citationId, index: citationIndex }
        })
      }
    }
  })

  // Nostr addresses (nostr:npub1..., nostr:note1..., etc.)
  const nostrRegex = new RegExp(NOSTR_URI_INLINE_REGEX.source, NOSTR_URI_INLINE_REGEX.flags)
  const nostrMatches = Array.from(content.matchAll(nostrRegex))
  nostrMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by other patterns and not in block pattern
      const isInOther = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image' || p.type === 'relay-url' || p.type === 'youtube-url' || p.type === 'citation') && 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        patterns.push({
          index: start,
          end: end,
          type: 'nostr',
          data: match[1]
        })
      }
    }
  })
  
  // Hashtags (#tag) - but not inside markdown links, relay URLs, or nostr addresses
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g
  const hashtagMatches = Array.from(content.matchAll(hashtagRegex))
  hashtagMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by another pattern and not in block pattern
      // Note: hashtags inside block patterns will be handled by parseInlineMarkdown
      const isInOther = patterns.some(p => 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        patterns.push({
          index: start,
          end: end,
          type: 'hashtag',
          data: match[1]
        })
      }
    }
  })
  
  // Wikilinks ([[link]] or [[link|display]]) - but not inside markdown links
  // Exclude citations ([[citation::...]]) from wikilink processing
  // Note: bookstr links ([[book::...]]) are included as wikilink type and handled in rendering
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g
  const wikilinkMatches = Array.from(content.matchAll(wikilinkRegex))
  wikilinkMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      const linkContent = match[1]
      
      // Skip citations - they're already processed above
      if (linkContent.startsWith('citation::')) {
        return
      }
      
      // Include bookstr links as wikilink type - they'll be handled in rendering
      // Only add if not already covered by another pattern and not in block pattern
      const isInOther = patterns.some(p => 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        patterns.push({
          index: start,
          end: end,
          type: 'wikilink',
          data: linkContent
        })
      }
    }
  })
  
  // Footnote references ([^1], [^note], etc.) - but not definitions
  const footnoteRefRegex = /\[\^([^\]]+)\]/g
  const footnoteRefMatches = Array.from(content.matchAll(footnoteRefRegex))
  footnoteRefMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if this is a footnote definition (has : after the closing bracket)
      const afterMatch = content.substring(match.index + match[0].length, match.index + match[0].length + 2)
      if (afterMatch.startsWith(']:')) {
        return // This is a definition, not a reference
      }
      
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by another pattern and not in block pattern
      const isInOther = patterns.some(p => 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        patterns.push({
          index: start,
          end: end,
          type: 'footnote-ref',
          data: match[1] // footnote ID
        })
      }
    }
  })
  
  // Sort patterns by index
  patterns.sort((a, b) => a.index - b.index)
  
  // Remove overlapping patterns (keep the first one)
  // Block-level patterns (headers, lists, horizontal rules, tables, blockquotes, greentext, code blocks) take priority
  const filteredPatterns: typeof patterns = []
  const blockLevelTypes = ['header', 'horizontal-rule', 'bullet-list-item', 'numbered-list-item', 'table', 'blockquote', 'greentext', 'footnote-definition', 'fenced-code-block']
  const blockLevelPatternsFromAll = patterns.filter(p => blockLevelTypes.includes(p.type))
  const otherPatterns = patterns.filter(p => !blockLevelTypes.includes(p.type))
  
  // First add all block-level patterns
  blockLevelPatternsFromAll.forEach(pattern => {
    filteredPatterns.push(pattern)
  })
  
  // Then add other patterns that don't overlap with block-level patterns
  otherPatterns.forEach(pattern => {
    const overlapsWithBlock = blockLevelPatternsFromAll.some(blockPattern =>
      (pattern.index >= blockPattern.index && pattern.index < blockPattern.end) ||
      (pattern.end > blockPattern.index && pattern.end <= blockPattern.end) ||
      (pattern.index <= blockPattern.index && pattern.end >= blockPattern.end)
    )
    if (!overlapsWithBlock) {
      // Check for overlaps with existing filtered patterns
      const overlaps = filteredPatterns.some(p => 
        (pattern.index >= p.index && pattern.index < p.end) ||
        (pattern.end > p.index && pattern.end <= p.end) ||
        (pattern.index <= p.index && pattern.end >= p.end)
      )
      if (!overlaps) {
        filteredPatterns.push(pattern)
      }
    }
  })
  
  // Re-sort by index
  filteredPatterns.sort((a, b) => a.index - b.index)
  
  // Create a map to store original line data for list items (for single-item list rendering)
  const listItemOriginalLines = new Map<number, string>()
  // Track patterns that have been merged into paragraphs (so we don't render them separately)
  const mergedPatterns = new Set<number>()
  
  // Build React nodes from patterns
  filteredPatterns.forEach((pattern, patternIdx) => {
    // Skip if this pattern was already merged (check early to avoid processing)
    // This is critical to prevent duplicate rendering
    if (mergedPatterns.has(patternIdx)) {
      return
    }
    
    // Additional safety check: if pattern index is before lastIndex, it was already processed
    // (unless it's a block-level pattern that should be rendered)
    if (pattern.index < lastIndex && 
        pattern.type !== 'header' && 
        pattern.type !== 'horizontal-rule' && 
        pattern.type !== 'bullet-list-item' && 
        pattern.type !== 'numbered-list-item' && 
        pattern.type !== 'table' && 
        pattern.type !== 'blockquote' &&
        pattern.type !== 'greentext' &&
        pattern.type !== 'footnote-definition' &&
        pattern.type !== 'fenced-code-block') {
      // This pattern was already processed as part of merged text
      // Skip it to avoid duplicate rendering
      return
    }
    
    // Store original line for list items
    if ((pattern.type === 'bullet-list-item' || pattern.type === 'numbered-list-item') && pattern.data.originalLine) {
      listItemOriginalLines.set(patternIdx, pattern.data.originalLine)
    }
    
    // Add text before pattern
    // Handle both cases: pattern.index > lastIndex (normal) and pattern.index === lastIndex (pattern at start)
    if (pattern.index >= lastIndex) {
      let text = pattern.index > lastIndex ? content.slice(lastIndex, pattern.index) : ''
      let textEndIndex = pattern.index
      
      // Check if this pattern is an inline markdown link, hashtag, relay URL, or nostr address that should be included in the paragraph
      // If so, extend the text to include the pattern so it gets processed as part of the paragraph
      // This ensures links, hashtags, relay URLs, and nostr addresses stay inline with their surrounding text instead of being separated
      // Note: Only profile types (npub/nprofile) should be merged inline; event types (note/nevent/naddr) remain block-level
      if (pattern.type === 'markdown-link' || pattern.type === 'hashtag' || pattern.type === 'relay-url' || pattern.type === 'nostr') {
        // Get the line containing the pattern
        const lineStart = content.lastIndexOf('\n', pattern.index) + 1
        const lineEnd = content.indexOf('\n', pattern.end)
        const lineEndIndex = lineEnd === -1 ? content.length : lineEnd
        const line = content.substring(lineStart, lineEndIndex)
        
        // Check if there's text on the same line before the pattern (indicates it's part of a sentence)
        const textBeforeOnSameLine = content.substring(lineStart, pattern.index)
        const hasTextOnSameLine = textBeforeOnSameLine.trim().length > 0
        
        // Check if there's text before the pattern (even on previous lines, as long as no paragraph break)
        const hasTextBefore = text.trim().length > 0 && !text.includes('\n\n')
        // For hashtags at start of line: text after on same line (e.g. "#pyramid 1.1 has..." - merge so no hard break)
        let hasTextAfterOnSameLine = false
        
        // For hashtags: check if the line contains only hashtags (and spaces)
        // This handles cases like "#orly #devstr #progressreport" on one line
        // Hashtags should ALWAYS be merged if they're part of text or on a line with other hashtags
        let shouldMergeHashtag = false
        let hasHashtagsOnAdjacentLines = false
        if (pattern.type === 'hashtag') {
          // Check if line contains only hashtags and whitespace
          const lineWithoutHashtags = line.replace(/#[a-zA-Z0-9_]+/g, '').trim()
          const lineHasOnlyHashtags = lineWithoutHashtags.length === 0 && line.trim().length > 0
          
          // Also check if there are other hashtags on the same line (after this one)
          const hasOtherHashtagsOnLine = filteredPatterns.some((p, idx) => 
            idx > patternIdx && 
            p.type === 'hashtag' && 
            p.index >= lineStart && 
            p.index < lineEndIndex
          )
          
          // Check if there are hashtags on adjacent lines (separated by single newlines)
          // This handles cases where hashtags are on separate lines but should stay together
          if (!hasOtherHashtagsOnLine) {
            // Check next line for hashtags
            const nextLineStart = lineEndIndex + 1
            if (nextLineStart < content.length) {
              const nextLineEnd = content.indexOf('\n', nextLineStart)
              const nextLineEndIndex = nextLineEnd === -1 ? content.length : nextLineEnd
              
              // Check if next line has hashtags and no double newline before it
              const hasHashtagOnNextLine = filteredPatterns.some((p, idx) => 
                idx > patternIdx && 
                p.type === 'hashtag' && 
                p.index >= nextLineStart && 
                p.index < nextLineEndIndex
              )
              
              // Also check previous line for hashtags
              const prevLineStart = content.lastIndexOf('\n', lineStart - 1) + 1
              const hasHashtagOnPrevLine = prevLineStart < lineStart && filteredPatterns.some((p, idx) => 
                idx < patternIdx && 
                p.type === 'hashtag' && 
                p.index >= prevLineStart && 
                p.index < lineStart
              )
              
              // If there's a hashtag on next or previous line, and no double newline between them, merge
              if ((hasHashtagOnNextLine || hasHashtagOnPrevLine) && !content.substring(Math.max(0, prevLineStart), nextLineEndIndex).includes('\n\n')) {
                hasHashtagsOnAdjacentLines = true
              }
            }
          }
          
          // Merge hashtag if:
          // 1. Line has only hashtags (so they stay together)
          // 2. There are other hashtags on the same line
          // 3. There are hashtags on adjacent lines (separated by single newlines)
          // 4. There's text on the same line before it (part of a sentence)
          // 5. There's text before it (even on previous lines, as long as no paragraph break)
          shouldMergeHashtag = lineHasOnlyHashtags || hasOtherHashtagsOnLine || hasHashtagsOnAdjacentLines || hasTextOnSameLine || hasTextBefore

          // Always compute — merge branch 2 below needs this even when shouldMergeHashtag was already
          // true from hasOtherHashtagsOnLine (e.g. "#a #b word" is not "only hashtags" so branch 1 skips,
          // and without hasTextAfterOnSameLine branch 2 would not run → spurious line break before <p>).
          const textAfterOnSameLineRaw = content.substring(pattern.end, lineEndIndex)
          hasTextAfterOnSameLine = textAfterOnSameLineRaw.trim().length > 0
          if (!shouldMergeHashtag && hasTextAfterOnSameLine) {
            shouldMergeHashtag = true
          }
        }
        
        // Merge if:
        // 1. There's text on the same line before the pattern (e.g., "via [TFTC](url)" or "things that #AI")
        // 2. OR there's text before the pattern and no double newline (paragraph break)
        // 3. OR (for hashtags) the line contains only hashtags, so they should stay together
        // This ensures links and hashtags in sentences stay together with their text
        if (pattern.type === 'hashtag' && shouldMergeHashtag) {
          // For hashtags on a line with only hashtags, or hashtags on adjacent lines, merge them together
          if (line.replace(/#[a-zA-Z0-9_]+/g, '').trim().length === 0 && line.trim().length > 0) {
            // Line contains only hashtags - merge the entire line
            // Also check if we need to merge adjacent lines with hashtags
            let mergeEndIndex = lineEndIndex
            let mergeStartIndex = lineStart
            
            // If there are hashtags on adjacent lines, extend the merge range
            if (hasHashtagsOnAdjacentLines) {
              // Find the start of the first hashtag line in this sequence
              let checkStart = lineStart
              while (checkStart > 0) {
                const prevLineStart = content.lastIndexOf('\n', checkStart - 2) + 1
                if (prevLineStart >= 0 && prevLineStart < checkStart) {
                  const prevLineEnd = checkStart - 1
                  const prevLine = content.substring(prevLineStart, prevLineEnd)
                  const hasHashtagOnPrevLine = filteredPatterns.some((p, idx) => 
                    idx < patternIdx && 
                    p.type === 'hashtag' && 
                    p.index >= prevLineStart && 
                    p.index < prevLineEnd
                  )
                  if (hasHashtagOnPrevLine && prevLine.replace(/#[a-zA-Z0-9_]+/g, '').trim().length === 0) {
                    mergeStartIndex = prevLineStart
                    checkStart = prevLineStart
                  } else {
                    break
                  }
                } else {
                  break
                }
              }
              
              // Find the end of the last hashtag line in this sequence
              let checkEnd = lineEndIndex
              while (checkEnd < content.length) {
                const nextLineStart = checkEnd + 1
                if (nextLineStart < content.length) {
                  const nextLineEnd = content.indexOf('\n', nextLineStart)
                  const nextLineEndIndex = nextLineEnd === -1 ? content.length : nextLineEnd
                  const nextLine = content.substring(nextLineStart, nextLineEndIndex)
                  const hasHashtagOnNextLine = filteredPatterns.some((p, idx) => 
                    idx > patternIdx && 
                    p.type === 'hashtag' && 
                    p.index >= nextLineStart && 
                    p.index < nextLineEndIndex
                  )
                  if (hasHashtagOnNextLine && nextLine.replace(/#[a-zA-Z0-9_]+/g, '').trim().length === 0) {
                    mergeEndIndex = nextLineEndIndex
                    checkEnd = nextLineEndIndex
                  } else {
                    break
                  }
                } else {
                  break
                }
              }
            }
            
            // Reconstruct text to include everything from lastIndex to the end of the merged range
            const textBeforeMerge = content.slice(lastIndex, mergeStartIndex)
            const mergedContent = content.substring(mergeStartIndex, mergeEndIndex)
            // Replace single newlines with spaces in the merged content to keep hashtags together
            const normalizedMergedContent = mergedContent.replace(/\n(?!\n)/g, ' ')
            text = textBeforeMerge + normalizedMergedContent
            textEndIndex = mergeEndIndex === content.length ? content.length : mergeEndIndex + 1
            
            // Mark all hashtags in the merged range as merged (so they don't render separately)
            filteredPatterns.forEach((p, idx) => {
              if (p.type === 'hashtag' && p.index >= mergeStartIndex && p.index < mergeEndIndex) {
                const tag = p.data
                const tagLower = tag.toLowerCase()
                hashtagsInContent.add(tagLower)
                mergedPatterns.add(idx)
              }
            })
            
            // Also update lastIndex immediately to prevent processing of patterns in this range
            lastIndex = textEndIndex
          } else if (hasTextOnSameLine || hasTextBefore || hasTextAfterOnSameLine) {
            // Hashtag is part of text - merge this hashtag and all following hashtags/text on same line (avoids hard break between #hashtag #other)
            const patternMarkdown = content.substring(pattern.index, pattern.end)
            const textAfterPattern = content.substring(pattern.end, lineEndIndex)
            text = text + patternMarkdown + textAfterPattern
            textEndIndex = lineEndIndex === content.length ? content.length : lineEndIndex + 1
            
            // Mark every hashtag in this merged range so we don't render them as separate blocks
            const mergeStartIndex = pattern.index
            const mergeEndIndex = lineEndIndex
            filteredPatterns.forEach((p, idx) => {
              if (p.type === 'hashtag' && p.index >= mergeStartIndex && p.index < mergeEndIndex) {
                const tag = p.data
                hashtagsInContent.add(tag.toLowerCase())
                mergedPatterns.add(idx)
              }
            })
          }
        } else if ((pattern.type === 'markdown-link' || pattern.type === 'relay-url') && (hasTextOnSameLine || hasTextBefore)) {
          // Get the original pattern syntax from the content
          const patternMarkdown = content.substring(pattern.index, pattern.end)
          
          // Get text after the pattern on the same line
          const textAfterPattern = content.substring(pattern.end, lineEndIndex)
          
          // Extend the text to include the pattern and any text after it on the same line
          text = text + patternMarkdown + textAfterPattern
          textEndIndex = lineEndIndex === content.length ? content.length : lineEndIndex + 1
          
          // Mark this pattern as merged so we don't render it separately later
          mergedPatterns.add(patternIdx)
        } else if (pattern.type === 'nostr') {
          // Only merge profile types (npub/nprofile) inline; event types (note/nevent/naddr) remain block-level.
          // Same idea as hashtags: if the mention is first on the line but more text follows on that line,
          // merge into the paragraph — otherwise we emit a bare <span> and the rest in <p>, which looks
          // like a spurious hard return (block <p> after inline-block mention).
          const bech32Id = pattern.data
          const isProfileType = bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')
          const hasTextAfterNostrOnSameLine =
            isProfileType && content.substring(pattern.end, lineEndIndex).trim().length > 0

          if (isProfileType && (hasTextOnSameLine || hasTextBefore || hasTextAfterNostrOnSameLine)) {
            const patternMarkdown = content.substring(pattern.index, pattern.end)
            const textAfterPattern = content.substring(pattern.end, lineEndIndex)
            text = text + patternMarkdown + textAfterPattern
            textEndIndex = lineEndIndex === content.length ? content.length : lineEndIndex + 1
            mergedPatterns.add(patternIdx)
          }
        }
      }
      
      if (text) {
        // Skip if this text is part of a table (tables are handled as block patterns)
        const isInTable = blockLevelPatternsFromAll.some(p => 
          p.type === 'table' &&
          lastIndex >= p.index && 
          lastIndex < p.end
        )
        if (!isInTable) {
          // Split text into paragraphs (double newlines create paragraph breaks)
          // Single newlines within paragraphs should be converted to spaces
          const paragraphs = text.split(/\n\n+/)
          
          paragraphs.forEach((paragraph, paraIdx) => {
            // Check for markdown images in this paragraph and extract them
            const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
            const imageMatches = Array.from(paragraph.matchAll(markdownImageRegex))
            
            if (imageMatches.length > 0) {
              // Process text and images separately
              let paraLastIndex = 0
              imageMatches.forEach((match, imgIdx) => {
                if (match.index !== undefined) {
                  const imgStart = match.index
                  const imgEnd = match.index + match[0].length
                  const imgUrl = match[2]
                  const cleaned = cleanUrl(imgUrl)
                  
                  // Add text before this image
                  if (imgStart > paraLastIndex) {
                    const textBefore = paragraph.slice(paraLastIndex, imgStart)
                    let normalizedText = textBefore.replace(/\n/g, ' ')
                    normalizedText = normalizedText.replace(/[ \t]{2,}/g, ' ')
                    normalizedText = normalizedText.trim()
                    if (normalizedText) {
                      const textContent = parseInlineMarkdown(normalizedText, `text-${patternIdx}-para-${paraIdx}-img-${imgIdx}`, footnotes, emojiInfos)
                      parts.push(
                        <p key={`text-${patternIdx}-para-${paraIdx}-img-${imgIdx}`} className="mb-1 last:mb-0">
                          {textContent}
                        </p>
                      )
                    }
                  }
                  
                  // Render the image
                  if (isImage(cleaned)) {
                    let imageIndex = imageIndexMap.get(cleaned)
                    if (imageIndex === undefined && getImageIdentifier) {
                      const identifier = getImageIdentifier(cleaned)
                      if (identifier) {
                        imageIndex = imageIndexMap.get(`__img_id:${identifier}`)
                      }
                    }
                    
                    let thumbnailUrl: string | undefined
                    if (imageThumbnailMap) {
                      thumbnailUrl = imageThumbnailMap.get(cleaned)
                      if (!thumbnailUrl && getImageIdentifier) {
                        const identifier = getImageIdentifier(cleaned)
                        if (identifier) {
                          thumbnailUrl = imageThumbnailMap.get(`__img_id:${identifier}`)
                        }
                      }
                    }
                    // Don't use thumbnails in notes - use original URL
                    const displayUrl = imgUrl
                    
                    parts.push(
                      <div key={`img-${patternIdx}-para-${paraIdx}-${imgIdx}`} className="my-2 block max-w-[400px] mx-auto">
                        <Image
                          image={{ url: displayUrl, pubkey: eventPubkey }}
                          className="w-full rounded-lg cursor-zoom-in"
                          classNames={{
                            wrapper: 'rounded-lg block w-full',
                            errorPlaceholder: 'aspect-square h-[30vh]'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (imageIndex !== undefined) {
                              openLightbox(imageIndex)
                            }
                          }}
                        />
                      </div>
                    )
                  }
                  
                  paraLastIndex = imgEnd
                }
              })
              
              // Add any remaining text after the last image
              if (paraLastIndex < paragraph.length) {
                const remainingText = paragraph.slice(paraLastIndex)
                let normalizedText = remainingText.replace(/\n/g, ' ')
                normalizedText = normalizedText.replace(/[ \t]{2,}/g, ' ')
                normalizedText = normalizedText.trim()
                if (normalizedText) {
                  const textContent = parseInlineMarkdown(normalizedText, `text-${patternIdx}-para-${paraIdx}-final`, footnotes, emojiInfos)
                  parts.push(
                    <p key={`text-${patternIdx}-para-${paraIdx}-final`} className="mb-1 last:mb-0">
                      {textContent}
                    </p>
                  )
                }
              }
            } else {
              // No images, process normally
              // Convert single newlines to spaces within the paragraph
              // This prevents hard breaks within sentences
              // Also collapse multiple spaces into one
              let normalizedPara = paragraph.replace(/\n/g, ' ')
              // Collapse multiple consecutive spaces/tabs (2+) into a single space, but preserve single spaces
              normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
              // Trim only leading/trailing whitespace, not internal spaces
              normalizedPara = normalizedPara.trim()
              if (normalizedPara) {
                // Process paragraph for inline formatting (which will handle markdown links)
                const paraContent = parseInlineMarkdown(normalizedPara, `text-${patternIdx}-para-${paraIdx}`, footnotes, emojiInfos)
                // Wrap in paragraph tag (no whitespace-pre-wrap, let normal text wrapping handle it)
                parts.push(
                  <p key={`text-${patternIdx}-para-${paraIdx}`} className="mb-1 last:mb-0">
                    {paraContent}
                  </p>
                )
              } else if (paraIdx > 0) {
                // Empty paragraph between non-empty paragraphs - add spacing
                // This handles cases where there are multiple consecutive newlines
                parts.push(<br key={`text-${patternIdx}-para-break-${paraIdx}`} />)
              }
            }
          })
          
          // Update lastIndex to the end of the processed text (including link if merged)
          // Only update if we haven't already updated it (e.g., for hashtag-only lines)
          if (textEndIndex > lastIndex) {
            lastIndex = textEndIndex
          }
        } else {
          // Still update lastIndex even if in table
          lastIndex = textEndIndex
        }
      } else {
        // No text before pattern, but still update lastIndex if we merged a pattern
        if (mergedPatterns.has(patternIdx)) {
          // textEndIndex should have been set during the merge logic above
          if (textEndIndex > lastIndex) {
            lastIndex = textEndIndex
          }
          // Skip rendering since it was merged
          return
        }
      }
    } else {
      // Pattern starts at or before lastIndex - check if it was merged
      // This can happen if a previous pattern's merge extended past this pattern
      if (mergedPatterns.has(patternIdx)) {
        // This pattern was already merged (e.g., as part of a hashtag-only line)
        // Skip it and don't update lastIndex (it was already updated)
        return
      }
    }
    
    // Skip rendering if this pattern was merged into a paragraph
    // (lastIndex was already updated when we merged it above)
    // This is a final safety check
    if (mergedPatterns.has(patternIdx)) {
      return
    }
    
    // Render pattern
    if (pattern.type === 'markdown-image') {
      const { url } = pattern.data
      const cleaned = cleanUrl(url)
      // Look up image index - try by URL first, then by identifier for cross-domain matching
      let imageIndex = imageIndexMap.get(cleaned)
      if (imageIndex === undefined && getImageIdentifier) {
        const identifier = getImageIdentifier(cleaned)
        if (identifier) {
          imageIndex = imageIndexMap.get(`__img_id:${identifier}`)
        }
      }
      
      if (isImage(cleaned)) {
        // Check if there's a thumbnail available for this image
        // Use thumbnail for display, but original URL for lightbox
        let thumbnailUrl: string | undefined
        if (imageThumbnailMap) {
          thumbnailUrl = imageThumbnailMap.get(cleaned)
          // Also check by identifier for cross-domain matching
          if (!thumbnailUrl && getImageIdentifier) {
            const identifier = getImageIdentifier(cleaned)
            if (identifier) {
              thumbnailUrl = imageThumbnailMap.get(`__img_id:${identifier}`)
            }
          }
        }
        // Don't use thumbnails in notes - use original URL
        const displayUrl = url
        const hasThumbnail = false
        
        parts.push(
          <div key={`img-${patternIdx}`} className={`my-2 block ${hasThumbnail ? 'max-w-[120px]' : 'max-w-[400px]'}`}>
            <Image
              image={{ url: displayUrl, pubkey: eventPubkey }}
              className={`${hasThumbnail ? 'h-auto' : 'w-full'} rounded-lg cursor-zoom-in`}
              classNames={{
                wrapper: `rounded-lg block ${hasThumbnail ? '' : 'w-full'}`,
                errorPlaceholder: 'aspect-square h-[30vh]'
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (imageIndex !== undefined) {
                  openLightbox(imageIndex)
                }
              }}
            />
          </div>
        )
      } else if (isVideo(cleaned) || isAudio(cleaned)) {
        const poster = videoPosterMap?.get(cleaned)
        parts.push(
          <div key={`media-${patternIdx}`} className="my-2">
            <MediaPlayer
              src={cleaned}
              className="max-w-[400px]"
              mustLoad={false}
              poster={poster}
            />
          </div>
        )
      }
    } else if (pattern.type === 'markdown-image-link') {
      // Link containing an image: [![](image)](url)
      const { text, url } = pattern.data
      // Extract image URL from the link text (which contains ![](imageUrl))
      const imageMatch = text.match(/!\[([^\]]*)\]\(([^)]+)\)/)
      if (imageMatch) {
        const imageUrl = imageMatch[2]
        const cleaned = cleanUrl(imageUrl)
        
        if (isImage(cleaned)) {
          // Check if there's a thumbnail available for this image
          let thumbnailUrl: string | undefined
          if (imageThumbnailMap) {
            thumbnailUrl = imageThumbnailMap.get(cleaned)
            // Also check by identifier for cross-domain matching
            if (!thumbnailUrl && getImageIdentifier) {
              const identifier = getImageIdentifier(cleaned)
              if (identifier) {
                thumbnailUrl = imageThumbnailMap.get(`__img_id:${identifier}`)
              }
            }
          }
          // Don't use thumbnails in notes - use original URL
          const displayUrl = imageUrl
          
          // Render as a block-level clickable image that links to the URL
          // Clicking the image should navigate to the URL (standard markdown behavior)
          parts.push(
            <div key={`image-link-${patternIdx}`} className="my-2 block">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block max-w-[400px] mx-auto no-underline hover:no-underline focus:no-underline"
                onClick={(e) => {
                  e.stopPropagation()
                  // Allow normal link navigation
                }}
              >
                <Image
                  image={{ url: displayUrl, pubkey: eventPubkey }}
                  className="w-full rounded-lg cursor-pointer"
                  classNames={{
                    wrapper: 'rounded-lg block w-full',
                    errorPlaceholder: 'aspect-square h-[30vh]'
                  }}
                  onClick={(e) => {
                    // Don't prevent default - let the link handle navigation
                    e.stopPropagation()
                  }}
                />
              </a>
            </div>
          )
        } else {
          // Not an image, render as regular link
          parts.push(
            <a
              key={`link-${patternIdx}`}
              href={url}
              className="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
              target="_blank"
              rel="noopener noreferrer"
            >
              {text}
            </a>
          )
        }
      } else {
        // Fallback: render as regular link
        parts.push(
          <a
            key={`link-${patternIdx}`}
            href={url}
            className="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
            target="_blank"
            rel="noopener noreferrer"
          >
            {text}
          </a>
        )
      }
    } else if (pattern.type === 'markdown-link-standalone') {
      const { url } = pattern.data
      const cleanedStandalone = cleanUrl(url) || url
      if (
        suppressStandaloneWebPreviewForCleanedUrl &&
        cleanedStandalone === suppressStandaloneWebPreviewForCleanedUrl
      ) {
        parts.push(
          <a
            key={`link-${patternIdx}`}
            href={url}
            className="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
            target="_blank"
            rel="noopener noreferrer"
          >
            {url}
          </a>
        )
      } else {
        parts.push(
          <div key={`webpreview-${patternIdx}`} className="my-2">
            <WebPreview url={url} className="w-full" />
          </div>
        )
      }
    } else if (pattern.type === 'markdown-link') {
      const { text, url } = pattern.data
      // Process the link text for inline formatting (bold, italic, etc.)
      const linkContent = parseInlineMarkdown(text, `link-${patternIdx}`, footnotes, emojiInfos)
      // Markdown links should always be rendered as inline links, not block-level components
      // This ensures they don't break up the content flow when used in paragraphs
      if (isWebsocketUrl(url)) {
        // Relay URLs link to relay page
        const relayPath = `/relays/${encodeURIComponent(url)}`
        parts.push(
          <a
            key={`relay-${patternIdx}`}
            href={relayPath}
            className="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              navigateToRelay(relayPath)
            }}
            title={text.length > 200 ? text : undefined}
          >
            {linkContent}
          </a>
        )
      } else {
        // Regular markdown links render as simple inline links (green to match theme)
        parts.push(
          <a
            key={`link-${patternIdx}`}
            href={url}
            className="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkContent}
          </a>
        )
      }
    } else if (pattern.type === 'youtube-url') {
      const { url } = pattern.data
      // Render YouTube URL as embedded player
      parts.push(
        <div key={`youtube-url-${patternIdx}`} className="my-2">
          <YoutubeEmbeddedPlayer
            url={url}
            className="max-w-[400px]"
            mustLoad={false}
          />
        </div>
      )
    } else if (pattern.type === 'relay-url') {
      const { url } = pattern.data
      const relayPath = `/relays/${encodeURIComponent(url)}`
      const displayText = truncateLinkText(url)
      parts.push(
        <a
          key={`relay-${patternIdx}`}
          href={relayPath}
          className="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            navigateToRelay(relayPath)
          }}
          title={url.length > 200 ? url : undefined}
        >
          {displayText}
        </a>
      )
    } else if (pattern.type === 'header') {
      const { level, text } = pattern.data
      // Parse the header text for inline formatting (but not nested headers)
      const headerContent = parseInlineMarkdown(text, `header-${patternIdx}`, footnotes, emojiInfos)
      const HeaderTag = `h${Math.min(level, 6)}` as keyof JSX.IntrinsicElements
      parts.push(
        <HeaderTag 
          key={`header-${patternIdx}`} 
          className={`font-bold break-words block mt-4 mb-2 ${
            level === 1 ? 'text-3xl' :
            level === 2 ? 'text-2xl' :
            level === 3 ? 'text-xl' :
            level === 4 ? 'text-lg' :
            level === 5 ? 'text-base' :
            'text-sm'
          }`}
        >
          {headerContent}
        </HeaderTag>
      )
    } else if (pattern.type === 'horizontal-rule') {
      parts.push(
        <hr key={`hr-${patternIdx}`} className="my-4 border-t border-gray-300 dark:border-gray-700" />
      )
    } else if (pattern.type === 'bullet-list-item') {
      const { text } = pattern.data
      const listContent = parseInlineMarkdown(text, `bullet-${patternIdx}`, footnotes, emojiInfos)
      parts.push(
        <li key={`bullet-${patternIdx}`} className="list-disc list-inside my-1">
          {listContent}
        </li>
      )
    } else if (pattern.type === 'numbered-list-item') {
      const { text, number } = pattern.data
      const listContent = parseInlineMarkdown(text, `numbered-${patternIdx}`, footnotes, emojiInfos)
      const itemNumber = number ? parseInt(number, 10) : undefined
      parts.push(
        <li key={`numbered-${patternIdx}`} className="leading-tight" value={itemNumber}>
          {listContent}
        </li>
      )
    } else if (pattern.type === 'table') {
      const { rows } = pattern.data
      if (rows.length > 0) {
        const headerRow = rows[0]
        const dataRows = rows.slice(1)
        parts.push(
          <div key={`table-${patternIdx}`} className="my-4 overflow-x-auto">
            <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-700">
              <thead>
                <tr>
                  {headerRow.map((cell: string, cellIdx: number) => (
                    <th 
                      key={`th-${patternIdx}-${cellIdx}`} 
                      className="border border-gray-300 dark:border-gray-700 px-4 py-2 bg-gray-100 dark:bg-gray-800 font-semibold text-left"
                    >
                      {parseInlineMarkdown(cell, `table-header-${patternIdx}-${cellIdx}`, footnotes, emojiInfos)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row: string[], rowIdx: number) => (
                  <tr key={`tr-${patternIdx}-${rowIdx}`}>
                    {row.map((cell: string, cellIdx: number) => (
                      <td 
                        key={`td-${patternIdx}-${rowIdx}-${cellIdx}`} 
                        className="border border-gray-300 dark:border-gray-700 px-4 py-2"
                      >
                        {parseInlineMarkdown(cell, `table-cell-${patternIdx}-${rowIdx}-${cellIdx}`, footnotes, emojiInfos)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    } else if (pattern.type === 'blockquote') {
      const { lines } = pattern.data
      // Group lines into paragraphs (consecutive non-empty lines form a paragraph, empty lines separate paragraphs)
      const paragraphs: string[][] = []
      let currentParagraph: string[] = []
      
      lines.forEach((line: string) => {
        if (line.trim() === '') {
          // Empty line - if we have a current paragraph, finish it and start a new one
          if (currentParagraph.length > 0) {
            paragraphs.push(currentParagraph)
            currentParagraph = []
          }
        } else {
          // Non-empty line - add to current paragraph
          currentParagraph.push(line)
        }
      })
      
      // Add the last paragraph if it exists
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph)
      }
      
      // Render paragraphs
      const blockquoteContent = paragraphs.map((paragraphLines: string[], paraIdx: number) => {
        // Join paragraph lines with newlines to preserve line breaks (especially before em-dashes)
        // This preserves the original formatting of the blockquote
        const paragraphText = paragraphLines.join('\n')
        const paragraphContent = parseInlineMarkdown(paragraphText, `blockquote-${patternIdx}-para-${paraIdx}`, footnotes, emojiInfos)
        
        return (
          <p key={`blockquote-${patternIdx}-para-${paraIdx}`} className="mb-1 last:mb-0 whitespace-pre-line">
            {paragraphContent}
          </p>
        )
      })
      
      parts.push(
        <blockquote
          key={`blockquote-${patternIdx}`}
          className="border-l-4 border-gray-400 dark:border-gray-500 pl-4 pr-2 py-2 my-4 italic text-gray-700 dark:text-gray-300 bg-gray-50/50 dark:bg-gray-800/30"
        >
          {blockquoteContent}
        </blockquote>
      )
    } else if (pattern.type === 'greentext') {
      const { lines } = pattern.data
      // Join all greentext lines with <br> to preserve line breaks
      // Each line should have the > prefix preserved
      const greentextContent = lines.map((line: string, lineIdx: number) => {
        // Parse inline markdown for each line (for links, hashtags, etc.)
        const lineContent = parseInlineMarkdown(line, `greentext-${patternIdx}-line-${lineIdx}`, footnotes, emojiInfos)
        return (
          <React.Fragment key={`greentext-${patternIdx}-line-${lineIdx}`}>
            {lineIdx > 0 && <br />}
            &gt;{lineContent}
          </React.Fragment>
        )
      })
      
      parts.push(
        <span
          key={`greentext-${patternIdx}`}
          className="greentext block my-1"
        >
          {greentextContent}
        </span>
      )
    } else if (pattern.type === 'fenced-code-block') {
      const { code, language } = pattern.data
      // Render code block with syntax highlighting
      // We'll use a ref and useEffect to apply highlight.js after render
      const codeBlockId = `code-block-${patternIdx}`
      parts.push(
        <CodeBlock 
          key={codeBlockId}
          id={codeBlockId}
          code={code}
          language={language}
        />
      )
    } else if (pattern.type === 'footnote-definition') {
      // Don't render footnote definitions in the main content - they'll be rendered at the bottom
      // Just skip this pattern
    } else if (pattern.type === 'footnote-ref') {
      const footnoteId = pattern.data
      const footnoteText = footnotes.get(footnoteId)
      if (footnoteText) {
        parts.push(
          <sup key={`footnote-ref-${patternIdx}`} className="footnote-ref">
            <a 
              href={`#footnote-${footnoteId}`} 
              id={`footnote-ref-${footnoteId}`}
              className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline no-underline"
              onClick={(e) => {
                e.preventDefault()
                const footnoteElement = document.getElementById(`footnote-${footnoteId}`)
                if (footnoteElement) {
                  footnoteElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              }}
            >
              [{footnoteId}]
            </a>
          </sup>
        )
      } else {
        // Footnote not found, just render the reference as-is
        parts.push(<span key={`footnote-ref-${patternIdx}`}>[^{footnoteId}]</span>)
      }
    } else if (pattern.type === 'citation') {
      const { type: citationType, citationId, index: citationIndex } = pattern.data
      const citationNumber = citationIndex + 1
      
      if (citationType === 'inline' || citationType === 'prompt-inline') {
        // Inline citations render as clickable text
        parts.push(
          <EmbeddedCitation
            key={`citation-${patternIdx}`}
            citationId={citationId}
            displayType={citationType as 'inline' | 'prompt-inline'}
            className="inline"
          />
        )
      } else if (citationType === 'foot' || citationType === 'foot-end') {
        // Footnotes render as superscript numbers
        parts.push(
          <sup key={`citation-foot-${patternIdx}`} className="citation-ref">
            <a
              href={`#citation-${citationIndex}`}
              id={`citation-ref-${citationIndex}`}
              className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline no-underline"
              onClick={(e) => {
                e.preventDefault()
                const citationElement = document.getElementById(`citation-${citationIndex}`)
                if (citationElement) {
                  citationElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              }}
            >
              [{citationNumber}]
            </a>
          </sup>
        )
      } else if (citationType === 'quote') {
        // Quotes render as block-level citation cards
        parts.push(
          <div key={`citation-quote-${patternIdx}`} className="w-full my-2">
            <EmbeddedCitation
              citationId={citationId}
              displayType="quote"
            />
          </div>
        )
      } else {
        // end, prompt-end render as superscript numbers that link to references section
        parts.push(
          <sup key={`citation-end-${patternIdx}`} className="citation-ref">
            <a
              href="#references-section"
              id={`citation-ref-${citationIndex}`}
              className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline no-underline"
              onClick={(e) => {
                e.preventDefault()
                const refSection = document.getElementById('references-section')
                if (refSection) {
                  refSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              }}
            >
              [{citationNumber}]
            </a>
          </sup>
        )
      }
    } else if (pattern.type === 'nostr') {
      const bech32Id = pattern.data
      // Check if it's a profile type (mentions/handles should be inline)
      if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
        parts.push(
          <span key={`nostr-${patternIdx}`} className="inline">
            <EmbeddedMention userId={bech32Id} />
          </span>
        )
      } else if (bech32Id.startsWith('note') || bech32Id.startsWith('nevent') || bech32Id.startsWith('naddr')) {
        // When this is the calendar invite naddr, show full calendar card with RSVP instead of embedded preview
        if (fullCalendarInvite && fullCalendarInvite.naddr === bech32Id) {
          parts.push(
            <div key={`nostr-${patternIdx}`} className="w-full my-2">
              <CalendarEventContent event={fullCalendarInvite.event} className="mt-2" showRsvp />
            </div>
          )
        } else {
          // Embedded events should be block-level and fill width
          parts.push(
            <div key={`nostr-${patternIdx}`} className="w-full my-2">
              <EmbeddedNote noteId={bech32Id} />
            </div>
          )
        }
      } else {
        parts.push(<span key={`nostr-${patternIdx}`}>nostr:{bech32Id}</span>)
      }
    } else if (pattern.type === 'hashtag') {
      const tag = pattern.data
      const tagLower = tag.toLowerCase()
      hashtagsInContent.add(tagLower) // Track hashtags rendered inline
      
      // Check if there's another hashtag immediately following (no space between them)
      // If so, add a space after this hashtag to prevent them from appearing smushed together
      const nextPattern = filteredPatterns[patternIdx + 1]
      // Add space if the next pattern is a hashtag that starts exactly where this one ends
      // (meaning there's no space or text between them)
      const shouldAddSpace = nextPattern && nextPattern.type === 'hashtag' && nextPattern.index === pattern.end
      
      parts.push(
        <a
          key={`hashtag-${patternIdx}`}
          href={`/notes?t=${tagLower}`}
          className="inline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline cursor-pointer whitespace-nowrap"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            navigateToHashtag(`/notes?t=${tagLower}`)
          }}
        >
          #{tag}
        </a>
      )
      
      // Add a space after the hashtag if another hashtag follows immediately
      // Use a non-breaking space wrapped in a span to ensure it's rendered
      if (shouldAddSpace) {
        parts.push(<span key={`hashtag-space-${patternIdx}`} className="whitespace-pre"> </span>)
      }
    } else if (pattern.type === 'bookstr-url') {
      const { wikilink, sourceUrl } = pattern.data
      parts.push(
        <BookstrContent key={`bookstr-url-${patternIdx}`} wikilink={wikilink} sourceUrl={sourceUrl} />
      )
    } else if (pattern.type === 'wikilink') {
      const linkContent = pattern.data
      
      // Check if this is a bookstr wikilink (NKBIP-08 format: book::...)
      const isBookstrLink = linkContent.startsWith('book::')
      
      if (isBookstrLink) {
        // Extract the bookstr content (already in book:: format)
        const bookstrContent = linkContent.trim()
        parts.push(
          <BookstrContent key={`bookstr-${patternIdx}`} wikilink={bookstrContent} />
        )
      } else {
        // Regular wikilink
      let target = linkContent.includes('|') ? linkContent.split('|')[0].trim() : linkContent.trim()
      let displayText = linkContent.includes('|') ? linkContent.split('|')[1].trim() : linkContent.trim()
      
      const dtag = target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      
      parts.push(
        <Wikilink key={`wikilink-${patternIdx}`} dTag={dtag} displayText={displayText} />
      )
      }
    }
    
    lastIndex = pattern.end
  })
  
  // Add remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex)
    // Skip whitespace-only text to avoid empty spans
    if (text && text.trim()) {
      // Process text for inline formatting
      // But skip if this text is part of a table
      const isInTable = blockLevelPatternsFromAll.some((p: { type: string; index: number; end: number }) => 
        p.type === 'table' &&
        lastIndex >= p.index && 
        lastIndex < p.end
      )
      if (!isInTable && text.trim()) {
        // Check if there are any markdown images in the remaining text that weren't detected as patterns
        // If so, we need to process them separately before processing the text
        const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
        const remainingImageMatches = Array.from(text.matchAll(markdownImageRegex))
        
        // Process images first, then text between/after them
        let textLastIndex = 0
        remainingImageMatches.forEach((match, imgIdx) => {
          if (match.index !== undefined) {
            const imgStart = match.index
            const imgEnd = match.index + match[0].length
            const imgUrl = match[2]
            const cleaned = cleanUrl(imgUrl)
            
            // Add text before this image
            if (imgStart > textLastIndex) {
              const textBefore = text.slice(textLastIndex, imgStart).trim()
              if (textBefore) {
                // Split into paragraphs
                const paragraphs = textBefore.split(/\n\n+/)
                paragraphs.forEach((paragraph, paraIdx) => {
                  let normalizedPara = paragraph.replace(/\n/g, ' ')
                  normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
                  normalizedPara = normalizedPara.trim()
                  if (normalizedPara) {
                    const paraContent = parseInlineMarkdown(normalizedPara, `text-end-para-${imgIdx}-${paraIdx}`, footnotes, emojiInfos)
                    parts.push(
                      <p key={`text-end-para-${imgIdx}-${paraIdx}`} className="mb-1 last:mb-0">
                        {paraContent}
                      </p>
                    )
                  }
                })
              }
            }
            
            // Render the image
            if (isImage(cleaned)) {
              let imageIndex = imageIndexMap.get(cleaned)
              if (imageIndex === undefined && getImageIdentifier) {
                const identifier = getImageIdentifier(cleaned)
                if (identifier) {
                  imageIndex = imageIndexMap.get(`__img_id:${identifier}`)
                }
              }
              
              let thumbnailUrl: string | undefined
              if (imageThumbnailMap) {
                thumbnailUrl = imageThumbnailMap.get(cleaned)
                if (!thumbnailUrl && getImageIdentifier) {
                  const identifier = getImageIdentifier(cleaned)
                  if (identifier) {
                    thumbnailUrl = imageThumbnailMap.get(`__img_id:${identifier}`)
                  }
                }
              }
              const displayUrl = thumbnailUrl || imgUrl
              
              parts.push(
                <div key={`img-end-${imgIdx}`} className="my-2 block max-w-[400px] mx-auto">
                  <Image
                    image={{ url: displayUrl, pubkey: eventPubkey }}
                    className="w-full rounded-lg cursor-zoom-in"
                    classNames={{
                      wrapper: 'rounded-lg block w-full',
                      errorPlaceholder: 'aspect-square h-[30vh]'
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (imageIndex !== undefined) {
                        openLightbox(imageIndex)
                      }
                    }}
                  />
                </div>
              )
            }
            
            textLastIndex = imgEnd
          }
        })
        
        // Add any remaining text after the last image
        if (textLastIndex < text.length) {
          const remainingText = text.slice(textLastIndex).trim()
          if (remainingText) {
            const paragraphs = remainingText.split(/\n\n+/)
            paragraphs.forEach((paragraph, paraIdx) => {
              let normalizedPara = paragraph.replace(/\n/g, ' ')
              normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
              normalizedPara = normalizedPara.trim()
              if (normalizedPara) {
                const paraContent = parseInlineMarkdown(normalizedPara, `text-end-final-para-${paraIdx}`, footnotes, emojiInfos)
                parts.push(
                  <p key={`text-end-final-para-${paraIdx}`} className="mb-1 last:mb-0">
                    {paraContent}
                  </p>
                )
              }
            })
          }
        } else if (remainingImageMatches.length === 0) {
          // No images found, process the text normally
          const paragraphs = text.split(/\n\n+/)
          paragraphs.forEach((paragraph, paraIdx) => {
            // Convert single newlines to spaces within the paragraph
            // Collapse multiple consecutive spaces/tabs (2+) into a single space, but preserve single spaces
            let normalizedPara = paragraph.replace(/\n/g, ' ')
            normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
            normalizedPara = normalizedPara.trim()
            if (normalizedPara) {
              const paraContent = parseInlineMarkdown(normalizedPara, `text-end-para-${paraIdx}`, footnotes, emojiInfos)
              parts.push(
                <p key={`text-end-para-${paraIdx}`} className="mb-1 last:mb-0">
                  {paraContent}
                </p>
              )
            }
          })
        }
      }
    }
  }
  
  // If no patterns, just return the content as text (with inline formatting and paragraphs)
  if (parts.length === 0) {
    const paragraphs = content.split(/\n\n+/)
    const formattedParagraphs = paragraphs.map((paragraph, paraIdx) => {
      // Convert single newlines to spaces within the paragraph
      // Collapse multiple consecutive spaces/tabs (2+) into a single space, but preserve single spaces
      let normalizedPara = paragraph.replace(/\n/g, ' ')
      normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
      normalizedPara = normalizedPara.trim()
      if (!normalizedPara) return null
      const paraContent = parseInlineMarkdown(normalizedPara, `text-only-para-${paraIdx}`, footnotes, emojiInfos)
      return (
        <p key={`text-only-para-${paraIdx}`} className="mb-1 last:mb-0">
          {paraContent}
        </p>
      )
    }).filter(Boolean)
    return { nodes: formattedParagraphs, hashtagsInContent, footnotes, citations }
  }
  
  // Filter out empty spans before wrapping lists
  // But preserve whitespace that appears between inline patterns (like hashtags)
  const filteredParts = parts.filter((part, idx) => {
    if (React.isValidElement(part) && part.type === 'span') {
      const children = part.props.children
      const isWhitespaceOnly = 
        (typeof children === 'string' && !children.trim()) ||
        (Array.isArray(children) && children.every(child => typeof child === 'string' && !child.trim()))
      
      if (isWhitespaceOnly) {
        // Check if this whitespace is adjacent to inline patterns (like hashtags)
        // Look at the previous and next parts to see if they're inline patterns
        const prevPart = idx > 0 ? parts[idx - 1] : null
        const nextPart = idx < parts.length - 1 ? parts[idx + 1] : null
        
        // Check if a part is an inline pattern (hashtag, wikilink, nostr mention, markdown link, etc.)
        const isInlinePattern = (part: any) => {
          if (!part || !React.isValidElement(part)) return false
          const key = part.key?.toString() || ''
          const type = part.type
          // Hashtags are <a> elements with keys starting with 'hashtag-'
          // Markdown links are <a> elements with keys starting with 'link-' or 'relay-'
          // Wikilinks might be custom components
          // Nostr mentions might be spans or other elements
          return (type === 'a' && (
            key.startsWith('hashtag-') ||
            key.startsWith('wikilink-') ||
            key.startsWith('link-') ||
            key.startsWith('relay-')
          )) ||
                 (type === 'span' && (key.startsWith('wikilink-') || key.startsWith('nostr-'))) ||
                 // Also check for embedded mentions/components that might be inline
                 (type && typeof type !== 'string' && key.includes('mention'))
        }
        
        const prevIsInlinePattern = isInlinePattern(prevPart)
        const nextIsInlinePattern = isInlinePattern(nextPart)
        
        // Preserve whitespace if it's between two inline patterns, or before/after one
        // This ensures spaces around hashtags are preserved
        if (prevIsInlinePattern || nextIsInlinePattern) {
          return true
        }
        
        // Otherwise filter out whitespace-only spans
        return false
      }
    }
    return true
  })
  
  // Wrap list items in <ul> or <ol> tags
  const wrappedParts: React.ReactNode[] = []
  let partIdx = 0
  while (partIdx < filteredParts.length) {
    const part = filteredParts[partIdx]
    // Check if this is a list item
    if (React.isValidElement(part) && part.type === 'li') {
      // Determine if it's a bullet or numbered list
      const isBullet = part.key && part.key.toString().startsWith('bullet-')
      const isNumbered = part.key && part.key.toString().startsWith('numbered-')
      
      if (isBullet || isNumbered) {
        // Collect consecutive list items of the same type
        const listItems: React.ReactNode[] = [part]
        partIdx++
        while (partIdx < filteredParts.length) {
          const nextPart = filteredParts[partIdx]
          if (React.isValidElement(nextPart) && nextPart.type === 'li') {
            const nextIsBullet = nextPart.key && nextPart.key.toString().startsWith('bullet-')
            const nextIsNumbered = nextPart.key && nextPart.key.toString().startsWith('numbered-')
            if ((isBullet && nextIsBullet) || (isNumbered && nextIsNumbered)) {
              listItems.push(nextPart)
              partIdx++
            } else {
              break
            }
          } else {
            break
          }
        }
        
        // Only wrap in <ul> or <ol> if there's more than one item
        // Single-item lists should not be formatted as lists
        if (listItems.length > 1) {
          if (isBullet) {
            wrappedParts.push(
              <ul key={`ul-${partIdx}`} className="list-disc list-inside my-2 space-y-1">
                {listItems}
              </ul>
            )
          } else {
            wrappedParts.push(
              <ol key={`ol-${partIdx}`} className="list-decimal list-outside my-2 ml-6">
                {listItems}
              </ol>
            )
          }
        } else {
          // Single item - render the original line text (including marker) as plain text
          // Extract pattern index from the key to look up original line
          const listItem = listItems[0]
          if (React.isValidElement(listItem) && listItem.key) {
            const keyStr = listItem.key.toString()
            const patternIndexMatch = keyStr.match(/(?:bullet|numbered)-(\d+)/)
            if (patternIndexMatch) {
              const patternIndex = parseInt(patternIndexMatch[1], 10)
              const originalLine = listItemOriginalLines.get(patternIndex)
              if (originalLine) {
                // Render the original line with inline markdown processing
                const lineContent = parseInlineMarkdown(originalLine, `single-list-item-${partIdx}`, footnotes, emojiInfos)
                wrappedParts.push(
                  <span key={`list-item-content-${partIdx}`}>
                    {lineContent}
                  </span>
                )
              } else {
                // Fallback: render the list item content
                wrappedParts.push(
                  <span key={`list-item-content-${partIdx}`}>
                    {listItem.props.children}
                  </span>
                )
              }
            } else {
              // Fallback: render the list item content
              wrappedParts.push(
                <span key={`list-item-content-${partIdx}`}>
                  {listItem.props.children}
                </span>
              )
            }
          } else {
            wrappedParts.push(listItem)
          }
        }
        continue
      }
    }
    
    wrappedParts.push(part)
    partIdx++
  }
  
  // Add footnotes section at the end if there are any footnotes
  if (footnotes.size > 0) {
    wrappedParts.push(
      <div key="footnotes-section" className="mt-8 pt-4 border-t border-gray-300 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Footnotes</h3>
        <ol className="list-decimal list-inside space-y-2">
          {Array.from(footnotes.entries()).map(([id, text]) => (
            <li 
              key={`footnote-${id}`} 
              id={`footnote-${id}`}
              className="text-sm text-gray-700 dark:text-gray-300"
            >
              <span className="font-semibold">[{id}]:</span>{' '}
              <span>{parseInlineMarkdown(text, `footnote-${id}`, footnotes, emojiInfos)}</span>
              {' '}
              <a 
                href={`#footnote-ref-${id}`}
                className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline text-xs"
                onClick={(e) => {
                  e.preventDefault()
                  const refElement = document.getElementById(`footnote-ref-${id}`)
                  if (refElement) {
                    refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }}
              >
                ↩
              </a>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  
  // Add citations section (footnotes) at the end if there are any footnotes
  const footCitations = citations.filter(c => c.type === 'foot' || c.type === 'foot-end')
  if (footCitations.length > 0) {
    wrappedParts.push(
      <div key="citations-footnotes-section" className="mt-8 pt-4 border-t border-gray-300 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Citations</h3>
        <ol className="list-decimal pl-6 space-y-3" style={{ listStylePosition: 'outside' }}>
          {footCitations.map((citation, idx) => (
            <li 
              key={`citation-footnote-${idx}`} 
              id={`citation-${citation.id.replace('citation-', '')}`}
              className="text-sm pl-2"
            >
              <div className="inline-block w-full relative">
                <span className="inline">
                  <EmbeddedCitation
                    citationId={citation.citationId}
                    displayType={citation.type as 'foot' | 'foot-end'}
                    className="inline"
                  />
                </span>
                <a 
                  href={`#citation-ref-${citation.id.replace('citation-', '')}`}
                  className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline text-xs ml-2 inline-flex items-center absolute right-0 top-0"
                  aria-label="Return to citation"
                  onClick={(e) => {
                    e.preventDefault()
                    const refElement = document.getElementById(`citation-ref-${citation.id.replace('citation-', '')}`)
                    if (refElement) {
                      refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                </a>
              </div>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  
  // Add references section at the end if there are any endnote citations
  const endCitations = citations.filter(c => c.type === 'end' || c.type === 'prompt-end')
  if (endCitations.length > 0) {
    wrappedParts.push(
      <div key="references-section" id="references-section" className="mt-8 pt-4 border-t border-gray-300 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">References</h3>
        <ol className="list-decimal pl-6 space-y-3" style={{ listStylePosition: 'outside' }}>
          {endCitations.map((citation, idx) => (
            <li 
              key={`citation-end-${idx}`} 
              id={`citation-end-${idx}`}
              className="text-sm pl-2"
              style={{ display: 'list-item' }}
            >
              <div className="inline-block w-full relative">
                <span className="inline">
                  <EmbeddedCitation
                    citationId={citation.citationId}
                    displayType={citation.type as 'end' | 'prompt-end'}
                    className="inline"
                  />
                </span>
                <a 
                  href={`#citation-ref-${citation.id.replace('citation-', '')}`}
                  className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline text-xs ml-2 inline-flex items-center absolute right-0 top-0"
                  aria-label="Return to citation"
                  onClick={(e) => {
                    e.preventDefault()
                    const refElement = document.getElementById(`citation-ref-${citation.id.replace('citation-', '')}`)
                    if (refElement) {
                      refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                </a>
              </div>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  
  return { nodes: wrappedParts, hashtagsInContent, footnotes, citations }
}

/**
 * Parse inline markdown formatting (bold, italic, strikethrough, inline code, footnote references)
 * Returns an array of React nodes
 * 
 * Supports:
 * - Bold: **text** or __text__ (double) or *text* (single asterisk)
 * - Italic: _text_ (single underscore) or __text__ (double underscore, but bold takes priority)
 * - Strikethrough: ~~text~~ (double tilde) or ~text~ (single tilde)
 * - Inline code: ``code`` (double backtick) or `code` (single backtick)
 * - Footnote references: [^1] (handled at block level, but parsed here for inline context)
 */
function parseInlineMarkdown(text: string, keyPrefix: string, _footnotes: Map<string, string> = new Map(), emojiInfos: TEmoji[] = []): React.ReactNode[] {
  if (isContentSpacingDebug() && text.includes('nostr:')) {
    // eslint-disable-next-line no-console
    console.log('[jumble content-spacing] parseInlineMarkdown:before-normalize', {
      keyPrefix,
      repr: reprString(text)
    })
  }
  // Normalize newlines to spaces at the start (defensive - text should already be normalized, but ensure it)
  // This prevents any hard breaks within inline content
  text = text.replace(/\n/g, ' ')
  // Collapse multiple consecutive spaces/tabs (2+) into a single space, but preserve single spaces
  text = text.replace(/[ \t]{2,}/g, ' ')
  if (isContentSpacingDebug() && text.includes('nostr:')) {
    // eslint-disable-next-line no-console
    console.log('[jumble content-spacing] parseInlineMarkdown:after-normalize', {
      keyPrefix,
      repr: reprString(text)
    })
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const inlinePatterns: Array<{ index: number; end: number; type: string; data: any }> = []
  
  // Inline code: ``code`` (double backtick) or `code` (single backtick) - process first to avoid conflicts
  // Double backticks first
  const doubleCodeRegex = /``([^`\n]+?)``/g
  const doubleCodeMatches = Array.from(text.matchAll(doubleCodeRegex))
  doubleCodeMatches.forEach(match => {
    if (match.index !== undefined) {
      inlinePatterns.push({
        index: match.index,
        end: match.index + match[0].length,
        type: 'code',
        data: match[1]
      })
    }
  })
  
  // Single backtick (but not if already in double backtick)
  const singleCodeRegex = /`([^`\n]+?)`/g
  const singleCodeMatches = Array.from(text.matchAll(singleCodeRegex))
  singleCodeMatches.forEach(match => {
    if (match.index !== undefined) {
      const isInDoubleCode = inlinePatterns.some(p => 
        p.type === 'code' &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInDoubleCode) {
        inlinePatterns.push({
              index: match.index,
              end: match.index + match[0].length,
          type: 'code',
          data: match[1]
        })
      }
    }
  })
  
  // Bold: **text** (double asterisk) or __text__ (double underscore) - process first
  // Also handle *text* (single asterisk) as bold
  // Allow single newlines within bold spans (but not double newlines which indicate paragraph breaks)
  const doubleBoldAsteriskRegex = /\*\*((?:[^\n]|\n(?!\n))+\n?)\*\*/g
  const doubleBoldAsteriskMatches = Array.from(text.matchAll(doubleBoldAsteriskRegex))
  doubleBoldAsteriskMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in code
      const isInCode = inlinePatterns.some(p => 
        p.type === 'code' &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInCode) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'bold',
          data: match[1]
        })
      }
    }
  })
  
  // Double underscore bold (but check if it's already italic)
  // Allow single newlines within bold spans (but not double newlines which indicate paragraph breaks)
  const doubleBoldUnderscoreRegex = /__((?:[^\n]|\n(?!\n))+\n?)__/g
  const doubleBoldUnderscoreMatches = Array.from(text.matchAll(doubleBoldUnderscoreRegex))
  doubleBoldUnderscoreMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in code or bold
      const isInOther = inlinePatterns.some(p => 
        (p.type === 'code' || p.type === 'bold') &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'bold',
          data: match[1]
        })
      }
    }
  })
  
  // Single asterisk bold: *text* (not part of **bold**)
  const singleBoldAsteriskRegex = /(?<!\*)\*([^*\n]+?)\*(?!\*)/g
  const singleBoldAsteriskMatches = Array.from(text.matchAll(singleBoldAsteriskRegex))
  singleBoldAsteriskMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in code, double bold, or strikethrough
      const isInOther = inlinePatterns.some(p => 
        (p.type === 'code' || p.type === 'bold' || p.type === 'strikethrough') &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'bold',
          data: match[1]
        })
      }
    }
  })
  
  // Strikethrough: ~~text~~ (double tilde) or ~text~ (single tilde)
  // Double tildes first
  const doubleStrikethroughRegex = /~~(.+?)~~/g
  const doubleStrikethroughMatches = Array.from(text.matchAll(doubleStrikethroughRegex))
  doubleStrikethroughMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in code or bold
      const isInOther = inlinePatterns.some(p => 
        (p.type === 'code' || p.type === 'bold') &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'strikethrough',
          data: match[1]
        })
      }
    }
  })
  
  // Single tilde strikethrough
  const singleStrikethroughRegex = /(?<!~)~([^~\n]+?)~(?!~)/g
  const singleStrikethroughMatches = Array.from(text.matchAll(singleStrikethroughRegex))
  singleStrikethroughMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in code, bold, or double strikethrough
      const isInOther = inlinePatterns.some(p => 
        (p.type === 'code' || p.type === 'bold' || p.type === 'strikethrough') &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'strikethrough',
          data: match[1]
        })
      }
    }
  })
  
  // Italic: _text_ (single underscore) or __text__ (double underscore, but bold takes priority)
  // Single underscore italic (not part of __bold__)
  const singleItalicUnderscoreRegex = /(?<!_)_([^_\n]+?)_(?!_)/g
  const singleItalicUnderscoreMatches = Array.from(text.matchAll(singleItalicUnderscoreRegex))
  singleItalicUnderscoreMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in code, bold, or strikethrough
      const isInOther = inlinePatterns.some(p => 
        (p.type === 'code' || p.type === 'bold' || p.type === 'strikethrough') &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'italic',
          data: match[1]
        })
      }
    }
  })
  
  // Double underscore italic (only if not already bold)
  // Note: __text__ is bold by default, but if user wants it italic, we can add it
  // For now, we'll keep __text__ as bold only, and _text_ as italic
  
  // Markdown links: [text](url) - but not images (process after code/bold/italic to avoid conflicts)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const markdownLinkMatches = Array.from(text.matchAll(markdownLinkRegex))
  markdownLinkMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in code, bold, italic, or strikethrough
      const isInOther = inlinePatterns.some(p => 
        (p.type === 'code' || p.type === 'bold' || p.type === 'italic' || p.type === 'strikethrough') &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'link',
          data: { text: match[1], url: match[2] }
        })
      }
    }
  })
  
  // Hashtags: #tag (process after code/bold/italic/links to avoid conflicts)
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g
  const hashtagMatches = Array.from(text.matchAll(hashtagRegex))
  hashtagMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in code, bold, italic, strikethrough, link, relay-url, nostr, or payto
      const isInOther = inlinePatterns.some(p => 
        (p.type === 'code' || p.type === 'bold' || p.type === 'italic' || p.type === 'strikethrough' || p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto') &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'hashtag',
          data: match[1] // The tag without the #
        })
      }
    }
  })
  
  // Relay URLs: wss:// or ws:// (process after code/bold/italic/links/hashtags to avoid conflicts)
  const relayUrlMatches = Array.from(text.matchAll(WS_URL_REGEX))
  relayUrlMatches.forEach(match => {
    if (match.index !== undefined) {
      const url = match[0]
      // Only process if it's actually a websocket URL
      if (isWebsocketUrl(url)) {
        // Skip if already in code, bold, italic, strikethrough, link, hashtag, or nostr
        const isInOther = inlinePatterns.some(p => 
          (p.type === 'code' || p.type === 'bold' || p.type === 'italic' || p.type === 'strikethrough' || p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr') &&
          match.index! >= p.index && 
          match.index! < p.end
        )
        if (!isInOther) {
          inlinePatterns.push({
            index: match.index,
            end: match.index + match[0].length,
            type: 'relay-url',
            data: url
          })
        }
      }
    }
  })
  
  // Nostr addresses: nostr:npub1..., nostr:note1..., etc. (process after code/bold/italic/links/hashtags/relay-urls to avoid conflicts)
  // Only process profile types (npub/nprofile) inline; event types (note/nevent/naddr) should remain block-level
  const nostrRegex = new RegExp(NOSTR_URI_INLINE_REGEX.source, NOSTR_URI_INLINE_REGEX.flags)
  const nostrMatches = Array.from(text.matchAll(nostrRegex))
  nostrMatches.forEach(match => {
    if (match.index !== undefined) {
      const bech32Id = match[1]
      // Only process profile types inline; event types should remain block-level
      const isProfileType = bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')
      
      if (isProfileType) {
        // Skip if already in code, bold, italic, strikethrough, link, hashtag, or relay-url
        const isInOther = inlinePatterns.some(p => 
          (p.type === 'code' || p.type === 'bold' || p.type === 'italic' || p.type === 'strikethrough' || p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto') &&
          match.index! >= p.index && 
          match.index! < p.end
        )
        if (!isInOther) {
          inlinePatterns.push({
            index: match.index,
            end: match.index + match[0].length,
            type: 'nostr',
            data: bech32Id
          })
        }
      }
    }
  })

  // payto: URIs (RFC-8905 / NIP-A3) – process after nostr so we don't match inside other patterns
  const paytoMatches = Array.from(text.matchAll(PAYTO_URI_REGEX))
  paytoMatches.forEach(match => {
    if (match.index !== undefined) {
      const fullMatch = match[0]
      const parsed = parsePaytoUri(fullMatch)
      if (!parsed) return
      const isInOther = inlinePatterns.some(p =>
        (p.type === 'code' || p.type === 'bold' || p.type === 'italic' || p.type === 'strikethrough' || p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto') &&
        match.index! >= p.index &&
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'payto',
          data: parsed
        })
      }
    }
  })

  // Emoji shortcodes :shortcode: or :short code: (custom and native)
  const emojiMatches = Array.from(text.matchAll(EMOJI_SHORT_CODE_REGEX))
  emojiMatches.forEach(match => {
    if (match.index !== undefined) {
      const isInOther = inlinePatterns.some(p =>
        (p.type === 'code' || p.type === 'bold' || p.type === 'italic' || p.type === 'strikethrough' || p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto' || p.type === 'emoji') &&
        match.index! >= p.index &&
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'emoji',
          data: (match[1] ?? match[0].slice(1, -1)).trim()
        })
      }
    }
  })
  
  // Sort by index
  inlinePatterns.sort((a, b) => a.index - b.index)
  
  // Remove overlaps (keep first)
  const filtered: typeof inlinePatterns = []
  let lastEnd = 0
  inlinePatterns.forEach(pattern => {
    if (pattern.index >= lastEnd) {
      filtered.push(pattern)
      lastEnd = pattern.end
    }
  })
  
  // Build nodes
  filtered.forEach((pattern, i) => {
    // Add text before pattern
    if (pattern.index > lastIndex) {
      let textBefore = text.slice(lastIndex, pattern.index)
      // Preserve spaces for proper spacing around inline elements
      // Text is already normalized (newlines to spaces, multiple spaces collapsed to one)
      // Even if textBefore is just whitespace, we need to preserve it for spacing
      if (textBefore.length > 0) {
        // If it's all whitespace, render as a space
        if (textBefore.trim().length === 0) {
          parts.push(<span key={`${keyPrefix}-space-${i}`}>{' '}</span>)
        } else {
          parts.push(<span key={`${keyPrefix}-inline-text-${i}`}>{textBefore}</span>)
        }
      }
    }
    
    // Render pattern
    if (pattern.type === 'bold') {
      parts.push(<strong key={`${keyPrefix}-bold-${i}`}>{pattern.data}</strong>)
    } else if (pattern.type === 'italic') {
      parts.push(<em key={`${keyPrefix}-italic-${i}`}>{pattern.data}</em>)
    } else if (pattern.type === 'strikethrough') {
      parts.push(<del key={`${keyPrefix}-strikethrough-${i}`} className="line-through">{pattern.data}</del>)
    } else if (pattern.type === 'code') {
      parts.push(
        <InlineCode 
          key={`${keyPrefix}-code-${i}`}
          keyPrefix={`${keyPrefix}-code-${i}`}
          code={pattern.data}
        />
      )
    } else if (pattern.type === 'link') {
      const { text, url } = pattern.data
      if (url.startsWith('payto://')) {
        parts.push(
          <PaytoLink key={`${keyPrefix}-payto-link-${i}`} paytoUri={url} className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words">
            {parseInlineMarkdown(text, `${keyPrefix}-link-${i}`, _footnotes, emojiInfos)}
          </PaytoLink>
        )
      } else {
        const linkContent = parseInlineMarkdown(text, `${keyPrefix}-link-${i}`, _footnotes, emojiInfos)
        parts.push(
          <a
            key={`${keyPrefix}-link-${i}`}
            href={url}
            className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkContent}
          </a>
        )
      }
    } else if (pattern.type === 'hashtag') {
      // Render hashtags as inline links (green to match theme)
      const tag = pattern.data
      const tagLower = tag.toLowerCase()
      parts.push(
        <a
          key={`${keyPrefix}-hashtag-${i}`}
          href={`/notes?t=${tagLower}`}
          className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
        >
          #{tag}
        </a>
      )
    } else if (pattern.type === 'relay-url') {
      // Render relay URLs as inline links (green to match theme)
      const url = pattern.data
      const relayPath = `/relays/${encodeURIComponent(url)}`
      // Note: We can't use navigateToRelay here since this is a pure function
      // The link will navigate normally, or we could make this a callback
      parts.push(
        <a
          key={`${keyPrefix}-relay-${i}`}
          href={relayPath}
          className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
        >
          {url}
        </a>
      )
    } else if (pattern.type === 'nostr') {
      // Render nostr addresses - only profile types (npub/nprofile) should be here (event types remain block-level)
      const bech32Id = pattern.data
      if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
        // Render as inline mention
        parts.push(
          <span key={`${keyPrefix}-nostr-${i}`} className="inline-block">
            <EmbeddedMention userId={bech32Id} />
          </span>
        )
      } else {
        // Fallback for unexpected types (shouldn't happen, but handle gracefully)
        parts.push(<span key={`${keyPrefix}-nostr-${i}`}>nostr:{bech32Id}</span>)
      }
    } else if (pattern.type === 'payto') {
      const payto = pattern.data as { type: string; authority: string; raw: string }
      parts.push(
        <PaytoLink
          key={`${keyPrefix}-payto-${i}`}
          paytoUri={payto.raw}
          className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
        />
      )
    } else if (pattern.type === 'emoji') {
      const shortcode = pattern.data as string
      const custom = emojiInfos.find((e) => e.shortcode === shortcode)
      if (custom) {
        parts.push(<Emoji key={`${keyPrefix}-emoji-${i}`} emoji={custom} classNames={{ img: 'size-4 inline-block' }} />)
      } else {
        const native = shortcodeToEmoji(shortcode, emojis) ?? shortcodeToEmoji(shortcode.replace(/\s+/g, '_'), emojis)
        if (native?.emoji) {
          parts.push(<Emoji key={`${keyPrefix}-emoji-${i}`} emoji={native.emoji} classNames={{ img: 'size-4' }} />)
        } else {
          parts.push(<span key={`${keyPrefix}-emoji-${i}`}>{`:${shortcode}:`}</span>)
        }
      }
    }
    
    lastIndex = pattern.end
  })
  
  // Add remaining text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex)
    // Preserve spaces - text should already be normalized (newlines converted to spaces)
    if (remaining.length > 0) {
      // If it's all whitespace, render as a space
      if (remaining.trim().length === 0) {
        parts.push(<span key={`${keyPrefix}-space-final`}>{' '}</span>)
      } else {
        parts.push(<span key={`${keyPrefix}-inline-text-final`}>{remaining}</span>)
      }
    }
  }
  
  // If no patterns found, return the text as-is (already normalized at start of function)
  if (parts.length === 0) {
    const trimmedText = text.trim()
    return trimmedText ? [<span key={`${keyPrefix}-plain`}>{trimmedText}</span>] : []
  }
  
  return parts
}

export default function MarkdownArticle({
  event,
  className,
  hideMetadata = false,
  parentImageUrl,
  fullCalendarInvite
}: {
  event: Event
  className?: string
  hideMetadata?: boolean
  parentImageUrl?: string
  /** When viewing a kind-24 invite, render full calendar card with RSVP in place of the naddr embed */
  fullCalendarInvite?: { naddr: string; event: Event }
}) {
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })
  const { navigateToHashtag } = useSmartHashtagNavigationOptional()
  const { navigateToRelay } = useSmartRelayNavigationOptional()
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const iArticleUrl = useMemo(() => getHttpUrlFromITags(event), [event])
  const iArticleCleaned = useMemo(
    () => (iArticleUrl ? cleanUrl(iArticleUrl) || iArticleUrl : ''),
    [iArticleUrl]
  )

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
  
  // Extract non-media links from tags (excluding YouTube URLs)
  const tagLinks = useMemo(() => {
    const links: string[] = []
    const seenUrls = new Set<string>()
    
    event.tags
      .filter(tag => tag[0] === 'r' && tag[1])
      .forEach(tag => {
        const url = tag[1]
        if (!url.startsWith('http://') && !url.startsWith('https://')) return
        if (isImage(url) || isMedia(url)) return
        if (isYouTubeUrl(url)) return // Exclude YouTube URLs
        
        const cleaned = cleanUrl(url)
        if (cleaned && !seenUrls.has(cleaned)) {
          links.push(cleaned)
          seenUrls.add(cleaned)
        }
      })
    
    return links
  }, [event.id, JSON.stringify(event.tags)])
  
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
  
  // Helper function to extract image filename/hash from URL for comparison
  // This helps identify the same image hosted on different domains
  const getImageIdentifier = useMemo(() => {
    return (url: string): string | null => {
      try {
        const cleaned = cleanUrl(url)
        if (!cleaned) return null
        const parsed = new URL(cleaned)
        const pathname = parsed.pathname
        // Extract the filename (last segment of the path)
        const filename = pathname.split('/').pop() || ''
        // If the filename looks like a hash (hex string), use it for comparison
        // Also use the full pathname as a fallback
        if (filename && /^[a-f0-9]{32,}\.(png|jpg|jpeg|gif|webp|svg)$/i.test(filename)) {
          return filename.toLowerCase()
        }
        // Fallback to cleaned URL for non-hash filenames
        return cleaned
      } catch {
        return cleanUrl(url) || null
      }
    }
  }, [])
  
  // Create image index map for lightbox
  // Maps image URLs (and identifiers) to their index in allImages
  const imageIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    allImages.forEach((img, index) => {
      const cleaned = cleanUrl(img.url)
      if (cleaned) {
        map.set(cleaned, index)
        // Also map by identifier for cross-domain matching
        const identifier = getImageIdentifier(cleaned)
        if (identifier && identifier !== cleaned) {
          // Only add identifier mapping if it's different from the cleaned URL
          // This helps match images across different domains
          if (!map.has(`__img_id:${identifier}`)) {
            map.set(`__img_id:${identifier}`, index)
          }
        }
      }
    })
    return map
  }, [allImages, getImageIdentifier])

  // Parse content to find media URLs that are already rendered
  // Store both cleaned URLs and image identifiers for comparison
  const mediaUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    const imageIdentifiers = new Set<string>()
    const urlRegex = /https?:\/\/[^\s<>"']+/g
    let match
    while ((match = urlRegex.exec(event.content)) !== null) {
      const url = match[0]
      const cleaned = cleanUrl(url)
      if (cleaned && (isImage(cleaned) || isVideo(cleaned) || isAudio(cleaned))) {
        urls.add(cleaned)
        // Also add image identifier for filename-based matching
        const identifier = getImageIdentifier(cleaned)
        if (identifier) {
          imageIdentifiers.add(identifier)
        }
      }
    }
    // Store identifiers in the Set as well (using a prefix to distinguish)
    imageIdentifiers.forEach(id => urls.add(`__img_id:${id}`))
    return urls
  }, [event.content, getImageIdentifier])
  
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
  
  // Extract non-media links from content (excluding YouTube URLs)
  const contentLinks = useMemo(() => {
    const links: string[] = []
    const seenUrls = new Set<string>()
    const urlRegex = /https?:\/\/[^\s<>"']+/g
    let match
    while ((match = urlRegex.exec(event.content)) !== null) {
      const url = match[0]
      if ((url.startsWith('http://') || url.startsWith('https://')) && !isImage(url) && !isMedia(url) && !isYouTubeUrl(url)) {
        const cleaned = cleanUrl(url)
        if (cleaned && !seenUrls.has(cleaned)) {
          links.push(cleaned)
          seenUrls.add(cleaned)
        }
      }
    }
    return links
  }, [event.content])
  
  // Image gallery state
  const [lightboxIndex, setLightboxIndex] = useState(-1)
  
  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index)
  }, [])
  
  // Filter tag media to only show what's not in content
  const leftoverTagMedia = useMemo(() => {
    const metadataImageUrl = metadata.image ? cleanUrl(metadata.image) : null
    const parentImageUrlCleaned = parentImageUrl ? cleanUrl(parentImageUrl) : null
    return tagMedia.filter(media => {
      const cleaned = cleanUrl(media.url)
      if (!cleaned) return false
      
      // Check if already in content by cleaned URL
      if (mediaUrlsInContent.has(cleaned)) return false
      
      // Also check by image identifier (filename/hash) for same image on different domains
      const identifier = getImageIdentifier(cleaned)
      if (identifier && mediaUrlsInContent.has(`__img_id:${identifier}`)) return false
      
      // Skip if this is the metadata image (shown separately)
      if (metadataImageUrl && cleaned === metadataImageUrl && !hideMetadata) return false
      
      // Skip if this matches the parent publication's image (to avoid duplicate cover images)
      if (parentImageUrlCleaned && cleaned === parentImageUrlCleaned) return false
      return true
    })
  }, [tagMedia, mediaUrlsInContent, metadata.image, hideMetadata, parentImageUrl])
  
  // Filter tag YouTube URLs to only show what's not in content
  const leftoverTagYouTubeUrls = useMemo(() => {
    return tagYouTubeUrls.filter(url => {
      const cleaned = cleanUrl(url)
      return cleaned && !youtubeUrlsInContent.has(cleaned)
    })
  }, [tagYouTubeUrls, youtubeUrlsInContent])
  
  // Filter tag links to only show what's not in content (to avoid duplicate WebPreview cards)
  const leftoverTagLinks = useMemo(() => {
    const contentLinksSet = new Set(contentLinks.map((link) => cleanUrl(link)).filter(Boolean))
    return tagLinks.filter((link) => {
      const cleaned = cleanUrl(link)
      if (!cleaned) return false
      if (iArticleCleaned && cleaned === iArticleCleaned) return false
      return !contentLinksSet.has(cleaned)
    })
  }, [tagLinks, contentLinks, iArticleCleaned])
  
  // Preprocess content to convert URLs to markdown syntax
  const preprocessedContent = useMemo(() => {
    // First unescape JSON-encoded escape sequences
    let processed = unescapeJsonContent(event.content)
    // Normalize excessive newlines (reduce 3+ to 2)
    processed = normalizeNewlines(processed)
    // Normalize single newlines within bold/italic spans to spaces
    processed = normalizeInlineFormattingNewlines(processed)
    // Normalize Setext-style headers (H1 with ===, H2 with ---)
    processed = normalizeSetextHeaders(processed)
    // Normalize backticks (inline code and code blocks)
    processed = normalizeBackticks(processed)
    // Replace standard :shortcode: with Unicode (custom emojis stay as shortcode for tag lookup)
    const customShortcodes = event.tags.filter((t) => t[0] === 'emoji').map((t) => t[1]).filter(Boolean)
    processed = replaceStandardEmojiShortcodesInContent(processed, customShortcodes)
    // Then preprocess media links
    return preprocessMarkdownMediaLinks(processed)
  }, [event.content, event.tags])
  
  // Create video poster map from imeta tags
  const videoPosterMap = useMemo(() => {
    const map = new Map<string, string>()
    const imetaInfos = getImetaInfosFromEvent(event)
    imetaInfos.forEach((info) => {
      if (info.image && (info.m?.startsWith('video/') || isVideo(info.url))) {
        const cleaned = cleanUrl(info.url)
        if (cleaned) {
          map.set(cleaned, info.image)
        }
      }
    })
    return map
  }, [event.id, JSON.stringify(event.tags)])
  
  // Create thumbnail map from imeta tags (for images)
  // Maps original image URL to thumbnail URL
  const imageThumbnailMap = useMemo(() => {
    const map = new Map<string, string>()
    const imetaInfos = getImetaInfosFromEvent(event)
    imetaInfos.forEach((info) => {
      if (info.thumb && (info.m?.startsWith('image/') || isImage(info.url))) {
        const cleaned = cleanUrl(info.url)
        if (cleaned && info.thumb) {
          map.set(cleaned, info.thumb)
          // Also map by identifier for cross-domain matching
          const identifier = getImageIdentifier(cleaned)
          if (identifier) {
            map.set(`__img_id:${identifier}`, info.thumb)
          }
        }
      }
    })
    return map
  }, [event.id, JSON.stringify(event.tags), getImageIdentifier])
  
  const emojiInfos = useMemo(() => getEmojiInfosFromEmojiTags(event.tags), [event.tags])

  // Parse markdown content with post-processing for nostr: links and hashtags
  const { nodes: parsedContent, hashtagsInContent } = useMemo(() => {
    const result = parseMarkdownContent(preprocessedContent, {
      eventPubkey: event.pubkey,
      imageIndexMap,
      openLightbox,
      navigateToHashtag,
      navigateToRelay,
      videoPosterMap,
      imageThumbnailMap,
      getImageIdentifier,
      emojiInfos,
      fullCalendarInvite,
      suppressStandaloneWebPreviewForCleanedUrl: iArticleCleaned || undefined
    })
    // Return nodes and hashtags (footnotes are already included in nodes)
    return { nodes: result.nodes, hashtagsInContent: result.hashtagsInContent }
  }, [
    preprocessedContent,
    event.pubkey,
    imageIndexMap,
    openLightbox,
    navigateToHashtag,
    navigateToRelay,
    videoPosterMap,
    imageThumbnailMap,
    getImageIdentifier,
    emojiInfos,
    fullCalendarInvite,
    iArticleCleaned
  ])
  
  // Filter metadata tags to only show what's not already in content
  const leftoverMetadataTags = useMemo(() => {
    return metadata.tags.filter(tag => !hashtagsInContent.has(tag.toLowerCase()))
  }, [metadata.tags, hashtagsInContent])
  
  return (
    <>
      <style>{`
        .prose ol[class*="list-decimal"] {
          list-style-type: decimal !important;
        }
        .prose ol[class*="list-decimal"] li {
          display: list-item !important;
          list-style-position: outside !important;
          line-height: 1.25 !important;
          margin-bottom: 0 !important;
        }
        .hljs {
          background: transparent !important;
          color: #1f2937 !important;
        }
        .dark .hljs {
          color: #f3f4f6 !important;
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
      `}</style>
      <div className={`prose prose-zinc max-w-none dark:prose-invert break-words overflow-wrap-anywhere ${className || ''}`}>
        {iArticleUrl && (
          <div className="not-prose mb-4 max-w-full">
            <WebPreview url={iArticleUrl} className="w-full" />
          </div>
        )}
        {/* Metadata */}
                {!hideMetadata && metadata.title && <h1 className="break-words">{metadata.title}</h1>}
                {!hideMetadata && metadata.summary && (
                  <blockquote>
                    <p className="break-words">{metadata.summary}</p>
                  </blockquote>
                )}
                {hideMetadata && metadata.title && event.kind !== ExtendedKind.DISCUSSION && (
                  <h2 className="text-2xl font-bold mb-4 leading-tight break-words">{metadata.title}</h2>
                )}
        
        {/* Metadata image */}
                {!hideMetadata && metadata.image && (() => {
        const cleanedMetadataImage = cleanUrl(metadata.image)
        const parentImageUrlCleaned = parentImageUrl ? cleanUrl(parentImageUrl) : null
          // Don't show if already in content (check by URL and by identifier)
          if (cleanedMetadataImage) {
            if (mediaUrlsInContent.has(cleanedMetadataImage)) return null
            const identifier = getImageIdentifier(cleanedMetadataImage)
            if (identifier && mediaUrlsInContent.has(`__img_id:${identifier}`)) return null
          }
          
          // Don't show if it matches the parent publication's image (to avoid duplicate cover images)
          if (parentImageUrlCleaned && cleanedMetadataImage === parentImageUrlCleaned) return null
          
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
                // Check if there's a thumbnail available for this image
                let thumbnailUrl: string | undefined
                if (imageThumbnailMap) {
                  thumbnailUrl = imageThumbnailMap.get(cleaned)
                  // Also check by identifier for cross-domain matching
                  if (!thumbnailUrl) {
                    const identifier = getImageIdentifier(cleaned)
                    if (identifier) {
                      thumbnailUrl = imageThumbnailMap.get(`__img_id:${identifier}`)
                    }
                  }
                }
        // Don't use thumbnails in notes - they're too small
        // Keep thumbnailUrl for fallback/OpenGraph data, but use original URL for display
        const displayUrl = media.url
        const hasThumbnail = false
                
                return (
                  <div key={`tag-media-${cleaned}`} className={`my-2 ${hasThumbnail ? 'max-w-[120px]' : 'max-w-[400px]'}`}>
                    <Image
                      image={{ url: displayUrl, pubkey: event.pubkey }}
                      className={`${hasThumbnail ? 'h-auto' : 'w-full'} rounded-lg cursor-zoom-in`}
                      classNames={{
                        wrapper: `rounded-lg ${hasThumbnail ? '' : 'w-full'}`,
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
      
        {/* Parsed content */}
        <div className="break-words">
          {parsedContent}
        </div>
        
        {/* Hashtags from metadata (only if not already in content) */}
        {leftoverMetadataTags.length > 0 && (
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

        {/* WebPreview cards for links from tags (only if not already in content) */}
        {/* Note: Links in content are already rendered as green hyperlinks above, so we don't show WebPreview for them */}
        {leftoverTagLinks.length > 0 && (
          <div className="space-y-3 mt-6">
            {leftoverTagLinks.map((url, index) => (
            <WebPreview key={`tag-${index}-${url}`} url={url} className="w-full" />
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
              closeOnBackdropClick: false,
              closeOnPullUp: true,
              closeOnPullDown: true
            }}
            render={{
              buttonPrev: allImages.length <= 1 ? () => null : undefined,
              buttonNext: allImages.length <= 1 ? () => null : undefined
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
