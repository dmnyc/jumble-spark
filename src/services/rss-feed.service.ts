import { DEFAULT_RSS_FEEDS } from '@/constants'
import logger from '@/lib/logger'

export interface RssFeedItemMedia {
  url: string
  type?: string
  credit?: string
  thumbnail?: string
  width?: string
  height?: string
}

export interface RssFeedItemEnclosure {
  url: string
  type: string
  length?: string
  duration?: string
}

export interface RssFeedItem {
  title: string
  link: string
  description: string
  pubDate: Date | null
  guid: string
  feedUrl: string
  feedTitle?: string
  feedImage?: string
  feedDescription?: string
  media?: RssFeedItemMedia[]
  enclosure?: RssFeedItemEnclosure
}

export interface RssFeed {
  title: string
  link: string
  description: string
  items: RssFeedItem[]
  feedUrl: string
  image?: {
    url?: string
    title?: string
    link?: string
    width?: string
    height?: string
    description?: string
  }
  language?: string
  copyright?: string
  generator?: string
  lastBuildDate?: Date
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
    
    // Extract feed metadata
    const language = this.getTextContent(channel, 'language') || undefined
    const copyright = this.getTextContent(channel, 'copyright') || undefined
    const generator = this.getTextContent(channel, 'generator') || undefined
    const lastBuildDateStr = this.getTextContent(channel, 'lastBuildDate')
    const lastBuildDate = lastBuildDateStr ? (this.parseDate(lastBuildDateStr) || undefined) : undefined
    
    // Extract feed image
    // Check all channel children for image elements (both standard RSS and namespaced)
    let feedImage: RssFeed['image'] | undefined
    const allChannelChildren = Array.from(channel.children)
    
    // First, try to find standard RSS 2.0 <image> element
    const standardImageElements = allChannelChildren.filter(child => {
      const nodeName = child.nodeName.toLowerCase()
      const localName = child.localName || nodeName
      const namespaceURI = child.namespaceURI
      // Standard RSS image element has nodeName "image" with no namespace prefix
      return localName === 'image' && 
             !nodeName.includes(':') && 
             (!namespaceURI || (!namespaceURI.includes('itunes') && !namespaceURI.includes('media')))
    })
    
    if (standardImageElements.length > 0) {
      const imageElement = standardImageElements[0]
      logger.debug('[RssFeedService] Processing standard image element', {
        url: feedUrl,
        nodeName: imageElement.nodeName,
        localName: imageElement.localName,
        childrenCount: imageElement.children.length,
        innerHTML: imageElement.innerHTML?.substring(0, 200)
      })
      
      const imageUrl = this.getTextContent(imageElement, 'url')
      logger.debug('[RssFeedService] Extracted image URL', { url: feedUrl, imageUrl })
      
      if (imageUrl) {
        const imageTitle = this.getTextContent(imageElement, 'title')
        const imageLink = this.getTextContent(imageElement, 'link')
        const imageWidth = this.getTextContent(imageElement, 'width')
        const imageHeight = this.getTextContent(imageElement, 'height')
        const imageDescription = this.getTextContent(imageElement, 'description')
        
        feedImage = {
          url: imageUrl,
          title: imageTitle || undefined,
          link: imageLink || undefined,
          width: imageWidth || undefined,
          height: imageHeight || undefined,
          description: imageDescription || undefined
        }
        logger.debug('[RssFeedService] Found standard RSS feed image element', { url: feedUrl, imageUrl, feedImage })
      } else {
        logger.warn('[RssFeedService] Standard image element found but no URL extracted', {
          url: feedUrl,
          imageElementHTML: imageElement.outerHTML?.substring(0, 300)
        })
      }
    }
    
    // If no standard image found, check for itunes:image (common in podcast feeds)
    if (!feedImage) {
      const itunesImageElements = allChannelChildren.filter(child => {
        const localName = child.localName || child.nodeName.toLowerCase()
        const nodeName = child.nodeName.toLowerCase()
        const namespaceURI = child.namespaceURI
        // Check if it's itunes:image by namespace or nodeName
        return (localName === 'image' && namespaceURI && namespaceURI.includes('itunes')) ||
               nodeName === 'itunes:image' ||
               (nodeName.includes('itunes') && nodeName.includes('image'))
      })
      
      if (itunesImageElements.length > 0) {
        const itunesImage = itunesImageElements[0]
        // itunes:image uses href attribute, not nested url element
        const href = itunesImage.getAttribute('href')
        if (href) {
          feedImage = { url: href }
          logger.debug('[RssFeedService] Found itunes:image', { url: feedUrl, imageUrl: href })
        }
      }
    }
    
    logger.debug('[RssFeedService] Feed image extraction result', {
      url: feedUrl,
      hasImage: !!feedImage,
      imageUrl: feedImage?.url,
      channelChildrenCount: allChannelChildren.length,
      standardImageCount: standardImageElements.length
    })

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
        // Try getting HTML content from description tag
        itemDescription = this.getHtmlContent(item, 'description') || ''
        
        // If that doesn't work, try getting text content and decode HTML entities
        // This handles cases where HTML entities are in the text content
        if (!itemDescription) {
          const descElement = item.querySelector('description')
          if (descElement) {
            // Get raw text content (which may contain HTML entities)
            const rawText = descElement.textContent?.trim() || descElement.innerHTML?.trim() || ''
            if (rawText) {
              // Decode HTML entities using a temporary element
              // The browser will automatically decode entities when setting innerHTML
              const temp = document.createElement('textarea')
              temp.innerHTML = rawText
              itemDescription = temp.value
            }
          }
        }
        
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
      
      // Extract enclosure element (for audio/video files)
      let enclosure: RssFeedItemEnclosure | undefined
      const enclosureElement = item.querySelector('enclosure')
      if (enclosureElement) {
        const enclosureUrl = enclosureElement.getAttribute('url') || ''
        const enclosureType = enclosureElement.getAttribute('type') || ''
        const enclosureLength = enclosureElement.getAttribute('length') || undefined
        
        if (enclosureUrl && enclosureType) {
          // Try to get duration from itunes:duration
          let duration: string | undefined
          const allItemChildren = Array.from(item.children)
          const durationElements = allItemChildren.filter(child => {
            const localName = child.localName || child.nodeName.toLowerCase()
            const nodeName = child.nodeName.toLowerCase()
            const namespaceURI = child.namespaceURI
            return (localName === 'duration' && (nodeName.includes('itunes:duration') || namespaceURI?.includes('itunes'))) ||
                   nodeName === 'itunes:duration'
          })
          
          if (durationElements.length > 0) {
            duration = durationElements[0].textContent?.trim() || undefined
          }
          
          enclosure = {
            url: enclosureUrl,
            type: enclosureType,
            length: enclosureLength,
            duration: duration
          }
          
          logger.debug('[RssFeedService] Found enclosure', {
            url: feedUrl,
            itemTitle: itemTitle.substring(0, 50),
            enclosureType: enclosureType,
            enclosureUrl: enclosureUrl,
            duration: duration
          })
        }
      }
      
      // Extract media:content elements (Media RSS)
      // Handle namespaced elements by checking all elements and filtering by localName and namespace
      const media: RssFeedItemMedia[] = []
      
      // Get all child elements and filter for media:content
      // media:content has localName "content" but is in the media namespace
      // Regular RSS content:encoded has localName "encoded" and is in the content namespace (different!)
      const allChildren = Array.from(item.children)
      const mediaContentElements = allChildren.filter(child => {
        const localName = child.localName || child.nodeName.toLowerCase()
        const nodeName = child.nodeName.toLowerCase()
        const namespaceURI = child.namespaceURI
        
        // media:content elements have:
        // 1. localName "content" AND a "url" attribute (media:content has url attribute)
        // 2. nodeName includes "media:content" 
        // 3. namespaceURI includes "media"
        // We exclude content:encoded which has localName "encoded" (not "content")
        if (localName === 'content') {
          // If it has a url attribute, it's likely media:content (content:encoded doesn't have url)
          if (child.getAttribute('url')) {
            return true
          }
          // Check namespace - media:content is in media namespace
          if (namespaceURI && namespaceURI.includes('media')) {
            return true
          }
          // Check nodeName for media: prefix
          if (nodeName.includes('media:content') || nodeName.startsWith('media:')) {
            return true
          }
        }
        return false
      })
      
      logger.debug('[RssFeedService] Found media:content elements', {
        url: feedUrl,
        itemTitle: itemTitle.substring(0, 50),
        mediaCount: mediaContentElements.length,
        allChildrenCount: allChildren.length
      })
      
      mediaContentElements.forEach((mediaEl) => {
        const url = mediaEl.getAttribute('url') || ''
        const type = mediaEl.getAttribute('type') || undefined
        const width = mediaEl.getAttribute('width') || undefined
        const height = mediaEl.getAttribute('height') || undefined
        
        if (url) {
          // Get media:credit (attribution) - check children for credit element
          let credit: string | undefined
          const creditElements = Array.from(mediaEl.children).filter(child => {
            const localName = child.localName || child.nodeName
            return localName === 'credit' || child.nodeName === 'media:credit'
          })
          if (creditElements.length > 0) {
            credit = creditElements[0].textContent?.trim() || creditElements[0].getAttribute('scheme') || undefined
          }
          
          // Get media:thumbnail - check children for thumbnail element
          let thumbnail: string | undefined
          const thumbnailElements = Array.from(mediaEl.children).filter(child => {
            const localName = child.localName || child.nodeName
            return localName === 'thumbnail' || child.nodeName === 'media:thumbnail'
          })
          if (thumbnailElements.length > 0) {
            thumbnail = thumbnailElements[0].getAttribute('url') || undefined
          }
          
          media.push({
            url,
            type,
            credit,
            thumbnail,
            width,
            height
          })
        }
      })
      
      // Also check for media:thumbnail at item level (if no media:content found)
      if (media.length === 0) {
        const thumbnailElementsAtItemLevel = Array.from(item.children).filter(child => {
          const localName = child.localName || child.nodeName.toLowerCase()
          const nodeName = child.nodeName.toLowerCase()
          return (localName === 'thumbnail' && (nodeName.includes('media:thumbnail') || child.namespaceURI?.includes('media'))) ||
                 nodeName === 'media:thumbnail'
        })
        
        thumbnailElementsAtItemLevel.forEach((thumbEl) => {
          const url = thumbEl.getAttribute('url') || ''
          if (url) {
            media.push({
              url,
              type: 'image',
              thumbnail: url
            })
          }
        })
      }

      items.push({
        title: itemTitle,
        link: itemLink,
        description: itemDescription,
        pubDate: itemPubDate,
        guid: itemGuid,
        feedUrl,
        feedTitle: title,
        feedImage: feedImage?.url,
        feedDescription: description,
        media: media.length > 0 ? media : undefined,
        enclosure: enclosure || undefined
      })
    })

    return {
      title,
      link,
      description,
      items,
      feedUrl,
      image: feedImage,
      language,
      copyright,
      generator,
      lastBuildDate
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
    
    // Extract feed metadata for Atom feeds
    const language = feed.getAttribute('xml:lang') || undefined
    const rights = this.getTextContent(feed, 'rights') || undefined
    const generator = this.getTextContent(feed, 'generator') || undefined
    const updatedStr = this.getTextContent(feed, 'updated')
    const lastBuildDate = updatedStr ? (this.parseDate(updatedStr) || undefined) : undefined
    
    // Extract feed image/logo for Atom feeds
    let feedImage: RssFeed['image'] | undefined
    const logoElement = feed.querySelector('logo')
    const iconElement = feed.querySelector('icon')
    if (logoElement) {
      const logoUrl = this.getTextContent(feed, 'logo')
      if (logoUrl) {
        feedImage = { url: logoUrl }
      }
    } else if (iconElement) {
      const iconUrl = this.getTextContent(feed, 'icon')
      if (iconUrl) {
        feedImage = { url: iconUrl }
      }
    }

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
      
      // Extract enclosure/link elements for Atom feeds (Atom uses <link rel="enclosure">)
      let enclosure: RssFeedItemEnclosure | undefined
      const enclosureLinkElements = entry.querySelectorAll('link[rel="enclosure"]')
      if (enclosureLinkElements.length > 0) {
        const enclosureLink = enclosureLinkElements[0]
        const enclosureUrl = enclosureLink.getAttribute('href') || ''
        const enclosureType = enclosureLink.getAttribute('type') || ''
        const enclosureLength = enclosureLink.getAttribute('length') || undefined
        
        if (enclosureUrl && enclosureType) {
          // Try to get duration from itunes:duration
          let duration: string | undefined
          const allEntryChildren = Array.from(entry.children)
          const durationElements = allEntryChildren.filter(child => {
            const localName = child.localName || child.nodeName.toLowerCase()
            const nodeName = child.nodeName.toLowerCase()
            const namespaceURI = child.namespaceURI
            return (localName === 'duration' && (nodeName.includes('itunes:duration') || namespaceURI?.includes('itunes'))) ||
                   nodeName === 'itunes:duration'
          })
          
          if (durationElements.length > 0) {
            duration = durationElements[0].textContent?.trim() || undefined
          }
          
          enclosure = {
            url: enclosureUrl,
            type: enclosureType,
            length: enclosureLength,
            duration: duration
          }
        }
      }
      
      // Extract media:content elements (Media RSS) for Atom feeds
      // In Atom feeds, we need to distinguish between media:content (media) and content (entry content)
      // Handle namespaced elements by checking all elements and filtering by namespace
      const media: RssFeedItemMedia[] = []
      
      // Get all child elements and filter for media:content
      // media:content has localName "content" but is in the media namespace (not Atom namespace)
      const allChildren = Array.from(entry.children)
      const mediaContentElements = allChildren.filter(child => {
        const localName = child.localName || child.nodeName.toLowerCase()
        const nodeName = child.nodeName.toLowerCase()
        const namespaceURI = child.namespaceURI
        // Check if it's media:content - must have localName "content" but NOT be in Atom namespace
        // Atom content element is in Atom namespace, media:content is in media namespace
        if (localName === 'content') {
          // If it has a url attribute, it's likely media:content (Atom content uses src or type="xhtml")
          if (child.getAttribute('url')) {
            return true
          }
          // Check namespace - media:content is in media namespace, not Atom namespace
          if (namespaceURI && namespaceURI.includes('media') && !namespaceURI.includes('atom')) {
            return true
          }
          // Check nodeName for media: prefix
          if (nodeName.includes('media:content')) {
            return true
          }
        }
        return false
      })
      
      mediaContentElements.forEach((mediaEl) => {
        const url = mediaEl.getAttribute('url') || ''
        const type = mediaEl.getAttribute('type') || undefined
        const width = mediaEl.getAttribute('width') || undefined
        const height = mediaEl.getAttribute('height') || undefined
        
        if (url) {
          // Get media:credit (attribution) - check children for credit element
          let credit: string | undefined
          const creditElements = Array.from(mediaEl.children).filter(child => {
            const localName = child.localName || child.nodeName.toLowerCase()
            const nodeName = child.nodeName.toLowerCase()
            return (localName === 'credit' && (nodeName.includes('media:credit') || child.namespaceURI?.includes('media'))) ||
                   nodeName === 'media:credit'
          })
          if (creditElements.length > 0) {
            credit = creditElements[0].textContent?.trim() || creditElements[0].getAttribute('scheme') || undefined
          }
          
          // Get media:thumbnail - check children for thumbnail element
          let thumbnail: string | undefined
          const thumbnailElements = Array.from(mediaEl.children).filter(child => {
            const localName = child.localName || child.nodeName.toLowerCase()
            const nodeName = child.nodeName.toLowerCase()
            return (localName === 'thumbnail' && (nodeName.includes('media:thumbnail') || child.namespaceURI?.includes('media'))) ||
                   nodeName === 'media:thumbnail'
          })
          if (thumbnailElements.length > 0) {
            thumbnail = thumbnailElements[0].getAttribute('url') || undefined
          }
          
          media.push({
            url,
            type,
            credit,
            thumbnail,
            width,
            height
          })
        }
      })
      
      // Also check for media:thumbnail at entry level (if no media:content found)
      if (media.length === 0) {
        const thumbnailElementsAtEntryLevel = Array.from(entry.children).filter(child => {
          const localName = child.localName || child.nodeName.toLowerCase()
          const nodeName = child.nodeName.toLowerCase()
          return (localName === 'thumbnail' && (nodeName.includes('media:thumbnail') || child.namespaceURI?.includes('media'))) ||
                 nodeName === 'media:thumbnail'
        })
        
        thumbnailElementsAtEntryLevel.forEach((thumbEl) => {
          const url = thumbEl.getAttribute('url') || ''
          if (url) {
            media.push({
              url,
              type: 'image',
              thumbnail: url
            })
          }
        })
      }

      items.push({
        title: entryTitle,
        link: entryLink,
        description: entryContent,
        pubDate: entryPubDate,
        guid: entryId,
        feedUrl,
        feedTitle: title,
        feedImage: feedImage?.url,
        feedDescription: description,
        media: media.length > 0 ? media : undefined,
        enclosure: enclosure
      })
    })

    return {
      title,
      link,
      description,
      items,
      feedUrl,
      image: feedImage,
      language,
      copyright: rights,
      generator,
      lastBuildDate
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
    
    // Decode HTML entities that might be encoded (like &lt; &gt; &amp; etc.)
    // The browser's XML parser should decode entities automatically when accessing textContent/innerHTML
    // However, if entities are still present, decode them using textarea trick
    // This handles cases where entities are double-encoded or in raw XML text
    if (html.includes('&lt;') || html.includes('&gt;') || html.includes('&amp;')) {
      // HTML entities are present, decode them
      const decoder = document.createElement('textarea')
      decoder.innerHTML = html
      html = decoder.value
    }
    
    // Also decode numeric entities (like &#8212;) using the same method
    // The textarea approach handles both named and numeric entities
    const temp = document.createElement('textarea')
    temp.innerHTML = html
    html = temp.value || html
    
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

