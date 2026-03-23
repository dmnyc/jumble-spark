import { DEFAULT_FAVORITE_RELAYS, FAST_READ_RELAY_URLS, READ_ONLY_RELAY_URLS } from '@/constants'
import type { TFeedSubRequest } from '@/types'
import { normalizeUrl } from '@/lib/url'
import type { Filter } from 'nostr-tools'
import {
  buildPrioritizedReadRelayUrls,
  buildReadRelayPriorityLayers,
  dedupeNormalizeRelayUrlsOrdered,
  MAX_REQ_RELAY_URLS,
  mergeRelayPriorityLayers,
  relayUrlsLocalsFirst
} from '@/lib/relay-url-priority'

/** True when the filter is unrestricted by kind or explicitly includes kind 1 (short notes). */
export function relayFilterLikelyIncludesKind1(filter: Filter): boolean {
  const k = filter.kinds
  if (k === undefined) return true
  const arr = Array.isArray(k) ? k : [k]
  return arr.includes(1)
}

const blockedSet = (blockedRelays: string[]) =>
  new Set(blockedRelays.map((b) => normalizeUrl(b) || b))

/**
 * Logged-in user’s favorite relays (kind 10012 `relay` tags via {@link useFavoriteRelays}, plus bootstrap defaults
 * when the event is missing): drop blocked, dedupe, normalize. If no non-blocked entries remain, use
 * {@link DEFAULT_FAVORITE_RELAYS}. Same list drives the favorites tier in REQ/publish prioritization and the
 * all-favorites home feed.
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
 * Profile pins + media: prepend {@link READ_ONLY_RELAY_URLS} and {@link FAST_READ_RELAY_URLS} to the
 * capped NIP-65 stack so REQ still hits aggregators when the author’s six relays fill the profile cap alone.
 */
export const PROFILE_AUGMENTED_READ_MAX_RELAYS = 16

export function buildProfileAugmentedReadRelayUrls(
  profileRelayUrls: string[],
  blockedRelays: string[],
  maxRelays: number = PROFILE_AUGMENTED_READ_MAX_RELAYS
): string[] {
  const readOnlyLayer = READ_ONLY_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean)
  const fastReadLayer = FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean)
  const merged = mergeRelayUrlLayers([readOnlyLayer, fastReadLayer, profileRelayUrls], blockedRelays)
  return merged.slice(0, maxRelays)
}

export type ReadRelayPriorityOptions = {
  /** User NIP-65 write list — local URLs are promoted with inboxes for REQ. */
  userWriteRelays?: string[]
  /** Profile/timeline author outboxes (write relays) when known. */
  authorWriteRelays?: string[]
  maxRelays?: number
  /**
   * When set, applies to all subrequests. When unset, each subrequest uses {@link relayFilterLikelyIncludesKind1}
   * on its filter to decide whether to strip kind-1-blocklisted relays before capping.
   */
  applyKind1BlockedFilter?: boolean
  /**
   * When false, ignore each subrequest’s `urls` and use only the shared prioritized stack (rare).
   * Default true.
   */
  mergeSubrequestRelayUrls?: boolean
  /**
   * When true, fold `r.urls` into the author-outbox tier only (no extra first layer). Use for GIF / explicit spell relays
   * that should rank with author outboxes, not ahead of user inboxes. Default false: prepend `r.urls` before user tiers.
   */
  mergeSubrequestRelaysIntoAuthorTier?: boolean
}

/**
 * REQ order: user inboxes + locals → author outboxes → favorites → {@link FAST_READ_RELAY_URLS}.
 */
export function getRelayUrlsWithFavoritesFastReadAndInbox(
  favoriteRelays: string[],
  blockedRelays: string[],
  userInboxReadRelays: string[],
  options?: ReadRelayPriorityOptions
): string[] {
  const favorites = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)
  return buildPrioritizedReadRelayUrls({
    userReadRelays: userInboxReadRelays,
    userWriteRelays: options?.userWriteRelays ?? [],
    authorWriteRelays: options?.authorWriteRelays ?? [],
    favoriteRelays: favorites,
    blockedRelays,
    maxRelays: options?.maxRelays,
    applyKind1BlockedFilter: options?.applyKind1BlockedFilter
  })
}

/**
 * Profile page pins + feed: viewed author's NIP-65 read + write (REQ tier 1), then logged-in user's favorites,
 * then fast-read defaults from constants, deduped and blocked-stripped, capped at this count.
 */
export const PROFILE_PAGE_FEED_MAX_RELAYS = 6

export const PROFILE_PAGE_PINS_RESOLVE_LIMIT = 10

export function buildProfilePageReadRelayUrls(
  favoriteRelays: string[],
  blockedRelays: string[],
  authorRelayList: { read: string[]; write: string[] },
  kindsIncludeKind1: boolean
): string[] {
  return getRelayUrlsWithFavoritesFastReadAndInbox(
    favoriteRelays,
    blockedRelays,
    authorRelayList.read ?? [],
    {
      userWriteRelays: authorRelayList.write ?? [],
      authorWriteRelays: [],
      maxRelays: PROFILE_PAGE_FEED_MAX_RELAYS,
      applyKind1BlockedFilter: kindsIncludeKind1
    }
  )
}

/**
 * Per subrequest: shared inbox → author/favorites → fast read stack, normalized, user-blocked and (when applicable)
 * kind-1-blocked stripped, deduped, capped. Subrequest `urls` are prepended first by default (following shards);
 * set {@link ReadRelayPriorityOptions.mergeSubrequestRelaysIntoAuthorTier} to fold them into the author tier only
 * (e.g. curated GIF / spell relay lists).
 */
export function augmentSubRequestsWithFavoritesFastReadAndInbox(
  requests: TFeedSubRequest[],
  favoriteRelays: string[],
  blockedRelays: string[],
  userInboxReadRelays: string[],
  options?: ReadRelayPriorityOptions
): TFeedSubRequest[] {
  const max = options?.maxRelays ?? MAX_REQ_RELAY_URLS
  return requests.map((r) => {
    const useSubUrls = options?.mergeSubrequestRelayUrls !== false
    const foldIntoAuthor = options?.mergeSubrequestRelaysIntoAuthorTier === true
    const applyK1 =
      options?.applyKind1BlockedFilter !== undefined
        ? options.applyKind1BlockedFilter
        : relayFilterLikelyIncludesKind1(r.filter)

    const favorites = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)

    if (!useSubUrls) {
      return {
        ...r,
        urls: buildPrioritizedReadRelayUrls({
          userReadRelays: userInboxReadRelays,
          userWriteRelays: options?.userWriteRelays ?? [],
          authorWriteRelays: options?.authorWriteRelays ?? [],
          favoriteRelays: favorites,
          blockedRelays,
          maxRelays: max,
          applyKind1BlockedFilter: applyK1
        })
      }
    }

    const authorOnly = dedupeNormalizeRelayUrlsOrdered(options?.authorWriteRelays ?? [])
    const authorTier = foldIntoAuthor
      ? dedupeNormalizeRelayUrlsOrdered([...authorOnly, ...r.urls])
      : authorOnly

    const coreLayers = buildReadRelayPriorityLayers({
      userReadRelays: userInboxReadRelays,
      userWriteRelays: options?.userWriteRelays ?? [],
      authorWriteRelays: authorTier,
      favoriteRelays: favorites
    })

    const layers = foldIntoAuthor ? coreLayers : [relayUrlsLocalsFirst(r.urls), ...coreLayers]

    return {
      ...r,
      urls: mergeRelayPriorityLayers(layers, blockedRelays, max, {
        applyKind1BlockedFilter: applyK1
      })
    }
  })
}
