import { getNoteBech32Id } from '@/lib/event'
import { Event, kinds } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import type { HighlightData } from '@/components/PostEditor/HighlightEditor'

/**
 * Build HighlightData for a Nostr event (source reference + optional paragraph context).
 */
export function buildHighlightDataFromEvent(
  event: Event,
  paragraphContext?: string
): HighlightData {
  let sourceValue: string
  let sourceHexId: string | undefined

  if (kinds.isAddressableKind(event.kind) || kinds.isReplaceableKind(event.kind)) {
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || ''
    if (dTag) {
      const relays = event.tags
        .filter(tag => tag[0] === 'relay')
        .map(tag => tag[1])
        .filter(Boolean)
      try {
        sourceValue = nip19.naddrEncode({
          kind: event.kind,
          pubkey: event.pubkey,
          identifier: dTag,
          relays: relays.length > 0 ? relays : undefined
        })
        sourceHexId = undefined
      } catch {
        sourceValue = getNoteBech32Id(event)
        sourceHexId = event.id
      }
    } else {
      sourceValue = getNoteBech32Id(event)
      sourceHexId = event.id
    }
  } else {
    sourceValue = getNoteBech32Id(event)
    sourceHexId = event.id
  }

  return {
    sourceType: 'nostr',
    sourceValue,
    sourceHexId,
    context: paragraphContext || undefined
  }
}
