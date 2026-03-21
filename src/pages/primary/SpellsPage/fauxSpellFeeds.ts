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
import { normalizeTopic } from '@/lib/discussion-topics'
import { normalizeUrl } from '@/lib/url'
import type { TFeedSubRequest, TRelayList, TNotificationType } from '@/types'
import { kinds, type Event, type Filter } from 'nostr-tools'

const NOTIFICATION_LIMIT = 500
const DISCUSSION_LIMIT = 500
const MAX_BOOKMARK_IDS = 250

export const MEDIA_SPELL_KINDS = [
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.VOICE
] as const

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

export function notificationRelayUrls(
  relayList: TRelayList | null | undefined,
  favoriteRelays: string[]
): string[] {
  const read = relayList?.read ?? []
  if (read.length > 0) return dedupe(read.slice(0, 5))
  if (favoriteRelays.length > 0) return dedupe(favoriteRelays.slice(0, 5))
  return dedupe(FAST_READ_RELAY_URLS.slice(0, 5))
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

export function notificationFilterKinds(notificationType: TNotificationType): number[] {
  switch (notificationType) {
    case 'mentions':
      return [
        kinds.ShortTextNote,
        ExtendedKind.COMMENT,
        ExtendedKind.VOICE_COMMENT,
        ExtendedKind.POLL,
        ExtendedKind.PUBLIC_MESSAGE,
        ExtendedKind.DISCUSSION
      ]
    case 'reactions':
      return [kinds.Reaction, kinds.Repost, ExtendedKind.POLL_RESPONSE]
    case 'zaps':
      return [kinds.Zap]
    default:
      return [
        kinds.ShortTextNote,
        kinds.Repost,
        kinds.Reaction,
        kinds.Zap,
        ExtendedKind.COMMENT,
        ExtendedKind.POLL_RESPONSE,
        ExtendedKind.VOICE_COMMENT,
        ExtendedKind.POLL,
        ExtendedKind.PUBLIC_MESSAGE,
        ExtendedKind.DISCUSSION
      ]
  }
}

export function buildNotificationFilter(pubkey: string, notificationType: TNotificationType): Filter {
  return {
    kinds: notificationFilterKinds(notificationType),
    limit: NOTIFICATION_LIMIT,
    '#p': [pubkey]
  }
}

/** Relay set for discussion threads (kind 11), aligned with DiscussionsPage’s merged list (sync). */
export function discussionRelayUrls(
  relayList: TRelayList | null | undefined,
  favoriteRelays: string[],
  blockedRelays: string[]
): string[] {
  const read = relayList?.read ?? []
  const write = relayList?.write ?? []
  const merged = [...read, ...write, ...favoriteRelays, ...FAST_READ_RELAY_URLS, ...FAST_WRITE_RELAY_URLS]
  const blocked = new Set(blockedRelays.map((b) => normalizeUrl(b) || b))
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of merged) {
    const k = normalizeUrl(u) || u
    if (!k || seen.has(k) || blocked.has(k)) continue
    seen.add(k)
    out.push(k)
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
  return { kinds: [...MEDIA_SPELL_KINDS], limit: 500 }
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
