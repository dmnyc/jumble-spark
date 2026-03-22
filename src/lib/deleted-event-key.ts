import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { NostrEvent } from 'nostr-tools'

/** Key used when optimistically marking an event deleted in UI (matches tombstone / filter lookup). */
export function getKeyForDeletedLookup(event: NostrEvent): string {
  return isReplaceableEvent(event.kind) ? getReplaceableCoordinateFromEvent(event) : event.id
}
