import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools'

// Mock the client service before importing the module under test: the real
// one initializes local storage (window) at module load, and the relay
// source is injected in every test below anyway.
vi.mock('@/services/client.service', () => ({
  default: {
    determineRelaysByFilter: vi.fn().mockResolvedValue(['wss://a', 'wss://b']),
    fetchEvents: vi.fn().mockResolvedValue([])
  }
}))
vi.mock('@/lib/relay', () => ({
  getDefaultRelayUrls: () => ['wss://default']
}))

import { getLazarusKindProfile, LAZARUS_REGISTRY } from './registry'
import {
  buildLazarusRecoveryDraft,
  computeLazarusDelta,
  rankLazarusCandidates,
  scanLazarusKind,
  type LazarusRelaySource
} from './recovery'

const MUTE_TAG_TYPES = ['p', 'word', 't', 'e']

let counter = 0
function makeEvent(overrides: Partial<Event> = {}): Event {
  counter += 1
  return {
    id: `test-event-${counter}`.padEnd(64, '0'),
    pubkey: 'test-pubkey',
    created_at: 1700000000 + counter,
    kind: 3,
    tags: [],
    content: '',
    sig: 'test-sig',
    ...overrides
  } as Event
}

function followListEvent(
  count: number,
  createdAt: number,
  content = ''
): Event {
  return {
    ...makeEvent({ created_at: createdAt, kind: 3 }),
    tags: Array.from({ length: count }, (_, i) => ['p', `pk${i}`]),
    content
  }
}

function muteListEvent(count: number, createdAt: number): Event {
  return {
    ...makeEvent({ created_at: createdAt, kind: 10000 }),
    tags: Array.from({ length: count }, (_, i) => [
      MUTE_TAG_TYPES[i % MUTE_TAG_TYPES.length],
      `item${i}`
    ]),
    content: ''
  }
}

describe('registry', () => {
  it('pins tier 1 kinds required for conformance', () => {
    expect(LAZARUS_REGISTRY[3].tier).toBe(1)
    expect(LAZARUS_REGISTRY[10000].tier).toBe(1)
  })

  it('flags kind 10044 as meaningful-empty with no ranking', () => {
    const profile = getLazarusKindProfile(10044)
    expect(profile?.meaningfulEmpty).toBe(true)
    expect(profile?.ranking).toBe('intent')
  })

  it('never returns profiles for unregistered kinds', () => {
    expect(getLazarusKindProfile(30078)).toBeUndefined()
    expect(getLazarusKindProfile(1)).toBeUndefined()
  })
})

describe('rankLazarusCandidates', () => {
  it('ranks count kinds by item count, not recency', () => {
    const olderBigger = followListEvent(120, 1000)
    const newerSmaller = followListEvent(2, 2000)
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      [
        { event: newerSmaller, relayUrl: 'wss://a' },
        { event: olderBigger, relayUrl: 'wss://b' }
      ]
    )
    expect(result.candidates[0].event.id).toBe(olderBigger.id)
    // current is still the newest version the scan saw
    expect(result.current?.event.id).toBe(newerSmaller.id)
    expect(result.recommended?.event.id).toBe(olderBigger.id)
    expect(result.recommended?.isRecommended).toBe(true)
  })

  it('never recommends empty candidates even when they are newest', () => {
    const tombstone = followListEvent(0, 3000)
    const healthy = followListEvent(50, 1000)
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: tombstone, relayUrl: 'wss://a' },
      { event: healthy, relayUrl: 'wss://b' }
    ])
    expect(result.current?.event.id).toBe(tombstone.id)
    expect(result.recommended?.event.id).toBe(healthy.id)
  })

  it('recommends nothing when current is already the best', () => {
    const biggest = followListEvent(80, 3000)
    const smaller = followListEvent(10, 1000)
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: biggest, relayUrl: 'wss://a' },
      { event: smaller, relayUrl: 'wss://b' }
    ])
    expect(result.recommended).toBeUndefined()
  })

  it('recommends nothing for meaningful-empty kinds and requires intent', () => {
    const keys = {
      ...makeEvent({ kind: 10044, created_at: 1000 }),
      tags: [['p', 'encryption-pubkey-1']]
    } as Event
    const emptied = { ...makeEvent({ kind: 10044, created_at: 2000 }), tags: [] } as Event
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[10044], [
      { event: emptied, relayUrl: 'wss://a' },
      { event: keys, relayUrl: 'wss://b' }
    ])
    expect(result.requiresIntentConfirmation).toBe(true)
    expect(result.recommended).toBeUndefined()
    // still offered, in recency order, not labeled damage
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].event.id).toBe(emptied.id)
  })

  it('dedupes by event id and accumulates found-on relays', () => {
    const shared = followListEvent(5, 1000)
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: shared, relayUrl: 'wss://a' },
      { event: shared, relayUrl: 'wss://b' },
      { event: shared, relayUrl: 'wss://a' }
    ])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].foundOn).toEqual(['wss://a', 'wss://b'])
  })

  it('counts mute lists across all NIP-51 tag types', () => {
    const mutes = muteListEvent(8, 1000)
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[10000], [
      { event: mutes, relayUrl: 'wss://a' }
    ])
    expect(result.candidates[0].itemCount.count).toBe(8)
  })

  it('marks encrypted-content candidates as partially counted', () => {
    const withPrivate = followListEvent(3, 1000, 'encrypted-private-items')
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: withPrivate, relayUrl: 'wss://a' }
    ])
    expect(result.candidates[0].itemCount.partial).toBe(true)
  })
})

describe('computeLazarusDelta', () => {
  it('computes additions, removals, and direction', () => {
    const current = {
      ...makeEvent({ kind: 3 }),
      tags: [['p', 'a'], ['p', 'b']]
    } as Event
    const chosen = {
      ...makeEvent({ kind: 3 }),
      tags: [['p', 'b'], ['p', 'c']]
    } as Event
    const delta = computeLazarusDelta(chosen, current)
    expect(delta.addedCount).toBe(1)
    expect(delta.removedCount).toBe(1)
    expect(delta.grows).toBe(true)
    expect(delta.shrinks).toBe(false)
  })

  it('flags a shrink for separate confirmation', () => {
    const current = {
      ...makeEvent({ kind: 3 }),
      tags: [['p', 'a'], ['p', 'b'], ['p', 'c']]
    } as Event
    const chosen = { ...makeEvent({ kind: 3 }), tags: [['p', 'a']] } as Event
    const delta = computeLazarusDelta(chosen, current)
    expect(delta.shrinks).toBe(true)
  })
})

describe('buildLazarusRecoveryDraft', () => {
  it('copies the candidate verbatim with a fresh timestamp', () => {
    const chosen = followListEvent(4, 999, '{"wss://relay": {"read": true}}')
    const draft = buildLazarusRecoveryDraft(chosen, 1234567890)
    expect(draft.kind).toBe(3)
    expect(draft.created_at).toBe(1234567890)
    expect(draft.content).toBe(chosen.content)
    expect(draft.tags).toEqual(chosen.tags)
    expect(draft.tags).not.toBe(chosen.tags)
  })
})

describe('scanLazarusKind', () => {
  it('reports relays that answered separately from relays queried', async () => {
    const healthy = followListEvent(30, 1000)
    const source: LazarusRelaySource = {
      fetchVersions: async () => ({
        tagged: [
          { event: healthy, relayUrl: 'wss://alive' },
          { event: healthy, relayUrl: 'wss://mirror' }
        ],
        queriedRelays: ['wss://alive', 'wss://mirror', 'wss://dead'],
        respondingRelays: ['wss://alive', 'wss://mirror']
      })
    }
    const result = await scanLazarusKind(3, 'test-pubkey', source)
    expect(result.queriedRelays).toHaveLength(3)
    expect(result.respondingRelays).toHaveLength(2)
    expect(result.candidates[0].foundOn).toEqual(['wss://alive', 'wss://mirror'])
  })

  it('rejects kinds outside the registry', async () => {
    await expect(scanLazarusKind(1, 'test-pubkey', {
      fetchVersions: async () => ({ tagged: [], queriedRelays: [], respondingRelays: [] })
    })).rejects.toThrow(/not in the Lazarus registry/)
  })
})
