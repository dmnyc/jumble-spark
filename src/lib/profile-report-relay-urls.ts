/**
 * Relays for profile NIP-56 reports (kind 1984): only the viewer’s favorite tier and read (inbox)
 * relays — no profile outboxes or global read mirrors, to limit abusive report spam.
 */

import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { mergeRelayPriorityLayers, relayUrlsLocalsFirst } from '@/lib/relay-url-priority'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'

const MAX_PROFILE_REPORT_RELAYS = 28

export async function buildProfileReportRelayUrls(options: {
  viewerPubkey: string
  favoriteRelays: string[]
  blockedRelays: string[]
}): Promise<string[]> {
  const { viewerPubkey, favoriteRelays, blockedRelays } = options
  const list = await client.fetchRelayList(viewerPubkey).catch(() => ({ read: [] as string[], write: [] as string[] }))
  const inbox = relayUrlsLocalsFirst(list.read ?? [])
    .map((u) => normalizeUrl(u) || u)
    .filter(Boolean) as string[]
  const favorites = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)
  return mergeRelayPriorityLayers([favorites, inbox], blockedRelays, MAX_PROFILE_REPORT_RELAYS, {
    applySocialKindBlockedFilter: false
  })
}
