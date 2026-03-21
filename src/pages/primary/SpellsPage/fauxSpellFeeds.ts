/**
 * Built-in “faux spells” use the same NoteList path as kind-777 REQ spells.
 */
import {
  DEFAULT_FAVORITE_RELAYS,
  ExtendedKind,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  PROFILE_FEED_KINDS
} from '@/constants'
import {
  extractHashtagsFromContent,
  extractTTagsFromEvent,
  normalizeTopic
} from '@/lib/discussion-topics'
import { getImetaInfosFromEvent } from '@/lib/event'
import { normalizeUrl } from '@/lib/url'
import type { TFeedSubRequest, TRelayList } from '@/types'
import { type Event, type Filter, kinds } from 'nostr-tools'

const NOTIFICATION_LIMIT = 500
const DISCUSSION_LIMIT = 500
const MAX_BOOKMARK_IDS = 250

/**
 * Spells “Discussions” uses NoteList → subscribeTimeline → one live REQ per relay.
 * The same merged list as DiscussionsPage’s one-shot query would open 80+ sockets and exhaust
 * subscription slots; cap keeps first paint fast. Full coverage remains on /discussions.
 */
const DISCUSSION_FAUX_SPELL_MAX_RELAYS = 32

export const MEDIA_SPELL_KINDS = [
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.VOICE
] as const

/** Kinds shown in the Media faux spell: native media + kind 1 notes filtered by {@link mediaSpellExtraShouldHideEvent}. */
export const MEDIA_SPELL_SHOW_KINDS = [
  kinds.ShortTextNote,
  ...MEDIA_SPELL_KINDS
] as const

/**
 * Topic roots for kind 1 in the Media spell: a note must also match one of these via `t` tag or `#hashtag`
 * (after {@link normalizeTopic}), **and** carry media (imeta / media URL / image|video|audio tag).
 */
export const MEDIA_SPELL_TOPIC_SEEDS = [
  'vlog',
  'video',
  'reel',
  'gallery',
  'podcast',
  'photography',
  'photo',
  'music',
  'screencast'
] as const

const MEDIA_SPELL_TOPIC_KEYWORDS = new Set(
  MEDIA_SPELL_TOPIC_SEEDS.map((t) => normalizeTopic(t)).filter(Boolean)
)

function hasMediaSpellTopicTag(event: Event): boolean {
  for (const topic of extractTTagsFromEvent(event)) {
    if (topic && MEDIA_SPELL_TOPIC_KEYWORDS.has(topic)) return true
  }
  for (const topic of extractHashtagsFromContent(event.content)) {
    if (topic && MEDIA_SPELL_TOPIC_KEYWORDS.has(topic)) return true
  }
  return false
}

function imetaTagsIndicateMedia(event: Event): boolean {
  for (const im of getImetaInfosFromEvent(event)) {
    const mime = im.m?.toLowerCase() ?? ''
    if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) {
      return true
    }
    const u = im.url ?? ''
    if (
      /\.(jpe?g|png|gif|webp|heic|mp4|webm|m4v|mov|mkv|avi|mp3|m4a|aac|ogg|opus|wav|flac)(\?|#|$)/i.test(
        u
      )
    ) {
      return true
    }
  }
  return false
}

function hasImageOrStreamTag(event: Event): boolean {
  for (const t of event.tags) {
    const name = t[0]?.toLowerCase()
    if (name === 'image' && t[1]?.startsWith('http')) return true
    if ((name === 'video' || name === 'audio' || name === 'stream') && t[1]?.startsWith('http')) {
      return true
    }
  }
  return false
}

const CONTENT_MEDIA_FILE_EXT_RE =
  /https?:\/\/[^\s<>"')]+\.(?:jpe?g|png|gif|webp|svg|bmp|heic|mp4|webm|m4v|mov|mkv|avi|mp3|m4a|aac|ogg|opus|wav|flac)(?:[\w#./?&=%~+-]*)/i

/** Embed-style hosts (excludes GIF sticker sites like Giphy/Tenor). */
const CONTENT_MEDIA_HOST_RE =
  /https?:\/\/(?:(?:[\w-]+\.)*(?:spotify\.com|fountain\.fm)\/|(?:www\.)?(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/|vimeo\.com\/|twitch\.tv\/|instagram\.com\/|(?:i\.)?imgur\.com\/|soundcloud\.com\/|(?:www\.)?tiktok\.com\/|rumble\.com\/|odysee\.com\/))/i

function contentHasMediaUrl(content: string): boolean {
  return CONTENT_MEDIA_FILE_EXT_RE.test(content) || CONTENT_MEDIA_HOST_RE.test(content)
}

function hasKind1MediaPayload(event: Event): boolean {
  return imetaTagsIndicateMedia(event) || hasImageOrStreamTag(event) || contentHasMediaUrl(event.content)
}

/** Kind 1: require {@link MEDIA_SPELL_TOPIC_SEEDS} match **and** imeta / media URL / image|video|audio tag. */
export function isKind1MediaSpellEligible(event: Event): boolean {
  if (event.kind !== kinds.ShortTextNote) return false
  return hasMediaSpellTopicTag(event) && hasKind1MediaPayload(event)
}

/** NoteList `extraShouldHideEvent`: hide kind 1 notes that fail the combined topic + media check. */
export function mediaSpellExtraShouldHideEvent(evt: Event): boolean {
  if (evt.kind !== kinds.ShortTextNote) return false
  return !isKind1MediaSpellEligible(evt)
}

/** Relays for “global” faux feeds (media, calendar): visible favorites or defaults. */
export function fauxFavoriteRelayUrls(favoriteRelays: string[], blockedRelays: string[]): string[] {
  const blocked = new Set(blockedRelays.map((b) => normalizeUrl(b) || b))
  const visible = favoriteRelays.filter((r) => {
    const k = normalizeUrl(r) || r
    return k && !blocked.has(k)
  })
  const base = visible.length > 0 ? visible : DEFAULT_FAVORITE_RELAYS
  return dedupe(base.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[])
}

/**
 * Notifications / bookmarks faux spells: prefer inbox (then favorites), but **always** merge FAST_READ.
 * Using only the first N inbox relays meant one dead relay (e.g. offline personal relay) could dominate
 * connection/EOSE latency while public relays were never asked — skeletons until timeout.
 */
const NOTIFICATION_PRIMARY_MAX = 6
const NOTIFICATION_BLEND_FAST_MAX = 6
const NOTIFICATION_RELAY_CAP = 12

function relayUrlsUpToUnblocked(urls: string[], blocked: Set<string>, max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const k = normalizeUrl(u) || u
    if (!k || blocked.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
    if (out.length >= max) break
  }
  return out
}

function mergeRelayListsUnique(
  lists: string[][],
  blocked: Set<string>,
  cap: number
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const u of list) {
      const k = normalizeUrl(u) || u
      if (!k || blocked.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push(k)
      if (out.length >= cap) return out
    }
  }
  return out
}

export function notificationRelayUrls(
  relayList: TRelayList | null | undefined,
  favoriteRelays: string[],
  blockedRelays: string[] = []
): string[] {
  const blocked = new Set(blockedRelays.map((b) => normalizeUrl(b) || b))
  const read = relayList?.read ?? []
  const readSorted = [...read].map((u) => normalizeUrl(u) || u).filter(Boolean).sort((a, b) => a.localeCompare(b))
  const favSorted = [...favoriteRelays]
    .map((u) => normalizeUrl(u) || u)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  const primary =
    read.length > 0
      ? relayUrlsUpToUnblocked(readSorted, blocked, NOTIFICATION_PRIMARY_MAX)
      : favoriteRelays.length > 0
        ? relayUrlsUpToUnblocked(favSorted, blocked, NOTIFICATION_PRIMARY_MAX)
        : []
  const fromFast = relayUrlsUpToUnblocked(FAST_READ_RELAY_URLS, blocked, NOTIFICATION_BLEND_FAST_MAX)
  const merged = mergeRelayListsUnique([primary, fromFast], blocked, NOTIFICATION_RELAY_CAP)
  if (merged.length > 0) return merged
  return relayUrlsUpToUnblocked(FAST_READ_RELAY_URLS, blocked, NOTIFICATION_RELAY_CAP)
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const k = normalizeUrl(u) || u
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** Notifications spell: same kind set as profile-style feeds, restricted to `#p` = you on the relay. */
export function buildMentionsSpellFilter(pubkey: string): Filter {
  return {
    kinds: [...PROFILE_FEED_KINDS],
    limit: NOTIFICATION_LIMIT,
    '#p': [pubkey]
  }
}

/**
 * Relay set for Spells “Discussions” (kind 11): same merge order as DiscussionsPage, but capped
 * for subscription-based loading (see DISCUSSION_FAUX_SPELL_MAX_RELAYS).
 */
/**
 * Deterministic relay pick: each tier (read / write / fav / fast) is normalized + sorted so NostrProvider
 * array order and NIP-66 ref churn do not change which 32 relays we REQ (prevents subscription identity thrash).
 */
export function discussionRelayUrls(
  relayList: TRelayList | null | undefined,
  favoriteRelays: string[],
  blockedRelays: string[]
): string[] {
  const blocked = new Set(blockedRelays.map((b) => normalizeUrl(b) || b))
  const tier = (urls: string[]) =>
    [...new Set(urls.map((u) => normalizeUrl(u) || u).filter(Boolean))]
      .filter((k) => !blocked.has(k))
      .sort((a, b) => a.localeCompare(b))

  const read = tier(relayList?.read ?? [])
  const write = tier(relayList?.write ?? [])
  const fav = tier(favoriteRelays)
  const fastR = tier([...FAST_READ_RELAY_URLS])
  const fastW = tier([...FAST_WRITE_RELAY_URLS])
  const merged = [...read, ...write, ...fav, ...fastR, ...fastW]
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of merged) {
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
    if (out.length >= DISCUSSION_FAUX_SPELL_MAX_RELAYS) break
  }
  return out
}

export function buildDiscussionFilter(): Filter {
  return {
    kinds: [ExtendedKind.DISCUSSION],
    limit: DISCUSSION_LIMIT
  }
}

export function buildMediaSpellFilter(): Filter {
  return { kinds: [...MEDIA_SPELL_SHOW_KINDS], limit: 500 }
}

export function buildCalendarSpellFilter(): Filter {
  return {
    kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
    limit: 200
  }
}

const FOLLOW_PACK_LIMIT = 100

/** Kind 39089 follow/starter packs from fast read relays (same scope as the old Follow Packs page). */
export function buildFollowPacksSubRequests(): TFeedSubRequest[] {
  const urls = FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
  if (!urls.length) return []
  return [
    {
      urls,
      filter: { kinds: [ExtendedKind.FOLLOW_PACK], limit: FOLLOW_PACK_LIMIT }
    }
  ]
}

/** One subrequest per topic (OR). Uses same kind set as the main profile/favorites feed. */
export function buildInterestsSubRequests(
  relayUrls: string[],
  rawTopics: string[],
  kindsList: number[] = PROFILE_FEED_KINDS
): TFeedSubRequest[] {
  if (!relayUrls.length || !rawTopics.length || !kindsList.length) return []
  const topics = Array.from(
    new Set(rawTopics.map((t) => normalizeTopic(t)).filter((t) => t.length > 0))
  )
  if (!topics.length) return []
  return topics.map((topic) => ({
    urls: relayUrls,
    filter: {
      kinds: kindsList,
      '#t': [topic],
      limit: 400
    }
  }))
}

/** Bookmark list e-tags only (hex ids); addressable (a-tag) bookmarks need separate fetches. */
export function buildBookmarksSubRequests(bookmarkListEvent: Event | null, urls: string[]): TFeedSubRequest[] {
  if (!bookmarkListEvent?.tags?.length || !urls.length) return []
  const ids = bookmarkListEvent.tags
    .filter((t) => t[0] === 'e' && t[1] && /^[a-f0-9]{64}$/i.test(t[1]))
    .map((t) => t[1] as string)
  if (!ids.length) return []
  return [{ urls, filter: { ids: ids.slice(0, MAX_BOOKMARK_IDS), limit: MAX_BOOKMARK_IDS } }]
}
