import type { AbstractRelay } from 'nostr-tools/abstract-relay'

const patched = new WeakSet<object>()

/** NOTICE bodies that indicate the relay backend failed to serve the REQ — count as a session strike. */
const FAILED_FETCH_EVENTS = /failed to fetch events/i

/**
 * One-time patch: relay NOTICE "failed to fetch events" → session strike (same as connection failure).
 * Safe to call on every ensureRelay; only the first patch per relay instance applies.
 */
export function patchRelayNoticeForFetchFailures(
  relay: AbstractRelay,
  relayKey: string,
  onStrike?: (normalizedUrl: string, noticeMessage: string) => void
): void {
  if (!onStrike || patched.has(relay as object)) return
  patched.add(relay as object)
  const previous = relay.onnotice.bind(relay)
  relay.onnotice = (msg: string) => {
    if (typeof msg === 'string' && FAILED_FETCH_EVENTS.test(msg)) {
      try {
        onStrike(relayKey, msg)
      } catch {
        /* ignore */
      }
    }
    previous(msg)
  }
}
