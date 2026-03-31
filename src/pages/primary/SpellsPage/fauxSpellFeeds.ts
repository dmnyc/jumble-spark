/**
 * Built-in “faux spells”: same NoteList + filters as kind-777 spells. The Spells page uses live
 * `subscribeTimeline` (same as Following) so the first relay results stream in immediately instead of
 * waiting for every relay to EOSE on a one-shot query.
 *
 * **Why faux feeds can feel slow:** each timeline shard opens live REQs over the prioritized relay
 * stack (see {@link applyFauxSpellCapsToSubRequests}). Read-only mirrors are **prepended** in
 * {@link appendCuratedReadOnlyRelays} so the per-shard relay cap still includes aggregators (otherwise
 * inbox+favorites fill the cap and global kinds/media/hashtags never hit aggr). The **interests** spell
 * uses **one** shard: all subscribed topics in one `#t` filter (NIP-01 OR semantics).
 */
import {
  DEFAULT_FEED_SHOW_KINDS,
  ExtendedKind,
  PROFILE_MEDIA_TAB_KINDS,
  READ_ONLY_RELAY_URLS
} from '@/constants'
import { RENDERABLE_NOTE_KINDS_SORTED } from '@/lib/note-renderable-kinds'
import { buildProfileAugmentedReadRelayUrls } from '@/lib/favorites-feed-relays'
import { normalizeTopic } from '@/lib/discussion-topics'
import { userIdToPubkey } from '@/lib/pubkey'
import { normalizeUrl } from '@/lib/url'
import type { TFeedSubRequest } from '@/types'
import { type Event, type Filter } from 'nostr-tools'

/** Default caps for every faux spell feed (relays per subrequest, events per REQ). */
export const FAUX_SPELL_MAX_RELAYS = 10
export const FAUX_SPELL_EVENT_LIMIT = 200

/** Profile Media tab: single REQ `limit` (matches merged cap in NoteList one-shot). */
export const PROFILE_MEDIA_REQ_LIMIT = 200

/** Max relay URLs per Medien REQ (author stack + aggregators; see {@link buildProfileMediaSubRequests}). */
export const PROFILE_MEDIA_MAX_RELAYS = 16

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
    return { ...r, urls, filter: f }
  })
}

/**
 * Same kinds as {@link RENDERABLE_NOTE_KINDS_SORTED}: anything `Note` renders with a real card, not
 * the unknown-event fallback. Live notifications REQ uses `#p` only (no relay `kinds`); this list is applied in
 * NoteList via `clientSideKindFilter` so only supported cards appear (other mention kinds are dropped).
 */
export const NOTIFICATION_SPELL_KINDS = RENDERABLE_NOTE_KINDS_SORTED

/** Live notifications spell: longer than NoteList’s default 15s before empty state (slow `#p` on some relays). */
export const NOTIFICATION_SPELL_LOADING_SAFETY_MS = 90_000

/**
 * Max base topics from the interest list. Each base topic expands to singular+plural variants.
 */
const INTERESTS_MAX_TOPICS = 80

/**
 * Max distinct `t` tag values in one filter after case + singular/plural expansion.
 */
const INTERESTS_MAX_TOPIC_TAG_VALUES = INTERESTS_MAX_TOPICS * 4

/**
 * Put {@link READ_ONLY_RELAY_URLS} (e.g. aggr) **first**, then curated relays. Faux spells cap URL count
 * ({@link FAUX_SPELL_MAX_RELAYS}); appending read-only at the end dropped mirrors whenever inbox+favorites
 * filled the cap.
 */
export function appendCuratedReadOnlyRelays(curated: string[], blockedRelays: string[]): string[] {
  const blocked = new Set(blockedRelays.map((b) => normalizeUrl(b) || b))
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of READ_ONLY_RELAY_URLS) {
    const k = normalizeUrl(u) || u
    if (!k || blocked.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  for (const u of curated) {
    const k = normalizeUrl(u) || u
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** NIP-style native media kinds only — same as {@link PROFILE_MEDIA_TAB_KINDS}. */
export const MEDIA_SPELL_KINDS = PROFILE_MEDIA_TAB_KINDS

function normalizeMentionPubkey(pubkey: string): string {
  return /^[0-9a-f]{64}$/i.test(pubkey.trim()) ? pubkey.trim().toLowerCase() : pubkey.trim()
}

/** Notifications faux spell: `#p` = you, narrow kinds — see module docstring. */
export function buildMentionsSpellFilter(pubkey: string): Filter {
  const pk = normalizeMentionPubkey(pubkey)
  return {
    kinds: [...NOTIFICATION_SPELL_KINDS],
    limit: FAUX_SPELL_EVENT_LIMIT,
    '#p': [pk]
  }
}

/** Live timeline: one REQ per relay set, any kind with `#p` = you; kinds narrowed in the client. */
export function buildNotificationsSpellSubRequests(urls: string[], pubkey: string): TFeedSubRequest[] {
  const pk = normalizeMentionPubkey(pubkey)
  return [{ urls, filter: { limit: FAUX_SPELL_EVENT_LIMIT, '#p': [pk] } }]
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

/** Media kinds for a single profile ({@link PROFILE_MEDIA_TAB_KINDS}, scoped by `authors`). */
export function buildProfileMediaSpellFilter(pubkey: string): Filter {
  const decoded = userIdToPubkey(pubkey.trim())
  const pk = /^[0-9a-f]{64}$/i.test(decoded) ? decoded.toLowerCase() : pubkey.trim().toLowerCase()
  return {
    authors: [pk],
    kinds: [...PROFILE_MEDIA_TAB_KINDS],
    limit: PROFILE_MEDIA_REQ_LIMIT
  }
}

/**
 * Author inboxes/outboxes + read-only + fast read (see {@link buildProfileAugmentedReadRelayUrls}), capped at
 * {@link PROFILE_MEDIA_MAX_RELAYS}.
 */
export function buildProfileMediaSubRequests(
  authorRelayUrls: string[],
  blockedRelays: string[],
  pubkey: string
): TFeedSubRequest[] {
  const urls = buildProfileAugmentedReadRelayUrls(authorRelayUrls, blockedRelays, PROFILE_MEDIA_MAX_RELAYS)
  if (!urls.length) return []
  return [{ urls, filter: buildProfileMediaSpellFilter(pubkey) }]
}

export function buildCalendarSpellFilter(): Filter {
  return {
    kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
    limit: FAUX_SPELL_EVENT_LIMIT
  }
}

function pluralizeTopic(topic: string): string {
  if (!topic) return topic
  if (topic.endsWith('y') && topic.length > 1 && !/[aeiou]y$/i.test(topic)) {
    return `${topic.slice(0, -1)}ies`
  }
  if (/(s|x|z|ch|sh)$/i.test(topic)) {
    return `${topic}es`
  }
  return `${topic}s`
}

function canonicalizeRawTopicTagValue(topic: string): string {
  return topic.trim().replace(/^#+/u, '').replace(/\s+/g, '-')
}

/**
 * One subrequest for all interests: NIP-01 treats multiple `#t` values as OR (any topic matches).
 * Expand every topic to singular+plural so feeds match either spelling on relays.
 */
export function buildInterestsSubRequests(
  relayUrls: string[],
  rawTopics: string[],
  kindsList: number[] = DEFAULT_FEED_SHOW_KINDS
): TFeedSubRequest[] {
  if (!relayUrls.length || !rawTopics.length || !kindsList.length) return []
  const normalizedBaseTopics = Array.from(
    new Set(rawTopics.map((t) => normalizeTopic(t)).filter((t) => t.length > 0))
  ).slice(0, INTERESTS_MAX_TOPICS)
  const rawCasedTopics = Array.from(
    new Set(rawTopics.map((t) => canonicalizeRawTopicTagValue(t)).filter((t) => t.length > 0))
  ).slice(0, INTERESTS_MAX_TOPICS)
  if (!normalizedBaseTopics.length && !rawCasedTopics.length) return []
  const topics = Array.from(new Set([
    ...normalizedBaseTopics.flatMap((topic) => {
      const singular = normalizeTopic(topic)
      const plural = pluralizeTopic(singular)
      return [singular, plural]
    }),
    ...rawCasedTopics.flatMap((topic) => [topic, pluralizeTopic(topic)])
  ])).slice(0, INTERESTS_MAX_TOPIC_TAG_VALUES)
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

/** NIP-B0 web bookmarks (kind 39701) authored by the user — merged with NIP-51 id bookmarks in the Bookmarks spell. */
export function buildWebBookmarksSpellSubRequests(pubkey: string, urls: string[]): TFeedSubRequest[] {
  if (!pubkey || !urls.length) return []
  const pk = /^[0-9a-f]{64}$/i.test(pubkey.trim()) ? pubkey.trim().toLowerCase() : pubkey.trim()
  return [
    {
      urls,
      filter: {
        authors: [pk],
        kinds: [ExtendedKind.WEB_BOOKMARK],
        limit: FAUX_SPELL_EVENT_LIMIT
      }
    }
  ]
}
