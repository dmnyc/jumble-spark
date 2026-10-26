import { POLL_RESPONSE_RELAY_URLS } from '@/constants'
import { normalizeUrl } from './url'

/**
 * Relays to read a poll's responses from: the poll's own relays, the current
 * user's write relays, and the relays most other clients publish responses to.
 */
export function getPollResponseRelayUrls(pollRelayUrls: string[], userRelayUrls: string[] = []) {
  const urls = [...pollRelayUrls, ...userRelayUrls, ...POLL_RESPONSE_RELAY_URLS]
    .map((url) => normalizeUrl(url))
    .filter(Boolean)
  return Array.from(new Set(urls))
}
