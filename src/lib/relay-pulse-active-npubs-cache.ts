import logger from '@/lib/logger'

/** One row per browser; overwritten whenever a new active-npub list is fetched for the same relay + viewer scope. */
export type RelayPulseActiveNpubsCacheRow = {
  relayKey: string
  viewerPubkey: string | null
  orderedPubkeys: string[]
  lastFetchedAtMs: number
}

const STORAGE_KEY = 'jumble.relayPulse.activeNpubs.v1'

export function readRelayPulseActiveNpubsCache(
  relayKey: string,
  viewerPubkey: string | null
): Pick<RelayPulseActiveNpubsCacheRow, 'orderedPubkeys' | 'lastFetchedAtMs'> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return null
    const o = data as Record<string, unknown>
    if (o.relayKey !== relayKey || o.viewerPubkey !== viewerPubkey) return null
    if (!Array.isArray(o.orderedPubkeys) || typeof o.lastFetchedAtMs !== 'number') return null
    const orderedPubkeys = o.orderedPubkeys.filter((x): x is string => typeof x === 'string')
    return { orderedPubkeys, lastFetchedAtMs: o.lastFetchedAtMs }
  } catch {
    return null
  }
}

export function writeRelayPulseActiveNpubsCache(row: RelayPulseActiveNpubsCacheRow): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(row))
  } catch (e) {
    logger.debug('[RelayPulseActiveNpubsCache] write failed', { error: e })
  }
}
