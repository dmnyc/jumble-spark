import { buildDeletionRelayUrls } from '@/lib/tombstone-events'
import client from '@/services/client.service'
import type { TRelayList } from '@/types'

/** Re-fetch the current user's kind-5 events, update IndexedDB tombstones, and notify UI (via tombstonesUpdated). */
export async function syncUserDeletionTombstones(
  pubkey: string | undefined | null,
  relayList: TRelayList | null | undefined
): Promise<void> {
  if (!pubkey) return
  await client.fetchDeletionEvents(buildDeletionRelayUrls(relayList ?? null), pubkey)
}
