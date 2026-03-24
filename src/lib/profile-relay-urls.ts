/**
 * Build relay URLs for profile-related fetches (zaps, likes, comments, badges, follow packs).
 * Uses profile owner's outboxes + PROFILE_FETCH_RELAY_URLS.
 */

import { E_TAG_FILTER_BLOCKED_RELAY_URLS, PROFILE_FETCH_RELAY_URLS } from '@/constants'
import client from '@/services/client.service'
import { normalizeUrl } from '@/lib/url'

export async function buildProfileRelayUrls(
  pubkey: string,
  blockedRelays: string[] = []
): Promise<string[]> {
  const blocked = new Set(
    [...blockedRelays, ...E_TAG_FILTER_BLOCKED_RELAY_URLS].map((u) => (normalizeUrl(u) || u).toLowerCase())
  )
  const addRelay = (url: string | undefined, out: Set<string>) => {
    if (!url) return
    const n = normalizeUrl(url) || url
    if (!n || blocked.has(n.toLowerCase())) return
    out.add(n)
  }

  const relayUrlsSet = new Set<string>()
  const relayList = await client.fetchRelayList(pubkey).catch(() => ({ write: [] as string[], read: [] as string[] }))
  ;(relayList?.write ?? []).filter((u): u is string => !!u).forEach((u) => addRelay(u, relayUrlsSet))
  PROFILE_FETCH_RELAY_URLS.forEach((u) => addRelay(u, relayUrlsSet))
  return Array.from(relayUrlsSet)
}
