import type { Event } from 'nostr-tools'

/** In-memory: successful tally fetches this tab session (incl. empty tallies). */
const receiptsByPollId = new Map<string, Event[]>()

function cacheKey(pollHexId: string): string | null {
  const k = pollHexId.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(k) ? k : null
}

export function peekZapPollTallyReceipts(pollHexId: string): Event[] | undefined {
  const k = cacheKey(pollHexId)
  if (!k || !receiptsByPollId.has(k)) return undefined
  return receiptsByPollId.get(k)!
}

export function storeZapPollTallyReceipts(pollHexId: string, receipts: Event[]) {
  const k = cacheKey(pollHexId)
  if (k) receiptsByPollId.set(k, receipts)
}
