import { TWebMetadata } from '@/types'
import DataLoader from 'dataloader'
import logger from '@/lib/logger'

class WebService {
  static instance: WebService

  private webMetadataDataLoader = new DataLoader<string, TWebMetadata>(
    async (urls) => {
      return await Promise.all(
        urls.map(async (url) => {
          // Check if we should use proxy server to avoid CORS issues
          // Uses the same proxy as wikistr (configured via VITE_PROXY_SERVER build arg)
          // Since jumble and wikistr run on the same server, they share the same proxy endpoint
          // Default to relative path /sites/ if VITE_PROXY_SERVER is not set (like wikistr does)
          const proxyServer = import.meta.env.VITE_PROXY_SERVER
          const proxyBase = proxyServer?.trim() || '/sites/'
          const isProxyUrl = url.includes('/sites/') || url.includes('/sites/?url=')
          
          // Build proxy URL - handle both full URLs and relative paths
          let fetchUrl = url
          if (!isProxyUrl) {
            if (proxyBase.startsWith('http://') || proxyBase.startsWith('https://')) {
              // Full URL - ensure it ends with / for query param usage
              const proxyUrl = proxyBase.endsWith('/') ? proxyBase : `${proxyBase}/`
              fetchUrl = `${proxyUrl}sites/?url=${encodeURIComponent(url)}`
            } else {
              // Relative path - ensure it ends with / for query param usage
              const basePath = proxyBase.endsWith('/') ? proxyBase : (proxyBase || '/sites/')
              fetchUrl = `${basePath}?url=${encodeURIComponent(url)}`
            }
            logger.info('[WebService] Using proxy for OG fetch', { originalUrl: url, proxyUrl: fetchUrl, proxyBase })
          } else {
            logger.info('[WebService] URL already proxied, using as-is', { url, fetchUrl })
          }
          
          try {
            
            // Add timeout and better error handling
            // Use 35 second timeout (proxy has 30s, add buffer for network latency)
            // This matches wikistr's timeout and allows Puppeteer to execute JavaScript
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 35000) // 35 second timeout for proxy
            
            // Fetch with appropriate headers
            // Note: credentials: 'omit' prevents sending cookies, which avoids SameSite warnings
            const res = await fetch(fetchUrl, {
              signal: controller.signal,
              mode: 'cors',
              credentials: 'omit',
              headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (compatible; Jumble/1.0; +https://jumble.imwald.eu)'
              }
            })
            
            clearTimeout(timeoutId)
            
            if (!res.ok) {
              logger.warn('[WebService] Fetch failed with non-OK status', { url, fetchUrl, status: res.status, statusText: res.statusText })
              return {}
            }
            
            const html = await res.text()
            
            // Check if we got a valid HTML response (not an error page or redirect)
            if (html.length < 100) {
              logger.warn('[WebService] Received suspiciously short HTML response', { url, fetchUrl, htmlLength: html.length })
            }
            
            // Log a snippet of the HTML to debug (first 500 chars)
            logger.info('[WebService] Received HTML response', { 
              url, 
              fetchUrl, 
              htmlLength: html.length,
              htmlSnippet: html.substring(0, 200)
            })
            
            const parser = new DOMParser()
            const doc = parser.parseFromString(html, 'text/html')

            // Check for OG tags
            const ogTitleMeta = doc.querySelector('meta[property="og:title"]')
            const ogDescMeta = doc.querySelector('meta[property="og:description"]')
            const ogImageMeta = doc.querySelector('meta[property="og:image"]')
            const titleTag = doc.querySelector('title')
            
            logger.info('[WebService] Found meta tags', {
              url,
              hasOgTitle: !!ogTitleMeta,
              hasOgDesc: !!ogDescMeta,
              hasOgImage: !!ogImageMeta,
              hasTitleTag: !!titleTag,
              ogTitleContent: ogTitleMeta?.getAttribute('content')?.substring(0, 100),
              titleTagContent: titleTag?.textContent?.substring(0, 100)
            })

            let title =
              ogTitleMeta?.getAttribute('content') ||
              titleTag?.textContent
            
            // Filter out common redirect/loading titles (including variations with ellipsis)
            if (title) {
              const trimmedTitle = title.trim()
              if (/^(Redirecting|Loading|Please wait|Redirect)(\.\.\.|…)?$/i.test(trimmedTitle) || 
                  trimmedTitle === '...' || 
                  trimmedTitle === '…') {
                title = undefined
              }
            }
            
            const description =
              doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
              (doc.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content
            let image = (doc.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)
              ?.content

            // Convert relative image URLs to absolute URLs by prepending the domain
            if (image) {
              try {
                const urlObj = new URL(url)
                // Check if image is a relative URL (starts with / or doesn't have a protocol)
                if (image.startsWith('/')) {
                  // Absolute path on same domain
                  image = `${urlObj.protocol}//${urlObj.host}${image}`
                } else if (!image.match(/^https?:\/\//)) {
                  // Relative path (e.g., "images/og.jpg")
                  // Resolve relative to the URL's path
                  const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)
                  image = `${urlObj.protocol}//${urlObj.host}${basePath}${image}`
                }
                logger.info('[WebService] Converted relative image URL to absolute', { originalImage: (doc.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)?.content, absoluteImage: image })
              } catch (error) {
                logger.warn('[WebService] Failed to convert relative image URL', { image, url, error })
                // Keep original image URL if conversion fails
              }
            }

            logger.info('[WebService] Extracted OG metadata', { url, title: title?.substring(0, 100), description: description?.substring(0, 100), hasImage: !!image })

            // Filter out Jumble's default OG tags if we're fetching a different domain
            // This prevents showing Jumble branding for other sites
            try {
              const urlObj = new URL(url)
              const isJumbleDomain = urlObj.hostname === 'jumble.imwald.eu' || urlObj.hostname.includes('jumble')
              const isJumbleDefaultTitle = title?.includes('Jumble - Imwald Edition') || title?.includes('Jumble Imwald Edition')
              const isJumbleDefaultDesc = description?.includes('A user-friendly Nostr client focused on relay feed browsing')
              
              // If we're fetching a non-jumble domain but got jumble's default OG tags, treat as no OG data
              if (!isJumbleDomain && (isJumbleDefaultTitle || isJumbleDefaultDesc)) {
                logger.warn('[WebService] Filtered out Jumble default OG tags for external domain - proxy may be returning wrong page', { url, hostname: urlObj.hostname, title, description: description?.substring(0, 100) })
                return {}
              }
            } catch {
              // If URL parsing fails, continue with what we have
            }

            return { title, description, image }
          } catch (error) {
            // Log errors for debugging
            if (error instanceof DOMException && error.name === 'AbortError') {
              logger.warn('[WebService] Fetch aborted (timeout)', { url, fetchUrl })
            } else {
              logger.error('[WebService] Failed to fetch OG metadata', { url, fetchUrl, error })
            }
            return {}
          }
        })
      )
    },
    { maxBatchSize: 1, batchScheduleFn: (callback) => setTimeout(callback, 100) }
  )

  constructor() {
    if (!WebService.instance) {
      WebService.instance = this
    }
    return WebService.instance
  }

  async fetchWebMetadata(url: string) {
    return await this.webMetadataDataLoader.load(url)
  }
}

const instance = new WebService()

export default instance
