import type { Event } from 'nostr-tools'
import client from '@/services/client.service'
import { getDefaultRelayUrls } from '@/lib/relay'
import { countItemTags, getContentEncryption } from './private-items'
import {
  getLazarusKindProfile,
  type LazarusItemCount,
  type LazarusKindProfile
} from './registry'

/**
 * Lazarus core: scan, rank, delta, recover-draft.
 *
 * Invariants (see notes/lazarus-spec-draft.md):
 *  1. This module never publishes. Recovery happens only when the UI asks
 *     the signer for exactly one event on an explicit click.
 *  2. Every candidate found is returned, including empty ones.
 *  3. Empty candidates are never recommended (except kinds flagged
 *     meaningfulEmpty, where nothing is recommended at all).
 *  4. The only signing surface is the draft builder; the caller owns the
 *     signer and the click.
 */

const SCAN_TIMEOUT_MS = 6000
const SCAN_LIMIT = 50

/** An event together with the relay it was observed on. */
export interface LazarusTaggedEvent {
  event: Event
  relayUrl: string
}

export interface LazarusCandidate {
  event: Event
  /** Relay URLs where this exact event id was observed. */
  foundOn: string[]
  itemCount: ReturnType<LazarusKindProfile['itemCount']>
  /** True for the most recent candidate (what the scan saw as current). */
  isCurrent: boolean
  isRecommended: boolean
}

export interface LazarusScanResult {
  kind: number
  /** Ranked candidates. Meaningful-empty kinds: recency order, nothing recommended. */
  candidates: LazarusCandidate[]
  current: LazarusCandidate | undefined
  recommended: LazarusCandidate | undefined
  /** True for meaningful-empty kinds: the user must choose with intent. */
  requiresIntentConfirmation: boolean
  queriedRelays: string[]
  respondingRelays: string[]
}

/** Decrypted private items (NIP-51), keyed by event id. */
export type LazarusPrivateTags = ReadonlyMap<string, string[][]>

/**
 * A candidate's total item count as a range: exact once its private items
 * are decrypted (or when it has none), estimated from the encrypted size
 * otherwise.
 */
export function getLazarusItemRange(itemCount: LazarusItemCount): { min: number; max: number } {
  const { count, privateCount, privateEstimate } = itemCount
  if (privateCount !== undefined) return { min: count + privateCount, max: count + privateCount }
  if (privateEstimate) {
    return { min: count + privateEstimate.min, max: count + privateEstimate.max }
  }
  return { min: count, max: count }
}

/** False when encrypted private items could be neither decrypted nor sized. */
export function isLazarusSizeKnown(itemCount: LazarusItemCount): boolean {
  return !itemCount.partial || !!itemCount.privateEstimate
}

function countItems(
  profile: LazarusKindProfile,
  event: Event,
  privateTags: string[][] | undefined
): LazarusItemCount {
  const itemCount = profile.itemCount(event)
  if (!privateTags || !profile.privateItemTypes) return itemCount
  return {
    count: itemCount.count,
    partial: false,
    privateCount: countItemTags(privateTags, profile.privateItemTypes)
  }
}

export interface LazarusRelaySource {
  fetchVersions(
    kind: number,
    pubkey: string
  ): Promise<{
    tagged: LazarusTaggedEvent[]
    queriedRelays: string[]
    respondingRelays: string[]
  }>
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Per-relay scanning so each candidate keeps an accurate found-on list and
 * the result can report which relays actually answered. A relay that fails
 * or times out never counts as "nothing found".
 */
export const defaultLazarusRelaySource: LazarusRelaySource = {
  async fetchVersions(kind, pubkey) {
    const filter = { kinds: [kind], authors: [pubkey], limit: SCAN_LIMIT }
    let relayUrls: string[]
    try {
      relayUrls = await client.determineRelaysByFilter(filter)
    } catch {
      relayUrls = getDefaultRelayUrls()
    }
    const urls = Array.from(new Set(relayUrls)).filter(Boolean)

    const results = await Promise.allSettled(
      urls.map((url) =>
        withTimeout(client.fetchEvents([url], filter), SCAN_TIMEOUT_MS)
      )
    )

    const tagged: LazarusTaggedEvent[] = []
    const respondingRelays: string[] = []
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return
      const relayEvents = result.value
      if (relayEvents.length > 0) respondingRelays.push(urls[index])
      for (const event of relayEvents) {
        tagged.push({ event, relayUrl: urls[index] })
      }
    })

    return { tagged, queriedRelays: urls, respondingRelays }
  }
}

export function scanLazarusKind(
  kind: number,
  pubkey: string,
  source: LazarusRelaySource = defaultLazarusRelaySource
): Promise<LazarusScanResult> {
  const profile = getLazarusKindProfile(kind)
  if (!profile) {
    return Promise.reject(new Error(`kind ${kind} is not in the Lazarus registry`))
  }
  return source.fetchVersions(kind, pubkey).then(({ tagged, queriedRelays, respondingRelays }) => {
    return rankLazarusCandidates(profile, tagged, queriedRelays, respondingRelays)
  })
}

export function rankLazarusCandidates(
  profile: LazarusKindProfile,
  taggedEvents: LazarusTaggedEvent[],
  queriedRelays: string[] = [],
  respondingRelays: string[] = [],
  privateTags: LazarusPrivateTags = new Map()
): LazarusScanResult {
  const byId = new Map<string, LazarusCandidate>()
  for (const { event, relayUrl } of taggedEvents) {
    const existing = byId.get(event.id)
    if (existing) {
      if (!existing.foundOn.includes(relayUrl)) {
        existing.foundOn.push(relayUrl)
      }
      continue
    }
    byId.set(event.id, {
      event,
      foundOn: [relayUrl],
      itemCount: countItems(profile, event, privateTags.get(event.id)),
      isCurrent: false,
      isRecommended: false
    })
  }

  const candidates = Array.from(byId.values())
  const newestFirst = [...candidates].sort(
    (a, b) => b.event.created_at - a.event.created_at || (a.event.id < b.event.id ? -1 : 1)
  )
  const current = newestFirst[0]
  if (current) current.isCurrent = true

  let ordered: LazarusCandidate[]
  let recommended: LazarusCandidate | undefined
  const requiresIntentConfirmation = profile.ranking === 'intent'

  if (profile.ranking === 'count') {
    // Private items count too: a private-only mute list has no public tags,
    // so ranking on tags alone would score an emptied list like a full one.
    const size = (c: LazarusCandidate) => {
      const range = getLazarusItemRange(c.itemCount)
      return range.min + range.max
    }
    ordered = [...candidates].sort(
      (a, b) => size(b) - size(a) || b.event.created_at - a.event.created_at
    )
    // Empty candidates are never recommended (invariant 3), and a recovery
    // must strictly improve on what the scan saw as current. Estimated sizes
    // only win when the ranges don't overlap, and nothing is recommended
    // while the current size is unknown.
    if (current && isLazarusSizeKnown(current.itemCount)) {
      const currentMax = getLazarusItemRange(current.itemCount).max
      recommended = ordered.find(
        (c) =>
          isLazarusSizeKnown(c.itemCount) &&
          getLazarusItemRange(c.itemCount).min > Math.max(currentMax, 0)
      )
    }
  } else {
    // 'recency' and 'intent' kinds: recency order, no recommendation. For
    // meaningful-empty kinds ranking is forbidden by spec: the user chooses
    // with intent.
    ordered = newestFirst
  }

  if (recommended) recommended.isRecommended = true

  return {
    kind: profile.kind,
    candidates: ordered,
    current,
    recommended,
    requiresIntentConfirmation,
    queriedRelays,
    respondingRelays
  }
}

/**
 * Re-rank a scan once private items have been decrypted. Candidates missing
 * from the map keep their size-based estimate.
 */
export function applyLazarusPrivateTags(
  profile: LazarusKindProfile,
  scan: LazarusScanResult,
  privateTags: LazarusPrivateTags
): LazarusScanResult {
  const tagged = scan.candidates.flatMap((candidate) =>
    candidate.foundOn.map((relayUrl) => ({ event: candidate.event, relayUrl }))
  )
  return rankLazarusCandidates(
    profile,
    tagged,
    scan.queriedRelays,
    scan.respondingRelays,
    privateTags
  )
}

export interface LazarusDelta {
  added: string[][]
  removed: string[][]
  addedCount: number
  removedCount: number
  /** True when recovery would grow the list. */
  grows: boolean
  /** True when recovery would shrink the list below current. */
  shrinks: boolean
  /**
   * True when either version has encrypted private items that weren't
   * decrypted, so the changes above cover public tags only.
   */
  privateUnknown: boolean
}

function tagIdentity(tag: string[]): string {
  return JSON.stringify(tag)
}

export function computeLazarusDelta(
  chosen: Event,
  current: Event | undefined,
  privateTags: LazarusPrivateTags = new Map()
): LazarusDelta {
  // Decrypted private items are compared together with the public tags, so
  // an item that only moved between public and private isn't a change
  const itemsOf = (event: Event | undefined) => {
    if (!event) return { tags: [] as string[][], unknown: false }
    const decrypted = privateTags.get(event.id)
    return {
      tags: [...event.tags, ...(decrypted ?? [])],
      unknown: !decrypted && !!getContentEncryption(event.content)
    }
  }
  const chosenItems = itemsOf(chosen)
  const currentItems = itemsOf(current)
  const currentTags = new Set(currentItems.tags.map(tagIdentity))
  const chosenTags = new Set(chosenItems.tags.map(tagIdentity))
  const added = chosenItems.tags.filter((tag) => !currentTags.has(tagIdentity(tag)))
  const removed = currentItems.tags.filter((tag) => !chosenTags.has(tagIdentity(tag)))
  return {
    added,
    removed,
    addedCount: added.length,
    removedCount: removed.length,
    grows: added.length > 0 && added.length >= removed.length,
    shrinks: removed.length > added.length,
    privateUnknown: chosenItems.unknown || currentItems.unknown
  }
}

export interface LazarusRecoveryDraft {
  kind: number
  content: string
  tags: string[][]
  created_at: number
}

/**
 * Build the recovery event. The chosen candidate's item set is copied
 * verbatim, including encrypted private content (it stays encrypted to the
 * user's own key). The caller signs and publishes this exactly once, on an
 * explicit user click.
 */
export function buildLazarusRecoveryDraft(
  chosen: Event,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): LazarusRecoveryDraft {
  return {
    kind: chosen.kind,
    content: chosen.content,
    tags: chosen.tags.map((tag) => [...tag]),
    created_at: nowSeconds
  }
}
