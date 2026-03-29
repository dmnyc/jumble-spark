import { FAST_READ_RELAY_URLS } from '@/constants'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import {
  dedupeNormalizeRelayUrlsOrdered,
  MAX_REQ_RELAY_URLS,
  mergeRelayPriorityLayers,
  relayUrlsLocalsFirst
} from '@/lib/relay-url-priority'
import { normalizeAnyRelayUrl } from '@/lib/url'
import type { Event } from 'nostr-tools'

/** NIP-53 live streaming (30311), meeting space (30312), meeting (30313). */
export const LIVE_ACTIVITY_KINDS = [30311, 30312, 30313] as const

export const LIVE_ACTIVITIES_MAX_ITEMS = 10

export const LIVE_ACTIVITIES_SLIDE_INTERVAL_MS = 30_000

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

/**
 * URL for “join this live space” in the browser. NIP-53 `streaming` is often a raw `.m3u8` feed; prefer
 * `service` (access URL), then `r` (e.g. Corny Chat room page), then non-manifest `streaming` / `endpoint`.
 */
function pickHttpsJoinUrl(ev: Event): string | undefined {
  const candidates: Array<string | undefined> = [
    firstTagValue(ev, 'service'),
    firstTagValue(ev, 'r'),
    firstTagValue(ev, 'streaming'),
    firstTagValue(ev, 'endpoint')
  ]
  for (const raw of candidates) {
    if (!raw?.startsWith('https://')) continue
    if (isLikelyRawStreamManifestUrl(raw)) continue
    return raw
  }
  return undefined
}

export function parseLiveActivityEvent(ev: Event, followSet: Set<string>): TLiveActivityItem | null {
  if (!LIVE_ACTIVITY_KINDS.includes(ev.kind as (typeof LIVE_ACTIVITY_KINDS)[number])) return null
  if (firstTagValue(ev, 'status') !== 'live') return null
  const dTag = firstTagValue(ev, 'd')
  if (!dTag) return null
  const joinUrl = pickHttpsJoinUrl(ev)
  if (!joinUrl) return null
  const title =
    firstTagValue(ev, 'title')?.trim() ||
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
 */
export function mergeLiveActivityEvents(events: Event[], followPubkeys: string[]): TLiveActivityItem[] {
  const followSet = new Set(followPubkeys)
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
  const items: TLiveActivityItem[] = []
  for (const ev of byAddress.values()) {
    const parsed = parseLiveActivityEvent(ev, followSet)
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
