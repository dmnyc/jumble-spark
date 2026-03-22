import { PROFILE_FETCH_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import type { TRelayList } from '@/types'

/** Dispatched after tombstones in IndexedDB change (kind-5 sync or local apply). */
export const TOMBSTONES_UPDATED_EVENT = 'jumble:tombstonesUpdated'

export function dispatchTombstonesUpdated(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TOMBSTONES_UPDATED_EVENT))
}

/** Relay set for querying the current user's kind-5 events (aligned with login sync). */
export function buildDeletionRelayUrls(relayList: TRelayList | null | undefined): string[] {
  if (!relayList?.read?.length && !relayList?.write?.length) {
    return Array.from(
      new Set(PROFILE_FETCH_RELAY_URLS.map((url) => normalizeUrl(url) || url).filter(Boolean))
    ).slice(0, 20)
  }
  return Array.from(
    new Set([
      ...relayList.write.map((url: string) => normalizeUrl(url) || url),
      ...relayList.read.slice(0, 8).map((url: string) => normalizeUrl(url) || url),
      ...PROFILE_FETCH_RELAY_URLS.map((url: string) => normalizeUrl(url) || url)
    ])
  ).slice(0, 20)
}
