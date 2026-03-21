/**
 * NIP-66 Relay Discovery and Liveness Monitoring (consumer side).
 *
 * Parses kind 30166 relay discovery events and exposes relay metadata (supported NIPs,
 * requirements, RTT, etc.) to supplement NIP-11 and static relay lists. Clients MUST NOT
 * require this data to function; use as a hint only.
 */

import { normalizeUrl } from '@/lib/url'
import indexDb from '@/services/indexed-db.service'
import { TNip66RelayDiscovery } from '@/types'
import { Event as NEvent } from 'nostr-tools'

const RELAY_DISCOVERY_KIND = 30166

function parseRequirement(value: string): { key: string; required: boolean } {
  const negated = value.startsWith('!')
  return { key: negated ? value.slice(1) : value, required: !negated }
}

function parseEvent(ev: NEvent): TNip66RelayDiscovery | null {
  if (ev.kind !== RELAY_DISCOVERY_KIND) return null
  const d = ev.tags.find((t) => t[0] === 'd')?.[1]
  if (!d) return null
  const url = d.startsWith('wss://') || d.startsWith('ws://') ? d : `wss://${d}`

  const nips = ev.tags.filter((t) => t[0] === 'N').map((t) => parseInt(t[1], 10)).filter((n) => !Number.isNaN(n))
  const requirements: TNip66RelayDiscovery['requirements'] = {}
  for (const t of ev.tags.filter((t) => t[0] === 'R')) {
    const { key, required } = parseRequirement(t[1] ?? '')
    if (key === 'auth') requirements.auth = required
    else if (key === 'payment') requirements.payment = required
    else if (key === 'writes') requirements.writes = required
    else if (key === 'pow') requirements.pow = required
  }

  const rttOpen = ev.tags.find((t) => t[0] === 'rtt-open')?.[1]
  const rttRead = ev.tags.find((t) => t[0] === 'rtt-read')?.[1]
  const rttWrite = ev.tags.find((t) => t[0] === 'rtt-write')?.[1]
  const networkType = ev.tags.find((t) => t[0] === 'n')?.[1]
  const relayType = ev.tags.find((t) => t[0] === 'T')?.[1]
  const topics = ev.tags.filter((t) => t[0] === 't').map((t) => t[1]).filter(Boolean) as string[]

  return {
    url,
    supportedNips: [...new Set(nips)],
    requirements,
    rttOpenMs: rttOpen != null ? parseInt(rttOpen, 10) : undefined,
    rttReadMs: rttRead != null ? parseInt(rttRead, 10) : undefined,
    rttWriteMs: rttWrite != null ? parseInt(rttWrite, 10) : undefined,
    networkType,
    relayType,
    topics: topics.length ? topics : undefined,
    created_at: ev.created_at,
    monitorPubkey: ev.pubkey
  }
}

/** TTL for the IndexedDB cache of public lively relay list (7 days). */
const PUBLIC_LIVELY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** TTL for per-relay NIP-66 discovery cache (24h). After this, we refetch from network. */
const DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000

class Nip66Service {
  private static instance: Nip66Service
  /** Normalized relay URL -> latest discovery (we keep the most recent 30166 per relay). */
  private discoveryByUrl = new Map<string, TNip66RelayDiscovery>()

  static getInstance(): Nip66Service {
    if (!Nip66Service.instance) {
      Nip66Service.instance = new Nip66Service()
    }
    return Nip66Service.instance
  }

  private isDiscoveryStale(cachedAt: number): boolean {
    return Date.now() - cachedAt > DISCOVERY_CACHE_TTL_MS
  }

  /**
   * Ingest kind 30166 events (e.g. from a query). Merges supported NIPs from multiple
   * events for the same relay; keeps the most recent event's metadata, union of NIPs.
   * Updates the IndexedDB cache of public lively relays and per-relay discovery cache.
   */
  loadFromEvents(events: NEvent[]): void {
    const updatedKeys = new Set<string>()
    for (const ev of events) {
      const discovery = parseEvent(ev)
      if (!discovery) continue
      const key = normalizeUrl(discovery.url) || discovery.url
      const existing = this.discoveryByUrl.get(key)
      if (!existing) {
        this.discoveryByUrl.set(key, discovery)
        updatedKeys.add(key)
        continue
      }
      const mergedNips = [...new Set([...existing.supportedNips, ...discovery.supportedNips])]
      if (discovery.created_at >= existing.created_at) {
        this.discoveryByUrl.set(key, { ...discovery, supportedNips: mergedNips })
      } else {
        this.discoveryByUrl.set(key, { ...existing, supportedNips: mergedNips })
      }
      updatedKeys.add(key)
    }
    const publicLively = this.buildPublicLivelyFromDiscovery()
    if (publicLively.length > 0 && typeof window !== 'undefined') {
      indexDb.setPublicLivelyRelayUrlsCache(publicLively).catch(() => {})
    }
    if (typeof window !== 'undefined') {
      for (const key of updatedKeys) {
        const d = this.discoveryByUrl.get(key)
        if (d) indexDb.setNip66Discovery(key, d).catch(() => {})
      }
    }
  }

  /**
   * Get discovery for a relay from memory or IndexedDB cache (if not stale).
   * Use this to show UI immediately; then refetch if stale to update cache and GUI.
   */
  async getDiscoveryCached(relayUrl: string): Promise<TNip66RelayDiscovery | undefined> {
    const key = normalizeUrl(relayUrl) || relayUrl
    const fromMemory = this.discoveryByUrl.get(key)
    if (fromMemory) return fromMemory
    if (typeof window === 'undefined') return undefined
    try {
      const cached = await indexDb.getNip66Discovery(key)
      if (!cached?.discovery || this.isDiscoveryStale(cached.cachedAt)) return undefined
      this.discoveryByUrl.set(key, cached.discovery)
      return cached.discovery
    } catch {
      return undefined
    }
  }

  /**
   * True if we should refetch discovery (no cache or IDB cache is stale).
   * Uses IDB only (not memory), so we refetch when cached data is past TTL.
   */
  async isDiscoveryStaleForRelay(relayUrl: string): Promise<boolean> {
    const key = normalizeUrl(relayUrl) || relayUrl
    try {
      const cached = await indexDb.getNip66Discovery(key)
      return !cached || this.isDiscoveryStale(cached.cachedAt)
    } catch {
      return true
    }
  }

  /**
   * Build list of relay URLs that are public (no auth, no payment) and have been
   * reported by NIP-66 monitors (lively). Used for random publish relays (censorship resilience).
   * Relays with a sane monitor `rtt-write` measurement are shuffled first — more likely to accept EVENT.
   */
  private buildPublicLivelyFromDiscovery(): string[] {
    const eligible: TNip66RelayDiscovery[] = []
    for (const d of this.discoveryByUrl.values()) {
      const authRequired = d.requirements.auth === true
      const paymentRequired = d.requirements.payment === true
      if (!authRequired && !paymentRequired) eligible.push(d)
    }
    const shuffleInPlace = <T>(arr: T[]) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
      }
      return arr
    }
    /** Monitor recorded write RTT — indicates write path was exercised recently */
    const writeProven = eligible.filter(
      (d) => d.rttWriteMs != null && d.rttWriteMs > 0 && d.rttWriteMs < 120_000
    )
    const rest = eligible.filter(
      (d) => !(d.rttWriteMs != null && d.rttWriteMs > 0 && d.rttWriteMs < 120_000)
    )
    shuffleInPlace(writeProven)
    shuffleInPlace(rest)
    return [...writeProven, ...rest].map((d) => d.url)
  }

  /**
   * Returns relay URLs from NIP-66 discovery (in-memory then IndexedDB cache).
   * Returns empty array when no monitoring list is available (caller may fallback to other relay lists).
   */
  async getPublicLivelyRelayUrls(): Promise<string[]> {
    const fromMemory = this.buildPublicLivelyFromDiscovery()
    if (fromMemory.length > 0) return fromMemory
    if (typeof window === 'undefined') return []
    try {
      const cached = await indexDb.getPublicLivelyRelayUrlsCache()
      if (cached?.urls?.length && (Date.now() - cached.cachedAt) < PUBLIC_LIVELY_CACHE_TTL_MS) {
        return cached.urls
      }
    } catch {
      // ignore
    }
    return []
  }

  getDiscovery(url: string): TNip66RelayDiscovery | undefined {
    const key = normalizeUrl(url) || url
    return this.discoveryByUrl.get(key)
  }

  /** Relay URLs that NIP-66 reports as supporting NIP-50 (search). Do not rely solely on this. */
  getSearchableRelayUrls(): string[] {
    const out: string[] = []
    for (const d of this.discoveryByUrl.values()) {
      if (d.supportedNips.includes(50)) out.push(d.url)
    }
    return out
  }

  /** True if we have a 30166 for this relay that lists NIP 50. Fall back to static list / NIP-11 when false. */
  isRelaySearchable(url: string): boolean {
    const d = this.getDiscovery(url)
    return d?.supportedNips.includes(50) ?? false
  }
}

export const nip66Service = Nip66Service.getInstance()
export default nip66Service
