import { SEARCHABLE_RELAY_URLS } from '@/constants'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import {
  getFavoritesFeedRelayUrls,
  mergeRelayUrlLayers
} from '@/lib/favorites-feed-relays'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { normalizeUrl } from '@/lib/url'

/**
 * Relay stack for “search loaded posts” → **full relay search**: searchable relays, favorites (kind 10012 + defaults),
 * logged-in account read/write merge, then {@link buildComprehensiveRelayList} (user NIP-65 + local + profile + fast
 * read/write + search + favorites). When {@link filterAuthorHex} differs from the viewer, that author’s NIP-65 in/out
 * (incl. http) is included via `authorPubkey`.
 */
export async function buildFeedFullSearchRelayUrls(options: {
  viewerPubkey: string | null | undefined
  filterAuthorHex: string | null | undefined
  favoriteRelays: string[]
  blockedRelays: string[]
}): Promise<string[]> {
  const { viewerPubkey, filterAuthorHex, favoriteRelays, blockedRelays } = options
  const blocked = blockedRelays ?? []
  const layers: string[][] = []

  const searchable = SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean)
  layers.push(searchable)

  layers.push(getFavoritesFeedRelayUrls(favoriteRelays ?? [], blocked))

  if (viewerPubkey) {
    try {
      const account = await buildAccountListRelayUrlsForMerge({
        accountPubkey: viewerPubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays: blocked
      })
      layers.push(account)
    } catch {
      /* continue with other layers */
    }
  }

  const viewerLower = viewerPubkey?.toLowerCase()
  const authorLower = filterAuthorHex?.toLowerCase()
  const authorForN65 =
    filterAuthorHex && authorLower !== viewerLower ? filterAuthorHex : undefined

  try {
    const comprehensive = await buildComprehensiveRelayList({
      userPubkey: viewerPubkey ?? undefined,
      authorPubkey: authorForN65,
      includeUserOwnRelays: !!viewerPubkey,
      includeProfileFetchRelays: true,
      includeFastReadRelays: true,
      includeFastWriteRelays: true,
      includeSearchableRelays: true,
      includeLocalRelays: true,
      includeFavoriteRelays: !!viewerPubkey,
      blockedRelays: blocked
    })
    layers.push(comprehensive)
  } catch {
    /* merge without comprehensive */
  }

  return mergeRelayUrlLayers(layers, blocked)
}
