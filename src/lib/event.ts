import { CALENDAR_EVENT_KINDS, ExtendedKind } from '@/constants'
import { muteSetHas } from '@/lib/mute-set'
import { EMBEDDED_EVENT_REGEX, EMBEDDED_MENTION_REGEX, NOSTR_EMBEDDED_NOTE_REGEX } from '@/lib/content-patterns'
import { cleanUrl } from '@/lib/url'
import client from '@/services/client.service'
import { TImetaInfo } from '@/types'
import { LRUCache } from 'lru-cache'
import { Event, getEventHash, kinds, nip19, UnsignedEvent } from 'nostr-tools'
import { getPow } from 'nostr-tools/nip13'
import { hexPubkeysEqual, normalizeHexPubkey } from './pubkey'
import {
  generateBech32IdFromATag,
  generateBech32IdFromETag,
  getFirstHexEventIdFromETags,
  getImetaInfoFromImetaTag,
  tagNameEquals
} from './tag'

/** NIP-25: kind 7 (nostr target) or kind 17 (external / NIP-73 `k`+`i`). */
export function isNip25ReactionKind(kind: number): boolean {
  return kind === kinds.Reaction || kind === ExtendedKind.EXTERNAL_REACTION
}

/** NIP-18: kind 6 (kind-1 repost) or kind 16 (generic repost). */
export function isNip18RepostKind(kind: number): boolean {
  return kind === kinds.Repost || kind === ExtendedKind.GENERIC_REPOST
}

/** NIP-56: kind 1984 report / flag (`kinds.Report` and {@link ExtendedKind.REPORT} are the same kind). */
export function isNip56ReportEvent(event: Pick<Event, 'kind'>): boolean {
  return event.kind === kinds.Report || event.kind === ExtendedKind.REPORT
}

/** `e` / `E` tags for NIP-10-style thread links (kinds 1, 11, 1111, …). */
function listThreadLinkETags(event: Event): string[][] {
  return event.tags.filter(([n]) => n === 'e' || n === 'E')
}

/**
 * Parent `e` for kind 1111 / voice comment: prefer `reply` marker, else last `e` when multiple
 * (NIP-10 root-then-reply), else first. Avoids treating the thread root as the parent when clients omit uppercase `E`.
 */
function getParentETagCommentOrDiscussion(event: Event): string[] | undefined {
  const isETag = (n: string) => n === 'e' || n === 'E'
  const byMarker = event.tags.find(([tagName, , , marker]) => isETag(tagName) && marker === 'reply')
  if (byMarker) return byMarker
  const etags = listThreadLinkETags(event)
  if (etags.length >= 2) return etags[etags.length - 1]
  return etags[0]
}

/**
 * Root `e` for kind 1111 / voice comment: prefer `root` marker, else uppercase `E` (Imwald / NIP-22),
 * else first `e` when multiple (NIP-10 root-before-reply), else single `e`.
 */
function getRootETagCommentOrDiscussion(event: Event): string[] | undefined {
  const isETag = (n: string) => n === 'e' || n === 'E'
  const byMarker = event.tags.find(([tagName, , , marker]) => isETag(tagName) && marker === 'root')
  if (byMarker) return byMarker
  const upperE = event.tags.find(tagNameEquals('E'))
  if (upperE) return upperE
  const etags = listThreadLinkETags(event)
  if (etags.length >= 2) return etags[0]
  return etags[0]
}

const EVENT_EMBEDDED_NOTES_CACHE = new LRUCache<string, string[]>({ max: 10000 })
const EVENT_EMBEDDED_PUBKEYS_CACHE = new LRUCache<string, string[]>({ max: 10000 })
const EVENT_IS_REPLY_NOTE_CACHE = new LRUCache<string, boolean>({ max: 10000 })
/** Bump when isReplyNoteEvent logic changes so cached booleans are not stale. */
const IS_REPLY_NOTE_CACHE_KEY_SUFFIX = ':v3'

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

  const cacheKey = event.id + IS_REPLY_NOTE_CACHE_KEY_SUFFIX
  const cache = EVENT_IS_REPLY_NOTE_CACHE.get(cacheKey)
  if (cache !== undefined) return cache

  // NIP-18 `q` without `e`/`a` is a quote note (top-level for OP vs reply filters), not a thread reply.
  const isReply = !!getParentETag(event) || !!getParentATag(event)
  EVENT_IS_REPLY_NOTE_CACHE.set(cacheKey, isReply)
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
    if (tagName === 'p' && muteSetHas(mutePubkeySet, pubkey)) {
      return true
    }
  }
  return false
}

export function getParentETag(event?: Event) {
  if (!event) return undefined

  // NIP-25 reactions, NIP-18 reposts (6 / 16), poll responses: first hex `e` / `E` references the target note.
  if (event.kind === kinds.Reaction || isNip18RepostKind(event.kind) || event.kind === ExtendedKind.POLL_RESPONSE) {
    const firstId = getFirstHexEventIdFromETags(event.tags)
    if (!firstId) return undefined
    return (
      event.tags.find((t) => t[0] === 'e' && t[1] === firstId) ??
      event.tags.find((t) => t[0] === 'E' && t[1] === firstId)
    )
  }

  if (event.kind === ExtendedKind.COMMENT || event.kind === ExtendedKind.VOICE_COMMENT) {
    return getParentETagCommentOrDiscussion(event)
  }

  // Kind 11: keep first `e` / `E` (thread shape differs from NIP-10 comment chains).
  if (event.kind === ExtendedKind.DISCUSSION) {
    return event.tags.find(tagNameEquals('e')) ?? event.tags.find(tagNameEquals('E'))
  }

  // Kind 9735: zapped note id is on `e` / `E` (or addressable target on `a` / `A`)
  if (event.kind === kinds.Zap) {
    const firstHex = getFirstHexEventIdFromETags(event.tags)
    if (firstHex) {
      return (
        event.tags.find((t) => t[0] === 'e' && t[1] === firstHex) ??
        event.tags.find((t) => t[0] === 'E' && t[1] === firstHex)
      )
    }
    return event.tags.find(tagNameEquals('e')) ?? event.tags.find(tagNameEquals('E'))
  }

  if (event.kind !== kinds.ShortTextNote) return undefined

  const isETag = (n: string) => n === 'e' || n === 'E'
  let tag = event.tags.find(([tagName, , , marker]) => {
    return isETag(tagName) && marker === 'reply'
  })
  if (!tag) {
    const embeddedEventIds = getEmbeddedNoteBech32Ids(event)
    tag = event.tags.findLast(
      ([tagName, tagValue, , marker]) =>
        isETag(tagName) &&
        !!tagValue &&
        marker !== 'mention' &&
        !embeddedEventIds.includes(tagValue)
    )
  }
  return tag
}

export function getParentATag(event?: Event) {
  if (!event) return undefined
  if (event.kind === kinds.Zap) {
    return event.tags.find(tagNameEquals('a')) ?? event.tags.find(tagNameEquals('A'))
  }
  if (
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
    return getRootETagCommentOrDiscussion(event)
  }

  if (event.kind === ExtendedKind.DISCUSSION) {
    return event.tags.find(tagNameEquals('E'))
  }

  // Kind 9735: thread root for note zaps is the zapped event id on `e` / `E`
  if (event.kind === kinds.Zap) {
    const firstHex = getFirstHexEventIdFromETags(event.tags)
    if (!firstHex) return undefined
    return (
      event.tags.find((t) => t[0] === 'e' && t[1] === firstHex) ??
      event.tags.find((t) => t[0] === 'E' && t[1] === firstHex)
    )
  }

  if (event.kind !== kinds.ShortTextNote) return undefined

  const isETag = (n: string) => n === 'e' || n === 'E'
  let tag = event.tags.find(([tagName, , , marker]) => {
    return isETag(tagName) && marker === 'root'
  })
  if (!tag) {
    const embeddedEventIds = getEmbeddedNoteBech32Ids(event)
    tag = event.tags.find(
      ([tagName, tagValue]) =>
        isETag(tagName) && !!tagValue && !embeddedEventIds.includes(tagValue)
    )
  }
  return tag
}

export function getRootATag(event?: Event) {
  if (!event) return undefined
  if (event.kind === kinds.Zap) {
    return event.tags.find(tagNameEquals('a')) ?? event.tags.find(tagNameEquals('A'))
  }
  if (
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

const RESOLVE_DECLARED_THREAD_ROOT_MAX_HOPS = 14

/** Zapped **note** id from a kind 9735 receipt (`e` / `E` hex). Kept here to avoid importing event-metadata (cycles). */
function zapReceiptTargetNoteHexFromEvent(ev: Event): string | undefined {
  if (ev.kind !== kinds.Zap) return undefined
  for (const t of ev.tags) {
    if ((t[0] === 'e' || t[0] === 'E') && t[1] && /^[0-9a-f]{64}$/i.test(t[1])) {
      return t[1].toLowerCase()
    }
  }
  return undefined
}

/**
 * Clients that reply from a notification often emit a single `e` tag whose **id is a reaction** (kind 7 / 17)
 * or **zap receipt** (kind 9735) but the marker is still `root` — they never saw the real OP. Walk
 * reaction / zap → target note → further NIP-10 `e` roots (session cache) until stable, for thread UI and child `root` tags.
 */
export function resolveDeclaredThreadRootEventHex(startHexId: string): string {
  let cur = startHexId.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(cur)) return cur
  const seen = new Set<string>()
  for (let hop = 0; hop < RESOLVE_DECLARED_THREAD_ROOT_MAX_HOPS; hop++) {
    if (seen.has(cur)) return cur
    seen.add(cur)
    const ev = client.peekSessionCachedEvent(cur)
    if (!ev) return cur
    if (isNip25ReactionKind(ev.kind)) {
      const fromParent = getParentEventHexId(ev)?.toLowerCase()
      let next: string | undefined
      if (fromParent && /^[0-9a-f]{64}$/i.test(fromParent)) {
        next = fromParent
      } else {
        const first = getFirstHexEventIdFromETags(ev.tags)
        next = first && /^[0-9a-f]{64}$/i.test(first) ? first.toLowerCase() : undefined
      }
      if (!next || next === cur) return cur
      cur = next
      continue
    }
    if (ev.kind === kinds.Zap) {
      const next = zapReceiptTargetNoteHexFromEvent(ev)
      if (!next || next === cur) return cur
      cur = next
      continue
    }
    const r = getRootEventHexId(ev)?.toLowerCase()
    if (r && r !== cur && /^[0-9a-f]{64}$/i.test(r)) {
      cur = r
      continue
    }
    return cur
  }
  return cur
}

/** True if event references target as root, parent, or quoted (#q, #a) — used to hide redundant preview when showing quotes of current note. */
export function eventReferencesEventId(
  event: Event | undefined,
  targetHexIdOrEvent: string | Event
): boolean {
  if (!event) return false
  const targetEvent = typeof targetHexIdOrEvent === 'object' ? targetHexIdOrEvent : undefined
  const targetHexId =
    typeof targetHexIdOrEvent === 'string'
      ? targetHexIdOrEvent.toLowerCase()
      : targetHexIdOrEvent.id?.toLowerCase()
  const targetCoordinate =
    targetEvent && isReplaceableEvent(targetEvent.kind)
      ? getReplaceableCoordinateFromEvent(targetEvent)
      : undefined

  const qRef = getQuotedReferenceFromQTags(event)

  if (targetHexId) {
    const rootId = getRootETag(event)?.[1]?.toLowerCase()
    if (rootId === targetHexId) return true
    const parentId = getParentETag(event)?.[1]?.toLowerCase()
    if (parentId === targetHexId) return true
    if (qRef?.hexId === targetHexId) return true
    const eTags = event.tags.filter((t) => t[0] === 'e' || t[0] === 'E')
    if (eTags.some((t) => t[1]?.toLowerCase() === targetHexId)) return true
  }

  if (targetCoordinate) {
    const targetCoordNorm = normalizeReplaceableCoordinateString(targetCoordinate)
    const aTags = event.tags.filter((t) => t[0] === 'a' || t[0] === 'A')
    if (aTags.some((t) => normalizeReplaceableCoordinateString(t[1] ?? '') === targetCoordNorm)) return true
    if (
      qRef?.coordinate &&
      normalizeReplaceableCoordinateString(qRef.coordinate) === targetCoordNorm
    ) {
      return true
    }
  }

  return false
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

/**
 * Merge key for NIP-33 addressable events when relays return different ids for the same logical
 * replaceable. Normalized `kind:pubkey:d`; missing/empty `d` or non-addressable kinds use `event.id`.
 */
export function replaceableEventDedupeKey(event: Event): string {
  if (!kinds.isAddressableKind(event.kind)) return event.id
  const d = event.tags.find(tagNameEquals('d'))?.[1]
  if (d == null || d === '') return event.id
  return normalizeReplaceableCoordinateString(getReplaceableCoordinateFromEvent(event))
}

/** Normalize `kind:pubkey:d` for comparisons (lowercase pubkey; preserve d). */
export function normalizeReplaceableCoordinateString(coord: string): string {
  const m = /^(\d+):([0-9a-f]{64}):(.*)$/i.exec(coord.trim())
  if (!m) return coord.trim().toLowerCase()
  return getReplaceableCoordinate(Number(m[1]), m[2].toLowerCase(), m[3])
}

function stripNostrUriScheme(s: string): string {
  const t = s.trim()
  if (t.toLowerCase().startsWith('nostr:')) return t.slice(6).trim()
  return t
}

/**
 * NIP-10 / NIP-18: `q` tag value is `<event-id>` or `<event-address>` (coordinate), or NIP-19 bech32.
 */
export function parseQTagReferenceValue(
  raw: string | undefined | null
): { hexId?: string; coordinate?: string } | undefined {
  if (raw == null) return undefined
  const s0 = stripNostrUriScheme(raw)
  if (!s0) return undefined

  if (/^[0-9a-f]{64}$/i.test(s0)) {
    return { hexId: s0.toLowerCase() }
  }

  const coordMatch = /^(\d+):([0-9a-f]{64}):(.*)$/i.exec(s0)
  if (coordMatch) {
    return {
      coordinate: getReplaceableCoordinate(
        Number(coordMatch[1]),
        coordMatch[2].toLowerCase(),
        coordMatch[3]
      )
    }
  }

  if (/^n(?:ote|event|addr)1/i.test(s0)) {
    try {
      const { type, data } = nip19.decode(s0)
      if (type === 'note') {
        const id = typeof data === 'string' ? data : (data as { id?: string }).id
        if (id && /^[0-9a-f]{64}$/i.test(id)) return { hexId: id.toLowerCase() }
      }
      if (type === 'nevent') {
        const id = (data as { id: string }).id
        if (id && /^[0-9a-f]{64}$/i.test(id)) return { hexId: id.toLowerCase() }
      }
      if (type === 'naddr') {
        const d = data as { kind: number; pubkey: string; identifier: string }
        return {
          coordinate: getReplaceableCoordinate(
            d.kind,
            d.pubkey.toLowerCase(),
            d.identifier ?? ''
          )
        }
      }
    } catch {
      /* invalid bech32 */
    }
  }

  return undefined
}

/** Parsed first `q` / `Q` tag on the event (NIP-10). */
export function getQuotedReferenceFromQTags(event: Event): {
  hexId?: string
  coordinate?: string
} | undefined {
  const q = event.tags.find((t) => t[0] === 'q' || t[0] === 'Q')?.[1]
  return parseQTagReferenceValue(q)
}

/** Hex id from `q` when the reference resolves to a fixed id (not coordinate-only). */
export function getQuotedEventHexIdFromQTags(event: Event): string | undefined {
  return getQuotedReferenceFromQTags(event)?.hexId
}

/** Kind 1 whose `q` points at this hex id (legacy helper). */
export function kind1QuotesEventHexId(event: Event, hexId: string): boolean {
  if (event.kind !== kinds.ShortTextNote) return false
  const ref = getQuotedReferenceFromQTags(event)
  return !!ref?.hexId && ref.hexId === hexId.trim().toLowerCase()
}

/** Kind 1 quote-of-root: match `q` hex and/or replaceable coordinate (and bech32 decoding). */
export function kind1QuotesThreadRoot(
  event: Event,
  root: { type: 'E'; id: string } | { type: 'A'; id: string; eventId: string }
): boolean {
  if (event.kind !== kinds.ShortTextNote) return false
  const ref = getQuotedReferenceFromQTags(event)
  if (!ref || (!ref.hexId && !ref.coordinate)) return false
  if (root.type === 'E') {
    const rid = root.id.trim().toLowerCase()
    return !!ref.hexId && ref.hexId === rid
  }
  const eid = root.eventId.trim().toLowerCase()
  const coordNorm = normalizeReplaceableCoordinateString(root.id)
  if (ref.hexId && ref.hexId === eid) return true
  if (ref.coordinate && normalizeReplaceableCoordinateString(ref.coordinate) === coordNorm) return true
  return false
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

export function filterEventsExcludingTombstones(events: Event[], tombstones: Set<string>): Event[] {
  if (tombstones.size === 0) return events
  return events.filter((e) => !isTombstoneKeyForEvent(e, tombstones))
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

  // Discussion roots (kind 11) usually do not reference their own id in tags/content; include the
  // row id so feed prefetch + open-note `fetchEvent` hit session cache after the list has loaded.
  if (event.kind === ExtendedKind.DISCUSSION) {
    addHex(event.id)
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
  const u = normalizeHexPubkey(userPubkey)
  if (hexPubkeysEqual(event.pubkey, u)) return false
  const inPtags = event.tags.some((t) => t[0] === 'p' && t[1] && hexPubkeysEqual(t[1], u))
  if (inPtags) return true
  return getEmbeddedPubkeys(event).some((pk) => hexPubkeysEqual(pk, u))
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
