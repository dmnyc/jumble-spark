import { normalizeUrl } from '@/lib/url'

/**
 * Trending notes stream from nostrarchives, consumed by
 * {@link https://github.com/barrydeen/wisp | Wisp} (Android). Same URL shape as Wisp’s
 * `buildTrendingRelayUrl` / `FEED_KINDS` REQ.
 */
export type WispTrendingMetric = 'reactions' | 'replies' | 'reposts' | 'zaps'

export type WispTrendingTimeframe = 'today' | '7d' | '30d' | '1y' | 'all'

export function buildWispTrendingNotesRelayUrl(
  metric: WispTrendingMetric = 'reactions',
  timeframe: WispTrendingTimeframe = 'today'
): string {
  return `wss://feeds.nostrarchives.com/notes/trending/${metric}/${timeframe}`
}

/** Wisp `FeedSubscriptionManager` FEED_KINDS when subscribing to trending notes. */
export const WISP_TRENDING_FEED_KINDS: readonly number[] = [1, 6, 1068, 6969, 30023, 20, 21, 22]

/** True when `url` is any nostrarchives notes trending WebSocket feed (path `/notes/trending/...`). */
export function isWispTrendingNotesRelayUrl(url: string): boolean {
  const raw = (normalizeUrl(url) || url).trim()
  const forParse = raw.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')
  try {
    const u = new URL(forParse)
    return (
      u.hostname.toLowerCase() === 'feeds.nostrarchives.com' &&
      u.pathname.toLowerCase().startsWith('/notes/trending/')
    )
  } catch {
    return false
  }
}
