/**
 * Builds the browser fetch URL for Jumble's server-side fetch proxy (`VITE_PROXY_SERVER`).
 * Shared by OG/HTML fetches and RSS so both hit the same proxy contract.
 */
export function buildViteProxySitesFetchUrl(originalUrl: string, proxyServer: string): string {
  const base = proxyServer.trim()
  if (base.startsWith('http://') || base.startsWith('https://')) {
    const withSlash = base.endsWith('/') ? base : `${base}/`
    return `${withSlash}sites/?url=${encodeURIComponent(originalUrl)}`
  }
  const basePath = base.endsWith('/') ? base : `${base}/`
  return `${basePath}?url=${encodeURIComponent(originalUrl)}`
}

export function urlLooksLikeViteProxyRequest(url: string): boolean {
  return url.includes('/sites/') || url.includes('/sites/?url=')
}
