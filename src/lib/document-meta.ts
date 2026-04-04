/** Shared Open Graph / Twitter / document title helpers (client-side). */

export const SITE_NAME = 'Imwald'

export const SITE_TAGLINE =
  'A user-friendly Nostr client focused on relay feed browsing, publications, and relay discovery.'

export function getSiteOrigin(): string {
  if (typeof window === 'undefined') return 'https://jumble.imwald.eu'
  return window.location.origin
}

export function defaultOgImageAbsoluteUrl(): string {
  return `${getSiteOrigin()}/og-image.png`
}

export function avatarProxyUrl(pubkey: string): string {
  return `${getSiteOrigin()}/api/avatar/${pubkey}`
}

export function updateMetaTag(property: string, content: string): void {
  if (typeof document === 'undefined') return
  const prop =
    property.startsWith('og:') || property.startsWith('article:') || property.startsWith('profile:')
      ? property
      : property.replace(/^property="|"$/, '')

  const isTwitterTag = prop.startsWith('twitter:')
  const selector = isTwitterTag ? `meta[name="${prop}"]` : `meta[property="${prop}"]`

  let meta = document.querySelector(selector)
  if (!meta) {
    meta = document.createElement('meta')
    if (isTwitterTag) {
      meta.setAttribute('name', prop)
    } else {
      meta.setAttribute('property', prop)
    }
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', content)
}

export function removeMetaByProperty(property: string): void {
  if (typeof document === 'undefined') return
  document.querySelectorAll(`meta[property="${property}"]`).forEach((m) => m.remove())
}

export function applyDefaultSiteSocialMeta(): void {
  if (typeof window === 'undefined') return
  const href = window.location.href
  const truncatedUrl = href.length > 150 ? href.substring(0, 147) + '...' : href
  const desc = `${truncatedUrl} — ${SITE_TAGLINE}`
  const img = defaultOgImageAbsoluteUrl()

  updateMetaTag('og:title', SITE_NAME)
  updateMetaTag('og:description', desc)
  updateMetaTag('og:image', img)
  updateMetaTag('og:type', 'website')
  updateMetaTag('og:url', href)
  updateMetaTag('og:site_name', SITE_NAME)

  updateMetaTag('twitter:card', 'summary_large_image')
  updateMetaTag('twitter:title', SITE_NAME)
  updateMetaTag('twitter:description', desc)
  updateMetaTag('twitter:image', img)
}

const PRIMARY_PAGE_LABEL: Record<string, string> = {
  explore: 'Explore',
  feed: 'Feed',
  me: 'Me',
  profile: 'Profile',
  relay: 'Relay',
  search: 'Search',
  'follows-latest': 'Latest follows',
  rss: 'RSS',
  settings: 'Settings',
  spells: 'Spells'
}

function relayHostnameFromPath(pathname: string): string | null {
  const m =
    pathname.match(/\/(?:home|explore)\/relays\/(.+)$/i) || pathname.match(/^\/relays\/(.+)$/i)
  if (!m?.[1]) return null
  try {
    const decoded = decodeURIComponent(m[1].split('/')[0])
    const asHttp = decoded.startsWith('wss://')
      ? 'https://' + decoded.slice(6)
      : decoded.startsWith('ws://')
        ? 'http://' + decoded.slice(5)
        : decoded
    const u = new URL(asHttp.includes('://') ? asHttp : `https://${asHttp}`)
    return u.hostname || decoded
  } catch {
    return m[1].slice(0, 80)
  }
}

export type TRouteSocialCopy = { pageTitle: string; ogTitle: string; description: string }

/** Note detail URLs set OG tags in NotePage. */
export function isNoteDetailPathname(pathname: string): boolean {
  const path = pathname.split('?')[0].split('#')[0]
  return (
    /\/notes\/[^/?#]+/.test(path) ||
    /\/(?:discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/notes\/[^/?#]+/.test(
      path
    )
  )
}

/** Profile detail (/users/:id) sets OG in ProfilePage. */
export function isProfileDetailPathname(pathname: string): boolean {
  const path = pathname.split('?')[0].split('#')[0].replace(/\/$/, '') || '/'
  return /^\/users\/[^/]+$/.test(path)
}

/** Labels for static Imwald URLs (in-app link previews + route-level OG when no note/profile). */
export function resolveImwaldRouteSocialCopy(
  pathname: string,
  currentPrimaryPage: string
): TRouteSocialCopy {
  const path = pathname.split('?')[0].split('#')[0].replace(/\/$/, '') || '/'
  const href = typeof window !== 'undefined' ? window.location.href : ''
  const relayHost = relayHostnameFromPath(path)

  let pageTitle = SITE_NAME
  let ogTitle = SITE_NAME
  let description = href ? `${SITE_TAGLINE} ${href}` : SITE_TAGLINE

  if (path.startsWith('/settings')) {
    if (path.includes('/general')) {
      pageTitle = `General · ${SITE_NAME}`
      ogTitle = `General settings · ${SITE_NAME}`
    } else if (path.includes('/relays')) {
      pageTitle = `Relays · ${SITE_NAME}`
      ogTitle = `Relay & storage settings · ${SITE_NAME}`
    } else if (path.includes('/cache')) {
      pageTitle = `Cache · ${SITE_NAME}`
      ogTitle = `Cache & offline storage · ${SITE_NAME}`
    } else if (path.includes('/wallet')) {
      pageTitle = `Wallet · ${SITE_NAME}`
      ogTitle = `Wallet settings · ${SITE_NAME}`
    } else if (path.includes('/posts')) {
      pageTitle = `Posts · ${SITE_NAME}`
      ogTitle = `Post settings · ${SITE_NAME}`
    } else if (path.includes('/translation')) {
      pageTitle = `Translation · ${SITE_NAME}`
      ogTitle = `Translation settings · ${SITE_NAME}`
    } else if (path.includes('/rss-feeds')) {
      pageTitle = `RSS feeds · ${SITE_NAME}`
      ogTitle = `RSS feed settings · ${SITE_NAME}`
    } else if (path.includes('/follow-sets')) {
      pageTitle = `Follow sets · ${SITE_NAME}`
      ogTitle = `Follow sets · ${SITE_NAME}`
    } else if (path.includes('/personal-lists')) {
      pageTitle = `Lists · ${SITE_NAME}`
      ogTitle = `Personal lists · ${SITE_NAME}`
    } else {
      pageTitle = `Settings · ${SITE_NAME}`
      ogTitle = `Settings · ${SITE_NAME}`
    }
    description = `${ogTitle}. ${SITE_TAGLINE}`
  } else if (path === '/search' || path.startsWith('/search/')) {
    pageTitle = `Search · ${SITE_NAME}`
    ogTitle = pageTitle
    description = `Search notes and people on Nostr with ${SITE_NAME}.`
  } else if (relayHost) {
    const host = relayHost
    pageTitle = `${host} · ${SITE_NAME}`
    ogTitle = `Relay ${host} · ${SITE_NAME}`
    description = `Relay ${host} on ${SITE_NAME}. ${SITE_TAGLINE}`
  } else if (path.startsWith('/rss-item') || path.includes('/rss-item/')) {
    pageTitle = `Article · ${SITE_NAME}`
    ogTitle = `RSS article · ${SITE_NAME}`
    description = `Read an RSS-sourced article in ${SITE_NAME}.`
  } else if (path === '/users') {
    pageTitle = `People · ${SITE_NAME}`
    ogTitle = `People on ${SITE_NAME}`
    description = `Browse Nostr profiles in ${SITE_NAME}.`
  } else if (path === '/bookmarks') {
    pageTitle = `Bookmarks · ${SITE_NAME}`
    ogTitle = pageTitle
    description = `Your bookmarked notes on ${SITE_NAME}.`
  } else if (path === '/mutes') {
    pageTitle = `Muted users · ${SITE_NAME}`
    ogTitle = pageTitle
    description = `Muted users in ${SITE_NAME}.`
  } else if (path === '/pins') {
    pageTitle = `Pinned notes · ${SITE_NAME}`
    ogTitle = pageTitle
    description = `Pinned notes in ${SITE_NAME}.`
  } else if (path === '/interests') {
    pageTitle = `Interests · ${SITE_NAME}`
    ogTitle = pageTitle
    description = `Interest lists in ${SITE_NAME}.`
  } else if (path === '/profile-editor') {
    pageTitle = `Edit profile · ${SITE_NAME}`
    ogTitle = pageTitle
    description = `Edit your Nostr profile in ${SITE_NAME}.`
  } else if (path === '/follow-packs') {
    pageTitle = `Follow packs · ${SITE_NAME}`
    ogTitle = pageTitle
    description = `Follow packs on ${SITE_NAME}.`
  } else if (path === '/notes') {
    pageTitle = `Notes · ${SITE_NAME}`
    ogTitle = pageTitle
    description = `Notes in ${SITE_NAME}.`
  } else if (path.match(/^\/users\/[^/]+\/following$/)) {
    pageTitle = `Following · ${SITE_NAME}`
    ogTitle = `Following list · ${SITE_NAME}`
    description = `Following list on ${SITE_NAME}.`
  } else if (path.match(/^\/users\/[^/]+\/relays$/)) {
    pageTitle = `Relays · ${SITE_NAME}`
    ogTitle = `User relays · ${SITE_NAME}`
    description = `Relay list on ${SITE_NAME}.`
  } else if (path === '/' || path === '/home') {
    pageTitle = `Home · ${SITE_NAME}`
    ogTitle = `Home · ${SITE_NAME}`
    description = `${SITE_TAGLINE} ${href}`
  } else {
    const seg = path.split('/').filter(Boolean)[0]
    if (seg && PRIMARY_PAGE_LABEL[seg]) {
      const label = PRIMARY_PAGE_LABEL[seg]
      pageTitle = `${label} · ${SITE_NAME}`
      ogTitle = pageTitle
      description = `${label} in ${SITE_NAME}. ${SITE_TAGLINE}`
    } else if (currentPrimaryPage && PRIMARY_PAGE_LABEL[currentPrimaryPage]) {
      const label = PRIMARY_PAGE_LABEL[currentPrimaryPage]
      pageTitle = `${label} · ${SITE_NAME}`
      ogTitle = pageTitle
      description = `${label} in ${SITE_NAME}. ${SITE_TAGLINE}`
    }
  }

  return { pageTitle, ogTitle, description }
}

/**
 * Browser tab + social tags for routes that do not set their own (e.g. settings, lists).
 * Note and profile detail pages set richer tags in their components.
 */
export function applyRouteDocumentMeta(pathname: string, currentPrimaryPage: string): void {
  if (typeof window === 'undefined') return

  const { pageTitle, ogTitle, description } = resolveImwaldRouteSocialCopy(pathname, currentPrimaryPage)
  const href = window.location.href
  const img = defaultOgImageAbsoluteUrl()

  document.title = pageTitle

  updateMetaTag('og:title', ogTitle)
  updateMetaTag('og:description', description.length > 300 ? description.slice(0, 297) + '...' : description)
  updateMetaTag('og:image', img)
  updateMetaTag('og:type', 'website')
  updateMetaTag('og:url', href)
  updateMetaTag('og:site_name', SITE_NAME)

  updateMetaTag('twitter:card', 'summary_large_image')
  updateMetaTag('twitter:title', ogTitle)
  updateMetaTag(
    'twitter:description',
    description.length > 200 ? description.slice(0, 197) + '...' : description
  )
  updateMetaTag('twitter:image', img)

  removeMetaByProperty('article:tag')
  removeMetaByProperty('article:author')
  document.querySelector('meta[property="article:author:url"]')?.remove()
}
