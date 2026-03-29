import logger from '@/lib/logger'
import { publicationCoordinateLookupKeys } from '@/lib/publication-coordinate'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { normalizeUrl } from '@/lib/url'
import client, { queryService } from '@/services/client.service'
import type { Event, Filter } from 'nostr-tools'
import { nip19 } from 'nostr-tools'

/** Parsed a/e reference from publication index tags (same shape as PublicationIndex uses). */
export type PublicationSectionRef = {
  type: 'a' | 'e'
  coordinate?: string
  eventId?: string
  kind?: number
  pubkey?: string
  identifier?: string
  relay?: string
}

export function publicationRefKey(ref: PublicationSectionRef): string {
  return (ref.coordinate || ref.eventId || '').trim()
}

/**
 * Parse NIP-33 `a` coordinate `kind:64-hex-pubkey:d-identifier` where `d` may contain `:`.
 * Returns a canonical coordinate with lowercase pubkey for cache / REQ / matching.
 */
export function parsePublicationATagCoordinate(raw: string): {
  kind: number
  pubkey: string
  identifier: string
  coordinate: string
} | null {
  const trimmed = raw.trim()
  const i0 = trimmed.indexOf(':')
  const i1 = trimmed.indexOf(':', i0 + 1)
  if (i0 < 1 || i1 <= i0 + 1) return null
  const kindStr = trimmed.slice(0, i0)
  const pubkeyRaw = trimmed.slice(i0 + 1, i1)
  const identifier = trimmed.slice(i1 + 1)
  const kind = parseInt(kindStr, 10)
  if (Number.isNaN(kind) || !/^[0-9a-fA-F]{64}$/.test(pubkeyRaw)) return null
  const pubkey = pubkeyRaw.toLowerCase()
  return {
    kind,
    pubkey,
    identifier,
    coordinate: `${kind}:${pubkey}:${identifier}`
  }
}

export function resolvePublicationEventIdToHex(eventId: string): string | undefined {
  if (!eventId) return undefined
  const trimmed = eventId.trim()
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase()
  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'note') return decoded.data
    if (decoded.type === 'nevent') return decoded.data.id
  } catch {
    /* ignore */
  }
  return undefined
}

function collectRelayHints(refs: PublicationSectionRef[]): string[] {
  const out: string[] = []
  for (const r of refs) {
    const h = r.relay?.trim()
    if (h && (h.startsWith('wss://') || h.startsWith('ws://'))) {
      const n = normalizeUrl(h) || h
      out.push(n)
    }
  }
  return out
}

/**
 * Focused relay set for publication sections: hints + author + user + profile/fast read, capped.
 * Omits full SEARCHABLE list to avoid opening dozens of relays per publication.
 */
export async function buildPublicationSectionRelayUrls(
  indexEvent: Event,
  refs: PublicationSectionRef[],
  maxRelays = 22
): Promise<string[]> {
  const hints = collectRelayHints(refs)
  const urls = await buildComprehensiveRelayList({
    authorPubkey: indexEvent.pubkey,
    userPubkey: client.pubkey || undefined,
    relayHints: hints,
    includeUserOwnRelays: true,
    includeProfileFetchRelays: true,
    includeFastReadRelays: true,
    includeSearchableRelays: false,
    includeFavoriteRelays: true,
    includeLocalRelays: true
  })
  return urls.slice(0, maxRelays)
}

const IDS_CHUNK = 44
const D_TAGS_CHUNK = 28

function coordinateFromEvent(ev: Event): string {
  const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  return `${ev.kind}:${ev.pubkey.toLowerCase()}:${d}`
}

/**
 * One batched query: chunk `ids` filters and grouped `authors + kinds + #d` filters.
 * Caller should hydrate from IndexedDB first. Keys are {@link publicationRefKey}.
 */
export async function batchFetchPublicationSectionEvents(
  refs: PublicationSectionRef[],
  relayUrls: string[]
): Promise<Map<string, Event>> {
  const out = new Map<string, Event>()
  if (refs.length === 0 || relayUrls.length === 0) return out

  const idRefs: PublicationSectionRef[] = []
  const hexByKey = new Map<string, string>()
  for (const r of refs) {
    if (r.type !== 'e' || !r.eventId) continue
    const key = publicationRefKey(r)
    if (!key) continue
    const hex = resolvePublicationEventIdToHex(r.eventId)
    if (hex) {
      idRefs.push(r)
      hexByKey.set(key, hex)
    }
  }

  const aRefs = refs.filter((r) => r.type === 'a' && r.coordinate && r.pubkey && r.kind != null)
  const aGroups = new Map<string, { pubkey: string; kind: number; dTags: string[] }>()
  for (const r of aRefs) {
    const idf = r.identifier ?? r.coordinate!.split(':').slice(2).join(':')
    if (!idf) continue
    const gk = `${r.pubkey}:${r.kind}`
    let g = aGroups.get(gk)
    if (!g) {
      g = { pubkey: r.pubkey!, kind: r.kind!, dTags: [] }
      aGroups.set(gk, g)
    }
    g.dTags.push(idf)
  }

  const filters: Filter[] = []

  const hexList = [...new Set([...hexByKey.values()])].filter((id) => /^[0-9a-f]{64}$/.test(id))
  for (let i = 0; i < hexList.length; i += IDS_CHUNK) {
    const chunk = hexList.slice(i, i + IDS_CHUNK)
    filters.push({ ids: chunk, limit: chunk.length })
  }

  for (const g of aGroups.values()) {
    const uniqueD = [...new Set(g.dTags)]
    for (let i = 0; i < uniqueD.length; i += D_TAGS_CHUNK) {
      const dChunk = uniqueD.slice(i, i + D_TAGS_CHUNK)
      filters.push({
        authors: [g.pubkey.toLowerCase()],
        kinds: [g.kind],
        '#d': dChunk,
        limit: dChunk.length
      })
    }
  }

  if (filters.length === 0) {
    if (import.meta.env.DEV) {
      logger.info('[PublicationSection] batch_fetch_skip — no filters', {
        aRefCount: aRefs.length,
        idRefCount: idRefs.length
      })
    }
    return out
  }

  let events: Event[] = []
  try {
    events = await queryService.fetchEvents(relayUrls, filters, {
      globalTimeout: 14_000,
      eoseTimeout: 2_500,
      /** Do not early-resolve after the first event; this query must wait for the full batch. */
      firstRelayResultGraceMs: false
    })
  } catch (err) {
    if (import.meta.env.DEV) {
      logger.warn('[PublicationSection] batch_fetch_error', {
        message: err instanceof Error ? err.message : String(err),
        filterCount: filters.length,
        relayCount: relayUrls.length
      })
    }
    return out
  }

  const byId = new Map<string, Event>()
  const byCoord = new Map<string, Event>()
  for (const ev of events) {
    byId.set(ev.id.toLowerCase(), ev)
    const d = ev.tags.find((t) => t[0] === 'd')?.[1]
    if (d !== undefined && d !== '') {
      const base = coordinateFromEvent(ev)
      for (const k of publicationCoordinateLookupKeys(base)) {
        if (!byCoord.has(k)) byCoord.set(k, ev)
      }
    }
  }

  for (const r of idRefs) {
    const key = publicationRefKey(r)
    const hex = hexByKey.get(key)
    if (!hex) continue
    const ev = byId.get(hex.toLowerCase())
    if (ev) out.set(key, ev)
  }

  for (const r of aRefs) {
    const key = publicationRefKey(r)
    const coord = r.coordinate!
    let ev: Event | undefined
    for (const k of publicationCoordinateLookupKeys(coord)) {
      ev = byCoord.get(k)
      if (ev) break
    }
    if (ev) out.set(key, ev)
  }

  if (import.meta.env.DEV) {
    const unmatchedA = aRefs.filter((r) => !out.has(publicationRefKey(r)))
    const unmatchedE = idRefs.filter((r) => !out.has(publicationRefKey(r)))
    logger.info('[PublicationSection] batch_fetch_result', {
      relayCount: relayUrls.length,
      filterCount: filters.length,
      eventsReturned: events.length,
      byCoordSize: byCoord.size,
      resolved: out.size,
      unmatchedACount: unmatchedA.length,
      unmatchedECount: unmatchedE.length,
      unmatchedAKeys: unmatchedA.map((r) => publicationRefKey(r)).slice(0, 12),
      sampleEventCoords: events.slice(0, 3).map((ev) => {
        const d = ev.tags.find((t) => t[0] === 'd')?.[1]
        return d !== undefined && d !== '' ? coordinateFromEvent(ev) : `${ev.kind}:${ev.pubkey.slice(0, 8)}…`
      })
    })
  }

  return out
}
