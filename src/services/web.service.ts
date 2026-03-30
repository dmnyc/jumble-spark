import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { buildViteProxySitesFetchUrl, urlLooksLikeViteProxyRequest } from '@/lib/vite-proxy-url'
import { TWebMetadata } from '@/types'
import DataLoader from 'dataloader'
import logger from '@/lib/logger'

/** True when HTML is the Vite/React dev shell or another SPA stub, not the target page. */
function htmlLooksLikeLocalDevAppShell(html: string): boolean {
  const head = html.slice(0, 8000)
  return (
    head.includes('injectIntoGlobalHook') ||
    head.includes('/@vite/') ||
    head.includes('@vite/client') ||
    head.includes('@react-refresh')
  )
}

const HTML_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (compatible; Jumble/1.0; +https://jumble.imwald.eu)'
}

async function tryFetchHtml(fetchUrl: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(fetchUrl, {
      timeoutMs,
      mode: 'cors',
      credentials: 'omit',
      headers: HTML_FETCH_HEADERS
    })
    if (!res.ok) return null
    const html = await res.text()
    if (html.length < 50) return null
    if (htmlLooksLikeLocalDevAppShell(html)) return null
    return html
  } catch {
    return null
  }
}

/**
 * OG HTML: always use `VITE_PROXY_SERVER` first when set; if that fails or is unset, fetch the page directly.
 */
async function fetchHtmlForOpenGraph(originalUrl: string): Promise<{ html: string; via: string } | null> {
  const isAlreadyProxyRequest = urlLooksLikeViteProxyRequest(originalUrl)

  if (isAlreadyProxyRequest) {
    const html = await tryFetchHtml(originalUrl, 35_000)
    return html ? { html, via: originalUrl } : null
  }

  const proxyServer = import.meta.env.VITE_PROXY_SERVER?.trim()

  if (proxyServer) {
    const proxyFetchUrl = buildViteProxySitesFetchUrl(originalUrl, proxyServer)
    logger.debug('[WebService] OG fetch via VITE_PROXY_SERVER', { originalUrl, proxyFetchUrl })
    let html = await tryFetchHtml(proxyFetchUrl, 35_000)
    if (html) {
      return { html, via: proxyFetchUrl }
    }
    logger.debug('[WebService] OG proxy unavailable or bad response', { originalUrl })
    // In production with a configured proxy, skip direct fetch: random sites rarely allow browser CORS,
    // and the attempt spams DevTools with cross-origin errors without improving OG success.
    if (!import.meta.env.PROD) {
      html = await tryFetchHtml(originalUrl, 15_000)
      return html ? { html, via: 'direct' } : null
    }
    return null
  }

  const html = await tryFetchHtml(originalUrl, 15_000)
  return html ? { html, via: 'direct' } : null
}

function parseOpenGraphFromHtml(html: string, pageUrl: string): TWebMetadata {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  const ogTitleMeta = doc.querySelector('meta[property="og:title"]')
  const titleTag = doc.querySelector('title')

  let title = ogTitleMeta?.getAttribute('content') || titleTag?.textContent
  if (title) {
    const trimmedTitle = title.trim()
    if (
      /^(Redirecting|Loading|Please wait|Redirect)(\.\.\.|…)?$/i.test(trimmedTitle) ||
      trimmedTitle === '...' ||
      trimmedTitle === '…'
    ) {
      title = undefined
    }
  }

  const description =
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    (doc.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content

  let image = (doc.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)?.content

  if (image) {
    try {
      const urlObj = new URL(pageUrl)
      if (image.startsWith('/')) {
        image = `${urlObj.protocol}//${urlObj.host}${image}`
      } else if (!image.match(/^https?:\/\//)) {
        const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)
        image = `${urlObj.protocol}//${urlObj.host}${basePath}${image}`
      }

      const imageLower = image.toLowerCase()
      if (
        imageLower.includes('/favicon') ||
        imageLower.endsWith('/favicon.ico') ||
        imageLower.endsWith('/favicon.svg')
      ) {
        logger.warn('[WebService] Filtered out favicon URL from OG image', { url: pageUrl, image })
        image = undefined
      }
    } catch (error) {
      logger.warn('[WebService] Failed to convert relative image URL', { image, url: pageUrl, error })
    }
  }

  try {
    const urlObj = new URL(pageUrl)
    const isJumbleDomain =
      urlObj.hostname === 'jumble.imwald.eu' || urlObj.hostname.includes('jumble')
    const isJumbleDefaultTitle =
      title?.includes('Jumble - Imwald Edition') || title?.includes('Jumble Imwald Edition')
    const isJumbleDefaultDesc = description?.includes(
      'A user-friendly Nostr client focused on relay feed browsing'
    )
    if (!isJumbleDomain && (isJumbleDefaultTitle || isJumbleDefaultDesc)) {
      logger.debug('[WebService] Filtered out Jumble default OG tags for external domain', {
        url: pageUrl,
        hostname: urlObj.hostname
      })
      return {}
    }
  } catch {
    /* ignore */
  }

  return { title, description, image }
}

class WebService {
  static instance: WebService

  private webMetadataDataLoader = new DataLoader<string, TWebMetadata>(
    async (urls) => {
      return await Promise.all(
        urls.map(async (url) => {
          try {
            const loaded = await fetchHtmlForOpenGraph(url)
            if (!loaded) {
              logger.debug('[WebService] No HTML for OG metadata', { url })
              return {}
            }

            logger.debug('[WebService] Received HTML for OG', {
              url,
              via: loaded.via,
              htmlLength: loaded.html.length
            })

            return parseOpenGraphFromHtml(loaded.html, url)
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              logger.warn('[WebService] Fetch aborted (timeout)', { url })
            } else {
              logger.error('[WebService] Failed to fetch OG metadata', { url, error })
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
