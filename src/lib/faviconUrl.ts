import UriTemplate from 'uri-templates'

// Common favicon locations to try when the configured template fails, ordered
// from most to least common.
const FALLBACK_FAVICON_PATHS = [
  '/favicon.ico',
  '/favicon.svg',
  '/favicon.png',
  '/apple-touch-icon.png'
]

export function faviconUrl(template: string, url: string | URL): string {
  const u = new URL(url)

  return UriTemplate(template).fill({
    href: u.href,
    origin: u.origin,
    protocol: u.protocol,
    username: u.username,
    password: u.password,
    host: u.host,
    hostname: u.hostname,
    port: u.port,
    pathname: u.pathname,
    hash: u.hash,
    search: u.search
  })
}

export function faviconUrlCandidates(template: string, url: string | URL): string[] {
  const u = new URL(url)

  const candidates: string[] = []
  try {
    candidates.push(faviconUrl(template, u))
  } catch {
    // Ignore an invalid template and rely on the fallback paths below.
  }
  for (const path of FALLBACK_FAVICON_PATHS) {
    candidates.push(`${u.origin}${path}`)
  }

  return [...new Set(candidates)]
}
