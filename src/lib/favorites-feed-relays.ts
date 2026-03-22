import { DEFAULT_FAVORITE_RELAYS, FAST_READ_RELAY_URLS } from '@/constants'
import type { TFeedSubRequest } from '@/types'
import { normalizeUrl } from '@/lib/url'

const blockedSet = (blockedRelays: string[]) =>
  new Set(blockedRelays.map((b) => normalizeUrl(b) || b))

/**
 * Relay URLs for the “all favorites” home feed only (`FeedProvider` `all-favorites` / that `RelaysFeed` mode).
 * Non-blocked user favorites, or {@link DEFAULT_FAVORITE_RELAYS} when none remain.
 */
export function getFavoritesFeedRelayUrls(
  favoriteRelays: string[],
  blockedRelays: string[]
): string[] {
  const blocked = blockedSet(blockedRelays)
  const visible = favoriteRelays.filter((r) => {
    const k = normalizeUrl(r) || r
    return k && !blocked.has(k)
  })
  const base = visible.length > 0 ? visible : DEFAULT_FAVORITE_RELAYS
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of base) {
    const k = normalizeUrl(u) || u
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/**
 * Merge relay URL lists in order; first occurrence wins; drops blocked.
 */
export function mergeRelayUrlLayers(layers: string[][], blockedRelays: string[]): string[] {
  const blocked = blockedSet(blockedRelays)
  const seen = new Set<string>()
  const out: string[] = []
  for (const layer of layers) {
    for (const u of layer) {
      const k = normalizeUrl(u) || u
      if (!k || blocked.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push(k)
    }
  }
  return out
}

/**
 * Favorites (same set as the favorites feed) plus {@link FAST_READ_RELAY_URLS} and the user’s NIP-65 **read** / inbox relays.
 * Fast-read URLs are merged first so REQ setup hits responsive indexers early (same deduped set).
 */
export function getRelayUrlsWithFavoritesFastReadAndInbox(
  favoriteRelays: string[],
  blockedRelays: string[],
  userInboxReadRelays: string[]
): string[] {
  const favorites = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)
  const fast = FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
  return mergeRelayUrlLayers([fast, favorites, userInboxReadRelays], blockedRelays)
}

/** Prefix each subrequest’s `urls` with the extended read set (favorites + fast read + inboxes). */
export function augmentSubRequestsWithFavoritesFastReadAndInbox(
  requests: TFeedSubRequest[],
  favoriteRelays: string[],
  blockedRelays: string[],
  userInboxReadRelays: string[]
): TFeedSubRequest[] {
  const base = getRelayUrlsWithFavoritesFastReadAndInbox(
    favoriteRelays,
    blockedRelays,
    userInboxReadRelays
  )
  return requests.map((r) => ({
    ...r,
    urls: mergeRelayUrlLayers([base, r.urls], blockedRelays)
  }))
}
