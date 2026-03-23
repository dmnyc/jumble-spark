/**
 * Built-in “faux spells”: same NoteList + filters as kind-777 spells. The Spells page uses live
 * `subscribeTimeline` (same as Following) so the first relay results stream in immediately instead of
 * waiting for every relay to EOSE on a one-shot query.
 *
 * **Why faux feeds can feel slow:** each timeline shard opens live REQs over the prioritized relay
 * stack (see {@link applyFauxSpellCapsToSubRequests}). The **interests** spell uses **one** shard: all subscribed
 * topics go in a single `#t` filter (NIP-01 OR semantics). The notifications spell uses a narrow
 * kind list vs full profile kinds.
 */
import { ExtendedKind, PROFILE_FEED_KINDS, READ_ONLY_RELAY_URLS } from '@/constants'
import { normalizeTopic } from '@/lib/discussion-topics'
import { normalizeUrl } from '@/lib/url'
import type { TFeedSubRequest } from '@/types'
import { type Event, type Filter, kinds } from 'nostr-tools'

/** Default caps for every faux spell feed (relays per subrequest, events per REQ). */
export const FAUX_SPELL_MAX_RELAYS = 6
export const FAUX_SPELL_EVENT_LIMIT = 200

/** Profile Media tab: single REQ `limit` (matches merged cap in NoteList one-shot). */
export const PROFILE_MEDIA_REQ_LIMIT = 200

/**
 * Trim relay lists and filter limits (and bookmark `ids`) so faux feeds stay cheap to open.
 */
export function applyFauxSpellCapsToSubRequests(requests: TFeedSubRequest[]): TFeedSubRequest[] {
  return requests.map((r) => {
    const urls = r.urls.slice(0, FAUX_SPELL_MAX_RELAYS)
    const f = { ...r.filter }
    const prevLimit = f.limit
    f.limit =
      typeof prevLimit === 'number' && prevLimit > 0
        ? Math.min(prevLimit, FAUX_SPELL_EVENT_LIMIT)
        : FAUX_SPELL_EVENT_LIMIT
    if (Array.isArray(f.ids) && f.ids.length > FAUX_SPELL_EVENT_LIMIT) {
      f.ids = f.ids.slice(0, FAUX_SPELL_EVENT_LIMIT)
    }
    return { urls, filter: f }
  })
}

/**
 * Mention/notification-shaped kinds only (aligned with `NotificationProvider`, plus zap receipts).
 * Not full {@link PROFILE_FEED_KINDS} — that asked relays for huge multi-kind slices per `#p`.
 */
export const NOTIFICATION_SPELL_KINDS = [
  kinds.ShortTextNote,
  kinds.Repost,
  kinds.Reaction,
  kinds.Zap,
  ExtendedKind.COMMENT,
  ExtendedKind.POLL_RESPONSE,
  ExtendedKind.VOICE_COMMENT,
  ExtendedKind.POLL,
  ExtendedKind.PUBLIC_MESSAGE,
  ExtendedKind.ZAP_RECEIPT
] as const

/**
 * Max distinct `t` tag values in one filter (very long `#t` arrays can hit relay limits).
 */
const INTERESTS_MAX_TOPICS = 80

/**
 * Append {@link READ_ONLY_RELAY_URLS} (e.g. aggr) after the curated set so every faux REQ includes them unless blocked.
 */
export function appendCuratedReadOnlyRelays(curated: string[], blockedRelays: string[]): string[] {
  const blocked = new Set(blockedRelays.map((b) => normalizeUrl(b) || b))
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of curated) {
    const k = normalizeUrl(u) || u
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  for (const u of READ_ONLY_RELAY_URLS) {
    const k = normalizeUrl(u) || u
    if (!k || blocked.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** NIP-style native media kinds only (picture, video, short video, voice). */
export const MEDIA_SPELL_KINDS = [
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.VOICE
] as const

/** Notifications faux spell: `#p` = you, narrow kinds — see module docstring. */
export function buildMentionsSpellFilter(pubkey: string): Filter {
  const pk = /^[0-9a-f]{64}$/i.test(pubkey.trim()) ? pubkey.trim().toLowerCase() : pubkey.trim()
  return {
    kinds: [...NOTIFICATION_SPELL_KINDS],
    limit: FAUX_SPELL_EVENT_LIMIT,
    '#p': [pk]
  }
}

export function buildDiscussionFilter(): Filter {
  return {
    kinds: [ExtendedKind.DISCUSSION],
    limit: FAUX_SPELL_EVENT_LIMIT
  }
}

export function buildMediaSpellFilter(): Filter {
  return { kinds: [...MEDIA_SPELL_KINDS], limit: FAUX_SPELL_EVENT_LIMIT }
}

/** Media kinds for a single profile (same as {@link MEDIA_SPELL_KINDS}, scoped by `authors`). */
export function buildProfileMediaSpellFilter(pubkey: string): Filter {
  const pk = /^[0-9a-f]{64}$/i.test(pubkey.trim()) ? pubkey.trim().toLowerCase() : pubkey.trim()
  return {
    authors: [pk],
    kinds: [...MEDIA_SPELL_KINDS],
    limit: PROFILE_MEDIA_REQ_LIMIT
  }
}

export function buildCalendarSpellFilter(): Filter {
  return {
    kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
    limit: FAUX_SPELL_EVENT_LIMIT
  }
}

/**
 * One subrequest for all interests: NIP-01 treats multiple `#t` values as OR (any topic matches).
 * Same relay set as before, but a single timeline shard instead of one per hashtag.
 */
export function buildInterestsSubRequests(
  relayUrls: string[],
  rawTopics: string[],
  kindsList: number[] = PROFILE_FEED_KINDS
): TFeedSubRequest[] {
  if (!relayUrls.length || !rawTopics.length || !kindsList.length) return []
  const topics = Array.from(
    new Set(rawTopics.map((t) => normalizeTopic(t)).filter((t) => t.length > 0))
  ).slice(0, INTERESTS_MAX_TOPICS)
  if (!topics.length) return []
  return [
    {
      urls: relayUrls,
      filter: {
        kinds: kindsList,
        '#t': topics,
        limit: FAUX_SPELL_EVENT_LIMIT
      }
    }
  ]
}

/** Bookmark list e-tags only (hex ids); addressable (a-tag) bookmarks need separate fetches. */
export function buildBookmarksSubRequests(bookmarkListEvent: Event | null, urls: string[]): TFeedSubRequest[] {
  if (!bookmarkListEvent?.tags?.length || !urls.length) return []
  const ids = bookmarkListEvent.tags
    .filter((t) => t[0] === 'e' && t[1] && /^[a-f0-9]{64}$/i.test(t[1]))
    .map((t) => t[1] as string)
  if (!ids.length) return []
  const cap = FAUX_SPELL_EVENT_LIMIT
  const slice = ids.slice(0, cap)
  return [{ urls, filter: { ids: slice, limit: slice.length } }]
}
