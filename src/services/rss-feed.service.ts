import { DEFAULT_RSS_FEEDS } from '@/constants'
import logger from '@/lib/logger'

export interface RssFeedItem {
  title: string
  link: string
  description: string
  pubDate: Date | null
  guid: string
  feedUrl: string
  feedTitle?: string
}

export interface RssFeed {
  title: string
  link: string
  description: string
  items: RssFeedItem[]
  feedUrl: string
}

class RssFeedService {
  static instance: RssFeedService
  private feedCache: Map<string, { feed: RssFeed; timestamp: number }> = new Map()
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

  constructor() {
    if (!RssFeedService.instance) {
      RssFeedService.instance = this
    }
    return RssFeedService.instance
  }

  /**
   * Fetch and parse an RSS/Atom feed from a URL
   */
  async fetchFeed(url: string): Promise<RssFeed> {
    // Check cache first
    const cached = this.feedCache.get(url)
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.feed
    }

    // Try multiple fetch strategies in order
    const strategies = this.getFetchStrategies(url)
    
    for (const strategy of strategies) {
      try {
        const xmlText = await this.fetchWithStrategy(url, strategy)
        if (xmlText) {
          const feed = this.parseFeed(xmlText, url)
          // Cache the feed
          this.feedCache.set(url, { feed, timestamp: Date.now() })
          return feed
        }
      } catch (error) {
        logger.warn('[RssFeedService] Strategy failed', { url, strategy: strategy.name, error })
        // Continue to next strategy
        continue
      }
    }

    // All strategies failed
    throw new Error(`Failed to fetch RSS feed from ${url} after trying all available methods`)
  }

  /**
   * Get list of fetch strategies to try in order
   */
  private getFetchStrategies(url: string): Array<{ name: string; getUrl: (url: string) => string }> {
    const strategies: Array<{ name: string; getUrl: (url: string) => string }> = []
    
    // Strategy 1: Use configured proxy server (if available)
    const proxyServer = import.meta.env.VITE_PROXY_SERVER
    if (proxyServer && !url.includes('/sites/')) {
      strategies.push({
        name: 'configured-proxy',
        getUrl: (url) => `${proxyServer}/sites/${encodeURIComponent(url)}`
      })
    }

    // Strategy 2: Use public CORS proxy (allorigins.win)
    strategies.push({
      name: 'allorigins-proxy',
      getUrl: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    })

    // Strategy 3: Alternative CORS proxy (corsproxy.io)
    strategies.push({
      name: 'corsproxy-proxy',
      getUrl: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`
    })

    // Strategy 4: Try direct fetch (may work for some feeds with CORS enabled)
    strategies.push({
      name: 'direct',
      getUrl: (url) => url
    })

    return strategies
  }

  /**
   * Fetch feed using a specific strategy
   */
  private async fetchWithStrategy(originalUrl: string, strategy: { name: string; getUrl: (url: string) => string }): Promise<string> {
    const fetchUrl = strategy.getUrl(originalUrl)
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout

    try {
      const res = await fetch(fetchUrl, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Accept': 'application/rss+xml, application/xml, application/atom+xml, text/xml, */*'
        }
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      const xmlText = await res.text()
      
      // Validate that we got XML content
      if (!xmlText || xmlText.trim().length === 0) {
        throw new Error('Empty response')
      }

      // Basic validation - check if it looks like XML
      if (!xmlText.trim().startsWith('<')) {
        throw new Error('Response does not appear to be XML')
      }

      return xmlText
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Parse RSS/Atom XML into structured data
   */
  private parseFeed(xmlText: string, feedUrl: string): RssFeed {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, 'text/xml')

    // Check for parsing errors
    const parserError = doc.querySelector('parsererror')
    if (parserError) {
      throw new Error('Failed to parse XML feed')
    }

    // Determine if it's RSS or Atom
    const isAtom = doc.documentElement.tagName === 'feed' || doc.documentElement.namespaceURI === 'http://www.w3.org/2005/Atom'
    
    if (isAtom) {
      return this.parseAtomFeed(doc, feedUrl)
    } else {
      return this.parseRssFeed(doc, feedUrl)
    }
  }

  /**
   * Parse RSS 2.0 feed
   */
  private parseRssFeed(doc: Document, feedUrl: string): RssFeed {
    const channel = doc.querySelector('channel')
    if (!channel) {
      throw new Error('Invalid RSS feed: no channel element found')
    }

    const title = this.getTextContent(channel, 'title') || 'Untitled Feed'
    const link = this.getTextContent(channel, 'link') || feedUrl
    const description = this.getTextContent(channel, 'description') || ''

    const items: RssFeedItem[] = []
    const itemElements = channel.querySelectorAll('item')

    itemElements.forEach((item) => {
      const itemTitle = this.getTextContent(item, 'title') || ''
      let itemLink = this.getTextContent(item, 'link') || ''
      // Convert relative URLs to absolute
      if (itemLink && !itemLink.startsWith('http://') && !itemLink.startsWith('https://')) {
        try {
          const baseUrl = new URL(feedUrl)
          itemLink = new URL(itemLink, baseUrl.origin).href
        } catch {
          // If URL parsing fails, keep the original link
        }
      }
      // For description, prefer content:encoded (WordPress full content) over description (truncated)
      // Check for content:encoded first, then fall back to description
      let itemDescription = ''
      
      // Try to find content:encoded element (WordPress namespace extension)
      // Iterate through all direct children to find it (most reliable method for namespaced XML)
      const children = Array.from(item.children)
      let contentEncoded: Element | null = null
      
      for (const child of children) {
        // Check if this is the content:encoded element
        // The tagName might be "content:encoded" or just "encoded" depending on parser
        const tagName = child.tagName || child.nodeName
        if (tagName && (
          tagName.toLowerCase() === 'encoded' ||
          tagName.toLowerCase() === 'content:encoded' ||
          tagName.includes('encoded') ||
          (child.localName && child.localName.toLowerCase() === 'encoded')
        )) {
          contentEncoded = child
          break
        }
      }
      
      if (contentEncoded) {
        // For CDATA sections in XML, we need to get the content carefully
        // The content:encoded element contains CDATA with HTML
        
        // Get textContent first (this properly extracts CDATA content)
        // textContent will contain the HTML as a string from CDATA sections
        const rawContent = contentEncoded.textContent?.trim() || contentEncoded.innerHTML?.trim() || ''
        
        if (rawContent) {
          // Clean up the content - remove any XML artifacts that might have leaked through
          // Remove XML closing tags that might appear at the end (like ]]>)
          itemDescription = rawContent
            .replace(/\]\]\s*>\s*$/g, '') // Remove trailing ]]> from CDATA
            .replace(/^\s*<!\[CDATA\[/g, '') // Remove leading CDATA declaration
            .trim()
          
          // If the content looks like it has HTML tags, use it as-is
          // Otherwise, it might be plain text that needs HTML entity decoding
          if (itemDescription && itemDescription.includes('<')) {
            // It's HTML - ensure it's clean
            // Remove any stray XML/namespace declarations that might appear
            itemDescription = itemDescription
              .replace(/<\?xml[^>]*\?>/gi, '') // Remove XML declarations
              .replace(/<\!DOCTYPE[^>]*>/gi, '') // Remove DOCTYPE declarations
              .trim()
          }
        }
        
        // Log for debugging
        if (itemDescription) {
          logger.debug('[RssFeedService] Found content:encoded', { 
            url: feedUrl,
            hasHtml: itemDescription.includes('<'),
            length: itemDescription.length,
            preview: itemDescription.substring(0, 100)
          })
        }
      } else {
        logger.debug('[RssFeedService] content:encoded not found, using description', { url: feedUrl })
      }
      
      // Fall back to description if content:encoded is not found or empty
      if (!itemDescription) {
        itemDescription = this.getHtmlContent(item, 'description') || ''
        // Clean description as well
        if (itemDescription) {
          itemDescription = itemDescription
            .replace(/\]\]\s*>\s*$/g, '')
            .replace(/^\s*<!\[CDATA\[/g, '')
            .trim()
        }
      }
      const itemPubDate = this.parseDate(this.getTextContent(item, 'pubDate'))
      const itemGuid = this.getTextContent(item, 'guid') || itemLink || ''

      items.push({
        title: itemTitle,
        link: itemLink,
        description: itemDescription,
        pubDate: itemPubDate,
        guid: itemGuid,
        feedUrl,
        feedTitle: title
      })
    })

    return {
      title,
      link,
      description,
      items,
      feedUrl
    }
  }

  /**
   * Parse Atom 1.0 feed
   */
  private parseAtomFeed(doc: Document, feedUrl: string): RssFeed {
    const feed = doc.documentElement

    const title = this.getTextContent(feed, 'title') || 'Untitled Feed'
    const linkElement = feed.querySelector('link[rel="alternate"], link:not([rel])')
    const link = linkElement?.getAttribute('href') || feedUrl
    const description = this.getTextContent(feed, 'subtitle') || this.getTextContent(feed, 'description') || ''

    const items: RssFeedItem[] = []
    const entryElements = feed.querySelectorAll('entry')

    entryElements.forEach((entry) => {
      const entryTitle = this.getTextContent(entry, 'title') || ''
      const entryLinkElement = entry.querySelector('link[rel="alternate"], link:not([rel])')
      let entryLink = entryLinkElement?.getAttribute('href') || ''
      // Convert relative URLs to absolute
      if (entryLink && !entryLink.startsWith('http://') && !entryLink.startsWith('https://')) {
        try {
          const baseUrl = new URL(feedUrl)
          entryLink = new URL(entryLink, baseUrl.origin).href
        } catch {
          // If URL parsing fails, keep the original link
        }
      }
      // For content/summary, preserve HTML content
      let entryContent = this.getHtmlContent(entry, 'content') || this.getHtmlContent(entry, 'summary') || ''
      // Additional cleaning for Atom feeds (getHtmlContent already does basic cleaning)
      // This ensures any remaining XML artifacts are removed
      if (entryContent) {
        entryContent = entryContent
          .replace(/\]\]\s*>\s*$/gm, '')
          .replace(/^\s*<!\[CDATA\[/gm, '')
          .trim()
      }
      const entryPublished = this.getTextContent(entry, 'published') || this.getTextContent(entry, 'updated')
      const entryPubDate = this.parseDate(entryPublished)
      const entryId = this.getTextContent(entry, 'id') || entryLink || ''

      items.push({
        title: entryTitle,
        link: entryLink,
        description: entryContent,
        pubDate: entryPubDate,
        guid: entryId,
        feedUrl,
        feedTitle: title
      })
    })

    return {
      title,
      link,
      description,
      items,
      feedUrl
    }
  }

  /**
   * Get text content from an element, handling CDATA and nested elements
   */
  private getTextContent(element: Element | null, tagName: string): string {
    if (!element) return ''
    const child = element.querySelector(tagName)
    if (!child) return ''
    // Get text content which automatically decodes HTML entities
    return child.textContent?.trim() || ''
  }

  /**
   * Get HTML content from an element (for descriptions that may contain HTML)
   */
  private getHtmlContent(element: Element | null, tagName: string): string {
    if (!element) return ''
    // Handle namespaced tags like content:encoded
    const child = element.querySelector(tagName) || 
                  element.querySelector(tagName.replace(':', '\\:')) ||
                  element.getElementsByTagName(tagName)[0]
    if (!child) return ''
    
    // Get innerHTML to preserve HTML formatting and CDATA content
    // CDATA sections are automatically included in innerHTML/textContent
    let html = child.innerHTML?.trim() || child.textContent?.trim() || ''
    
    if (!html) return ''
    
    // Decode HTML entities that might be encoded (like &#8212; for em dash)
    // Create a temporary element to decode entities
    const temp = document.createElement('div')
    temp.innerHTML = html
    html = temp.innerHTML || html
    
    // Clean up any XML artifacts that might have leaked through
    // Do this AFTER entity decoding, as entities might encode XML artifacts
    html = html
      .replace(/\]\]\s*>\s*$/gm, '') // Remove trailing ]]> from CDATA (multiline, end of string)
      .replace(/\]\]\s*>/g, '') // Remove any ]]> anywhere in the content
      .replace(/^\s*<!\[CDATA\[/gm, '') // Remove leading CDATA declaration (multiline, start of string)
      .replace(/<!\[CDATA\[/g, '') // Remove any CDATA declaration anywhere
      .replace(/<\?xml[^>]*\?>/gi, '') // Remove XML declarations
      .replace(/<\!DOCTYPE[^>]*>/gi, '') // Remove DOCTYPE declarations
      .replace(/xmlns[=:][^=]*=["'][^"']*["']/gi, '') // Remove xmlns attributes
      .trim()
    
    return html
  }

  /**
   * Parse date string into Date object
   */
  private parseDate(dateString: string | null): Date | null {
    if (!dateString) return null
    try {
      return new Date(dateString)
    } catch {
      return null
    }
  }

  /**
   * Get feed URLs to use (from event or default)
   */
  getFeedUrls(eventFeedUrls: string[] | null | undefined): string[] {
    if (eventFeedUrls && eventFeedUrls.length > 0) {
      return eventFeedUrls
    }
    return DEFAULT_RSS_FEEDS
  }

  /**
   * Fetch multiple feeds and merge items
   * This method gracefully handles failures - if some feeds fail, it returns items from successful feeds
   */
  async fetchMultipleFeeds(feedUrls: string[]): Promise<RssFeedItem[]> {
    if (feedUrls.length === 0) {
      return []
    }

    const results = await Promise.allSettled(
      feedUrls.map(url => this.fetchFeed(url))
    )

    const allItems: RssFeedItem[] = []
    let successCount = 0
    let failureCount = 0

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value.items)
        successCount++
        logger.debug('[RssFeedService] Successfully fetched feed', { url: feedUrls[index], itemCount: result.value.items.length })
      } else {
        failureCount++
        // Log warning but don't throw - we want to return partial results
        const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason)
        logger.warn('[RssFeedService] Failed to fetch feed after trying all strategies', { 
          url: feedUrls[index], 
          error: errorMessage
        })
      }
    })

    // Log summary
    if (successCount > 0) {
      logger.info('[RssFeedService] Feed fetch summary', { 
        total: feedUrls.length, 
        successful: successCount, 
        failed: failureCount,
        itemsFound: allItems.length
      })
    } else if (failureCount > 0) {
      logger.error('[RssFeedService] All feeds failed to fetch', { 
        total: feedUrls.length, 
        urls: feedUrls 
      })
    }

    // Sort by publication date (newest first)
    allItems.sort((a, b) => {
      const dateA = a.pubDate?.getTime() || 0
      const dateB = b.pubDate?.getTime() || 0
      return dateB - dateA
    })

    return allItems
  }

  /**
   * Clear cache for a specific feed or all feeds
   */
  clearCache(url?: string) {
    if (url) {
      this.feedCache.delete(url)
    } else {
      this.feedCache.clear()
    }
  }
}

const instance = new RssFeedService()
export default instance

