import { PROFILE_FETCH_RELAY_URLS } from '@/constants'
import { normalizeAnyRelayUrl, normalizeHttpRelayUrl, normalizeUrl } from '@/lib/url'
import type { TRelayList } from '@/types'

/** Dispatched after tombstones in IndexedDB change (kind-5 sync or local apply). */
export const TOMBSTONES_UPDATED_EVENT = 'jumble:tombstonesUpdated'

export function dispatchTombstonesUpdated(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TOMBSTONES_UPDATED_EVENT))
}

/** Relay set for querying the current user's kind-5 events (aligned with login sync). */
export function buildDeletionRelayUrls(relayList: TRelayList | null | undefined): string[] {
  const httpR = relayList?.httpRead ?? []
  const httpW = relayList?.httpWrite ?? []
  if (!relayList?.read?.length && !relayList?.write?.length && !httpR.length && !httpW.length) {
    return Array.from(
      new Set(PROFILE_FETCH_RELAY_URLS.map((url) => normalizeUrl(url) || url).filter(Boolean))
    ).slice(0, 20)
  }
  const ws = relayList?.write ?? []
  const rs = relayList?.read ?? []
  return Array.from(
    new Set([
      ...ws.map((url: string) => normalizeUrl(url) || url),
      ...rs.slice(0, 8).map((url: string) => normalizeUrl(url) || url),
      ...httpW.map((url: string) => normalizeHttpRelayUrl(url) || url),
      ...httpR.slice(0, 8).map((url: string) => normalizeHttpRelayUrl(url) || url),
      ...PROFILE_FETCH_RELAY_URLS.map((url: string) => normalizeAnyRelayUrl(url) || url)
    ])
  ).slice(0, 20)
}
