import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { buildPrioritizedReadRelayUrls, buildPrioritizedWriteRelayUrls } from '@/lib/relay-url-priority'
import { normalizeAnyRelayUrl } from '@/lib/url'
import client from '@/services/client.service'

/**
 * Read + write relay stack for merging replaceable list events (pins, bookmarks, follows, …)
 * before publishing an update — same idea as {@link BookmarksProvider}'s comprehensive list.
 */
export async function buildAccountListRelayUrlsForMerge(options: {
  accountPubkey: string
  favoriteRelays: string[]
  blockedRelays: string[]
}): Promise<string[]> {
  const { accountPubkey, favoriteRelays, blockedRelays } = options
  const myRelayList = await client.fetchRelayList(accountPubkey)
  const favoritesTier = getFavoritesFeedRelayUrls(favoriteRelays ?? [], blockedRelays)
  const read = buildPrioritizedReadRelayUrls({
    userReadRelays: [...(myRelayList.httpRead ?? []), ...(myRelayList.read ?? [])],
    userWriteRelays: [...(myRelayList.httpWrite ?? []), ...(myRelayList.write ?? [])],
    favoriteRelays: favoritesTier,
    blockedRelays,
    maxRelays: 100,
    applySocialKindBlockedFilter: false
  })
  const write = buildPrioritizedWriteRelayUrls({
    userWriteRelays: [...(myRelayList.httpWrite ?? []), ...(myRelayList.write ?? [])],
    favoriteRelays: favoritesTier,
    blockedRelays,
    maxRelays: 100,
    applySocialKindBlockedFilter: false
  })
  const merged = [...read, ...write]
  return [...new Set(merged.map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean))]
}
