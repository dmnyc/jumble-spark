import { FAST_READ_RELAY_URLS } from '@/constants'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import {
  dedupeNormalizeRelayUrlsOrdered,
  MAX_REQ_RELAY_URLS,
  mergeRelayPriorityLayers,
  relayUrlsLocalsFirst
} from '@/lib/relay-url-priority'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { nip19, type Event, type Filter } from 'nostr-tools'

/** [zap.stream](https://github.com/v0l/zap.stream) resolves `/:naddr` (NIP-19) for NIP-53 streams — no separate public API needed for “open in player”. */
const ZAP_STREAM_ORIGIN = 'https://zap.stream'

/** [Nostr Nests](https://nostrnests.com/) web app loads rooms at `/:naddr` (same pattern as their share modal). */
const NOSTR_NESTS_WEB_ORIGIN = 'https://nostrnests.com'

/**
 * [Corny Chat](https://github.com/vicariousdrama/cornychat) labels NIP-53 tickers with `L`/`com.cornychat` and serves
 * `naddr1…` (and other bech32) at `/_/integrations/nostr/<bech32>` on each instance origin (`ui/server/app.js`).
 */
const CORNYCHAT_LABEL_NAMESPACE = 'com.cornychat'

const EMPTY_PARENT_MAP = new Map<string, Event>()

/** Max extra REQ filters when resolving 30312 parents for 30313 meetings (relay limits). */
export const LIVE_ACTIVITIES_MAX_PARENT_FETCH = 32

export type LiveActivitiesFetchEventsFn = (
  urls: string[],
  filter: Filter | Filter[],
  opts?: { eoseTimeout?: number; globalTimeout?: number; replaceableRace?: boolean; immediateReturn?: boolean }
) => Promise<Event[]>

/** NIP-53 live streaming (30311), meeting space (30312), meeting (30313). */
export const LIVE_ACTIVITY_KINDS = [30311, 30312, 30313] as const

export const LIVE_ACTIVITIES_MAX_ITEMS = 10

export const LIVE_ACTIVITIES_SLIDE_INTERVAL_MS = 15_000

export type TLiveActivityItem = {
  address: string
  kind: number
  pubkey: string
  dTag: string
  title: string
  summary: string
  imageUrl: string | undefined
  joinUrl: string
  updatedAt: number
  fromFollowedHost: boolean
}

function firstTagValue(ev: Event, name: string): string | undefined {
  for (const t of ev.tags) {
    if (t[0] === name && t[1]) return t[1]
  }
  return undefined
}

function parseOptionalUnixTag(ev: Event, name: string): number | undefined {
  const v = firstTagValue(ev, name)
  if (v === undefined) return undefined
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n)) return undefined
  return n
}

/** True when `ends` is in the past (NIP-53 scheduled window). */
function isPastScheduledEndsTag(ev: Event, nowSec: number): boolean {
  const ends = parseOptionalUnixTag(ev, 'ends')
  if (ends === undefined) return false
  return nowSec > ends
}

/** Hide ticker entries that are explicitly ended or past `ends`; `live` is often stale. */
function isNip53TickerExpired(ev: Event, nowSec: number): boolean {
  const st = firstTagValue(ev, 'status')?.toLowerCase()
  if (st === 'ended') return true
  if (ev.kind === 30311 || ev.kind === 30313) {
    if (isPastScheduledEndsTag(ev, nowSec)) return true
  }
  return false
}

/** HLS/DASH manifests and similar — opening in a tab usually triggers a download, not a join page. */
function isLikelyRawStreamManifestUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return (
      path.endsWith('.m3u8') ||
      path.endsWith('.m3u') ||
      path.endsWith('.mpd') ||
      path.endsWith('.pls')
    )
  } catch {
    return false
  }
}

function relayHintsFromEvent(ev: Event): string[] | undefined {
  const out: string[] = []
  for (const t of ev.tags) {
    if (t[0] !== 'relays') continue
    for (let i = 1; i < t.length; i++) {
      const u = t[i]?.trim()
      if (u) out.push(u)
    }
  }
  return out.length > 0 ? out.slice(0, 8) : undefined
}

/** Bare `naddr1…` or zap.stream path → canonical https URL (matches zap.stream router `/:id`). */
function normalizeTaggedJoinCandidate(raw: string): string | undefined {
  const t = raw.trim()
  if (!t) return undefined
  if (t.startsWith('naddr1') && t.length >= 16) {
    return `${ZAP_STREAM_ORIGIN}/${t}`
  }
  if (t.startsWith('https://zap.stream/')) return t
  if (t.startsWith('http://zap.stream/')) {
    return `https://zap.stream/${t.slice('http://zap.stream/'.length)}`
  }
  if (t.startsWith('https://')) return t
  return undefined
}

function naddrPageUrlForAddressable(ev: Event, origin: string): string | undefined {
  const d = firstTagValue(ev, 'd')
  if (!d) return undefined
  try {
    const relays = relayHintsFromEvent(ev)
    const naddr = nip19.naddrEncode({
      kind: ev.kind,
      pubkey: ev.pubkey,
      identifier: d,
      relays: relays?.length ? relays : undefined
    })
    return `${origin}/${naddr}`
  } catch {
    return undefined
  }
}

/** NIP-19 naddr for this addressable event → `https://zap.stream/naddr1…` (live player page). */
function zapStreamUrlForAddressable(ev: Event): string | undefined {
  return naddrPageUrlForAddressable(ev, ZAP_STREAM_ORIGIN)
}

/**
 * Official Nostr Nests ([nostrnests/nests](https://github.com/nostrnests/nests)) rooms tag MoQ relay + moq-auth;
 * `streaming` is not a browser join URL — prefer the web app naddr route.
 */
function isNostrNestsOfficialMoq30312(ev: Event): boolean {
  if (ev.kind !== 30312) return false
  const auth = firstTagValue(ev, 'auth') ?? ''
  if (auth.includes('moq-auth.nostrnests.com')) return true
  const stream = firstTagValue(ev, 'streaming') ?? ''
  try {
    const host = new URL(stream).hostname.toLowerCase()
    return host === 'moq.nostrnests.com'
  } catch {
    return stream.includes('moq.nostrnests.com')
  }
}

function nostrNestsWebUrlForAddressable(ev: Event): string | undefined {
  return naddrPageUrlForAddressable(ev, NOSTR_NESTS_WEB_ORIGIN)
}

function firstHttpsJoinFromTagNames(ev: Event, names: readonly string[]): string | undefined {
  for (const name of names) {
    const raw = firstTagValue(ev, name)
    if (!raw?.trim()) continue
    const url = normalizeTaggedJoinCandidate(raw.trim())
    if (!url?.startsWith('https://')) continue
    if (isLikelyRawStreamManifestUrl(url)) continue
    return url
  }
  return undefined
}

/** NIP-53 30311 live ticker published by [Corny Chat](https://github.com/vicariousdrama/cornychat) (`L` label namespace). */
function isCornyChat30311(ev: Event): boolean {
  if (ev.kind !== 30311) return false
  for (const t of ev.tags) {
    if (t[0] === 'L' && t[1] === CORNYCHAT_LABEL_NAMESPACE) return true
  }
  return false
}

/**
 * `l` tag value `jamHost` from Corny pantry (`['l', jamHost, 'com.cornychat']`), when present.
 * Used to ensure `r`/`service` URLs belong to the same instance before building an integration link.
 */
function cornyChatJamHost(ev: Event): string | undefined {
  for (const t of ev.tags) {
    if (t[0] === 'l' && t[1] && t[2] === CORNYCHAT_LABEL_NAMESPACE) {
      return t[1].trim().toLowerCase()
    }
  }
  return undefined
}

/** `https://<instance>` from Corny room links in `r` / `service` / `streaming`. */
function cornyChatWebOriginFromEvent(ev: Event): string | undefined {
  const raw = firstHttpsJoinFromTagNames(ev, ['r', 'service', 'streaming'])
  if (!raw) return undefined
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return undefined
    const jamHost = cornyChatJamHost(ev)
    if (jamHost && u.hostname.toLowerCase() !== jamHost) return undefined
    return u.origin
  } catch {
    return undefined
  }
}

/** `https://<corny-instance>/_/integrations/nostr/<naddr>` — matches Corny’s nostr handler route. */
function cornyChatNaddrIntegrationUrl(ev: Event): string | undefined {
  if (!isCornyChat30311(ev)) return undefined
  const origin = cornyChatWebOriginFromEvent(ev)
  if (!origin) return undefined
  const base = `${origin}/_/integrations/nostr`
  return naddrPageUrlForAddressable(ev, base)
}

/** [Corny Chat](https://github.com/vicariousdrama/cornychat) kind-1 invites: same room URL on `r` / `service` / `streaming`; prefer `r` (explicit room link). */
function isCornyChatKind1Invite(ev: Event): boolean {
  if (ev.kind !== 1) return false
  let hasL = false
  let hasAudioServer = false
  for (const t of ev.tags) {
    if (t[0] === 'L' && t[1] === CORNYCHAT_LABEL_NAMESPACE) hasL = true
    if (t[0] === 'audioserver' && t[1]) hasAudioServer = true
  }
  return hasL || hasAudioServer
}

/**
 * URL to open for this activity.
 * **30311 (Corny Chat):** Prefer [`origin/_/integrations/nostr/naddr…`](https://github.com/vicariousdrama/cornychat) when
 * `L`/`com.cornychat` is present (instance origin from `r`/`service`, host checked against `l` when tagged).
 * **30311 (other):** Always use canonical [zap.stream/naddr…](https://zap.stream) when `d` is present so we never
 * stick on stale `service`/`r` URLs publishers no longer use. zap.stream loads the same NIP-53 event and
 * plays `streaming` / etc. Fallbacks only if naddr cannot be built.
 * **30312 (Nostr Nests official MoQ):** Prefer [nostrnests.com/naddr…](https://nostrnests.com/) over `streaming` (MoQ).
 * **Kind 1 (Corny Chat invite):** Prefer `r` → `service` → `streaming` per pantry publish shape.
 * **Other 30312 / 30313:** Use tagged https URLs, bare `naddr1`, or (for 30313) parent space URLs via {@link resolveJoinUrl}.
 */
/**
 * Kind 30311 is shared by every NIP-53 “live stream” ticker (zap.stream, Corny Chat, etc.).
 * There is no single tag that means “zap.stream”; we only special-case publishers that label themselves
 * (Corny uses [`L`, `com.cornychat`](https://github.com/vicariousdrama/cornychat/blob/main/pantry/nostr/nostr.js)).
 * Everyone else gets the zap.stream player URL, which resolves the same replaceable event by naddr.
 */
function joinUrlFor30311Ticker(ev: Event): string | undefined {
  if (isCornyChat30311(ev)) {
    const corny = cornyChatNaddrIntegrationUrl(ev)
    if (corny) return corny
    // Corny-labelled but unsafe/missing room URL vs `l` host, or missing `d`: fall through to zap.stream.
  }
  return zapStreamUrlForAddressable(ev)
}

/**
 * Kind 30312 is the NIP-53 “meeting space” ticker (Jitsi-style rooms, Nostr Nests, etc.).
 * [Nostr Nests](https://github.com/nostrnests/nests) official rooms use MoQ (`moq.nostrnests.com` / `moq-auth.nostrnests.com`);
 * `streaming` there is not a normal browser page, so we open [nostrnests.com/naddr…](https://nostrnests.com/) instead.
 * Other 30312 publishers keep using `service` / `r` / … from the generic branch below.
 */
function joinUrlFor30312Space(ev: Event): string | undefined {
  if (!isNostrNestsOfficialMoq30312(ev)) return undefined
  return nostrNestsWebUrlForAddressable(ev)
}

function pickJoinUrl(ev: Event): string | undefined {
  if (ev.kind === 30311) {
    const url = joinUrlFor30311Ticker(ev)
    if (url) return url
  }

  if (ev.kind === 30312) {
    const nests = joinUrlFor30312Space(ev)
    if (nests) return nests
  }

  if (isCornyChatKind1Invite(ev)) {
    const corny = firstHttpsJoinFromTagNames(ev, ['r', 'service', 'streaming'])
    if (corny) return corny
  }

  const candidates: Array<string | undefined> = [
    firstTagValue(ev, 'service'),
    firstTagValue(ev, 'r'),
    firstTagValue(ev, 'streaming'),
    firstTagValue(ev, 'endpoint')
  ]
  for (const raw of candidates) {
    if (!raw?.trim()) continue
    const url = normalizeTaggedJoinCandidate(raw.trim())
    if (!url?.startsWith('https://')) continue
    if (isLikelyRawStreamManifestUrl(url)) continue
    return url
  }
  if (ev.kind === 30311) {
    const stream = firstTagValue(ev, 'streaming')
    if (stream?.startsWith('https://')) return stream.trim()
  }
  return undefined
}

/**
 * Browser join URL for NIP-53 ticker kinds and known audio-space invites (e.g. Corny Chat 30311 with `L`/`com.cornychat`,
 * or kind 1 with `L`/`audioserver`).
 * Prefer this over raw tag order when opening rooms from the feed or tooling.
 */
export function preferredLiveJoinUrlForEvent(ev: Event): string | undefined {
  return pickJoinUrl(ev)
}

/**
 * NIP-53 uses different `status` vocabulary per kind:
 * - 30311 live stream: `planned` | `live` | `ended`
 * - 30312 meeting space: `open` | `private` | `closed` (never `live`)
 * - 30313 meeting in a space: `planned` | `live` | `ended`
 */
function isActiveLiveActivityStatus(ev: Event): boolean {
  const status = firstTagValue(ev, 'status')
  if (ev.kind === 30312) {
    return status === 'open' || status === 'private'
  }
  if (ev.kind === 30311 || ev.kind === 30313) {
    return status === 'live'
  }
  return false
}

/** Parse NIP-33 address `kind:hex64pubkey:d` (used in `a` tags and dedupe keys). */
export function parseNip33Address(ref: string): { kind: number; pubkey: string; d: string } | null {
  const m = /^(\d+):([0-9a-f]{64}):(.+)$/i.exec(ref.trim())
  if (!m) return null
  const kind = Number(m[1])
  if (!Number.isFinite(kind)) return null
  return { kind, pubkey: m[2], d: m[3] }
}

/** Parent meeting space (30312) address from a 30313 event’s `a` tag, if any. */
export function firstParent30312Address(ev: Event): string | null {
  for (const t of ev.tags) {
    if (t[0] !== 'a' || !t[1]) continue
    const p = parseNip33Address(t[1])
    if (p && p.kind === 30312) return `30312:${p.pubkey}:${p.d}`
  }
  return null
}

function resolveJoinUrl(ev: Event, parentByAddress: ReadonlyMap<string, Event>): string | undefined {
  const direct = pickJoinUrl(ev)
  if (direct) return direct
  if (ev.kind !== 30313) return undefined
  const parentAddr = firstParent30312Address(ev)
  if (!parentAddr) return undefined
  const parent = parentByAddress.get(parentAddr)
  return parent ? pickJoinUrl(parent) : undefined
}

function dedupeEventsById(events: Event[]): Event[] {
  const byId = new Map<string, Event>()
  for (const ev of events) {
    const prev = byId.get(ev.id)
    if (!prev || ev.created_at > prev.created_at) byId.set(ev.id, ev)
  }
  return [...byId.values()]
}

function dedupeLatestForLiveTicker(events: Event[]): Map<string, Event> {
  const byAddress = new Map<string, Event>()
  for (const ev of events) {
    const d = firstTagValue(ev, 'd')
    if (!d) continue
    const addr = `${ev.kind}:${ev.pubkey}:${d}`
    const prev = byAddress.get(addr)
    if (!prev || ev.created_at > prev.created_at) {
      byAddress.set(addr, ev)
    }
  }
  return byAddress
}

/** Latest 30312 space event per address from an event list (no network). */
export function parent30312MapFromEvents(events: Event[]): Map<string, Event> {
  const m = new Map<string, Event>()
  for (const ev of events) {
    if (ev.kind !== 30312) continue
    const d = firstTagValue(ev, 'd')
    if (!d) continue
    const addr = `30312:${ev.pubkey}:${d}`
    const prev = m.get(addr)
    if (!prev || ev.created_at > prev.created_at) m.set(addr, ev)
  }
  return m
}

/**
 * Fetch kind 30312 parent spaces referenced by kind 30313 meetings that lack their own join URL.
 * Merges with any 30312 already present in `events`.
 */
export async function resolveParentSpacesForLiveActivities(
  events: Event[],
  relayUrls: string[],
  fetchEvents: LiveActivitiesFetchEventsFn
): Promise<Map<string, Event>> {
  const parentMap = parent30312MapFromEvents(events)
  const latest = dedupeLatestForLiveTicker(events)
  const needed: string[] = []
  const seen = new Set<string>()
  for (const ev of latest.values()) {
    if (ev.kind !== 30313) continue
    if (pickJoinUrl(ev)) continue
    const pa = firstParent30312Address(ev)
    if (!pa || parentMap.has(pa) || seen.has(pa)) continue
    seen.add(pa)
    needed.push(pa)
  }
  const slice = needed.slice(0, LIVE_ACTIVITIES_MAX_PARENT_FETCH)
  if (slice.length === 0) return parentMap

  const filters: Filter[] = []
  for (const addr of slice) {
    const p = parseNip33Address(addr)
    if (!p || p.kind !== 30312) continue
    filters.push({ kinds: [30312], authors: [p.pubkey], '#d': [p.d], limit: 12 })
  }
  if (filters.length === 0) return parentMap

  const fetched = await fetchEvents(relayUrls, filters, {
    eoseTimeout: 6000,
    globalTimeout: 12_000
  })
  const merged = new Map(parentMap)
  for (const ev of fetched) {
    if (ev.kind !== 30312) continue
    const d = firstTagValue(ev, 'd')
    if (!d) continue
    const addr = `30312:${ev.pubkey}:${d}`
    const prev = merged.get(addr)
    if (!prev || ev.created_at > prev.created_at) merged.set(addr, ev)
  }
  return merged
}

export function parseLiveActivityEvent(
  ev: Event,
  followSet: Set<string>,
  parentByAddress: ReadonlyMap<string, Event> = EMPTY_PARENT_MAP,
  nowSec: number = Math.floor(Date.now() / 1000)
): TLiveActivityItem | null {
  if (!LIVE_ACTIVITY_KINDS.includes(ev.kind as (typeof LIVE_ACTIVITY_KINDS)[number])) return null
  if (isNip53TickerExpired(ev, nowSec)) return null
  if (!isActiveLiveActivityStatus(ev)) return null
  const dTag = firstTagValue(ev, 'd')
  if (!dTag) return null
  const joinUrl = resolveJoinUrl(ev, parentByAddress)
  if (!joinUrl) return null
  const title =
    ev.kind === 30312
      ? firstTagValue(ev, 'room')?.trim() ||
        firstTagValue(ev, 'title')?.trim() ||
        'Live space'
      : firstTagValue(ev, 'title')?.trim() ||
        firstTagValue(ev, 'room')?.trim() ||
        'Live'
  const summary = firstTagValue(ev, 'summary')?.trim() || ''
  const image = firstTagValue(ev, 'image')
  const imageUrl = image?.startsWith('https://') ? image : undefined
  const address = `${ev.kind}:${ev.pubkey}:${dTag}`
  return {
    address,
    kind: ev.kind,
    pubkey: ev.pubkey,
    dTag,
    title,
    summary,
    imageUrl,
    joinUrl,
    updatedAt: ev.created_at,
    fromFollowedHost: followSet.has(ev.pubkey)
  }
}

/**
 * Keep newest event per NIP-33 address (`kind:pubkey:d`), then sort: followed hosts first, then `updatedAt` desc.
 * `parentByAddress`: latest 30312 per `30312:pubkey:d` for resolving 30313 join URLs from parent `service`.
 */
export function mergeLiveActivityEvents(
  events: Event[],
  followPubkeys: string[],
  parentByAddress: ReadonlyMap<string, Event> = EMPTY_PARENT_MAP
): TLiveActivityItem[] {
  const followSet = new Set(followPubkeys)
  const nowSec = Math.floor(Date.now() / 1000)
  const unique = dedupeEventsById(events)
  const byAddress = dedupeLatestForLiveTicker(unique)
  const items: TLiveActivityItem[] = []
  for (const ev of byAddress.values()) {
    const parsed = parseLiveActivityEvent(ev, followSet, parentByAddress, nowSec)
    if (parsed) items.push(parsed)
  }
  items.sort((a, b) => {
    if (a.fromFollowedHost !== b.fromFollowedHost) return a.fromFollowedHost ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
  return items.slice(0, LIVE_ACTIVITIES_MAX_ITEMS)
}

export function buildLiveActivitiesRelayUrls(options: {
  loggedIn: boolean
  favoriteRelays: string[]
  blockedRelays: string[]
  relayListRead: string[]
  relayListWrite: string[]
}): string[] {
  const { loggedIn, favoriteRelays, blockedRelays, relayListRead, relayListWrite } = options
  if (loggedIn) {
    const fav = relayUrlsLocalsFirst(getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays))
    const read = relayUrlsLocalsFirst(relayListRead)
    const write = relayUrlsLocalsFirst(relayListWrite)
    return mergeRelayPriorityLayers([fav, read, write], blockedRelays, MAX_REQ_RELAY_URLS, {
      applySocialKindBlockedFilter: true
    })
  }
  const fav = relayUrlsLocalsFirst(getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays))
  const fast = dedupeNormalizeRelayUrlsOrdered(
    FAST_READ_RELAY_URLS.map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean)
  )
  return mergeRelayPriorityLayers([fav, fast], blockedRelays, MAX_REQ_RELAY_URLS, {
    applySocialKindBlockedFilter: true
  })
}

/** Milliseconds until the next wall-clock quarter hour (:00, :15, :30, :45). */
export function msUntilNextQuarterHour(): number {
  const now = new Date()
  const m = now.getMinutes()
  const s = now.getSeconds()
  const ms = now.getMilliseconds()
  const minsPastQuarter = m % 15
  const secsUntil = (15 - minsPastQuarter) * 60 - s - ms / 1000
  return Math.max(0, Math.floor(secsUntil * 1000))
}
