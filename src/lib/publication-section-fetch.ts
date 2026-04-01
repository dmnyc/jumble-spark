import logger from '@/lib/logger'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { publicationCoordinateLookupKeys, splitPublicationCoordinate } from '@/lib/publication-coordinate'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { normalizeUrl } from '@/lib/url'
import client, { queryService } from '@/services/client.service'
import type { Event, Filter } from 'nostr-tools'
import { nip19 } from 'nostr-tools'

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

export function parsePublicationATagCoordinate(raw: string): {
  kind: number
  pubkey: string
  identifier: string
  coordinate: string
} | null {
  const parsed = splitPublicationCoordinate(raw)
  if (!parsed) return null
  return {
    kind: parsed.kind,
    pubkey: parsed.pubkey,
    identifier: parsed.d,
    coordinate: `${parsed.kind}:${parsed.pubkey}:${parsed.d}`
  }
}

export function resolvePublicationEventIdToHex(eventId: string): string | undefined {
  const trimmed = eventId.trim()
  if (!trimmed) return undefined
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase()
  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'note') return decoded.data
    if (decoded.type === 'nevent') return decoded.data.id
  } catch {
    // ignore malformed bech32 ids
  }
  return undefined
}

function collectRelayHints(refs: PublicationSectionRef[]): string[] {
  const out: string[] = []
  for (const ref of refs) {
    const relay = ref.relay?.trim()
    if (!relay) continue
    if (!relay.startsWith('wss://') && !relay.startsWith('ws://')) continue
    const normalized = normalizeUrl(relay) || relay
    out.push(normalized)
  }
  return [...new Set(out)]
}

export async function buildPublicationSectionRelayUrls(
  indexEvent: Event,
  refs: PublicationSectionRef[],
  maxRelays = 22,
  includeSearchableRelays = false
): Promise<string[]> {
  const hints = collectRelayHints(refs)
  const fastReadRelays = FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter((u) => !!u)
  const seenOnRelays = queryService
    .getSeenEventRelayUrls(indexEvent.id)
    .map((u) => normalizeUrl(u) || u)
    .filter((u) => !!u)
  const urls = await buildComprehensiveRelayList({
    authorPubkey: indexEvent.pubkey,
    userPubkey: client.pubkey || undefined,
    relayHints: [...hints, ...seenOnRelays],
    includeUserOwnRelays: true,
    includeProfileFetchRelays: true,
    includeFastReadRelays: true,
    includeSearchableRelays,
    includeFavoriteRelays: true,
    includeLocalRelays: true
  })
  // Keep fast-read relays pinned at the front so slicing can never drop them.
  const prioritized = [...new Set([...fastReadRelays, ...hints, ...seenOnRelays, ...urls])]
  if (import.meta.env.DEV) {
    logger.info('[PublicationSection] relay_urls_built', {
      indexId: indexEvent.id,
      includeSearchableRelays,
      fastReadCount: fastReadRelays.length,
      relayHintsCount: hints.length,
      seenOnRelaysCount: seenOnRelays.length,
      totalBeforeSlice: prioritized.length,
      maxRelays,
      hasAggr: prioritized.includes(normalizeUrl('wss://aggr.nostr.land') || 'wss://aggr.nostr.land'),
      hasTheCitadel: prioritized.includes(
        normalizeUrl('wss://thecitadel.nostr1.com') || 'wss://thecitadel.nostr1.com'
      )
    })
  }
  return prioritized.slice(0, maxRelays)
}

const IDS_CHUNK = 44
const D_CHUNK = 28
const ANY_KIND_LIMIT_PER_D = 12
const AUTHOR_KIND_SCAN_LIMIT = 200
const HINT_RELAY_AUTHOR_KIND_SCAN_LIMIT = 1200

function dTagOf(ev: Event): string | undefined {
  const d = ev.tags.find((t) => (t[0] || '').trim().toLowerCase() === 'd')?.[1]
  return d && d.length > 0 ? d : undefined
}

function coordinateOfEvent(ev: Event): string | null {
  const d = dTagOf(ev)
  if (!d) return null
  return `${ev.kind}:${ev.pubkey.toLowerCase()}:${d}`
}

export async function batchFetchPublicationSectionEvents(
  refs: PublicationSectionRef[],
  relayUrls: string[]
): Promise<Map<string, Event>> {
  const out = new Map<string, Event>()
  if (refs.length === 0 || relayUrls.length === 0) return out

  const eRefs: PublicationSectionRef[] = []
  const eHexByKey = new Map<string, string>()
  const aRefs = refs.filter((r) => r.type === 'a' && r.coordinate && r.pubkey && typeof r.kind === 'number')

  for (const ref of refs) {
    // Only explicit `e` refs are resolved by id. For `a` refs, tag[3] is historization metadata only.
    if (ref.type !== 'e' || !ref.eventId) continue
    const key = publicationRefKey(ref)
    const hex = resolvePublicationEventIdToHex(ref.eventId)
    if (!key || !hex) continue
    eRefs.push(ref)
    eHexByKey.set(key, hex)
  }

  const filters: Filter[] = []

  const ids = [...new Set([...eHexByKey.values()])]
  for (let i = 0; i < ids.length; i += IDS_CHUNK) {
    const chunk = ids.slice(i, i + IDS_CHUNK)
    filters.push({ ids: chunk, limit: chunk.length })
  }

  const groupedA = new Map<string, { pubkey: string; kind: number; dTags: string[] }>()
  for (const ref of aRefs) {
    const d = ref.identifier ?? ref.coordinate!.split(':').slice(2).join(':')
    if (!d) continue
    const gk = `${ref.pubkey}:${ref.kind}`
    let g = groupedA.get(gk)
    if (!g) {
      g = { pubkey: ref.pubkey!, kind: ref.kind!, dTags: [] }
      groupedA.set(gk, g)
    }
    g.dTags.push(d)
  }

  for (const g of groupedA.values()) {
    const uniqueD = [...new Set(g.dTags)]
    for (let i = 0; i < uniqueD.length; i += D_CHUNK) {
      const dChunk = uniqueD.slice(i, i + D_CHUNK)
      filters.push({
        authors: [g.pubkey.toLowerCase()],
        kinds: [g.kind],
        '#d': dChunk,
        limit: dChunk.length
      })
    }
  }

  if (import.meta.env.DEV) {
    logger.info('[PublicationSection] batch_filters_prepared', {
      relayCount: relayUrls.length,
      refCount: refs.length,
      aRefCount: aRefs.length,
      eRefCount: eRefs.length,
      filterCount: filters.length,
      filterPreview: filters.slice(0, 3).map((f) => ({
        ids: Array.isArray(f.ids) ? f.ids.length : 0,
        authors: Array.isArray(f.authors) ? f.authors.length : 0,
        kinds: Array.isArray(f.kinds) ? f.kinds : [],
        d: Array.isArray(f['#d']) ? f['#d'].slice(0, 4) : []
      }))
    })
  }

  let events: Event[] = []
  if (filters.length > 0) {
    try {
      events = await queryService.fetchEvents(relayUrls, filters, {
        globalTimeout: 12_000,
        eoseTimeout: 2_000,
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
    }
  }

  const byId = new Map<string, Event>()
  const byCoord = new Map<string, Event>()
  for (const ev of events) {
    byId.set(ev.id.toLowerCase(), ev)
    const coord = coordinateOfEvent(ev)
    if (!coord) continue
    for (const key of publicationCoordinateLookupKeys(coord)) {
      const prev = byCoord.get(key)
      if (!prev || ev.created_at > prev.created_at) byCoord.set(key, ev)
    }
  }

  for (const ref of eRefs) {
    const key = publicationRefKey(ref)
    const hex = eHexByKey.get(key)
    if (!hex) continue
    const ev = byId.get(hex)
    if (ev) out.set(key, ev)
  }

  for (const ref of aRefs) {
    const key = publicationRefKey(ref)
    if (out.has(key)) continue
    const coord = ref.coordinate!
    let ev: Event | undefined
    for (const k of publicationCoordinateLookupKeys(coord)) {
      ev = byCoord.get(k)
      if (ev) break
    }
    if (ev) out.set(key, ev)
  }

  // Relay-hint targeted pass for unresolved `a` refs.
  const unresolvedAfterBatch = aRefs.filter((r) => !out.has(publicationRefKey(r)))
  const byHintRelay = new Map<string, PublicationSectionRef[]>()
  for (const ref of unresolvedAfterBatch) {
    const relay = normalizeUrl(ref.relay || '') || ref.relay?.trim()
    if (!relay) continue
    const list = byHintRelay.get(relay)
    if (list) list.push(ref)
    else byHintRelay.set(relay, [ref])
  }

  for (const [relay, relayRefs] of byHintRelay) {
    const hintFilters: Filter[] = []
    const groups = new Map<string, { pubkey: string; kind: number; dTags: string[] }>()
    for (const ref of relayRefs) {
      const d = ref.identifier ?? ref.coordinate!.split(':').slice(2).join(':')
      if (!d) continue
      const gk = `${ref.pubkey}:${ref.kind}`
      let g = groups.get(gk)
      if (!g) {
        g = { pubkey: ref.pubkey!.toLowerCase(), kind: ref.kind!, dTags: [] }
        groups.set(gk, g)
      }
      g.dTags.push(d)
    }
    for (const g of groups.values()) {
      const uniqueD = [...new Set(g.dTags)]
      for (let i = 0; i < uniqueD.length; i += D_CHUNK) {
        const dChunk = uniqueD.slice(i, i + D_CHUNK)
        hintFilters.push({
          authors: [g.pubkey],
          kinds: [g.kind],
          '#d': dChunk,
          limit: dChunk.length
        })
      }
    }
    if (hintFilters.length === 0) continue
    if (import.meta.env.DEV) {
      logger.info('[PublicationSection] relay_hint_pass_start', {
        relay,
        refCount: relayRefs.length,
        filterCount: hintFilters.length,
        sampleKeys: relayRefs.map((r) => publicationRefKey(r)).slice(0, 6)
      })
    }
    try {
      const hintEvents = await queryService.fetchEvents([relay], hintFilters, {
        globalTimeout: 8_000,
        eoseTimeout: 1_500,
        firstRelayResultGraceMs: false
      })
      const hintByCoord = new Map<string, Event>()
      for (const ev of hintEvents) {
        const coord = coordinateOfEvent(ev)
        if (!coord) continue
        for (const key of publicationCoordinateLookupKeys(coord)) {
          const prev = hintByCoord.get(key)
          if (!prev || ev.created_at > prev.created_at) hintByCoord.set(key, ev)
        }
      }
      for (const ref of relayRefs) {
        const key = publicationRefKey(ref)
        if (out.has(key)) continue
        const coord = ref.coordinate!
        let ev: Event | undefined
        for (const k of publicationCoordinateLookupKeys(coord)) {
          ev = hintByCoord.get(k)
          if (ev) break
        }
        if (ev) out.set(key, ev)
      }
      if (import.meta.env.DEV) {
        const unresolvedAfterRelay = relayRefs
          .map((r) => publicationRefKey(r))
          .filter((k) => !out.has(k))
        logger.info('[PublicationSection] relay_hint_pass_done', {
          relay,
          eventsReturned: hintEvents.length,
          unresolvedAfterRelayCount: unresolvedAfterRelay.length,
          unresolvedAfterRelay: unresolvedAfterRelay.slice(0, 8)
        })
      }
    } catch {
      // ignore per-relay hint failures
      if (import.meta.env.DEV) {
        logger.warn('[PublicationSection] relay_hint_pass_error', { relay, filterCount: hintFilters.length })
      }
    }
  }

  // Secondary hint pass: some relays do not index `#d` reliably for 30040/30041.
  // For unresolved refs with an explicit relay hint, scan that same relay by author+kind
  // and resolve `d` client-side before doing broader multi-relay fallbacks.
  const unresolvedAfterHintPass = aRefs.filter((r) => !out.has(publicationRefKey(r)))
  const byHintRelayForScan = new Map<string, PublicationSectionRef[]>()
  for (const ref of unresolvedAfterHintPass) {
    const relay = normalizeUrl(ref.relay || '') || ref.relay?.trim()
    if (!relay) continue
    const list = byHintRelayForScan.get(relay)
    if (list) list.push(ref)
    else byHintRelayForScan.set(relay, [ref])
  }

  for (const [relay, relayRefs] of byHintRelayForScan) {
    const groups = new Map<string, { pubkey: string; kind: number }>()
    for (const ref of relayRefs) {
      const key = `${ref.pubkey!.toLowerCase()}:${ref.kind!}`
      if (!groups.has(key)) {
        groups.set(key, { pubkey: ref.pubkey!.toLowerCase(), kind: ref.kind! })
      }
    }
    const scanFilters: Filter[] = []
    for (const g of groups.values()) {
      scanFilters.push({
        authors: [g.pubkey],
        kinds: [g.kind],
        limit: HINT_RELAY_AUTHOR_KIND_SCAN_LIMIT
      })
    }
    if (scanFilters.length === 0) continue
    if (import.meta.env.DEV) {
      logger.info('[PublicationSection] relay_hint_author_kind_scan_start', {
        relay,
        refCount: relayRefs.length,
        filterCount: scanFilters.length
      })
    }
    try {
      const scanEvents = await queryService.fetchEvents([relay], scanFilters, {
        globalTimeout: 10_000,
        eoseTimeout: 1_500,
        firstRelayResultGraceMs: false
      })
      const scanByCoord = new Map<string, Event>()
      for (const ev of scanEvents) {
        const coord = coordinateOfEvent(ev)
        if (!coord) continue
        for (const k of publicationCoordinateLookupKeys(coord)) {
          const prev = scanByCoord.get(k)
          if (!prev || ev.created_at > prev.created_at) scanByCoord.set(k, ev)
        }
      }
      for (const ref of relayRefs) {
        const key = publicationRefKey(ref)
        if (out.has(key)) continue
        const coord = ref.coordinate!
        let ev: Event | undefined
        for (const lk of publicationCoordinateLookupKeys(coord)) {
          ev = scanByCoord.get(lk)
          if (ev) break
        }
        if (ev) out.set(key, ev)
      }
      if (import.meta.env.DEV) {
        logger.info('[PublicationSection] relay_hint_author_kind_scan_done', {
          relay,
          eventsReturned: scanEvents.length,
          unresolvedAfterScan: relayRefs
            .map((r) => publicationRefKey(r))
            .filter((k) => !out.has(k))
            .slice(0, 8)
        })
      }
    } catch {
      if (import.meta.env.DEV) {
        logger.warn('[PublicationSection] relay_hint_author_kind_scan_error', {
          relay,
          filterCount: scanFilters.length
        })
      }
    }
  }

  // Last fallback: author + #d across any kind.
  const unresolvedAfterHint = aRefs.filter((r) => !out.has(publicationRefKey(r)))
  if (unresolvedAfterHint.length > 0) {
    const fallbackFilters: Filter[] = []
    const groups = new Map<string, { pubkey: string; dTags: string[] }>()
    for (const ref of unresolvedAfterHint) {
      const d = ref.identifier ?? ref.coordinate!.split(':').slice(2).join(':')
      if (!d) continue
      const pk = ref.pubkey!.toLowerCase()
      let g = groups.get(pk)
      if (!g) {
        g = { pubkey: pk, dTags: [] }
        groups.set(pk, g)
      }
      g.dTags.push(d)
    }
    for (const g of groups.values()) {
      const uniqueD = [...new Set(g.dTags)]
      for (let i = 0; i < uniqueD.length; i += D_CHUNK) {
        const dChunk = uniqueD.slice(i, i + D_CHUNK)
        fallbackFilters.push({
          authors: [g.pubkey],
          '#d': dChunk,
          limit: dChunk.length * ANY_KIND_LIMIT_PER_D
        })
      }
    }
    if (fallbackFilters.length > 0) {
      if (import.meta.env.DEV) {
        logger.info('[PublicationSection] any_kind_fallback_start', {
          relayCount: relayUrls.length,
          filterCount: fallbackFilters.length,
          unresolvedBefore: unresolvedAfterHint.map((r) => publicationRefKey(r)).slice(0, 12)
        })
      }
      try {
        const fallbackEvents = await queryService.fetchEvents(relayUrls, fallbackFilters, {
          globalTimeout: 10_000,
          eoseTimeout: 2_000,
          firstRelayResultGraceMs: false
        })
        const byAuthorD = new Map<string, Event[]>()
        for (const ev of fallbackEvents) {
          const d = dTagOf(ev)
          if (!d) continue
          const k = `${ev.pubkey.toLowerCase()}:${d}`
          const arr = byAuthorD.get(k)
          if (arr) arr.push(ev)
          else byAuthorD.set(k, [ev])
        }
        for (const ref of unresolvedAfterHint) {
          const key = publicationRefKey(ref)
          if (out.has(key)) continue
          const d = ref.identifier ?? ref.coordinate!.split(':').slice(2).join(':')
          const candidates = byAuthorD.get(`${ref.pubkey!.toLowerCase()}:${d}`)
          if (!candidates || candidates.length === 0) continue
          const preferred = candidates.filter((ev) => ev.kind === ref.kind)
          const src = preferred.length > 0 ? preferred : candidates
          let newest = src[0]
          for (let i = 1; i < src.length; i++) {
            if (src[i].created_at > newest.created_at) newest = src[i]
          }
          out.set(key, newest)
        }
        if (import.meta.env.DEV) {
          const unresolvedAfterAnyKind = unresolvedAfterHint
            .map((r) => publicationRefKey(r))
            .filter((k) => !out.has(k))
          logger.info('[PublicationSection] any_kind_fallback_done', {
            eventsReturned: fallbackEvents.length,
            unresolvedAfterAnyKindCount: unresolvedAfterAnyKind.length,
            unresolvedAfterAnyKind: unresolvedAfterAnyKind.slice(0, 10)
          })
        }
      } catch {
        // ignore fallback errors
        if (import.meta.env.DEV) {
          logger.warn('[PublicationSection] any_kind_fallback_error', { filterCount: fallbackFilters.length })
        }
      }
    }
  }

  // Final robust fallback for relays that do not properly index `#d`:
  // scan author + kind and match d-tag client-side.
  const unresolvedAfterAll = aRefs.filter((r) => !out.has(publicationRefKey(r)))
  if (unresolvedAfterAll.length > 0) {
    const scanFilters: Filter[] = []
    const scanGroups = new Map<string, { pubkey: string; kind: number }>()
    for (const ref of unresolvedAfterAll) {
      const key = `${ref.pubkey!.toLowerCase()}:${ref.kind!}`
      if (!scanGroups.has(key)) {
        scanGroups.set(key, { pubkey: ref.pubkey!.toLowerCase(), kind: ref.kind! })
      }
    }
    for (const g of scanGroups.values()) {
      scanFilters.push({
        authors: [g.pubkey],
        kinds: [g.kind],
        limit: AUTHOR_KIND_SCAN_LIMIT
      })
    }
    if (scanFilters.length > 0) {
      if (import.meta.env.DEV) {
        logger.info('[PublicationSection] author_kind_scan_start', {
          filterCount: scanFilters.length,
          relayCount: relayUrls.length,
          unresolvedCount: unresolvedAfterAll.length,
          unresolvedKeys: unresolvedAfterAll.map((r) => publicationRefKey(r)).slice(0, 10)
        })
      }
      try {
        const scanEvents = await queryService.fetchEvents(relayUrls, scanFilters, {
          globalTimeout: 12_000,
          eoseTimeout: 2_000,
          firstRelayResultGraceMs: false
        })
        const scanByCoord = new Map<string, Event>()
        for (const ev of scanEvents) {
          const coord = coordinateOfEvent(ev)
          if (!coord) continue
          for (const k of publicationCoordinateLookupKeys(coord)) {
            const prev = scanByCoord.get(k)
            if (!prev || ev.created_at > prev.created_at) scanByCoord.set(k, ev)
          }
        }
        for (const ref of unresolvedAfterAll) {
          const key = publicationRefKey(ref)
          if (out.has(key)) continue
          const coord = ref.coordinate!
          let ev: Event | undefined
          for (const lk of publicationCoordinateLookupKeys(coord)) {
            ev = scanByCoord.get(lk)
            if (ev) break
          }
          if (ev) out.set(key, ev)
        }
        if (import.meta.env.DEV) {
          const unresolvedAfterScan = unresolvedAfterAll
            .map((r) => publicationRefKey(r))
            .filter((k) => !out.has(k))
          logger.info('[PublicationSection] author_kind_scan_done', {
            eventsReturned: scanEvents.length,
            resolvedTotal: out.size,
            unresolvedAfterScanCount: unresolvedAfterScan.length,
            unresolvedAfterScan: unresolvedAfterScan.slice(0, 10)
          })
        }
      } catch {
        if (import.meta.env.DEV) {
          logger.warn('[PublicationSection] author_kind_scan_error', {
            filterCount: scanFilters.length
          })
        }
      }
    }
  }

  if (import.meta.env.DEV) {
    const unmatchedA = aRefs.filter((r) => !out.has(publicationRefKey(r)))
    const unmatchedE = eRefs.filter((r) => !out.has(publicationRefKey(r)))
    const sampleEvents = events.slice(0, 8).map((ev) => ({
      id: ev.id,
      kind: ev.kind,
      pubkey: ev.pubkey.slice(0, 12),
      created_at: ev.created_at,
      tagNames: ev.tags.slice(0, 8).map((t) => String(t[0] || '')),
      dTag: dTagOf(ev)
    }))
    logger.info('[PublicationSection] batch_fetch_result', {
      relayCount: relayUrls.length,
      filterCount: filters.length,
      eventsReturned: events.length,
      byCoordSize: byCoord.size,
      resolved: out.size,
      unmatchedACount: unmatchedA.length,
      unmatchedECount: unmatchedE.length,
      unmatchedAKeys: unmatchedA.map((r) => publicationRefKey(r)).slice(0, 12),
      sampleEvents
    })
  }

  return out
}
