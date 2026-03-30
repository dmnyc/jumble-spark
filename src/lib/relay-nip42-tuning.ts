import type { AbstractRelay } from 'nostr-tools/abstract-relay'

import { RELAY_NIP42_PUBLISH_ACK_TIMEOUT_MS } from '@/constants'

/** Set nostr-tools ACK wait so NIP-42 AUTH is not rejected while the relay (or extension) is slow. */
export function applyRelayNip42AckTimeout(relay: AbstractRelay): void {
  relay.publishTimeout = RELAY_NIP42_PUBLISH_ACK_TIMEOUT_MS
}
