import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import {
  buildPinListTagsAfterRemovingRef,
  buildPinListTagsAfterToggle,
  fetchNewestPinListForPubkey,
  isEventInPinList
} from '@/lib/replaceable-list-latest'
import { decodePersonalListBech32Ref } from '@/lib/personal-list-mutations'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import indexedDb from '@/services/indexed-db.service'
import { useCallback } from 'react'
import type { Event } from 'nostr-tools'

/**
 * Publish an updated kind 10001 pin list without the given entry (by loaded event or NIP-19 ref).
 */
export function useRemovePinListEntry(onSuccess?: () => void) {
  const { publish, pubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()

  const removePinEntry = useCallback(
    async (bech32Id: string, loadedEvent: Event | null): Promise<boolean> => {
      if (!pubkey) return false
      const comprehensiveRelays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      if (!comprehensiveRelays.length) return false

      const latest = await fetchNewestPinListForPubkey(pubkey, comprehensiveRelays)
      if (!latest) return false

      let newTags: string[][] | null = null
      if (loadedEvent) {
        if (!isEventInPinList(latest, loadedEvent)) return false
        newTags = buildPinListTagsAfterToggle(latest, loadedEvent, false)
      } else {
        const ref = decodePersonalListBech32Ref(bech32Id)
        if (!ref) return false
        newTags = buildPinListTagsAfterRemovingRef(latest.tags, ref)
      }
      if (!newTags) return false

      const published = await publish(
        {
          kind: 10001,
          tags: newTags,
          content: '',
          created_at: Math.floor(Date.now() / 1000)
        },
        { specifiedRelayUrls: comprehensiveRelays }
      )
      await indexedDb.putReplaceableEvent(published as Event)
      onSuccess?.()
      return true
    },
    [blockedRelays, favoriteRelays, onSuccess, publish, pubkey]
  )

  return removePinEntry
}
