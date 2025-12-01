/**
 * Comprehensive content parsing service for all Nostr content fields
 * Supports AsciiDoc, Advanced Markdown, Basic Markdown, and LaTeX
 */

import { detectMarkupType, getMarkupClasses, MarkupType } from '@/lib/markup-detection'
import { Event, kinds, nip19 } from 'nostr-tools'
import { getImetaInfosFromEvent } from '@/lib/event'
import { URL_REGEX, ExtendedKind } from '@/constants'
import { TImetaInfo } from '@/types'
import logger from '@/lib/logger'

export interface ParsedContent {
  html: string
  markupType: MarkupType
  cssClasses: string
  hasMath: boolean
  media: TImetaInfo[]
  links: Array<{ url: string; text: string; isExternal: boolean }>
  hashtags: string[]
  nostrLinks: Array<{ type: 'npub' | 'nprofile' | 'nevent' | 'naddr' | 'note'; id: string; text: string }>
  highlightSources: Array<{ type: 'event' | 'addressable' | 'url'; value: string; bech32: string }>
}

export interface ParseOptions {
  eventKind?: number
  field?: 'content' | 'title' | 'summary' | 'description'
  maxWidth?: string
  enableMath?: boolean
  enableSyntaxHighlighting?: boolean
}

class ContentParserService {
  private asciidoctor: any = null
  private isAsciidoctorLoaded = false

  /**
   * Initialize AsciiDoctor (lazy loading)
   */
  private async loadAsciidoctor() {
    if (this.isAsciidoctorLoaded) return this.asciidoctor

    try {
      const Asciidoctor = await import('@asciidoctor/core')
      this.asciidoctor = Asciidoctor.default()
      this.isAsciidoctorLoaded = true
      return this.asciidoctor
    } catch (error) {
      logger.warn('Failed to load AsciiDoctor', error as Error)
      return null
    }
  }

  /**
   * Parse content with appropriate markup processor
   */
  async parseContent(
    content: string, 
    options: ParseOptions = {},
    event?: Event
  ): Promise<ParsedContent> {
    const {
      eventKind,
      enableMath = true,
      enableSyntaxHighlighting = true
    } = options

    // Detect markup type
    const markupType = detectMarkupType(content, eventKind)
    const cssClasses = getMarkupClasses(markupType)

    // Extract all content elements
            // For article-type events, don't extract media as it should be rendered inline
            const isArticleType = eventKind === kinds.LongFormArticle || 
                                 eventKind === ExtendedKind.WIKI_ARTICLE || 
                                 eventKind === ExtendedKind.PUBLICATION ||
                                 eventKind === ExtendedKind.PUBLICATION_CONTENT
            
            const media = isArticleType ? [] : this.extractAllMedia(content, event)
            const links = this.extractLinks(content)
            const hashtags = this.extractHashtags(content)
            const nostrLinks = this.extractNostrLinks(content)
            const highlightSources = event ? this.extractHighlightSources(event) : []

    // Check for LaTeX math
    const hasMath = enableMath && this.hasMathContent(content)

    // Preprocess content: Convert "Read naddr... instead." patterns to hyperlinks
    // This is a standard format for forwarding readers to referred events (e.g., in wikis)
    let preprocessedContent = content
    const redirectRegex = /Read (naddr1[a-z0-9]+) instead\./gi
    preprocessedContent = preprocessedContent.replace(redirectRegex, (_match, naddr) => {
      // Convert to AsciiDoc link format pointing to the note page
      // Use a regular HTTP link format that will be processed as a normal link
      return `Read link:/notes/${naddr}[${naddr}] instead.`
    })

    let html = ''

    try {
      // Convert everything to AsciiDoc format and process as AsciiDoc
      const asciidocContent = this.convertToAsciidoc(preprocessedContent, markupType)
      html = await this.parseAsciidoc(asciidocContent, { enableMath, enableSyntaxHighlighting })
    } catch (error) {
      logger.error('Content parsing error', { error })
      // Fallback to plain text
      html = this.parsePlainText(content)
    }

            return {
              html,
              markupType: 'asciidoc',
              cssClasses,
              hasMath,
              media,
              links,
              hashtags,
              nostrLinks,
              highlightSources
            }
  }

  /**
   * Parse AsciiDoc content
   */
  private async parseAsciidoc(content: string, options: { enableMath: boolean; enableSyntaxHighlighting: boolean }): Promise<string> {
    const asciidoctor = await this.loadAsciidoctor()
    if (!asciidoctor) {
      return this.parsePlainText(content)
    }

    // Check if content starts with level 3+ headers (=== or deeper)
    // Asciidoctor article doctype requires level 1 (=) or level 2 (==) before level 3 (===)
    // If content starts with level 3+, use book doctype which allows sections at any level
    const firstHeaderMatch = content.match(/^(={1,6})\s+/m)
    let doctype: 'article' | 'book' = 'article'
    
    if (firstHeaderMatch) {
      const firstHeaderLevel = firstHeaderMatch[1].length
      // If first header is level 3 or deeper, use book doctype
      // Book doctype allows sections at any level without requiring hierarchy
      if (firstHeaderLevel >= 3) {
        doctype = 'book'
      }
    }

    try {
      const result = asciidoctor.convert(content, {
        safe: 'safe',
        backend: 'html5',
        doctype: doctype,
        attributes: {
          'showtitle': true,
          'sectanchors': true,
          'sectlinks': true,
          'toc': 'left',
          'toclevels': 6,
          'toc-title': 'Table of Contents',
          'source-highlighter': options.enableSyntaxHighlighting ? 'highlight.js' : 'none',
          'stem': options.enableMath ? 'latexmath' : 'none',
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
          'skip-front-matter': true,
          'source-indent': 0,
          'indent': 0,
          'tabsize': 2,
          'tabwidth': 2,
          'hardbreaks': false,
          'paragraph-rewrite': 'normal',
          'sectids': true,
          'idprefix': '',
          'idseparator': '-',
          'sectidprefix': '',
          'sectidseparator': '-'
        }
      })

      const htmlString = typeof result === 'string' ? result : result.toString()
      
      // Debug: log the AsciiDoc HTML output for troubleshooting
      if (process.env.NODE_ENV === 'development') {
        logger.debug('AsciiDoc HTML output preview', { preview: htmlString.substring(0, 1000) + '...' })
      }
      
      // Process wikilinks in the HTML output
      const processedHtml = this.processWikilinksInHtml(htmlString)
      
      // Process images: add max-width styling and prepare for carousel
      const imagesProcessedHtml = this.processImagesInHtml(processedHtml)
      
      // Clean up any leftover markdown syntax and hide raw ToC text
      const cleanedHtml = this.cleanupMarkdown(imagesProcessedHtml)
      
      // Add proper CSS classes for styling
      const styledHtml = this.addStylingClasses(cleanedHtml)
      
      // Hide any raw AsciiDoc ToC text that might appear in the content
      return this.hideRawTocText(styledHtml)
    } catch (error) {
      logger.error('AsciiDoc parsing error', { error })
      return this.parsePlainText(content)
    }
  }

  /**
   * Convert content to AsciiDoc format based on markup type
   */
  private convertToAsciidoc(content: string, markupType: string): string {
    let asciidoc = ''
    
    switch (markupType) {
      case 'asciidoc':
        // For AsciiDoc content, ensure proper formatting
        // Convert escaped newlines to actual newlines
        asciidoc = content.replace(/\\n/g, '\n')
        
        // Ensure headers are on their own lines with proper spacing
        // AsciiDoc requires blank lines before headers when they follow other content
        // Fix pattern: non-empty line + newline + header without blank line between
        asciidoc = asciidoc.replace(/(\S[^\n]*)\n(={1,6}\s+[^\n]+)/g, (_match, before, header) => {
          // Add blank line before header if it follows non-empty content
          return `${before}\n\n${header}`
        })
        break

      case 'advanced-markdown':
      case 'basic-markdown':
        asciidoc = this.convertMarkdownToAsciidoc(content)
        break

      case 'plain-text':
      default:
        asciidoc = this.convertPlainTextToAsciidoc(content)
        break
    }

    // Process wikilinks for all content types
    let result = this.processWikilinks(asciidoc)
    
    // Process nostr: addresses - convert them to proper AsciiDoc format
    result = this.processNostrAddresses(result)
    
    // Process hashtags - convert them to proper AsciiDoc format
    result = this.processHashtags(result)
    
    // Debug: log the converted AsciiDoc for troubleshooting
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Converted AsciiDoc', result)
    }
    
    return result
  }

  /**
   * Convert Markdown to AsciiDoc format
   */
  private convertMarkdownToAsciidoc(content: string): string {
    // Preprocess: convert escaped newlines to actual newlines
    let asciidoc = content.replace(/\\n/g, '\n')
    
    // Preprocess: Fix the specific issue where backticks are used for inline code but not as code blocks
    // Look for patterns like `sqlite` (databased) and convert them properly
    asciidoc = asciidoc.replace(/`([^`\n]+)`\s*\(([^)]+)\)/g, '`$1` ($2)')
    
    // Fix spacing issues where text runs together
    asciidoc = asciidoc.replace(/([a-zA-Z0-9])`([^`\n]+)`([a-zA-Z0-9])/g, '$1 `$2` $3')
    asciidoc = asciidoc.replace(/([a-zA-Z0-9])`([^`\n]+)`\s*\(/g, '$1 `$2` (')
    asciidoc = asciidoc.replace(/\)`([^`\n]+)`([a-zA-Z0-9])/g, ') `$1` $2')
    
    // Fix specific pattern: text)text -> text) text
    asciidoc = asciidoc.replace(/([a-zA-Z0-9])\)([a-zA-Z0-9])/g, '$1) $2')
    
    // Fix specific pattern: text== -> text ==
    asciidoc = asciidoc.replace(/([a-zA-Z0-9])==/g, '$1 ==')
    
    // Handle nostr: addresses - preserve them as-is for now, they'll be processed later
    // This prevents them from being converted to AsciiDoc link syntax
    asciidoc = asciidoc.replace(/nostr:([a-z0-9]+)/g, 'nostr:$1')

    // Convert headers - process in order from most specific to least specific
    asciidoc = asciidoc.replace(/^#{6}\s+(.+)$/gm, '====== $1 ======')
    asciidoc = asciidoc.replace(/^#{5}\s+(.+)$/gm, '===== $1 =====')
    asciidoc = asciidoc.replace(/^#{4}\s+(.+)$/gm, '==== $1 ====')
    asciidoc = asciidoc.replace(/^#{3}\s+(.+)$/gm, '=== $1 ===')
    asciidoc = asciidoc.replace(/^#{2}\s+(.+)$/gm, '== $1 ==')
    asciidoc = asciidoc.replace(/^#{1}\s+(.+)$/gm, '= $1 =')
    
    // Convert markdown-style == headers to AsciiDoc
    asciidoc = asciidoc.replace(/^==\s+(.+?)\s+==$/gm, '== $1 ==')
    
    // Also handle inline == headers that might appear in the middle of text
    asciidoc = asciidoc.replace(/\s==\s+([^=]+?)\s+==\s/g, ' == $1 == ')

    // Convert emphasis - handle both single and double asterisks/underscores
    asciidoc = asciidoc.replace(/\*\*(.+?)\*\*/g, '*$1*') // Bold **text**
    asciidoc = asciidoc.replace(/__(.+?)__/g, '*$1*') // Bold __text__
    asciidoc = asciidoc.replace(/\*(.+?)\*/g, '_$1_') // Italic *text*
    asciidoc = asciidoc.replace(/_(.+?)_/g, '_$1_') // Italic _text_
    asciidoc = asciidoc.replace(/~~(.+?)~~/g, '[line-through]#$1#') // Strikethrough
    asciidoc = asciidoc.replace(/~(.+?)~/g, '[subscript]#$1#') // Subscript
    asciidoc = asciidoc.replace(/\^(.+?)\^/g, '[superscript]#$1#') // Superscript

    // Convert code blocks - use more precise matching to avoid capturing regular text
    asciidoc = asciidoc.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (_match, lang, code) => {
      // Ensure we don't capture too much content and it looks like actual code
      const trimmedCode = code.trim()
      if (trimmedCode.length === 0) return ''
      
      // Check if this looks like actual code (has programming syntax patterns)
      const hasCodePatterns = /[{}();=<>]|function|class|import|export|def |if |for |while |return |const |let |var |public |private |static |console\.log|var |let |const |if |for |while |return |function/.test(trimmedCode)
      
      // Additional checks for common non-code patterns
      const isLikelyText = /^[A-Za-z\s.,!?\-'"]+$/.test(trimmedCode) && trimmedCode.length > 50
      const hasTooManySpaces = (trimmedCode.match(/\s{3,}/g) || []).length > 3
      const hasMarkdownPatterns = /^#{1,6}\s|^\*\s|^\d+\.\s|^\>\s|^\|.*\|/.test(trimmedCode)
      
      // If it doesn't look like code, has too many spaces, or looks like markdown, treat as regular text
      if ((!hasCodePatterns && trimmedCode.length > 100) || isLikelyText || hasTooManySpaces || hasMarkdownPatterns) {
        return _match // Return original markdown
      }
      
      return `[source${lang ? ',' + lang : ''}]\n----\n${trimmedCode}\n----`
    })
    asciidoc = asciidoc.replace(/`([^`]+)`/g, '`$1`') // Inline code
    
    // Handle LaTeX math in inline code - preserve $...$ syntax
    asciidoc = asciidoc.replace(/`\$([^$]+)\$`/g, '`$\\$1\\$$`')

    // Convert images - use proper AsciiDoc image syntax
    asciidoc = asciidoc.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, 'image::$2[$1,width=100%]')
    
    // Also handle the specific format: image::url[alt,width=100%] that's already in the content
    // This ensures it's properly formatted for AsciiDoc
    asciidoc = asciidoc.replace(/image::([^\[]+)\[([^\]]+),width=100%\]/g, 'image::$1[$2,width=100%]')

    // Convert links
    asciidoc = asciidoc.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 'link:$2[$1]')

    // Convert horizontal rules
    asciidoc = asciidoc.replace(/^---$/gm, '\n---\n')

    // Convert unordered lists
    asciidoc = asciidoc.replace(/^(\s*)\*\s+(.+)$/gm, '$1* $2')
    asciidoc = asciidoc.replace(/^(\s*)-\s+(.+)$/gm, '$1* $2')
    asciidoc = asciidoc.replace(/^(\s*)\+\s+(.+)$/gm, '$1* $2')

    // Convert ordered lists
    asciidoc = asciidoc.replace(/^(\s*)\d+\.\s+(.+)$/gm, '$1. $2')

    // Convert blockquotes - handle multiline blockquotes properly with separate attribution
    asciidoc = asciidoc.replace(/^(>\s+.+(?:\n>\s+.+)*)/gm, (match) => {
      const lines = match.split('\n').map(line => line.replace(/^>\s*/, '')) // Remove '>' and optional space from each line
      
      let quoteBodyLines: string[] = []
      let attributionLine: string | undefined
      
      // Find the last line that looks like an attribution (starts with '—' or '--')
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim()
        if (line.startsWith('—') || line.startsWith('--')) {
          attributionLine = line
          quoteBodyLines = lines.slice(0, i) // Everything before the attribution is the quote body
          break
        }
      }
      
      const quoteContent = quoteBodyLines.filter(l => l.trim() !== '').join('\n').trim()
      
      if (attributionLine) {
        // Remove leading '—' or '--' from the attribution line
        let cleanedAttribution = attributionLine.replace(/^[—-]+/, '').trim()
        
        let author = ''
        let source = ''
        
        // Try to find a link:url[text] pattern (already converted from markdown links)
        // Example: "George Bernard Shaw, link:https://www.goodreads.com/work/quotes/376394[Man and Superman]"
        const linkMatch = cleanedAttribution.match(/^(.*?),?\s*link:([^[\\]]+)\[([^\\]]+)\]$/)
        
        if (linkMatch) {
          author = linkMatch[1].trim()
          // Use the AsciiDoc link format directly in the source attribute
          source = `link:${linkMatch[2].trim()}[${linkMatch[3].trim()}]`
        } else {
          // If no link, assume the whole thing is author or author, sourceText
          const parts = cleanedAttribution.split(',').map(p => p.trim())
          author = parts[0]
          if (parts.length > 1) {
            source = parts.slice(1).join(', ').trim()
          }
        }
        
        // AsciiDoc blockquote with attribution: [quote, author, source]
        return `[quote, ${author}, ${source}]\n____\n${quoteContent}\n____`
      } else {
        // If no attribution line is found, render as a regular AsciiDoc blockquote
        return `____\n${quoteContent}\n____`
      }
    })

    // Convert lists
    asciidoc = asciidoc.replace(/^(\s*)\*\s+(.+)$/gm, '$1* $2') // Unordered lists
    asciidoc = asciidoc.replace(/^(\s*)\d+\.\s+(.+)$/gm, '$1. $2') // Ordered lists

    // Convert links
    asciidoc = asciidoc.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 'link:$2[$1]')

    // Convert images
    asciidoc = asciidoc.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, 'image::$2[$1]')

    // Convert tables (basic support) - handle markdown tables properly
    asciidoc = asciidoc.replace(/^\|(.+)\|$/gm, (match, content) => {
      // Check if this is a table row (not just a single cell)
      const cells = content.split('|').map((cell: string) => cell.trim()).filter((cell: string) => cell)
      if (cells.length > 1) {
        return '|' + content + '|'
      }
      return match
    })
    
    // Fix table rendering by ensuring proper AsciiDoc table format
    asciidoc = asciidoc.replace(/(\|.*\|[\r\n]+\|[\s\-\|]*[\r\n]+(\|.*\|[\r\n]+)*)/g, (match) => {
      const lines = match.trim().split('\n').filter(line => line.trim())
      if (lines.length < 2) return match
      
      const headerRow = lines[0]
      const separatorRow = lines[1]
      const dataRows = lines.slice(2)
      
      // Check if it's actually a table (has separator row with dashes)
      if (!separatorRow.includes('-')) return match
      
      // Convert to proper AsciiDoc table format
      let tableAsciidoc = '[cols="1,1"]\n|===\n'
      tableAsciidoc += headerRow + '\n'
      dataRows.forEach(row => {
        tableAsciidoc += row + '\n'
      })
      tableAsciidoc += '|==='
      
      return tableAsciidoc
    })

    // Convert horizontal rules
    asciidoc = asciidoc.replace(/^---$/gm, '\'\'\'')

    // Convert footnotes - handle both references and definitions for auto-numbering
    const footnoteDefinitions: { [id: string]: string } = {}
    let tempAsciidoc = asciidoc

    // First, extract all footnote definitions and remove them from the content
    // This regex captures [^id]: text including multi-line content
    tempAsciidoc = tempAsciidoc.replace(/^\[\^([^\]]+)\]:\s*([\s\S]*?)(?=\n\[\^|\n---|\n##|\n###|\n####|\n#####|\n######|$)/gm, (_, id, text) => {
      footnoteDefinitions[id] = text.trim()
      return '' // Remove the definition line from the content
    })

    // Then, replace all footnote references [^id] with AsciiDoc's auto-numbered footnote syntax
    // using the extracted definitions.
    asciidoc = tempAsciidoc.replace(/\[\^([^\]]+)\]/g, (match, id) => {
      if (footnoteDefinitions[id]) {
        return `footnote:[${footnoteDefinitions[id]}]`
      }
      return match // If definition not found, leave as is
    })

    return asciidoc
  }

  /**
   * Process nostr: addresses in content
   */
  private processNostrAddresses(content: string): string {
    let processed = content

    // Process nostr: addresses - convert them to AsciiDoc link format
    // This regex matches nostr: followed by any valid bech32 string
    processed = processed.replace(/nostr:([a-z0-9]+[a-z0-9]{6,})/g, (_match, bech32Id) => {
      // Create AsciiDoc link with nostr: prefix
      return `link:nostr:${bech32Id}[${bech32Id}]`
    })

    return processed
  }

  /**
   * Process hashtags in content
   */
  private processHashtags(content: string): string {
    let processed = content

    // Convert hashtags to AsciiDoc link format: #hashtag -> hashtag:tag[#tag]
    // This regex matches # followed by word characters, avoiding those in URLs, code blocks, etc.
    // Using word boundary approach to avoid matching # in URLs
    processed = processed.replace(/\B#([a-zA-Z0-9_]+)/g, (_match, hashtag) => {
      // Normalize hashtag to lowercase for consistency
      const normalizedHashtag = hashtag.toLowerCase()
      return `hashtag:${normalizedHashtag}[#${hashtag}]`
    })

    return processed
  }

  /**
   * Process wikilinks in content (both standard and bookstr macro)
   */
  private processWikilinks(content: string): string {
    let processed = content

    // Process bookstr macro wikilinks: [[book::...]] where ... follows NKBIP-08 format
    // These should be converted to a special marker that will be processed in HTML
    processed = processed.replace(/\[\[book::([^\]]+)\]\]/g, (_match, bookContent) => {
      const cleanContent = bookContent.trim()
      // Use a passthrough marker that will be converted to HTML placeholder in processWikilinksInHtml
      return `BOOKSTR:${cleanContent}`
    })

    // Process standard wikilinks: [[Target Page]] or [[target page|see this]]
    processed = processed.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_match, target, displayText) => {
      const cleanTarget = target.trim()
      const cleanDisplay = displayText ? displayText.trim() : cleanTarget
      const dTag = this.normalizeDtag(cleanTarget)
      
      return `wikilink:${dTag}[${cleanDisplay}]`
    })

    return processed
  }

  /**
   * Normalize text to d-tag format (lowercase, non-letters to dashes)
   */
  private normalizeDtag(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  /**
   * Process wikilinks and nostr links in HTML output
   */
  private processWikilinksInHtml(html: string): string {
    let processed = html
    
    // Convert bookstr markers to HTML placeholders
    processed = processed.replace(/BOOKSTR:([^<>\s]+)/g, (_match, bookContent) => {
      // Escape special characters for HTML attributes
      const escaped = bookContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      return `<span data-bookstr="${escaped}" class="bookstr-placeholder"></span>`
    })
    
    // Convert hashtag links to HTML with green styling
    processed = processed.replace(/hashtag:([^[]+)\[([^\]]+)\]/g, (_match, normalizedHashtag, displayText) => {
      return `<a href="/notes?t=${normalizedHashtag}" class="hashtag-link text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline">${displayText}</a>`
    })
    
    // Convert wikilink:dtag[display] format to HTML with data attributes
    processed = processed.replace(/wikilink:([^[]+)\[([^\]]+)\]/g, (_match, dTag, displayText) => {
      return `<span class="wikilink cursor-pointer text-blue-600 hover:text-blue-800 hover:underline border-b border-dotted border-blue-300" data-dtag="${dTag}" data-display="${displayText}">${displayText}</span>`
    })
    
    // Convert nostr: links to proper embedded components
    processed = processed.replace(/link:nostr:([^[]+)\[([^\]]+)\]/g, (_match, bech32Id, displayText) => {
      const nostrType = this.getNostrType(bech32Id)
      
      if (nostrType === 'nevent' || nostrType === 'naddr' || nostrType === 'note') {
        // Render as embedded event
        return `<div data-embedded-note="${bech32Id}" class="embedded-note-container">Loading embedded event...</div>`
      } else if (nostrType === 'npub' || nostrType === 'nprofile') {
        // Render as user handle
        return `<span class="user-handle" data-pubkey="${bech32Id}">@${displayText}</span>`
      } else {
        // Fallback to regular link
        return `<a href="nostr:${bech32Id}" class="nostr-link text-blue-600 hover:text-blue-800 hover:underline" data-nostr-type="${nostrType}" data-bech32="${bech32Id}">${displayText}</a>`
      }
    })
    
    return processed
  }

  /**
   * Process images in HTML output: add max-width styling and data attributes for carousel
   */
  private processImagesInHtml(html: string): string {
    let processed = html
    
    // Extract all image URLs for carousel
    const imageUrls: string[] = []
    const imageUrlRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    let match
    while ((match = imageUrlRegex.exec(html)) !== null) {
      const url = match[1]
      if (url && !imageUrls.includes(url)) {
        imageUrls.push(url)
      }
    }
    
    // Process each img tag: add max-width styling and data attributes
    processed = processed.replace(/<img([^>]+)>/gi, (imgTag, attributes) => {
      // Extract src attribute
      const srcMatch = attributes.match(/src=["']([^"']+)["']/i)
      if (!srcMatch) return imgTag
      
      const src = srcMatch[1]
      const currentIndex = imageUrls.indexOf(src)
      
      // Add/update class for max-width
      let updatedAttributes = attributes
      
      if (updatedAttributes.match(/class=["']/i)) {
        updatedAttributes = updatedAttributes.replace(/class=["']([^"']*)["']/i, (_match: string, classes: string) => {
          // Remove existing max-w classes and add our max-w-[400px]
          const cleanedClasses = classes.replace(/max-w-\[?[^\s\]]+\]?/g, '').trim()
          const newClasses = cleanedClasses 
            ? `${cleanedClasses} max-w-[400px] object-contain cursor-zoom-in`
            : 'max-w-[400px] object-contain cursor-zoom-in'
          return `class="${newClasses}"`
        })
      } else {
        updatedAttributes += ` class="max-w-[400px] h-auto object-contain cursor-zoom-in"`
      }
      
      // Add data attributes for carousel
      updatedAttributes += ` data-asciidoc-image="true" data-image-index="${currentIndex}" data-image-src="${src.replace(/"/g, '&quot;')}"`
      
      return `<img${updatedAttributes}>`
    })
    
    return processed
  }

  /**
   * Convert plain text to AsciiDoc format
   */
  private convertPlainTextToAsciidoc(content: string): string {
    // Convert line breaks to AsciiDoc format
    return content
      .replace(/\n\n/g, '\n\n')
      .replace(/\n/g, ' +\n')
  }


  /**
   * Parse plain text content
   */
  private parsePlainText(content: string): string {
    // Convert line breaks to HTML
    return content
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>')
  }



  /**
   * Clean up leftover markdown syntax after AsciiDoc processing
   */
  private cleanupMarkdown(html: string): string {
    let cleaned = html

    // Clean up markdown image syntax: ![alt](url)
    cleaned = cleaned.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
      const altText = alt || ''
      return `<img src="${url}" alt="${altText}" class="max-w-[400px] object-contain my-0" />`
    })

    // Clean up markdown link syntax: [text](url)
    cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
      // Check if it's already an HTML link
      if (cleaned.includes(`href="${url}"`)) {
        return _match
      }
      return `<a href="${url}" target="_blank" rel="noreferrer noopener" class="break-words inline-flex items-baseline gap-1">${text} <svg class="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg></a>`
    })

    // Fix broken HTML attributes that are being rendered as text
    cleaned = cleaned.replace(/" target="_blank" rel="noreferrer noopener" class="break-words inline-flex items-baseline gap-1">([^<]+) <svg[^>]*><path[^>]*><\/path><\/svg><\/a>/g, (_match, text) => {
      return `" target="_blank" rel="noreferrer noopener" class="break-words inline-flex items-baseline gap-1">${text} <svg class="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg></a>`
    })

    // Fix broken image HTML
    cleaned = cleaned.replace(/" alt="([^"]*)" class="max-w-\[400px\] object-contain my-0" \/>/g, (_match, alt) => {
      return `" alt="${alt}" class="max-w-[400px] object-contain my-0" />`
    })

    // Clean up markdown table syntax
    cleaned = this.cleanupMarkdownTables(cleaned)

    return cleaned
  }

  /**
   * Clean up markdown tables
   */
  private cleanupMarkdownTables(html: string): string {
    const tableRegex = /(\|.*\|[\r\n]+\|[\s\-\|]*[\r\n]+(\|.*\|[\r\n]+)*)/g

    return html.replace(tableRegex, (match) => {
      const lines = match.trim().split('\n').filter(line => line.trim())
      if (lines.length < 2) return match

      const headerRow = lines[0]
      const separatorRow = lines[1]
      const dataRows = lines.slice(2)

      // Check if it's actually a table (has separator row with dashes)
      if (!separatorRow.includes('-')) return match

      const headers = headerRow.split('|').map(cell => cell.trim()).filter(cell => cell)
      const rows = dataRows.map(row => 
        row.split('|').map(cell => cell.trim()).filter(cell => cell)
      )

      let tableHtml = '<table class="min-w-full border-collapse border border-gray-300 my-4">\n'
      
      // Header
      tableHtml += '  <thead>\n    <tr>\n'
      headers.forEach(header => {
        tableHtml += `      <th class="border border-gray-300 px-4 py-2 bg-gray-50 font-semibold text-left">${header}</th>\n`
      })
      tableHtml += '    </tr>\n  </thead>\n'
      
      // Body
      tableHtml += '  <tbody>\n'
      rows.forEach(row => {
        tableHtml += '    <tr>\n'
        row.forEach((cell, index) => {
          const tag = index < headers.length ? 'td' : 'td'
          tableHtml += `      <${tag} class="border border-gray-300 px-4 py-2">${cell}</${tag}>\n`
        })
        tableHtml += '    </tr>\n'
      })
      tableHtml += '  </tbody>\n'
      tableHtml += '</table>'

      return tableHtml
    })
  }

  /**
   * Extract all media from content and event
   */
  private extractAllMedia(content: string, event?: Event): TImetaInfo[] {
    const media: TImetaInfo[] = []
    const seenUrls = new Set<string>()

    // 1. Extract from imeta tags if event is provided
    if (event) {
      const imetaMedia = getImetaInfosFromEvent(event)
      imetaMedia.forEach(item => {
        if (!seenUrls.has(item.url)) {
          media.push(item)
          seenUrls.add(item.url)
        }
      })
    }

    // 2. Extract from markdown images: ![alt](url)
    const imageMatches = content.match(/!\[[^\]]*\]\(([^)]+)\)/g) || []
    imageMatches.forEach(match => {
      const url = match.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1]
      if (url && !seenUrls.has(url)) {
        const isVideo = /\.(mp4|webm|ogg)$/i.test(url)
        media.push({ 
          url, 
          pubkey: event?.pubkey || '', 
          m: isVideo ? 'video/*' : 'image/*' 
        })
        seenUrls.add(url)
      }
    })

    // 3. Extract from asciidoc images: image::url[alt,width]
    const asciidocImageMatches = content.match(/image::([^\[]+)\[/g) || []
    asciidocImageMatches.forEach(match => {
      const url = match.match(/image::([^\[]+)\[/)?.[1]
      if (url && !seenUrls.has(url)) {
        const isVideo = /\.(mp4|webm|ogg)$/i.test(url)
        media.push({ 
          url, 
          pubkey: event?.pubkey || '', 
          m: isVideo ? 'video/*' : 'image/*' 
        })
        seenUrls.add(url)
      }
    })

    // 4. Extract raw URLs from content
    const rawUrls = content.match(URL_REGEX) || []
    rawUrls.forEach(url => {
      if (!seenUrls.has(url)) {
        const isImage = /\.(jpeg|jpg|png|gif|webp|svg)$/i.test(url)
        const isVideo = /\.(mp4|webm|ogg)$/i.test(url)
        if (isImage || isVideo) {
          media.push({ 
            url, 
            pubkey: event?.pubkey || '', 
            m: isVideo ? 'video/*' : 'image/*' 
          })
          seenUrls.add(url)
        }
      }
    })

    return media
  }

  /**
   * Extract all links from content
   */
  private extractLinks(content: string): Array<{ url: string; text: string; isExternal: boolean }> {
    const links: Array<{ url: string; text: string; isExternal: boolean }> = []
    const seenUrls = new Set<string>()

    // Extract markdown links: [text](url)
    const markdownLinks = content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []
    markdownLinks.forEach(_match => {
      const linkMatch = _match.match(/\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch) {
        const [, text, url] = linkMatch
        if (!seenUrls.has(url)) {
          links.push({
            url,
            text,
            isExternal: this.isExternalUrl(url)
          })
          seenUrls.add(url)
        }
      }
    })

    // Extract asciidoc links: link:url[text]
    const asciidocLinks = content.match(/link:([^\[]+)\[([^\]]+)\]/g) || []
    asciidocLinks.forEach(_match => {
      const linkMatch = _match.match(/link:([^\[]+)\[([^\]]+)\]/)
      if (linkMatch) {
        const [, url, text] = linkMatch
        if (!seenUrls.has(url)) {
          links.push({
            url,
            text,
            isExternal: this.isExternalUrl(url)
          })
          seenUrls.add(url)
        }
      }
    })

    // Extract raw URLs
    const rawUrls = content.match(URL_REGEX) || []
    rawUrls.forEach(url => {
      if (!seenUrls.has(url) && !this.isNostrUrl(url)) {
        links.push({
          url,
          text: url,
          isExternal: this.isExternalUrl(url)
        })
        seenUrls.add(url)
      }
    })

    return links
  }

  /**
   * Extract hashtags from content
   */
  private extractHashtags(content: string): string[] {
    const hashtags: string[] = []
    const seenTags = new Set<string>()

    // Extract hashtags: #hashtag
    const hashtagMatches = content.match(/#([a-zA-Z0-9_]+)/g) || []
    hashtagMatches.forEach(_match => {
      const tag = _match.substring(1) // Remove #
      if (!seenTags.has(tag)) {
        hashtags.push(tag)
        seenTags.add(tag)
      }
    })

    return hashtags
  }

  /**
   * Extract Nostr links from content
   */
  private extractNostrLinks(content: string): Array<{ type: 'npub' | 'nprofile' | 'nevent' | 'naddr' | 'note'; id: string; text: string }> {
    const nostrLinks: Array<{ type: 'npub' | 'nprofile' | 'nevent' | 'naddr' | 'note'; id: string; text: string }> = []

    // Extract nostr: prefixed links
    const nostrMatches = content.match(/nostr:([a-z0-9]+[a-z0-9]{6,})/g) || []
    nostrMatches.forEach(_match => {
      const id = _match.substring(6) // Remove 'nostr:'
      const type = this.getNostrType(id)
      if (type) {
        nostrLinks.push({
          type,
          id,
          text: _match
        })
      }
    })

    // Extract raw nostr identifiers
    const rawNostrMatches = content.match(/([a-z0-9]+[a-z0-9]{6,})/g) || []
    rawNostrMatches.forEach(_match => {
      const type = this.getNostrType(_match)
      if (type && !nostrLinks.some(link => link.id === _match)) {
        nostrLinks.push({
          type,
          id: _match,
          text: _match
        })
      }
    })

    return nostrLinks
  }

  /**
   * Check if URL is external
   */
  private isExternalUrl(url: string): boolean {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname !== window.location.hostname
    } catch {
      return true
    }
  }

  /**
   * Check if URL is a Nostr URL
   */
  private isNostrUrl(url: string): boolean {
    return url.startsWith('nostr:') || this.getNostrType(url) !== null
  }

  /**
   * Extract highlight sources from event tags
   */
  private extractHighlightSources(event: Event): Array<{ type: 'event' | 'addressable' | 'url'; value: string; bech32: string }> {
    const sources: Array<{ type: 'event' | 'addressable' | 'url'; value: string; bech32: string }> = []

    // Check for 'source' marker first (highest priority)
    let sourceTag: string[] | undefined
    for (const tag of event.tags) {
      if (tag[2] === 'source' || tag[3] === 'source') {
        sourceTag = tag
        break
      }
    }

    // If no 'source' marker found, process tags in priority order: e > a > r
    if (!sourceTag) {
      for (const tag of event.tags) {
        // Give 'e' tags highest priority
        if (tag[0] === 'e') {
          sourceTag = tag
          continue
        }

        // Give 'a' tags second priority (but don't override 'e' tags)
        if (tag[0] === 'a' && (!sourceTag || sourceTag[0] !== 'e')) {
          sourceTag = tag
          continue
        }

        // Give 'r' tags lowest priority
        if (tag[0] === 'r' && (!sourceTag || sourceTag[0] === 'r')) {
          sourceTag = tag
          continue
        }
      }
    }

    // Process the selected source tag
    if (sourceTag) {
      if (sourceTag[0] === 'e') {
        sources.push({
          type: 'event',
          value: sourceTag[1],
          bech32: nip19.noteEncode(sourceTag[1])
        })
      } else if (sourceTag[0] === 'a') {
        const [kind, pubkey, identifier] = sourceTag[1].split(':')
        const relay = sourceTag[2]
        sources.push({
          type: 'addressable',
          value: sourceTag[1],
          bech32: nip19.naddrEncode({
            kind: parseInt(kind),
            pubkey,
            identifier: identifier || '',
            relays: relay ? [relay] : []
          })
        })
      } else if (sourceTag[0] === 'r') {
        sources.push({
          type: 'url',
          value: sourceTag[1],
          bech32: sourceTag[1]
        })
      }
    }

    return sources
  }

  /**
   * Get Nostr identifier type
   */
  private getNostrType(id: string): 'npub' | 'nprofile' | 'nevent' | 'naddr' | 'note' | null {
    if (id.startsWith('npub')) return 'npub'
    if (id.startsWith('nprofile')) return 'nprofile'
    if (id.startsWith('nevent')) return 'nevent'
    if (id.startsWith('naddr')) return 'naddr'
    if (id.startsWith('note')) return 'note'
    return null
  }

  /**
   * Check if content has LaTeX math
   */
  private hasMathContent(content: string): boolean {
    // Check for inline math: $...$ or \(...\)
    const inlineMath = /\$[^$]+\$|\\\([^)]+\\\)/.test(content)
    
    // Check for block math: $$...$$ or \[...\]
    const blockMath = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/.test(content)
    
    return inlineMath || blockMath
  }

  /**
   * Parse content for a specific Nostr event field
   */
  async parseEventField(
    event: Event, 
    field: 'content' | 'title' | 'summary' | 'description',
    options: Omit<ParseOptions, 'eventKind' | 'field'> = {}
  ): Promise<ParsedContent> {
    const content = this.getFieldContent(event, field)
    if (!content) {
      return {
        html: '',
        markupType: 'plain-text',
        cssClasses: getMarkupClasses('plain-text'),
        hasMath: false,
        media: [],
        links: [],
        hashtags: [],
        nostrLinks: [],
        highlightSources: []
      }
    }

    return this.parseContent(content, {
      ...options,
      eventKind: event.kind,
      field
    }, event)
  }

  /**
   * Get content from specific event field
   */
  private getFieldContent(event: Event, field: 'content' | 'title' | 'summary' | 'description'): string {
    switch (field) {
      case 'content':
        return event.content
      case 'title':
        return event.tags.find(tag => tag[0] === 'title')?.[1] || ''
      case 'summary':
        return event.tags.find(tag => tag[0] === 'summary')?.[1] || ''
      case 'description':
        return event.tags.find(tag => tag[0] === 'd')?.[1] || ''
      default:
        return ''
    }
  }

  /**
   * Add proper CSS classes for styling
   */
  private addStylingClasses(html: string): string {
    let styled = html
    
    // Add strikethrough styling
    styled = styled.replace(/<span class="line-through">([^<]+)<\/span>/g, '<span class="line-through line-through-2">$1</span>')
    
    // Add subscript styling
    styled = styled.replace(/<span class="subscript">([^<]+)<\/span>/g, '<span class="subscript text-xs align-sub">$1</span>')
    
    // Add superscript styling
    styled = styled.replace(/<span class="superscript">([^<]+)<\/span>/g, '<span class="superscript text-xs align-super">$1</span>')
    
    // Add code highlighting classes
    styled = styled.replace(/<pre class="highlightjs[^"]*">/g, '<pre class="highlightjs hljs">')
    styled = styled.replace(/<code class="highlightjs[^"]*">/g, '<code class="highlightjs hljs">')
    
    return styled
  }

  /**
   * Hide raw AsciiDoc ToC text that might appear in the content
   */
  private hideRawTocText(html: string): string {
    // Hide any raw ToC text that might be generated by AsciiDoc
    // This includes patterns like "# Table of Contents (5)" and plain text lists
    let cleaned = html

    // Hide raw ToC headings and content
    cleaned = cleaned.replace(
      /<h[1-6][^>]*>.*?Table of Contents.*?\(\d+\).*?<\/h[1-6]>/gi,
      ''
    )

    // Hide raw ToC lists that might appear as plain text
    cleaned = cleaned.replace(
      /<p[^>]*>.*?Table of Contents.*?\(\d+\).*?<\/p>/gi,
      ''
    )

    // Hide any remaining raw ToC text patterns
    cleaned = cleaned.replace(
      /<p[^>]*>.*?Assumptions.*?\[n=0\].*?<\/p>/gi,
      ''
    )

    return cleaned
  }
}

// Export singleton instance
export const contentParserService = new ContentParserService()
export default contentParserService
