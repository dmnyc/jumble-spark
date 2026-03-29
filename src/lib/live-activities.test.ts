import { describe, expect, it, vi } from 'vitest'
import {
  parseLiveActivityEvent,
  preferredLiveJoinUrlForEvent,
  resolveParentSpacesForLiveActivities
} from './live-activities'
import { nip19, type Event } from 'nostr-tools'

const base = (kind: number, tags: string[][], pubkey = 'a'.repeat(64)): Event =>
  ({
    kind,
    pubkey,
    content: '',
    tags,
    id: 'b'.repeat(64),
    sig: 'c'.repeat(128),
    created_at: 1_700_000_000
  }) as Event

describe('parseLiveActivityEvent (NIP-53)', () => {
  it('accepts 30312 meeting space when status is open (not live)', () => {
    const ev = base(30312, [
      ['d', 'room-1'],
      ['room', 'Main Hall'],
      ['status', 'open'],
      ['service', 'https://meet.example.com/r/abc']
    ])
    const item = parseLiveActivityEvent(ev, new Set())
    expect(item).not.toBeNull()
    expect(item?.title).toBe('Main Hall')
    expect(item?.joinUrl).toBe('https://meet.example.com/r/abc')
  })

  it('rejects 30312 when status is closed', () => {
    const ev = base(30312, [
      ['d', 'room-1'],
      ['room', 'X'],
      ['status', 'closed'],
      ['service', 'https://meet.example.com/r/abc']
    ])
    expect(parseLiveActivityEvent(ev, new Set())).toBeNull()
  })

  it('requires status live for 30311', () => {
    const ev = base(30311, [
      ['d', 's1'],
      ['status', 'planned'],
      ['streaming', 'https://x/stream.m3u8']
    ])
    expect(parseLiveActivityEvent(ev, new Set())).toBeNull()
  })

  it('excludes 30311 when ends is in the past (even if status is still live)', () => {
    const nowSec = 1_700_000_000
    const pk = 'a'.repeat(64)
    const ev = base(
      30311,
      [
        ['d', 's1'],
        ['status', 'live'],
        ['ends', String(nowSec - 60)]
      ],
      pk
    )
    expect(parseLiveActivityEvent(ev, new Set(), new Map(), nowSec)).toBeNull()
  })

  it('keeps 30311 when ends is in the future', () => {
    const nowSec = 1_700_000_000
    const pk = 'a'.repeat(64)
    const ev = base(
      30311,
      [
        ['d', 's1'],
        ['status', 'live'],
        ['ends', String(nowSec + 3600)]
      ],
      pk
    )
    expect(parseLiveActivityEvent(ev, new Set(), new Map(), nowSec)).not.toBeNull()
  })

  it('excludes 30311 when status is ended', () => {
    const ev = base(30311, [
      ['d', 's1'],
      ['status', 'ended'],
      ['streaming', 'https://example.com/x.m3u8']
    ])
    expect(parseLiveActivityEvent(ev, new Set())).toBeNull()
  })

  it('uses zap.stream naddr page for 30311 when streaming is only HLS manifest', () => {
    const pk = 'a'.repeat(64)
    const ev = base(
      30311,
      [
        ['d', 's1'],
        ['status', 'live'],
        ['streaming', 'https://example.com/live/stream.m3u8']
      ],
      pk
    )
    const item = parseLiveActivityEvent(ev, new Set())
    expect(item?.joinUrl).toMatch(/^https:\/\/zap\.stream\/naddr1/)
  })

  it('30311 prefers canonical zap.stream URL over legacy https service', () => {
    const pk = 'c'.repeat(64)
    const ev = base(
      30311,
      [
        ['d', 'my-stream'],
        ['status', 'live'],
        ['service', 'https://legacy.example.com/watch/old']
      ],
      pk
    )
    const naddr = nip19.naddrEncode({ kind: 30311, pubkey: pk, identifier: 'my-stream' })
    expect(parseLiveActivityEvent(ev, new Set())?.joinUrl).toBe(`https://zap.stream/${naddr}`)
  })

  it('30313 inherits join URL from parent 30312 via `a` tag', () => {
    const spacePk = 'f'.repeat(64)
    const parentAddr = `30312:${spacePk}:conf-room`
    const parent = base(
      30312,
      [
        ['d', 'conf-room'],
        ['room', 'Conference'],
        ['status', 'open'],
        ['service', 'https://meet.example.com/space/xyz']
      ],
      spacePk
    )
    const meeting = base(30313, [
      ['d', 'annual-2025'],
      ['a', parentAddr, 'wss://relay.example.com'],
      ['title', 'Annual Meeting'],
      ['status', 'live'],
      ['starts', '1700000000']
    ])
    const map = new Map<string, Event>([[parentAddr, parent]])
    const item = parseLiveActivityEvent(meeting, new Set(), map)
    expect(item).not.toBeNull()
    expect(item?.joinUrl).toBe('https://meet.example.com/space/xyz')
    expect(item?.title).toBe('Annual Meeting')
  })
})

describe('preferredLiveJoinUrlForEvent (Nostr Nests & Corny Chat)', () => {
  it('30312 Nostr Nests: prefers nostrnests.com naddr over MoQ streaming URL', () => {
    const pk = 'a'.repeat(64)
    const ev = base(30312, [
      ['d', 'nest-room-1'],
      ['title', 'Jam session'],
      ['summary', ''],
      ['streaming', 'https://moq.nostrnests.com'],
      ['auth', 'https://moq-auth.nostrnests.com'],
      ['status', 'open'],
      ['starts', '1700000000'],
      ['relays', 'wss://nos.lol']
    ])
    const naddr = nip19.naddrEncode({
      kind: 30312,
      pubkey: pk,
      identifier: 'nest-room-1',
      relays: ['wss://nos.lol']
    })
    expect(preferredLiveJoinUrlForEvent(ev)).toBe(`https://nostrnests.com/${naddr}`)
  })

  it('Corny Chat kind 1: prefers r over service when they differ', () => {
    const ev = base(1, [
      ['L', 'com.cornychat'],
      ['audioserver', 'cornychat.com'],
      ['r', 'https://cornychat.com/room-a'],
      ['service', 'https://cornychat.com/room-b'],
      ['streaming', 'https://cornychat.com/room-b']
    ])
    expect(preferredLiveJoinUrlForEvent(ev)).toBe('https://cornychat.com/room-a')
  })
})

describe('resolveParentSpacesForLiveActivities', () => {
  it('fetches 30312 when 30313 references parent but has no URL', async () => {
    const spacePk = 'e'.repeat(64)
    const parentAddr = `30312:${spacePk}:hall`
    const meeting = base(30313, [
      ['d', 'm1'],
      ['a', parentAddr],
      ['title', 'Town hall'],
      ['status', 'live'],
      ['starts', '1700000000']
    ])
    const parent = base(
      30312,
      [
        ['d', 'hall'],
        ['room', 'Main'],
        ['status', 'open'],
        ['service', 'https://join.example/hall']
      ],
      spacePk
    )
    const fetchEvents = vi.fn().mockResolvedValue([parent])
    const map = await resolveParentSpacesForLiveActivities([meeting], ['wss://r.test'], fetchEvents)
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    expect(map.get(parentAddr)?.kind).toBe(30312)
    expect(map.get(parentAddr)?.pubkey).toBe(spacePk)
  })
})
