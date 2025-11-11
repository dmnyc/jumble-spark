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

    try {
      // Check if we should use proxy server to avoid CORS issues
      const proxyServer = import.meta.env.VITE_PROXY_SERVER
      const isProxyUrl = url.includes('/sites/')
      
      // If proxy is configured and URL isn't already proxied, use proxy
      let fetchUrl = url
      if (proxyServer && !isProxyUrl) {
        fetchUrl = `${proxyServer}/sites/${encodeURIComponent(url)}`
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

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
        throw new Error(`Failed to fetch feed: ${res.status} ${res.statusText}`)
      }

      const xmlText = await res.text()
      const feed = this.parseFeed(xmlText, url)
      
      // Cache the feed
      this.feedCache.set(url, { feed, timestamp: Date.now() })
      
      return feed
    } catch (error) {
      logger.error('[RssFeedService] Error fetching feed', { url, error })
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
      // For description, preserve HTML content
      const itemDescription = this.getHtmlContent(item, 'description') || ''
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
      const entryContent = this.getHtmlContent(entry, 'content') || this.getHtmlContent(entry, 'summary') || ''
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
    const child = element.querySelector(tagName)
    if (!child) return ''
    // Return innerHTML to preserve HTML formatting
    return child.innerHTML?.trim() || child.textContent?.trim() || ''
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
   */
  async fetchMultipleFeeds(feedUrls: string[]): Promise<RssFeedItem[]> {
    const results = await Promise.allSettled(
      feedUrls.map(url => this.fetchFeed(url))
    )

    const allItems: RssFeedItem[] = []

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value.items)
      } else {
        logger.warn('[RssFeedService] Failed to fetch feed', { url: feedUrls[index], error: result.reason })
      }
    })

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

