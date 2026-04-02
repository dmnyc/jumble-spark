import { Event } from 'nostr-tools'
import nip89Service from '@/services/nip89.service'

/**
 * Create the Imwald application handler info event (kind 31990).
 * This can be published using the existing publish function from NostrProvider.
 */
export function createImwaldHandlerInfoEvent(pubkey: string): Omit<Event, 'id' | 'sig'> {
  return nip89Service.createImwaldHandlerInfo(pubkey)
}

/** @deprecated Use {@link createImwaldHandlerInfoEvent} */
export const createJumbleImWaldHandlerInfoEvent = createImwaldHandlerInfoEvent
