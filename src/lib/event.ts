import { CALENDAR_EVENT_KINDS, ExtendedKind } from '@/constants'
import { EMBEDDED_EVENT_REGEX, EMBEDDED_MENTION_REGEX, NOSTR_EMBEDDED_NOTE_REGEX } from '@/lib/content-patterns'
import { cleanUrl } from '@/lib/url'
import client from '@/services/client.service'
import { TImetaInfo } from '@/types'
import { LRUCache } from 'lru-cache'
import { Event, getEventHash, kinds, nip19, UnsignedEvent } from 'nostr-tools'
import { getPow } from 'nostr-tools/nip13'
import {
  generateBech32IdFromATag,
  generateBech32IdFromETag,
  getImetaInfoFromImetaTag,
  tagNameEquals
} from './tag'

const EVENT_EMBEDDED_NOTES_CACHE = new LRUCache<string, string[]>({ max: 10000 })
const EVENT_EMBEDDED_PUBKEYS_CACHE = new LRUCache<string, string[]>({ max: 10000 })
const EVENT_IS_REPLY_NOTE_CACHE = new LRUCache<string, boolean>({ max: 10000 })

export function isNsfwEvent(event: Event) {
  return event.tags.some(
    ([tagName, tagValue]) =>
      tagName === 'content-warning' || (tagName === 't' && tagValue.toLowerCase() === 'nsfw')
  )
}

export function isReplyNoteEvent(event: Event) {
  if ([ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, 1111].includes(event.kind)) {
    return true
  }

  // Zap receipts are considered replies if they have an 'e' tag (zapping a note) or 'a' tag (zapping an addressable event)
  if (event.kind === kinds.Zap) {
    return event.tags.some(tag => tag[0] === 'e' || tag[0] === 'a')
  }

  if (event.kind !== kinds.ShortTextNote) return false

  const cache = EVENT_IS_REPLY_NOTE_CACHE.get(event.id)
  if (cache !== undefined) return cache

  const isReply = !!getParentETag(event) || !!getParentATag(event)
  EVENT_IS_REPLY_NOTE_CACHE.set(event.id, isReply)
  return isReply
}

export function isReplaceableEvent(kind: number) {
  return (
    kinds.isReplaceableKind(kind) ||
    kinds.isAddressableKind(kind) ||
    CALENDAR_EVENT_KINDS.includes(kind)
  )
}

export function isPictureEvent(event: Event) {
  return event.kind === ExtendedKind.PICTURE
}

export function isProtectedEvent(event: Event) {
  return event.tags.some(([tagName]) => tagName === '-')
}

export function isMentioningMutedUsers(event: Event, mutePubkeySet: Set<string>) {
  for (const [tagName, pubkey] of event.tags) {
    if (tagName === 'p' && mutePubkeySet.has(pubkey)) {
      return true
    }
  }
  return false
}

export function getParentETag(event?: Event) {
  if (!event) return undefined

  if (event.kind === ExtendedKind.COMMENT || event.kind === ExtendedKind.VOICE_COMMENT) {
    return event.tags.find(tagNameEquals('e')) ?? event.tags.find(tagNameEquals('E'))
  }

  // Handle DISCUSSION events (kind 11) - they use e tag for parent reference
  if (event.kind === ExtendedKind.DISCUSSION) {
    return event.tags.find(tagNameEquals('e')) ?? event.tags.find(tagNameEquals('E'))
  }

  if (event.kind !== kinds.ShortTextNote) return undefined

  let tag = event.tags.find(([tagName, , , marker]) => {
    return tagName === 'e' && marker === 'reply'
  })
  if (!tag) {
    const embeddedEventIds = getEmbeddedNoteBech32Ids(event)
    tag = event.tags.findLast(
      ([tagName, tagValue, , marker]) =>
        tagName === 'e' &&
        !!tagValue &&
        marker !== 'mention' &&
        !embeddedEventIds.includes(tagValue)
    )
  }
  return tag
}

export function getParentATag(event?: Event) {
  if (
    !event ||
    ![kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, ExtendedKind.DISCUSSION].includes(event.kind)
  ) {
    return undefined
  }

  return event.tags.find(tagNameEquals('a')) ?? event.tags.find(tagNameEquals('A'))
}

export function getParentEventHexId(event?: Event) {
  const tag = getParentETag(event)
  return tag?.[1]
}

export function getParentBech32Id(event?: Event) {
  const eTag = getParentETag(event)
  if (!eTag) {
    const aTag = getParentATag(event)
    if (!aTag) return undefined

    return generateBech32IdFromATag(aTag)
  }

  return generateBech32IdFromETag(eTag)
}

export function getRootETag(event?: Event) {
  if (!event) return undefined

  if (event.kind === ExtendedKind.COMMENT || event.kind === ExtendedKind.VOICE_COMMENT) {
    return event.tags.find(tagNameEquals('E'))
  }

  // Handle DISCUSSION events (kind 11) - they use E tag for root reference
  if (event.kind === ExtendedKind.DISCUSSION) {
    return event.tags.find(tagNameEquals('E'))
  }

  if (event.kind !== kinds.ShortTextNote) return undefined

  let tag = event.tags.find(([tagName, , , marker]) => {
    return tagName === 'e' && marker === 'root'
  })
  if (!tag) {
    const embeddedEventIds = getEmbeddedNoteBech32Ids(event)
    tag = event.tags.find(
      ([tagName, tagValue]) => tagName === 'e' && !!tagValue && !embeddedEventIds.includes(tagValue)
    )
  }
  return tag
}

export function getRootATag(event?: Event) {
  if (
    !event ||
    ![kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, ExtendedKind.DISCUSSION].includes(event.kind)
  ) {
    return undefined
  }

  return event.tags.find(tagNameEquals('A'))
}

export function getRootEventHexId(event?: Event) {
  const tag = getRootETag(event)
  return tag?.[1]
}

export function getRootBech32Id(event?: Event) {
  const eTag = getRootETag(event)
  if (!eTag) {
    const aTag = getRootATag(event)
    if (!aTag) return undefined

    return generateBech32IdFromATag(aTag)
  }

  return generateBech32IdFromETag(eTag)
}

export function getReplaceableCoordinate(kind: number, pubkey: string, d: string = '') {
  return `${kind}:${pubkey}:${d}`
}

export function getReplaceableCoordinateFromEvent(event: Event) {
  const d = event.tags.find(tagNameEquals('d'))?.[1] ?? ''
  return getReplaceableCoordinate(event.kind, event.pubkey, d)
}

/** Whether an event matches a tombstone key from IndexedDB (e-tag id, a-tag coordinate, or k-tag kind:pubkey). */
export function isTombstoneKeyForEvent(event: Event, tombstones: Set<string>): boolean {
  if (tombstones.has(event.id)) return true
  if (isReplaceableEvent(event.kind)) {
    if (tombstones.has(getReplaceableCoordinateFromEvent(event))) return true
    if (tombstones.has(`${event.kind}:${event.pubkey}`)) return true
  }
  return false
}

export function getNoteBech32Id(event: Event) {
  const hints = client.getEventHints(event.id).slice(0, 2)
  if (isReplaceableEvent(event.kind)) {
    const identifier = event.tags.find(tagNameEquals('d'))?.[1] ?? ''
    return nip19.naddrEncode({ pubkey: event.pubkey, kind: event.kind, identifier, relays: hints })
  }
  return nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays: hints })
}

export function getUsingClient(event: Event) {
  const clientTag = event.tags.find(tagNameEquals('client'))
  if (!clientTag) return undefined
  
  // NIP-89 client tag format: ["client", "Client Name", "31990:pubkey:identifier", "relay"]
  // Simple format: ["client", "client_name"]
  // For display purposes, we use the client name (second element)
  return clientTag[1]
}

export function getImetaInfosFromEvent(event: Event) {
  const imeta: TImetaInfo[] = []
  event.tags.forEach((tag) => {
    const imageInfo = getImetaInfoFromImetaTag(tag, event.pubkey)
    if (imageInfo) {
      imeta.push(imageInfo)
    }
  })
  return imeta
}

export function getEmbeddedNoteBech32Ids(event: Event) {
  const cache = EVENT_EMBEDDED_NOTES_CACHE.get(event.id)
  if (cache) return cache

  const embeddedNoteBech32Ids: string[] = []
  ;(event.content.match(NOSTR_EMBEDDED_NOTE_REGEX) || []).forEach((note) => {
    try {
      const { type, data } = nip19.decode(note.split(':')[1])
      if (type === 'nevent') {
        embeddedNoteBech32Ids.push(data.id)
      } else if (type === 'note') {
        embeddedNoteBech32Ids.push(data)
      }
    } catch {
      // ignore
    }
  })
  EVENT_EMBEDDED_NOTES_CACHE.set(event.id, embeddedNoteBech32Ids)
  return embeddedNoteBech32Ids
}

/**
 * Collect targets to prefetch so embedded notes (and reply roots) resolve into session cache.
 * - `hexIds`: lowercase event ids (e tags, a-tag snapshot, nostr:note1 / nevent1 in content).
 * - `nip19Pointers`: bech32 strings (e.g. naddr) for per-pointer fetches — not batchable as a single `ids` filter.
 */
export function collectEmbeddedEventPrefetchTargets(event: Event): {
  hexIds: string[]
  nip19Pointers: string[]
} {
  const hexSet = new Set<string>()
  const nip19Set = new Set<string>()

  const addHex = (id: string | undefined) => {
    if (!id) return
    const t = id.trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(t)) hexSet.add(t)
  }

  for (const tag of event.tags) {
    if (tag[0] === 'e' && tag[1]) addHex(tag[1])
    if (tag[0] === 'a' && tag[3]) addHex(tag[3])
  }

  for (const full of event.content.match(EMBEDDED_EVENT_REGEX) ?? []) {
    const colon = full.indexOf(':')
    if (colon < 0) continue
    const bech32 = full.slice(colon + 1)
    try {
      const { type, data } = nip19.decode(bech32)
      if (type === 'note') addHex(data)
      else if (type === 'nevent') addHex(data.id)
      else if (type === 'naddr') nip19Set.add(bech32)
    } catch {
      /* ignore */
    }
  }

  return {
    hexIds: Array.from(hexSet),
    nip19Pointers: Array.from(nip19Set)
  }
}

export function getEmbeddedPubkeys(event: Event) {
  const cache = EVENT_EMBEDDED_PUBKEYS_CACHE.get(event.id)
  if (cache) return cache

  const embeddedPubkeySet = new Set<string>()
  ;(event.content.match(EMBEDDED_MENTION_REGEX) || []).forEach((mention) => {
    try {
      const { type, data } = nip19.decode(mention.split(':')[1])
      if (type === 'npub') {
        embeddedPubkeySet.add(data)
      } else if (type === 'nprofile') {
        embeddedPubkeySet.add(data.pubkey)
      }
    } catch {
      // ignore
    }
  })
  const embeddedPubkeys = Array.from(embeddedPubkeySet)
  EVENT_EMBEDDED_PUBKEYS_CACHE.set(event.id, embeddedPubkeys)
  return embeddedPubkeys
}

/**
 * Whether `userPubkey` is mentioned on the event: any `p` tag and/or
 * `nostr:npub…` / `nostr:nprofile…` in content (see {@link getEmbeddedPubkeys}).
 * Events authored by the user are excluded (not treated as incoming mentions).
 */
export function isUserInEventMentions(event: Event, userPubkey: string): boolean {
  if (event.pubkey === userPubkey) return false
  const inPtags = event.tags.some((t) => t[0] === 'p' && t[1] === userPubkey)
  if (inPtags) return true
  return getEmbeddedPubkeys(event).includes(userPubkey)
}

export function getLatestEvent(events: Event[]): Event | undefined {
  return events.sort((a, b) => b.created_at - a.created_at)[0]
}

export function getReplaceableEventIdentifier(event: Event) {
  return event.tags.find(tagNameEquals('d'))?.[1] ?? ''
}

export function createFakeEvent(event: Partial<Event>): Event {
  return {
    id: '',
    kind: 1,
    pubkey: '',
    content: '',
    created_at: 0,
    tags: [],
    sig: '',
    ...event
  }
}

export async function minePow(
  unsigned: UnsignedEvent,
  difficulty: number
): Promise<Omit<Event, 'sig'>> {
  let count = 0

  const event = unsigned as Omit<Event, 'sig'>
  const tag = ['nonce', count.toString(), difficulty.toString()]

  event.tags.push(tag)

  return new Promise((resolve) => {
    const mine = () => {
      let iterations = 0

      while (iterations < 1000) {
        const now = Math.floor(new Date().getTime() / 1000)

        if (now !== event.created_at) {
          count = 0
          event.created_at = now
        }

        tag[1] = (++count).toString()
        event.id = getEventHash(event)

        if (getPow(event.id) >= difficulty) {
          resolve(event)
          return
        }

        iterations++
      }

      setTimeout(mine, 0)
    }

    mine()
  })
}

// Legacy compare function for sorting compatibility
// If return 0, it means the two events are equal.
// If return a negative number, it means `b` should be retained, and `a` should be discarded.
// If return a positive number, it means `a` should be retained, and `b` should be discarded.
export function compareEvents(a: Event, b: Event): number {
  if (a.created_at !== b.created_at) {
    return a.created_at - b.created_at
  }
  // In case of replaceable events with the same timestamp, the event with the lowest id (first in lexical order) should be retained, and the other discarded.
  if (a.id !== b.id) {
    return a.id < b.id ? 1 : -1
  }
  return 0
}

// Returns the event that should be retained when comparing two events
export function getRetainedEvent(a: Event, b: Event): Event {
  if (compareEvents(a, b) > 0) {
    return a
  }
  return b
}

/**
 * Collapse replaceable/addressable events to one per NIP-01 coordinate (`kind:pubkey` or `kind:pubkey:d`),
 * keeping the newest (`created_at`, then lexicographically smallest `id` on ties).
 * Non-replaceable events are keyed by `id` only.
 */
export function dedupeToLatestPerReplaceableCoordinate(events: Event[]): Event[] {
  const byKey = new Map<string, Event>()
  for (const e of events) {
    if (!isReplaceableEvent(e.kind)) {
      byKey.set(e.id, e)
      continue
    }
    const coord = getReplaceableCoordinateFromEvent(e)
    const existing = byKey.get(coord)
    if (!existing) {
      byKey.set(coord, e)
      continue
    }
    byKey.set(coord, getRetainedEvent(e, existing))
  }
  return [...byKey.values()]
}

/** External article URL from `i` / `I` tags (e.g. kind 1111 comments on web content). */
export function getHttpUrlFromITags(event: Event): string | undefined {
  const lower = event.tags.find((t) => t[0] === 'i')?.[1]?.trim()
  const upper = event.tags.find((t) => t[0] === 'I')?.[1]?.trim()
  const raw = lower ?? upper
  if (!raw) return undefined
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return undefined
  return cleanUrl(raw) || raw
}
