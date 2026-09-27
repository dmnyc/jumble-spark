import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bytesToHex } from '@noble/hashes/utils'
import {
  generateSecretKey,
  getPublicKey,
  nip44,
  type Event,
  type EventTemplate,
  type Filter,
  type VerifiedEvent
} from 'nostr-tools'
import type { subscribeRelays } from '@/lib/relay-subscription'
import type { IRelay, IRelayPool } from '@/types/relay-pool'

// Relays answer through a fake pool, under the client's real subscription
// helper, so the scan sees each outcome the way the app reports it
const pool = vi.hoisted(() => ({ ensureRelay: vi.fn<(url: string) => Promise<unknown>>() }))

type SubscribeOptions = Parameters<typeof subscribeRelays>[3] & { skipAuth?: boolean }

// Mock the client service before importing the module under test: the real
// one initializes local storage (window) at module load. Its subscribe goes
// through subscribeRelays, as the real one does.
vi.mock('@/services/client.service', async () => {
  const relaySubscription = await vi.importActual<typeof import('@/lib/relay-subscription')>(
    '@/lib/relay-subscription'
  )
  const client = {
    fetchRelayList: vi.fn(),
    publishEvent: vi.fn(),
    signer: undefined as { signEvent: (event: EventTemplate) => Promise<unknown> } | undefined,
    subscribe: vi.fn(
      (urls: string[], filter: Filter | Filter[], { skipAuth, ...handlers }: SubscribeOptions) =>
        relaySubscription.subscribeRelays(pool as unknown as IRelayPool, urls, [filter].flat(), {
          ...handlers,
          getAuthenticator: () => {
            const signer = client.signer
            if (skipAuth || !signer) return undefined
            return async (relay: IRelay) => {
              await relay.auth(
                async (authEvt) => (await signer.signEvent(authEvt)) as VerifiedEvent
              )
            }
          }
        })
    )
  }
  return { default: client }
})
vi.mock('@/lib/relay', () => ({
  getDefaultRelayUrls: () => ['wss://default']
}))
// The fixtures aren't signed; tests that need a forged event override this
vi.mock('@/lib/nostr-verifier', () => ({
  verifyEvent: vi.fn(() => true)
}))

import client from '@/services/client.service'
import { verifyEvent } from '@/lib/nostr-verifier'
import { normalizeUrl } from '@/lib/url'
import { getLazarusKindProfile, LAZARUS_REGISTRY, normalizeLazarusRelayUrl } from './registry'
import {
  applyLazarusPrivateTags,
  buildLazarusRecoveryDraft,
  checkLazarusCurrent,
  computeLazarusDelta,
  computeLazarusProfileChanges,
  fitsLazarusRemoteRestore,
  getLazarusItemRange,
  getLazarusPublishRelays,
  getLazarusScanPlan,
  groupLazarusCandidates,
  LAZARUS_ARCHIVAL_RELAYS,
  lazarusScanReachedNoRelay,
  loadOlderLazarusVersions,
  publishLazarusRecovery,
  rankLazarusCandidates,
  readLazarusCurrent,
  scanLazarusKind,
  sortLazarusCandidates,
  type LazarusListItem,
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

function followListEvent(count: number, createdAt: number, content = ''): Event {
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

const selfKey = generateSecretKey()
const selfConversationKey = nip44.getConversationKey(selfKey, getPublicKey(selfKey))

function privateTags(count: number): string[][] {
  return Array.from({ length: count }, () => ['p', bytesToHex(generateSecretKey())])
}

/** A mute list whose items are all private: no tags, NIP-44 content encrypted to self */
function privateMuteListEvent(tags: string[][], createdAt: number): Event {
  return {
    ...makeEvent({ created_at: createdAt, kind: 10000 }),
    tags: [],
    content: nip44.encrypt(JSON.stringify(tags), selfConversationKey)
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

  it('counts the n tags NIP-4e lists encryption keys in', () => {
    const keyList = {
      ...makeEvent({ kind: 10044 }),
      tags: [
        ['n', 'a'.repeat(64)],
        ['n', 'b'.repeat(64)],
        ['p', 'c'.repeat(64)]
      ]
    } as Event
    expect(getLazarusKindProfile(10044)?.itemCount(keyList).count).toBe(2)
  })

  it('counts each item once, and no tag without a value', () => {
    const follows = {
      ...makeEvent({ kind: 3 }),
      tags: [['p', 'a'], ['p', 'a', 'wss://hint'], ['p', 'b'], ['p'], ['p', ''], ['alt', 'x']]
    } as Event
    expect(LAZARUS_REGISTRY[3].itemCount(follows).count).toBe(2)
  })

  it("counts a profile's fields, so one wiped to {} is empty", () => {
    const profile = (content: string) => ({ ...makeEvent({ kind: 0 }), content }) as Event
    const count = (content: string) => LAZARUS_REGISTRY[0].itemCount(profile(content)).count
    expect(count('{"name":"a","about":"b","bot":null}')).toBe(2)
    expect(count('{}')).toBe(0)
    expect(count('not json')).toBe(0)
    expect(count('["name"]')).toBe(0)
  })

  it('compares relay URLs normalized on the relay kinds', () => {
    const relayList = (kind: number, name: string) =>
      ({
        ...makeEvent({ kind }),
        tags: [
          [name, 'wss://Relay.Example/'],
          [name, 'wss://relay.example'],
          [name, 'wss://relay.example:443//']
        ]
      }) as Event
    expect(LAZARUS_REGISTRY[10002].itemCount(relayList(10002, 'r')).count).toBe(1)
    expect(LAZARUS_REGISTRY[10050].itemCount(relayList(10050, 'relay')).count).toBe(1)
    expect(LAZARUS_REGISTRY[10006].itemCount(relayList(10006, 'relay')).count).toBe(1)
    expect(normalizeLazarusRelayUrl('wss://Relay.Example:443//path/')).toBe(
      'wss://relay.example/path'
    )
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
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: newerSmaller, relayUrl: 'wss://a' },
      { event: olderBigger, relayUrl: 'wss://b' }
    ])
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

  it('keeps the current version when an older one is only slightly bigger', () => {
    // A few unfollows over time is curation, not a clobber
    const older = followListEvent(1102, 1000)
    const current = followListEvent(1094, 2000)
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: older, relayUrl: 'wss://a' },
      { event: current, relayUrl: 'wss://a' }
    ])
    expect(result.candidates[0].event.id).toBe(older.id)
    expect(result.recommended).toBeUndefined()
  })

  it('recommends an older version when the current one lost a large share of it', () => {
    const beforeClobber = followListEvent(1945, 1000)
    const current = followListEvent(1094, 2000)
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: beforeClobber, relayUrl: 'wss://a' },
      { event: current, relayUrl: 'wss://a' }
    ])
    expect(result.recommended?.event.id).toBe(beforeClobber.id)
  })

  it('does not recommend over a couple of items on a small list', () => {
    const older = followListEvent(6, 1000)
    const current = followListEvent(4, 2000)
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: older, relayUrl: 'wss://a' },
      { event: current, relayUrl: 'wss://a' }
    ])
    expect(result.recommended).toBeUndefined()
  })

  it('keeps the current version when the list shrank gradually, however far', () => {
    // Each step loses about a tenth: curation, even though 2000 to 1200 is 40%
    const versions = [2000, 1800, 1600, 1400, 1200].map((count, i) =>
      followListEvent(count, 1000 + i)
    )
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    expect(result.recommended).toBeUndefined()
  })

  it('recommends the version before the latest clobber, not an older peak', () => {
    // Slow curation from 3000 to 1945, then a clobber to empty and a partial rebuild
    const versions = [3000, 2600, 2250, 1945, 0, 500, 1094].map((count, i) =>
      followListEvent(count, 1000 + i)
    )
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    expect(result.recommended?.event.id).toBe(versions[3].id)
  })

  it('treats a clobber the list has been edited on for a week as settled', () => {
    const day = 24 * 3600
    const versions = [
      followListEvent(1945, day),
      followListEvent(1114, day + 60), // clobbered
      ...[1112, 1110, 1105, 1100, 1094].map((count, i) => followListEvent(count, (i + 2) * 2 * day))
    ]
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    expect(result.recommended).toBeUndefined()
  })

  it('still recommends when the edits since a clobber all came within a week', () => {
    const hour = 3600
    const versions = [
      followListEvent(1945, hour),
      followListEvent(1114, 2 * hour), // clobbered
      ...[1112, 1110, 1105, 1100, 1094].map((count, i) => followListEvent(count, (i + 3) * hour))
    ]
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    expect(result.recommended?.event.id).toBe(versions[0].id)
  })

  it('treats back-to-back drops as one clobber', () => {
    const versions = [500, 3, 0].map((count, i) => followListEvent(count, 1000 + i))
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    expect(result.recommended?.event.id).toBe(versions[0].id)
  })

  it('points at the fullest version before a clobber that bounced', () => {
    // Clobbered, partly restored, and clobbered again within hours
    const hour = 3600
    const day = 24 * hour
    const versions = [
      followListEvent(1945, 10 * hour),
      followListEvent(1114, 11 * hour),
      followListEvent(1660, 12 * hour),
      followListEvent(1114, 13 * hour),
      followListEvent(1100, 5 * day),
      followListEvent(1094, 90 * day)
    ]
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    expect(result.recommended?.event.id).toBe(versions[0].id)
  })

  it('does not reach back to an unrelated clobber weeks earlier', () => {
    const day = 24 * 3600
    const versions = [
      followListEvent(3000, day),
      followListEvent(2000, day + 60), // clobbered
      followListEvent(2950, 2 * day), // restored the next day
      followListEvent(2600, 20 * day), // then curated down over two months
      followListEvent(2250, 40 * day),
      followListEvent(1945, 60 * day),
      followListEvent(1114, 60 * day + 60), // clobbered again
      followListEvent(1100, 90 * day)
    ]
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    expect(result.recommended?.event.id).toBe(versions[5].id)
  })

  it('takes the lowest id as current among versions from the same second', () => {
    const higher = { ...followListEvent(10, 1000), id: 'b'.repeat(64) }
    const lower = { ...followListEvent(12, 1000), id: 'a'.repeat(64) }
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: higher, relayUrl: 'wss://a' },
      { event: lower, relayUrl: 'wss://a' }
    ])
    expect(result.current?.event.id).toBe(lower.id)
  })

  it('recommends the version before a small list was emptied', () => {
    const small = followListEvent(3, 1000)
    const emptied = followListEvent(0, 2000)
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: emptied, relayUrl: 'wss://a' },
      { event: small, relayUrl: 'wss://a' }
    ])
    expect(result.recommended?.event.id).toBe(small.id)
  })

  it("measures a settled clobber from its episode's last drop", () => {
    const hour = 60 * 60
    const full = followListEvent(100, 0)
    const events = [
      full,
      followListEvent(10, hour),
      // Edits on the clobbered list, then a second drop the same day: one episode
      ...[2, 3, 4, 5, 6].map((h) => followListEvent(12, h * hour)),
      followListEvent(2, 7 * hour),
      followListEvent(3, 8 * 24 * hour)
    ]
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      events.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    // One version follows the episode's last drop, so it isn't settled
    expect(result.recommended?.event.id).toBe(full.id)
  })

  it('leaves versions of unknown size out of drops, and never recommends one', () => {
    // 50 public mutes, and private ones that can be neither decrypted nor sized
    const unsizable = { ...muteListEvent(50, 1000), content: 'A'.repeat(133) }
    const current = muteListEvent(10, 2000)
    const rank = (...events: Event[]) =>
      rankLazarusCandidates(
        LAZARUS_REGISTRY[10000],
        events.map((event) => ({ event, relayUrl: 'wss://a' }))
      )
    expect(rank(current, unsizable).recommended).toBeUndefined()
    // Consecutive means consecutive among versions of known size
    const full = muteListEvent(50, 500)
    expect(rank(current, unsizable, full).recommended?.event.id).toBe(full.id)
  })

  it('recommends nothing for meaningful-empty kinds and requires intent', () => {
    const keys = {
      ...makeEvent({ kind: 10044, created_at: 1000 }),
      tags: [['n', 'encryption-pubkey-1']]
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
    const encrypted = nip44.encrypt(JSON.stringify(privateTags(2)), selfConversationKey)
    const withPrivate = followListEvent(3, 1000, encrypted)
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: withPrivate, relayUrl: 'wss://a' }
    ])
    expect(result.candidates[0].itemCount.partial).toBe(true)
  })

  it('does not treat legacy relay JSON in a follow list as private items', () => {
    const withRelays = followListEvent(3, 1000, '{"wss://relay": {"read": true}}')
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: withRelays, relayUrl: 'wss://a' }
    ])
    expect(result.candidates[0].itemCount).toEqual({ count: 3, partial: false })
  })
})

describe('computeLazarusDelta', () => {
  it('computes additions, removals, and direction', () => {
    const current = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'a'],
        ['p', 'b']
      ]
    } as Event
    const chosen = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'b'],
        ['p', 'c']
      ]
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
      tags: [
        ['p', 'a'],
        ['p', 'b'],
        ['p', 'c']
      ]
    } as Event
    const chosen = { ...makeEvent({ kind: 3 }), tags: [['p', 'a']] } as Event
    const delta = computeLazarusDelta(chosen, current)
    expect(delta.shrinks).toBe(true)
  })

  it('treats a follow whose relay hint or petname changed as the same item', () => {
    const current = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'a'],
        ['p', 'b', 'wss://old']
      ]
    } as Event
    const chosen = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'a', 'wss://new', 'alice'],
        ['p', 'b']
      ]
    } as Event
    const delta = computeLazarusDelta(chosen, current)
    expect(delta.addedCount).toBe(0)
    expect(delta.removedCount).toBe(0)
  })

  it('counts a changed read/write marker on relay lists', () => {
    const current = { ...makeEvent({ kind: 10002 }), tags: [['r', 'wss://a', 'read']] } as Event
    const chosen = { ...makeEvent({ kind: 10002 }), tags: [['r', 'wss://a', 'write']] } as Event
    const delta = computeLazarusDelta(chosen, current)
    expect(delta.addedCount).toBe(1)
    expect(delta.removedCount).toBe(1)
  })
})

describe('computeLazarusDelta items', () => {
  it('counts a duplicated tag once, and ignores tags that are not items', () => {
    const current = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'a'],
        ['p', 'a'],
        ['client', 'x']
      ]
    } as Event
    const chosen = {
      ...makeEvent({ kind: 3 }),
      tags: [['p', 'a'], ['p'], ['client', 'y']]
    } as Event
    const delta = computeLazarusDelta(chosen, current)
    expect(delta.addedCount).toBe(0)
    expect(delta.removedCount).toBe(0)
  })

  it('compares relay URLs normalized', () => {
    const relayList = (url: string) =>
      ({ ...makeEvent({ kind: 10002 }), tags: [['r', url, 'write']] }) as Event
    const delta = computeLazarusDelta(
      relayList('wss://relay.example'),
      relayList('wss://Relay.Example/')
    )
    expect(delta.addedCount + delta.removedCount).toBe(0)
  })

  it('counts removed profile fields toward a shrink', () => {
    const profile = (fields: object) =>
      ({ ...makeEvent({ kind: 0 }), content: JSON.stringify(fields) }) as Event
    const delta = computeLazarusDelta(
      profile({ name: 'a' }),
      profile({ name: 'b', about: 'c', lud16: 'd@e.f' })
    )
    expect(delta.removedCount).toBe(2)
    expect(delta.needsShrinkConfirmation).toBe(true)
  })
})

describe('computeLazarusProfileChanges', () => {
  const profileEvent = (content: object, tags: string[][] = []) =>
    ({ ...makeEvent({ kind: 0 }), content: JSON.stringify(content), tags }) as Event

  it('lists only the profile fields that change', () => {
    const current = profileEvent({ name: 'clobbered', about: 'same' })
    const chosen = profileEvent({ name: 'Daniel', about: 'same', picture: 'https://pic' })
    expect(computeLazarusProfileChanges(chosen, current)).toEqual([
      { field: 'name', from: 'clobbered', to: 'Daniel' },
      { field: 'picture', from: undefined, to: 'https://pic' }
    ])
  })

  it('covers every field and tag a restore would replace', () => {
    const current = profileEvent({ name: 'same', pronouns: 'they/them' }, [
      ['emoji', 'wave', 'https://wave']
    ])
    const chosen = profileEvent({ name: 'same', bot: false })
    expect(computeLazarusProfileChanges(chosen, current)).toEqual([
      { field: 'bot', from: undefined, to: 'false' },
      { field: 'pronouns', from: 'they/them', to: undefined },
      { field: 'emoji tags', from: 'wave https://wave', to: undefined }
    ])
  })

  it('ignores tag order', () => {
    const tags = [
      ['emoji', 'a', 'https://a'],
      ['emoji', 'b', 'https://b']
    ]
    const current = profileEvent({ name: 'same' }, tags)
    const chosen = profileEvent({ name: 'same' }, [...tags].reverse())
    expect(computeLazarusProfileChanges(chosen, current)).toEqual([])
  })
})

describe('checkLazarusCurrent', () => {
  // Explicit ids: makeEvent's padded ids can repeat
  const version = (id: string, createdAt: number) => ({
    ...followListEvent(5, createdAt),
    id: id.padStart(64, '0')
  })
  const reviewed = version('c1', 2000)
  const older = version('c2', 1000)
  const newer = version('c3', 3000)
  const answered = (...events: Event[]) => ({ events, answered: true })
  const unanswered = (...events: Event[]) => ({ events, answered: false })

  it('proceeds over an older copy on the write relays', () => {
    expect(checkLazarusCurrent(reviewed, older, [answered(older), answered()])).toEqual({
      status: 'proceed',
      current: reviewed
    })
  })

  it('reports a newer version from a write relay or the local copy as a change', () => {
    expect(checkLazarusCurrent(reviewed, undefined, [answered(older), answered(newer)])).toEqual({
      status: 'changed',
      current: newer
    })
    expect(checkLazarusCurrent(reviewed, newer, [answered()])).toEqual({
      status: 'changed',
      current: newer
    })
    // A relay that sent a newer version and then failed still shows the edit
    expect(checkLazarusCurrent(reviewed, undefined, [unanswered(newer)])).toEqual({
      status: 'changed',
      current: newer
    })
  })

  it('reports a version from the same second with a lower id as a change', () => {
    const lowerId = version('c0', 2000)
    expect(checkLazarusCurrent(reviewed, undefined, [answered(lowerId)])).toEqual({
      status: 'changed',
      current: lowerId
    })
    // One with a higher id is the version relays drop
    expect(checkLazarusCurrent(reviewed, undefined, [answered(version('c9', 2000))])).toEqual({
      status: 'proceed',
      current: reviewed
    })
  })

  it('treats a version found when none was reviewed as a change', () => {
    expect(checkLazarusCurrent(undefined, undefined, [answered(older)])).toEqual({
      status: 'changed',
      current: older
    })
  })

  it('refuses when no write relay answered', () => {
    expect(checkLazarusCurrent(reviewed, older, [unanswered(older), unanswered()])).toEqual({
      status: 'unconfirmed'
    })
    expect(checkLazarusCurrent(reviewed, undefined, [])).toEqual({ status: 'unconfirmed' })
  })

  it('counts one empty answer as enough', () => {
    expect(checkLazarusCurrent(reviewed, undefined, [unanswered(), answered()])).toEqual({
      status: 'proceed',
      current: reviewed
    })
  })
})

describe('buildLazarusRecoveryDraft', () => {
  it('copies the candidate verbatim with a fresh timestamp', () => {
    const chosen = followListEvent(4, 999, '{"wss://relay": {"read": true}}')
    const draft = buildLazarusRecoveryDraft(chosen, { now: 1234567890 })
    expect(draft.kind).toBe(3)
    expect(draft.created_at).toBe(1234567890)
    expect(draft.content).toBe(chosen.content)
    expect(draft.tags).toEqual(chosen.tags)
    expect(draft.tags).not.toBe(chosen.tags)
  })

  it('dates the draft after the version it replaces, even one from the future', () => {
    const chosen = followListEvent(4, 999)
    const current = followListEvent(1, 1234568490) // ten minutes ahead of now
    const draft = buildLazarusRecoveryDraft(chosen, { current, now: 1234567890 })
    expect(draft.created_at).toBe(1234568491)
  })
})

describe('sortLazarusCandidates', () => {
  const small = followListEvent(10, 3000)
  const big = followListEvent(500, 1000)
  const bigNewer = followListEvent(500, 2000)
  const { candidates } = rankLazarusCandidates(
    LAZARUS_REGISTRY[3],
    [small, big, bigNewer].map((event) => ({ event, relayUrl: 'wss://a' }))
  )

  it('sorts newest first by date', () => {
    expect(sortLazarusCandidates(candidates, 'date').map((c) => c.event.id)).toEqual([
      small.id,
      bigNewer.id,
      big.id
    ])
  })

  it('sorts largest first by size, newest first on ties', () => {
    expect(sortLazarusCandidates(candidates, 'size').map((c) => c.event.id)).toEqual([
      bigNewer.id,
      big.id,
      small.id
    ])
  })
})

describe('fitsLazarusRemoteRestore', () => {
  const pubkey = 'f'.repeat(64)
  const followList = (count: number) => ({
    ...followListEvent(0, 1000),
    tags: Array.from({ length: count }, (_, i) => ['p', i.toString(16).padStart(64, '0')])
  })

  it('fits a modest follow list in one NIP-46 request', () => {
    expect(fitsLazarusRemoteRestore(followList(500), pubkey)).toBe(true)
  })

  it('flags a follow list too large for a remote signer', () => {
    expect(fitsLazarusRemoteRestore(followList(1000), pubkey)).toBe(false)
  })
})

describe('groupLazarusCandidates', () => {
  const rank = (counts: number[]) => {
    const events = counts.map((count, i) => followListEvent(count, 1000 + i))
    const scan = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      events.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    return { events, scan }
  }
  const shape = (items: LazarusListItem[]) =>
    items.map((item) =>
      item.type === 'version' ? item.candidate.event.id : item.candidates.map((c) => c.event.id)
    )

  it('folds a run of small edits and keeps the current version on its own row', () => {
    const { events, scan } = rank([1100, 1101, 1099, 1098, 1097, 1096, 1095, 1094])
    expect(shape(groupLazarusCandidates(scan, LAZARUS_REGISTRY[3]))).toEqual([
      events[7].id,
      events
        .slice(0, 7)
        .reverse()
        .map((e) => e.id)
    ])
  })

  it('folds a clobber into its own group, apart from the curation around it', () => {
    const { events, scan } = rank([2000, 1990, 1980, 1945, 1114, 1110, 1100, 1094])
    const items = groupLazarusCandidates(scan, LAZARUS_REGISTRY[3])
    expect(shape(items)).toEqual([
      events[7].id,
      [events[6].id, events[5].id],
      [events[4].id, events[3].id],
      [events[2].id, events[1].id, events[0].id]
    ])
    expect(items.map((item) => item.type === 'group' && item.clobbered)).toEqual([
      false,
      false,
      true,
      false
    ])
    expect(scan.recommended?.event.id).toBe(events[3].id)
  })

  it('keeps empty versions on their own rows', () => {
    const { events, scan } = rank([500, 490, 0, 480, 470, 460])
    expect(shape(groupLazarusCandidates(scan, LAZARUS_REGISTRY[3]))).toEqual([
      events[5].id,
      [events[4].id, events[3].id],
      events[2].id,
      events[1].id,
      events[0].id
    ])
  })

  it('can leave out past empty versions, but never an empty current one', () => {
    const { events, scan } = rank([500, 490, 0, 480, 470, 460])
    const items = groupLazarusCandidates(scan, LAZARUS_REGISTRY[3], { hidePastEmpty: true })
    expect(shape(items)).toEqual([
      events[5].id,
      [events[4].id, events[3].id],
      events[1].id,
      events[0].id
    ])
    const emptied = rank([300, 0])
    const emptiedItems = groupLazarusCandidates(emptied.scan, LAZARUS_REGISTRY[3], {
      hidePastEmpty: true
    })
    expect(shape(emptiedItems)).toEqual([emptied.events[1].id, emptied.events[0].id])
  })

  it('keeps empty versions of meaningful-empty kinds, where empty is a valid option', () => {
    const events = [1000, 1001].map((createdAt, i) => ({
      ...makeEvent({ created_at: createdAt, kind: 10044 }),
      tags: i === 0 ? [] : [['n', 'a'.repeat(64)]]
    }))
    const scan = rankLazarusCandidates(
      LAZARUS_REGISTRY[10044],
      events.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    const items = groupLazarusCandidates(scan, LAZARUS_REGISTRY[10044], { hidePastEmpty: true })
    expect(items).toHaveLength(2)
  })
  it('does not group kinds where any two versions can differ', () => {
    const events = [1000, 1001, 1002].map((createdAt) => ({
      ...makeEvent({ created_at: createdAt, kind: 0 }),
      content: '{"name":"a"}'
    }))
    const scan = rankLazarusCandidates(
      LAZARUS_REGISTRY[0],
      events.map((event) => ({ event, relayUrl: 'wss://a' }))
    )
    const items = groupLazarusCandidates(scan, LAZARUS_REGISTRY[0])
    expect(items.every((item) => item.type === 'version')).toBe(true)
  })
})

/** A relay list as the client returns it once it has found the user's kind 10002. */
function relayListOf(write: string[], read: string[] = []) {
  return {
    write,
    read,
    originalRelays: [...write, ...read].map((url) => ({ url, scope: 'both' as const }))
  }
}

type RelayHandlers = {
  onevent?: (event: Event) => void
  oneose?: () => void
  onclose?: (reason: string) => void
  eoseTimeout?: number
}

/**
 * Relays answer through the fake pool: `respond` plays each relay's side of a
 * request, a microtask after it's made. Relays in `refuse` refuse the
 * connection.
 */
function relays(
  respond: (url: string, filter: Filter, handlers: RelayHandlers) => void,
  { refuse = [] }: { refuse?: string[] } = {}
) {
  pool.ensureRelay.mockImplementation(async (url) => {
    if (refuse.includes(url)) throw new Error('connection refused')
    return {
      url,
      subscribe: (filters: Filter[], handlers: RelayHandlers) => {
        queueMicrotask(() => respond(url, filters[0], handlers))
        return { close: () => {} }
      }
    } as unknown as IRelay
  })
}

/** Every relay answers every request (EOSE), serving `events` whatever the filter. */
function answerAll(events: Event[] = []) {
  relays((_url, _filter, handlers) => {
    events.forEach((event) => handlers.onevent?.(event))
    handlers.oneose?.()
  })
}

/** Every relay refuses the connection. */
function failAll() {
  pool.ensureRelay.mockRejectedValue(new Error('connection refused'))
}

describe('getLazarusScanPlan', () => {
  afterEach(() => {
    pool.ensureRelay.mockReset()
  })

  it('scans every user relay, the defaults, and the archival set', async () => {
    vi.mocked(client.fetchRelayList).mockResolvedValueOnce(
      relayListOf(
        ['wss://w1/', 'wss://w2/', 'wss://w3/', 'wss://w4/', 'wss://w5/', 'wss://w6/'],
        ['wss://hist.nostr.land/', 'wss://r1/']
      )
    )
    const { relays, relayList } = await getLazarusScanPlan('pubkey')
    expect(relayList).toBe('found')
    // Past the first five write relays, and read relays too
    expect(relays).toEqual(expect.arrayContaining(['wss://w6/', 'wss://r1/', 'wss://default/']))
    for (const url of LAZARUS_ARCHIVAL_RELAYS) {
      expect(relays).toContain(normalizeUrl(url))
    }
    // A user relay that is also archival is scanned once
    expect(relays.filter((url) => url === 'wss://hist.nostr.land/')).toHaveLength(1)
    expect(new Set(relays).size).toBe(relays.length)
  })

  it('looks the relay list up itself when the client has none, taking the newest', async () => {
    vi.mocked(client.fetchRelayList).mockRejectedValueOnce(new Error('offline'))
    const relayListEvent = (id: string, createdAt: number, url: string) => ({
      ...makeEvent({ kind: 10002, created_at: createdAt }),
      id: id.padStart(64, '0'),
      tags: [['r', url, 'write']]
    })
    answerAll([relayListEvent('b1', 1000, 'wss://old/'), relayListEvent('b2', 2000, 'wss://new/')])
    const plan = await getLazarusScanPlan('test-pubkey')
    expect(plan.relayList).toBe('found')
    expect(plan.write).toEqual(['wss://new/'])
  })

  it('lets the defaults stand in when relays answered without a relay list', async () => {
    vi.mocked(client.fetchRelayList).mockRejectedValueOnce(new Error('offline'))
    answerAll()
    const plan = await getLazarusScanPlan('pubkey')
    expect(plan.relayList).toBe('missing')
    expect(plan.write).toEqual(['wss://default/'])
    expect(plan.relays).toContain('wss://hist.nostr.land/')
  })

  it('never substitutes the defaults when every relay refuses the lookup', async () => {
    vi.mocked(client.fetchRelayList).mockRejectedValueOnce(new Error('offline'))
    failAll()
    const plan = await getLazarusScanPlan('pubkey')
    expect(plan.relayList).toBe('unknown')
    expect(plan.write).toEqual([])
    // The default and archival sets are still scanned
    expect(plan.relays).toContain('wss://default/')
    expect(plan.relays).toContain('wss://hist.nostr.land/')
  })
})

describe('getLazarusPublishRelays', () => {
  afterEach(() => {
    pool.ensureRelay.mockReset()
  })

  it('judges success on the write relays and sends the rest as extras', async () => {
    vi.mocked(client.fetchRelayList).mockResolvedValueOnce(
      relayListOf(
        ['wss://w1/', 'wss://w2/', 'wss://w3/', 'wss://w4/', 'wss://w5/', 'wss://w6/'],
        ['wss://r1/']
      )
    )
    const relays = await getLazarusPublishRelays('pubkey', ['wss://hist.nostr.land', 'wss://w1/'])
    expect(relays).toEqual({
      write: ['wss://w1/', 'wss://w2/', 'wss://w3/', 'wss://w4/', 'wss://w5/', 'wss://w6/'],
      extra: ['wss://hist.nostr.land/']
    })
  })

  it('falls back to the default relays when the user has no relay list', async () => {
    vi.mocked(client.fetchRelayList).mockRejectedValueOnce(new Error('offline'))
    answerAll()
    expect(await getLazarusPublishRelays('pubkey', ['wss://a/'])).toEqual({
      write: ['wss://default/'],
      extra: ['wss://a/']
    })
  })
})

describe('publishLazarusRecovery', () => {
  const event = followListEvent(3, 1000)

  afterEach(() => {
    vi.mocked(client.publishEvent).mockReset()
  })

  it('succeeds when one write relay accepts, short of the client threshold', async () => {
    vi.mocked(client.publishEvent).mockRejectedValueOnce(
      new AggregateError([new Error('wss://w2/: blocked'), new Error('wss://w3/: blocked')])
    )
    await expect(
      publishLazarusRecovery(['wss://w1/', 'wss://w2/', 'wss://w3/'], event)
    ).resolves.toBeUndefined()
  })

  it('fails when no write relay accepts', async () => {
    vi.mocked(client.publishEvent).mockRejectedValueOnce(
      new AggregateError([new Error('wss://w1/: blocked'), new Error('wss://w2/: blocked')])
    )
    await expect(publishLazarusRecovery(['wss://w1/', 'wss://w2/'], event)).rejects.toThrow()
    await expect(publishLazarusRecovery([], event)).rejects.toThrow()
  })
})

describe('relay queries', () => {
  const HISTORY_RELAY = 'wss://hist.nostr.land/'
  // 70 versions on one relay: more than one page. Explicit ids, since
  // makeEvent's padded ids repeat past a few dozen events.
  const history = Array.from({ length: 70 }, (_, i) => ({
    ...followListEvent(10, 1000 + i),
    id: (i + 1).toString(16).padStart(64, '0')
  }))
  const profile = getLazarusKindProfile(3)!

  // This relay serves a fixed history; every other relay answers with nothing
  const serve = (relay: string, events: Event[], honorUntil = true) =>
    relays((url, filter, handlers) => {
      const { until, limit = 50 } = filter as { until?: number; limit?: number }
      if (url === relay) {
        events
          .filter((event) => !honorUntil || until === undefined || event.created_at <= until)
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, limit)
          .forEach((event) => handlers.onevent?.(event))
      }
      handlers.oneose?.()
    })

  beforeEach(() => {
    vi.mocked(client.fetchRelayList).mockResolvedValue({
      write: [],
      read: [],
      originalRelays: []
    })
  })

  afterEach(() => {
    vi.mocked(client.fetchRelayList).mockReset()
    pool.ensureRelay.mockReset()
    Object.assign(client, { signer: undefined })
  })

  it('pages back from relays that filled a page', async () => {
    serve(HISTORY_RELAY, history)
    const scan = await scanLazarusKind(3, 'test-pubkey')
    expect(scan.candidates).toHaveLength(50)
    expect(scan.olderCursors).toEqual({ [HISTORY_RELAY]: 1020 })
    // Re-ranking once private items are decrypted keeps the cursors
    expect(applyLazarusPrivateTags(profile, scan, new Map()).olderCursors).toEqual(
      scan.olderCursors
    )

    const older = await loadOlderLazarusVersions(profile, scan, 'test-pubkey')
    expect(older.candidates).toHaveLength(70)
    expect(older.olderCursors).toEqual({})
    expect(older.queriedRelays).toEqual(scan.queriedRelays)
  })

  it('stops paging a relay that ignores until', async () => {
    serve(HISTORY_RELAY, history, false)
    const scan = await scanLazarusKind(3, 'test-pubkey')
    const older = await loadOlderLazarusVersions(profile, scan, 'test-pubkey')
    expect(older.candidates).toHaveLength(50)
    expect(older.olderCursors).toEqual({})
  })

  it('closes relay subscriptions that time out, and fails a scan no relay answered', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn()
      const subscribe = vi.fn(() => ({ close }))
      pool.ensureRelay.mockImplementation(async (url) => ({ url, subscribe }) as unknown as IRelay)
      const pending = scanLazarusKind(3, 'test-pubkey')
      // Attach the rejection handler before the timers fire
      const failed = expect(pending).rejects.toThrow('No relay answered the scan')
      // The relay list lookup times out, then the scan
      await vi.advanceTimersByTimeAsync(12000)
      await failed
      expect(subscribe).toHaveBeenCalled()
      expect(close).toHaveBeenCalledTimes(subscribe.mock.calls.length)
    } finally {
      vi.useRealTimers()
    }
  })

  it('times a silent relay out before its own EOSE timeout can report an answer', async () => {
    vi.useFakeTimers()
    try {
      // Like nostr-tools, a relay subscription reports EOSE by itself once its
      // timeout passes, whether or not the relay sent one
      pool.ensureRelay.mockImplementation(
        async (url) =>
          ({
            url,
            subscribe: (_filters: Filter[], handlers: RelayHandlers) => {
              const timer = setTimeout(() => handlers.oneose?.(), handlers.eoseTimeout ?? 4400)
              return { close: () => clearTimeout(timer) }
            }
          }) as unknown as IRelay
      )
      const pending = scanLazarusKind(3, 'test-pubkey')
      const failed = expect(pending).rejects.toThrow('No relay answered the scan')
      await vi.advanceTimersByTimeAsync(12000)
      await failed
    } finally {
      vi.useRealTimers()
    }
  })

  it('records how each relay ended, keeping versions sent before a failure', async () => {
    vi.mocked(client.fetchRelayList).mockResolvedValue(relayListOf(['wss://w1/']))
    const partial = { ...followListEvent(5, 1000), id: 'p1'.padStart(64, '0') }
    relays(
      (url, _filter, handlers) => {
        if (url === HISTORY_RELAY) {
          // Sends a version, then its connection drops before EOSE
          handlers.onevent?.(partial)
          return handlers.onclose?.('relay connection closed')
        }
        // Asks to authenticate, with no signer to do it
        if (url === 'wss://w1/') return handlers.onclose?.('auth-required: sign in')
        if (url === 'wss://nostr.mom/') return handlers.onclose?.('blocked: rate limited')
        handlers.oneose?.()
      },
      { refuse: ['wss://purplepag.es/'] }
    )
    const scan = await scanLazarusKind(3, 'test-pubkey')
    expect(scan.candidates.map((c) => c.event.id)).toEqual([partial.id])
    expect(scan.relayOutcomes?.[HISTORY_RELAY]).toBe('failed')
    expect(scan.relayOutcomes?.['wss://w1/']).toBe('failed')
    // A CLOSED before EOSE, and a refused connection, are failures, never empty answers
    expect(scan.relayOutcomes?.['wss://nostr.mom/']).toBe('failed')
    expect(scan.relayOutcomes?.['wss://purplepag.es/']).toBe('failed')
    expect(scan.relayOutcomes?.['wss://nos.lol/']).toBe('answered')
    // The only write relay failed, so current is unconfirmed
    expect(scan.currentConfirmed).toBe(false)
    expect(lazarusScanReachedNoRelay(scan)).toBe(false)
  })

  it('authenticates only to relays in the user list', async () => {
    vi.mocked(client.fetchRelayList).mockResolvedValue(relayListOf(['wss://w1/']))
    const signer = { signEvent: vi.fn(async (event: EventTemplate) => ({ ...event, sig: 'auth' })) }
    Object.assign(client, { signer })
    const authenticated = new Set<string>()
    pool.ensureRelay.mockImplementation(
      async (url) =>
        ({
          url,
          auth: async (sign: (event: EventTemplate) => Promise<unknown>) => {
            await sign({ kind: 22242, created_at: 0, tags: [], content: '' })
            authenticated.add(url)
          },
          subscribe: (_filters: Filter[], handlers: RelayHandlers) => {
            queueMicrotask(() => {
              // The user's own relay and an archival one both require authentication
              const restricted = url === 'wss://w1/' || url === HISTORY_RELAY
              if (restricted && !authenticated.has(url)) {
                return handlers.onclose?.('auth-required: sign in')
              }
              handlers.oneose?.()
            })
            return { close: () => {} }
          }
        }) as unknown as IRelay
    )
    const scan = await scanLazarusKind(3, 'test-pubkey')
    expect([...authenticated]).toEqual(['wss://w1/'])
    expect(signer.signEvent).toHaveBeenCalledTimes(1)
    expect(scan.relayOutcomes?.['wss://w1/']).toBe('answered')
    expect(scan.relayOutcomes?.[HISTORY_RELAY]).toBe('failed')
    expect(scan.currentConfirmed).toBe(true)
  })

  it('recommends nothing while no write relay answered', async () => {
    vi.mocked(client.fetchRelayList).mockResolvedValue(relayListOf(['wss://w1/']))
    // A clear clobber on the history relay: 40 follows, then 3
    const full = { ...followListEvent(40, 1000), id: 'd1'.padStart(64, '0') }
    const clobbered = { ...followListEvent(3, 2000), id: 'd2'.padStart(64, '0') }
    const serveClobber = (writeRelayAnswers: boolean) =>
      relays(
        (url, _filter, handlers) => {
          if (url === HISTORY_RELAY) [full, clobbered].forEach((e) => handlers.onevent?.(e))
          handlers.oneose?.()
        },
        { refuse: writeRelayAnswers ? [] : ['wss://w1/'] }
      )
    serveClobber(true)
    expect((await scanLazarusKind(3, 'test-pubkey')).recommended?.event.id).toBe(full.id)
    serveClobber(false)
    const unconfirmed = await scanLazarusKind(3, 'test-pubkey')
    expect(unconfirmed.currentConfirmed).toBe(false)
    expect(unconfirmed.recommended).toBeUndefined()
  })

  it('shows versions that arrived even when no relay answered', async () => {
    vi.mocked(client.fetchRelayList).mockResolvedValue(relayListOf(['wss://w1/']))
    const partial = { ...followListEvent(5, 1000), id: 'e1'.padStart(64, '0') }
    relays((url, _filter, handlers) => {
      if (url === HISTORY_RELAY) handlers.onevent?.(partial)
      handlers.onclose?.('relay connection closed')
    })
    const scan = await scanLazarusKind(3, 'test-pubkey')
    expect(scan.candidates.map((c) => c.event.id)).toEqual([partial.id])
    expect(lazarusScanReachedNoRelay(scan)).toBe(true)
  })

  it('counts only valid versions of the list from each relay', async () => {
    vi.mocked(verifyEvent).mockImplementation((event) => event.sig !== 'forged')
    try {
      const version = (id: string, overrides: Partial<Event> = {}) => ({
        ...followListEvent(5, 1000),
        id: id.padStart(64, '0'),
        ...overrides
      })
      const valid = version('v1')
      const foreign = version('v2', { pubkey: 'someone-else' })
      const wrongKind = version('v3', { kind: 10000 })
      // A full page of forged versions must not count or move a cursor
      const forged = Array.from({ length: 50 }, (_, i) =>
        version(`f${i}`, { sig: 'forged', created_at: 900 + i })
      )
      relays((url, _filter, handlers) => {
        const events =
          url === HISTORY_RELAY
            ? [valid, foreign, wrongKind]
            : url === 'wss://nos.lol/'
              ? forged
              : []
        events.forEach((event) => handlers.onevent?.(event))
        handlers.oneose?.()
      })
      const scan = await scanLazarusKind(3, 'test-pubkey')
      expect(scan.candidates.map((c) => c.event.id)).toEqual([valid.id])
      expect(scan.respondingRelays).toEqual([HISTORY_RELAY])
      expect(scan.olderCursors).toEqual({})
    } finally {
      vi.mocked(verifyEvent).mockImplementation(() => true)
    }
  })

  it('reads every write relay before a restore, telling failed reads from empty ones', async () => {
    vi.mocked(client.fetchRelayList).mockResolvedValue(
      relayListOf(['wss://w1/', 'wss://w2/', 'wss://w3/'])
    )
    const newer = followListEvent(6, 2000)
    const foreign = { ...followListEvent(6, 3000), pubkey: 'someone-else' }
    // w3 refuses the connection, so it sends nothing and doesn't answer
    relays(
      (url, _filter, handlers) => {
        handlers.onevent?.(url === 'wss://w1/' ? foreign : newer)
        handlers.oneose?.()
      },
      { refuse: ['wss://w3/'] }
    )
    expect(await readLazarusCurrent(3, 'test-pubkey')).toEqual([
      { events: [], answered: true },
      { events: [newer], answered: true },
      { events: [], answered: false }
    ])
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
    await expect(
      scanLazarusKind(1, 'test-pubkey', {
        fetchVersions: async () => ({ tagged: [], queriedRelays: [], respondingRelays: [] })
      })
    ).rejects.toThrow(/not in the Lazarus registry/)
  })
})

describe('private items', () => {
  const muteProfile = LAZARUS_REGISTRY[10000]

  it('sizes private-only mute lists instead of reading them as empty', () => {
    const full = privateMuteListEvent(privateTags(593), 1000)
    const range = getLazarusItemRange(
      rankLazarusCandidates(muteProfile, [{ event: full, relayUrl: 'wss://a' }]).candidates[0]
        .itemCount
    )
    expect(range.min).toBeLessThanOrEqual(593)
    expect(range.max).toBeGreaterThanOrEqual(593)
    expect(range.min).toBeGreaterThan(0)
  })

  it('recommends the full version when a client emptied the private list', () => {
    const full = privateMuteListEvent(privateTags(593), 1000)
    const emptied = privateMuteListEvent(privateTags(1), 2000)
    const result = rankLazarusCandidates(muteProfile, [
      { event: emptied, relayUrl: 'wss://a' },
      { event: full, relayUrl: 'wss://b' }
    ])
    expect(result.current?.event.id).toBe(emptied.id)
    expect(result.candidates[0].event.id).toBe(full.id)
    expect(result.recommended?.event.id).toBe(full.id)
  })

  it('recommends nothing when the current private list is already the full one', () => {
    const emptied = privateMuteListEvent(privateTags(1), 1000)
    const full = privateMuteListEvent(privateTags(593), 2000)
    const result = rankLazarusCandidates(muteProfile, [
      { event: emptied, relayUrl: 'wss://a' },
      { event: full, relayUrl: 'wss://b' }
    ])
    expect(result.current?.event.id).toBe(full.id)
    expect(result.recommended).toBeUndefined()
  })

  it('recommends nothing while the current size is unknown', () => {
    // Looks like NIP-44 but isn't a valid payload size, so it can't be sized
    const unsizable = { ...makeEvent({ created_at: 2000, kind: 10000 }), content: 'A'.repeat(133) }
    const full = privateMuteListEvent(privateTags(593), 1000)
    const result = rankLazarusCandidates(muteProfile, [
      { event: unsizable, relayUrl: 'wss://a' },
      { event: full, relayUrl: 'wss://b' }
    ])
    expect(result.recommended).toBeUndefined()
  })

  it('uses exact counts once private items are decrypted', () => {
    const olderTags = privateTags(40)
    const newerTags = privateTags(2)
    const older = privateMuteListEvent(olderTags, 1000)
    const newer = privateMuteListEvent(newerTags, 2000)
    const scan = rankLazarusCandidates(muteProfile, [
      { event: newer, relayUrl: 'wss://a' },
      { event: older, relayUrl: 'wss://b' }
    ])
    const decrypted = applyLazarusPrivateTags(
      muteProfile,
      scan,
      new Map([
        [older.id, olderTags],
        [newer.id, newerTags]
      ])
    )
    const olderCandidate = decrypted.candidates.find((c) => c.event.id === older.id)!
    expect(olderCandidate.itemCount).toEqual({ count: 0, partial: false, privateCount: 40 })
    expect(decrypted.recommended?.event.id).toBe(older.id)
    expect(decrypted.candidates[0].foundOn).toEqual(['wss://b'])
  })

  it('diffs private items together with public tags', () => {
    const [a, b, c] = privateTags(3)
    const current = { ...privateMuteListEvent([a, b], 2000), tags: [c] }
    const chosen = privateMuteListEvent([a, c], 1000)
    const delta = computeLazarusDelta(
      chosen,
      current,
      new Map([
        [current.id, [a, b]],
        [chosen.id, [a, c]]
      ])
    )
    // c moved from public to private, so only b is a change
    expect(delta.removed).toEqual([b])
    expect(delta.addedCount).toBe(0)
    expect(delta.privateUnknown).toBe(false)
  })

  it('flags a delta whose private items were not decrypted', () => {
    const current = privateMuteListEvent(privateTags(3), 2000)
    const chosen = privateMuteListEvent(privateTags(5), 1000)
    expect(computeLazarusDelta(chosen, current).privateUnknown).toBe(true)
  })

  it('says which side has private items that were not decrypted', () => {
    const encrypted = privateMuteListEvent(privateTags(3), 2000)
    const plain = { ...muteListEvent(0, 1000), tags: [['p', 'x']] }
    const overEncrypted = computeLazarusDelta(plain, encrypted)
    expect(overEncrypted.privateUnknownCurrent).toBe(true)
    expect(overEncrypted.privateUnknownChosen).toBe(false)
    // It adds an item, but replaces private items nobody counted
    expect(overEncrypted.shrinks).toBe(false)
    expect(overEncrypted.needsShrinkConfirmation).toBe(true)
    const restoringEncrypted = computeLazarusDelta(encrypted, plain)
    expect(restoringEncrypted.privateUnknownChosen).toBe(true)
    expect(restoringEncrypted.privateUnknownCurrent).toBe(false)
  })

  it('treats identical encrypted content as the same private items', () => {
    const tags = privateTags(4)
    const current = privateMuteListEvent(tags, 2000)
    const chosen = { ...current, id: 'f'.repeat(64), created_at: 1000, tags: [['p', 'x']] }
    const delta = computeLazarusDelta(chosen, current)
    expect(delta.privateUnknown).toBe(false)
    expect(delta.needsShrinkConfirmation).toBe(false)
    // Decrypting either one covers both
    const decrypted = computeLazarusDelta(chosen, current, new Map([[current.id, tags]]))
    expect(decrypted.added).toEqual([['p', 'x']])
    expect(decrypted.removedCount).toBe(0)
  })
})
