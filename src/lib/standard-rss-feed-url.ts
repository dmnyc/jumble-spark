/**
 * Recognize well-known RSS / Atom feed URL shapes (Spotifeed, YouTube, FeedBurner, etc.)
 * for friendlier labels in the UI. Not exhaustive — unknown URLs return null.
 */

export type StandardRssFeedIcon = 'music' | 'youtube' | 'feedburner' | 'reddit' | 'substack' | 'medium' | 'rss'

export type StandardRssFeedProfile = {
  icon: StandardRssFeedIcon
  /** i18n key under translation */
  labelKey: string
  /** English fallback if catalog missing */
  defaultLabel: string
  /** Short secondary line (e.g. truncated id) */
  detail?: string
}

function truncateId(id: string, max = 14): string {
  const t = id.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/**
 * Returns a profile when `feedUrl` matches a known pattern; otherwise null.
 */
export function getStandardRssFeedProfile(feedUrl: string): StandardRssFeedProfile | null {
  let u: URL
  try {
    u = new URL(feedUrl.trim())
  } catch {
    return null
  }

  const host = u.hostname.replace(/^www\./, '').toLowerCase()

  if (host === 'spotifeed.timdorr.com') {
    const id = u.pathname.replace(/^\//, '').split('/').filter(Boolean)[0] ?? ''
    return {
      icon: 'music',
      labelKey: 'standardRssFeed_spotifeed',
      defaultLabel: 'Spotify playlist (Spotifeed)',
      detail: id ? truncateId(id, 22) : undefined
    }
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (u.pathname.includes('/feeds/videos.xml')) {
      const ch = u.searchParams.get('channel_id')
      const pl = u.searchParams.get('playlist_id')
      if (ch) {
        return {
          icon: 'youtube',
          labelKey: 'standardRssFeed_youtubeChannel',
          defaultLabel: 'YouTube channel feed',
          detail: truncateId(ch, 18)
        }
      }
      if (pl) {
        return {
          icon: 'youtube',
          labelKey: 'standardRssFeed_youtubePlaylist',
          defaultLabel: 'YouTube playlist feed',
          detail: truncateId(pl, 18)
        }
      }
      return {
        icon: 'youtube',
        labelKey: 'standardRssFeed_youtube',
        defaultLabel: 'YouTube feed'
      }
    }
  }

  if (host.endsWith('feedburner.com') || host.endsWith('feedburner.google.com')) {
    return {
      icon: 'feedburner',
      labelKey: 'standardRssFeed_feedburner',
      defaultLabel: 'FeedBurner'
    }
  }

  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    const p = u.pathname
    if (p.endsWith('.rss') || p.includes('/.rss') || p.endsWith('/rss') || p.includes('/rss/')) {
      return {
        icon: 'reddit',
        labelKey: 'standardRssFeed_reddit',
        defaultLabel: 'Reddit RSS'
      }
    }
  }

  if (host.endsWith('.substack.com') && u.pathname.startsWith('/feed')) {
    return {
      icon: 'substack',
      labelKey: 'standardRssFeed_substack',
      defaultLabel: 'Substack'
    }
  }

  if (host === 'medium.com' || host.endsWith('.medium.com')) {
    if (u.pathname.startsWith('/feed') || u.pathname.startsWith('/@')) {
      return {
        icon: 'medium',
        labelKey: 'standardRssFeed_medium',
        defaultLabel: 'Medium'
      }
    }
  }

  return null
}

/** Hostname for display when there is no known profile. */
export function getRssFeedUrlHostname(feedUrl: string): string {
  try {
    return new URL(feedUrl.trim()).hostname.replace(/^www\./, '')
  } catch {
    return feedUrl.trim().slice(0, 80)
  }
}
