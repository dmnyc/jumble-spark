import logger from '@/lib/logger'
import { bytesToHex } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'
import type { NostrEvent } from 'nostr-tools'

const STORAGE_KEY = 'jumble.searchFollowsFeed.v1'
/** Stay under typical 5MB localStorage budgets */
const MAX_JSON_CHARS = 4_000_000

export type SearchFollowsFeedCachePayloadV1 = {
  v: 1
  scopeKey: string
  /** Hex pubkey → recent posts (same shape as in-memory map) */
  posts: Record<string, NostrEvent[]>
  savedAtMs: number
}

export function fingerprintSortedPubkeys(pubkeys: string[]): string {
  if (pubkeys.length === 0) return '0'
  const sorted = [...pubkeys].sort()
  return bytesToHex(sha256(new TextEncoder().encode(sorted.join('\n'))))
}

export function fingerprintRelaySet(urls: string[]): string {
  if (urls.length === 0) return '0'
  return bytesToHex(sha256(new TextEncoder().encode(urls.join('\n'))))
}

export function buildSearchFollowsFeedScopeKey(input: {
  mode: 'self' | 'recommended'
  viewerPubkey: string | null
  followListFingerprint: string
  aggregateRelayFingerprint: string
}): string {
  const v = input.viewerPubkey?.toLowerCase() ?? ''
  return `${input.mode}|${v}|${input.followListFingerprint}|${input.aggregateRelayFingerprint}`
}

export function readSearchFollowsFeedCache(
  scopeKey: string
): SearchFollowsFeedCachePayloadV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw || raw.length > MAX_JSON_CHARS) return null
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return null
    const o = data as Record<string, unknown>
    if (o.v !== 1 || o.scopeKey !== scopeKey) return null
    if (typeof o.savedAtMs !== 'number' || typeof o.posts !== 'object' || o.posts === null) return null
    const posts = o.posts as Record<string, unknown>
    const out: Record<string, NostrEvent[]> = {}
    for (const [pk, arr] of Object.entries(posts)) {
      if (!Array.isArray(arr)) continue
      const evs = arr.filter((x): x is NostrEvent => x && typeof x === 'object' && typeof (x as NostrEvent).id === 'string')
      if (evs.length) out[pk] = evs
    }
    return { v: 1, scopeKey, posts: out, savedAtMs: o.savedAtMs }
  } catch {
    return null
  }
}

export function writeSearchFollowsFeedCache(payload: SearchFollowsFeedCachePayloadV1): void {
  try {
    const json = JSON.stringify(payload)
    if (json.length > MAX_JSON_CHARS) {
      logger.debug('[SearchFollowsFeedCache] skip write (payload too large)', {
        chars: json.length
      })
      return
    }
    localStorage.setItem(STORAGE_KEY, json)
  } catch (e) {
    logger.debug('[SearchFollowsFeedCache] write failed', { error: e })
  }
}

export function postsMapToRecord(m: Map<string, NostrEvent[]>): Record<string, NostrEvent[]> {
  const o: Record<string, NostrEvent[]> = {}
  for (const [k, v] of m) {
    if (v.length) o[k] = v
  }
  return o
}

export function postsRecordToMap(r: Record<string, NostrEvent[]>): Map<string, NostrEvent[]> {
  const m = new Map<string, NostrEvent[]>()
  for (const [k, v] of Object.entries(r)) {
    if (Array.isArray(v) && v.length) m.set(k, v)
  }
  return m
}
