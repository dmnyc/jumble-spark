import type { Event } from 'nostr-tools'
import client from '@/services/client.service'
import { getDefaultRelayUrls } from '@/lib/relay'
import {
  getLazarusKindProfile,
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
  respondingRelays: string[] = []
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
      itemCount: profile.itemCount(event),
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
    ordered = [...candidates].sort((a, b) => {
      if (b.itemCount.count !== a.itemCount.count) {
        return b.itemCount.count - a.itemCount.count
      }
      return b.event.created_at - a.event.created_at
    })
    const currentCount = current ? current.itemCount.count : -1
    // Empty candidates are never recommended (invariant 3), and a recovery
    // must strictly improve on what the scan saw as current.
    recommended = ordered.find((c) => c.itemCount.count > Math.max(currentCount, 0))
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

export interface LazarusDelta {
  added: string[][]
  removed: string[][]
  addedCount: number
  removedCount: number
  /** True when recovery would grow the list. */
  grows: boolean
  /** True when recovery would shrink the list below current. */
  shrinks: boolean
}

function tagIdentity(tag: string[]): string {
  return JSON.stringify(tag)
}

export function computeLazarusDelta(
  chosen: Event,
  current: Event | undefined
): LazarusDelta {
  const currentTags = new Set((current?.tags ?? []).map(tagIdentity))
  const chosenTags = new Set(chosen.tags.map(tagIdentity))
  const added = chosen.tags.filter((tag) => !currentTags.has(tagIdentity(tag)))
  const removed = (current?.tags ?? []).filter((tag) => !chosenTags.has(tagIdentity(tag)))
  return {
    added,
    removed,
    addedCount: added.length,
    removedCount: removed.length,
    grows: added.length > 0 && added.length >= removed.length,
    shrinks: removed.length > added.length
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
