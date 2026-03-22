import {
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  KIND_1_BLOCKED_RELAY_URLS,
  MAX_PUBLISH_RELAYS,
  MAX_REQ_RELAY_URLS
} from '@/constants'
import { isLocalNetworkUrl, normalizeUrl } from '@/lib/url'

export { MAX_REQ_RELAY_URLS }

export function dedupeNormalizeRelayUrlsOrdered(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const n = normalizeUrl(u) || u
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/** LAN / local host relays first, then the rest; deduped. */
export function relayUrlsLocalsFirst(urls: string[]): string[] {
  const local: string[] = []
  const remote: string[] = []
  for (const u of urls) {
    const n = normalizeUrl(u) || u
    if (!n) continue
    if (isLocalNetworkUrl(n)) local.push(n)
    else remote.push(n)
  }
  return dedupeNormalizeRelayUrlsOrdered([...local, ...remote])
}

function blockedNormSet(blockedRelays: string[] | undefined): Set<string> {
  return new Set((blockedRelays ?? []).map((b) => normalizeUrl(b) || b).filter(Boolean))
}

let kind1BlockedNormCache: Set<string> | undefined
function kind1BlockedNormSet(): Set<string> {
  if (!kind1BlockedNormCache) {
    kind1BlockedNormCache = new Set(
      KIND_1_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean)
    )
  }
  return kind1BlockedNormCache
}

export type MergeRelayPriorityLayersOptions = {
  /** When true, drop {@link KIND_1_BLOCKED_RELAY_URLS} before applying the max cap. */
  applyKind1BlockedFilter?: boolean
}

/**
 * Merge priority layers in order; first occurrence wins; skip blocked (and optional kind-1 block list); stop at `max`.
 */
export function mergeRelayPriorityLayers(
  layers: string[][],
  blockedRelays: string[] | undefined,
  max: number,
  mergeOpts?: MergeRelayPriorityLayersOptions
): string[] {
  const blocked = blockedNormSet(blockedRelays)
  const k1 = mergeOpts?.applyKind1BlockedFilter ? kind1BlockedNormSet() : new Set<string>()
  const seen = new Set<string>()
  const out: string[] = []
  for (const layer of layers) {
    for (const u of layer) {
      const n = normalizeUrl(u) || u
      if (!n || blocked.has(n) || k1.has(n) || seen.has(n)) continue
      seen.add(n)
      out.push(n)
      if (out.length >= max) return out
    }
  }
  return out
}

const normFastRead = (): string[] =>
  dedupeNormalizeRelayUrlsOrdered(
    FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
  )

const normFastWrite = (): string[] =>
  dedupeNormalizeRelayUrlsOrdered(
    FAST_WRITE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
  )

/**
 * Ordered layers for REQ / read (before merge, dedupe, blocked strip, kind-1 strip, cap).
 */
export function buildReadRelayPriorityLayers(opts: {
  userReadRelays: string[]
  userWriteRelays?: string[]
  authorWriteRelays?: string[]
  favoriteRelays: string[]
}): string[][] {
  const userWrite = opts.userWriteRelays ?? []
  const writeLocals = userWrite.filter((u) => isLocalNetworkUrl(normalizeUrl(u) || u))
  const userReadOrdered = relayUrlsLocalsFirst(opts.userReadRelays)
  const tier1 = dedupeNormalizeRelayUrlsOrdered([...writeLocals, ...userReadOrdered])
  const tier2 = dedupeNormalizeRelayUrlsOrdered(opts.authorWriteRelays ?? [])
  const tier3 = dedupeNormalizeRelayUrlsOrdered(opts.favoriteRelays ?? [])
  const tier4 = normFastRead()
  return [tier1, tier2, tier3, tier4]
}

/**
 * REQ / read: user inboxes (locals first) + user local outboxes → author outboxes → favorites → FAST_READ.
 * Blocked and (optionally) kind-1-blocked relays are removed before slicing to `maxRelays`.
 */
export function buildPrioritizedReadRelayUrls(opts: {
  userReadRelays: string[]
  userWriteRelays?: string[]
  authorWriteRelays?: string[]
  favoriteRelays: string[]
  blockedRelays?: string[]
  maxRelays?: number
  /** Default true: strip {@link KIND_1_BLOCKED_RELAY_URLS} (kind-1-heavy timelines). Set false for non–kind-1 queries. */
  applyKind1BlockedFilter?: boolean
}): string[] {
  const max = opts.maxRelays ?? MAX_REQ_RELAY_URLS
  const applyK1 = opts.applyKind1BlockedFilter !== false
  const layers = buildReadRelayPriorityLayers({
    userReadRelays: opts.userReadRelays,
    userWriteRelays: opts.userWriteRelays,
    authorWriteRelays: opts.authorWriteRelays,
    favoriteRelays: opts.favoriteRelays
  })
  return mergeRelayPriorityLayers(layers, opts.blockedRelays, max, {
    applyKind1BlockedFilter: applyK1
  })
}

/**
 * Ordered layers for publish / write (before merge, blocked strip, kind-1 strip, cap).
 */
export function buildWriteRelayPriorityLayers(opts: {
  userWriteRelays: string[]
  authorReadRelays?: string[]
  favoriteRelays?: string[]
  extraRelays?: string[]
}): string[][] {
  const tier1 = relayUrlsLocalsFirst(opts.userWriteRelays)
  const tier2 = dedupeNormalizeRelayUrlsOrdered(opts.authorReadRelays ?? [])
  const tier3 = dedupeNormalizeRelayUrlsOrdered(opts.favoriteRelays ?? [])
  const tier4 = dedupeNormalizeRelayUrlsOrdered(opts.extraRelays ?? [])
  const tier5 = normFastWrite()
  const tier6 = normFastRead()
  return [tier1, tier2, tier3, tier4, tier5, tier6]
}

/**
 * Publish / write: user outboxes (locals first) → target author inboxes → favorites → extras → FAST_WRITE → FAST_READ.
 */
export function buildPrioritizedWriteRelayUrls(opts: {
  userWriteRelays: string[]
  authorReadRelays?: string[]
  favoriteRelays?: string[]
  extraRelays?: string[]
  blockedRelays?: string[]
  maxRelays?: number
  /** When true, strip {@link KIND_1_BLOCKED_RELAY_URLS} before capping (kind 1 notes). */
  applyKind1BlockedFilter?: boolean
}): string[] {
  const max = opts.maxRelays ?? MAX_PUBLISH_RELAYS
  const layers = buildWriteRelayPriorityLayers({
    userWriteRelays: opts.userWriteRelays,
    authorReadRelays: opts.authorReadRelays,
    favoriteRelays: opts.favoriteRelays,
    extraRelays: opts.extraRelays
  })
  return mergeRelayPriorityLayers(layers, opts.blockedRelays, max, {
    applyKind1BlockedFilter: opts.applyKind1BlockedFilter === true
  })
}
