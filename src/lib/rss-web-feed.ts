import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { isReplyNoteEvent } from '@/lib/event'
import {
  articleUrlMatchesThreadScope,
  canonicalizeRssArticleUrl,
  expandArticleUrlThreadQueryValues,
  getArticleUrlFromCommentITags,
  getHighlightSourceHttpUrl,
  getReactionPageUrlFromRTags,
  getWebBookmarkArticleUrl,
  getWebExternalReactionTargetUrl
} from '@/lib/rss-article'
import logger from '@/lib/logger'
import { isImage, isLocalNetworkUrl, isMedia, isVideo, normalizeUrl } from '@/lib/url'
import { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { RssFeedItem } from '@/services/rss-feed.service'
import { kinds, type Event, type Filter } from 'nostr-tools'

/** IndexedDB: `'1'` (default) = hide clawstr.com (strip preview links + drop URL/RSS rows for that host). */
export const RSS_WEB_SUPPRESS_CLAWSTR_SETTING = 'rssWebSuppressClawstrLinks'

/** IndexedDB: `'1'` (default) = keep local/media/feed XML links as plain RSS rows, not URL cards. */
export const RSS_WEB_HIDE_UNIFIED_CLUTTER_SETTING = 'rssWebHideUnifiedClutter'

/** IndexedDB: feed view — article URL cards, flat RSS timeline, or both interleaved. */
export const RSS_WEB_FEED_SCOPE_SETTING = 'rssWebFeedScope'

/** IndexedDB: JSON array of `{ url, addedAt }` for URLs added from “Add URL” (no RSS row yet). */
export const RSS_WEB_MANUAL_URLS_SETTING = 'rssWebManualUrls'

/** `urls` = one card per article URL (Nostr + RSS merge). `rss` = classic chronological RSS list. `both` = mixed timeline with distinct row UIs. */
export type RssWebFeedScope = 'urls' | 'rss' | 'both'

/** Normalize stored scope (legacy `webOnly` / `rssOnly` / `webAndRss` included). */
export function parseRssWebFeedScope(raw: string | null | undefined): RssWebFeedScope {
  if (raw === 'urls' || raw === 'rss' || raw === 'both') return raw
  if (raw === 'webOnly') return 'urls'
  if (raw === 'rssOnly') return 'rss'
  if (raw === 'webAndRss' || raw === 'all') return 'both'
  return 'both'
}

export type ManualRssWebUrlEntry = { url: string; addedAt: number }

const MAX_MANUAL_WEB_URLS = 200

/** Keep newest URLs by `addedAt`; drops oldest when over limit. */
function trimManualRssWebUrlsToLimit(entries: ManualRssWebUrlEntry[]): ManualRssWebUrlEntry[] {
  if (entries.length <= MAX_MANUAL_WEB_URLS) return entries
  return [...entries]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, MAX_MANUAL_WEB_URLS)
}

/** Per-kind REQ limit for RSS+Web relay URL discovery (no `authors` filter). */
export const RSS_WEB_NOSTR_PER_KIND_LIMIT = 100

/** Relay discovery: only events in this window (some relays reject unbounded kind-only REQs). */
const RSS_WEB_RELAY_DISCOVERY_SINCE_SEC = 365 * 24 * 60 * 60

export async function loadManualRssWebUrls(): Promise<ManualRssWebUrlEntry[]> {
  const raw = await indexedDb.getSetting(RSS_WEB_MANUAL_URLS_SETTING)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: ManualRssWebUrlEntry[] = []
    for (const x of parsed) {
      if (typeof x !== 'object' || x === null) continue
      const rec = x as Record<string, unknown>
      if (typeof rec.url !== 'string') continue
      const url = canonicalizeRssArticleUrl(rec.url.trim())
      if (!isHttpArticleUrl(url)) continue
      const addedAt = typeof rec.addedAt === 'number' ? rec.addedAt : 0
      out.push({ url, addedAt })
    }
    return out
  } catch {
    return []
  }
}

/** Dedupes by canonical URL; newest first. Returns canonical URL. */
export async function addManualRssWebUrl(rawUrl: string): Promise<string> {
  const canonical = canonicalizeRssArticleUrl(rawUrl.trim())
  if (!isHttpArticleUrl(canonical)) return canonical
  const existing = await loadManualRssWebUrls()
  const filtered = existing.filter((e) => e.url !== canonical)
  const next = trimManualRssWebUrlsToLimit([
    { url: canonical, addedAt: Date.now() },
    ...filtered
  ])
  await indexedDb.setSetting(RSS_WEB_MANUAL_URLS_SETTING, JSON.stringify(next))
  return canonical
}

/**
 * Merge URLs learned from Nostr (follows + self) into the manual web URL list.
 * Returns whether IndexedDB was updated (caller may refetch UI state).
 */
export async function mergeDiscoveredRssWebUrls(discovered: ManualRssWebUrlEntry[]): Promise<boolean> {
  if (discovered.length === 0) return false
  const existing = await loadManualRssWebUrls()
  const byUrl = new Map<string, number>()
  for (const e of existing) {
    byUrl.set(e.url, e.addedAt)
  }
  let changed = false
  for (const d of discovered) {
    const prev = byUrl.get(d.url) ?? 0
    const next = Math.max(prev, d.addedAt)
    if (next !== prev) changed = true
    byUrl.set(d.url, next)
  }
  if (!changed) return false
  const merged = trimManualRssWebUrlsToLimit(
    [...byUrl.entries()].map(([url, addedAt]) => ({ url, addedAt }))
  )
  await indexedDb.setSetting(RSS_WEB_MANUAL_URLS_SETTING, JSON.stringify(merged))
  return true
}

/** Dispatched after publishing a kind 17 web URL reaction so RSS+Web can refetch. */
export const WEB_EXTERNAL_REACTION_PUBLISHED_EVENT = 'jumble:webExternalReactionPublished'

export type RssUrlGroup = {
  canonicalUrl: string
  items: RssFeedItem[]
  /** Latest RSS pubDate in group for sorting */
  latestPub: number
}

export function isHttpArticleUrl(url: string): boolean {
  const t = url.trim()
  return t.startsWith('http://') || t.startsWith('https://')
}

/**
 * URLs that make poor “article URL” cards: localhost/LAN, direct media files, and common RSS/Atom document paths.
 * When filtering is on, these stay as normal RSS timeline rows instead of Web URL cards.
 */
export function isRssWebUnifiedClutterUrl(url: string): boolean {
  const t = url.trim()
  if (!isHttpArticleUrl(t)) return false
  let parsed: URL
  try {
    parsed = new URL(t)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  if (host.endsWith('.local')) return true
  if (isLocalNetworkUrl(t)) return true
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4 && Number(ipv4[1]) === 127) return true

  if (isMedia(t) || isVideo(t) || isImage(t)) return true

  const path = parsed.pathname.toLowerCase()
  const segments = path.split('/').filter(Boolean)
  const last = segments[segments.length - 1] || ''
  // Documents — not article pages
  if (
    /\.(pdf|epub|mobi|azw3|doc|docx|xls|xlsx|ppt|pptx|ods|odt|rtf)(\?.*)?$/i.test(path)
  ) {
    return true
  }
  if (/\.(rss|atom)$/i.test(last)) return true
  if (last === 'feed.xml' || last === 'rss.xml' || last === 'atom.xml') return true
  if (last.endsWith('.xml')) return true
  if (last === 'feed' || last === 'rss' || last === 'atom') return true
  return false
}

/**
 * Split filters: `social` uses kinds that match {@link relayFilterIncludesSocialKindBlockedKind} and therefore omit
 * {@link SOCIAL_KIND_BLOCKED_RELAY_URLS}; `nonSocial` keeps reactions / `#r` on batches that do not apply that strip.
 * Read-only index relays ({@link READ_ONLY_RELAY_URLS}) are unrelated to the social-kind block list.
 */
export function buildRssArticleUrlThreadInteractionFilterGroups(
  canonicalArticleUrl: string,
  limit: number
): { nonSocial: Filter[]; social: Filter[] } {
  const canonical = canonicalizeRssArticleUrl(canonicalArticleUrl)
  const tagVals = expandArticleUrlThreadQueryValues(canonical)
  const iFilterVals = tagVals.length > 0 ? tagVals : [canonical]
  const social: Filter[] = [
    { '#i': iFilterVals, kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT], limit },
    { '#I': iFilterVals, kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT], limit }
  ]
  const nonSocial: Filter[] = [
    { '#i': iFilterVals, kinds: [ExtendedKind.EXTERNAL_REACTION], limit },
    { '#I': iFilterVals, kinds: [ExtendedKind.EXTERNAL_REACTION], limit }
  ]
  if (tagVals.length > 0) {
    nonSocial.push(
      { '#r': tagVals, kinds: [kinds.Highlights], limit },
      { '#r': tagVals, kinds: [kinds.Reaction], limit }
    )
  }
  return { nonSocial, social }
}

/** REQ filters for Nostr comments, reactions, and highlights on one article URL (synthetic RSS thread). */
export function buildRssArticleUrlThreadInteractionFilters(
  canonicalArticleUrl: string,
  limit: number
): Filter[] {
  const { nonSocial, social } = buildRssArticleUrlThreadInteractionFilterGroups(
    canonicalArticleUrl,
    limit
  )
  return [...nonSocial, ...social]
}

/** Whether `evt` belongs to the URL-scoped article thread (comments / voice / highlight / reactions on this page). */
export function isRssArticleUrlThreadInteraction(evt: Event, canonicalArticleUrl: string): boolean {
  const key = canonicalizeRssArticleUrl(canonicalArticleUrl)
  if (evt.kind === kinds.Highlights) {
    const hu = getHighlightSourceHttpUrl(evt)
    return !!hu && articleUrlMatchesThreadScope(hu, key)
  }
  if (evt.kind === ExtendedKind.EXTERNAL_REACTION) {
    const u = getWebExternalReactionTargetUrl(evt)
    return !!u && articleUrlMatchesThreadScope(u, key)
  }
  if (evt.kind === kinds.Reaction) {
    const u = getReactionPageUrlFromRTags(evt)
    return !!u && articleUrlMatchesThreadScope(u, key)
  }
  if (!isReplyNoteEvent(evt)) return false
  const u = getArticleUrlFromCommentITags(evt)
  return !!u && articleUrlMatchesThreadScope(u, key)
}

/**
 * Group RSS entries by canonical article URL (NIP-22 / web thread key).
 */
export function groupRssItemsByCanonicalUrl(items: RssFeedItem[]): RssUrlGroup[] {
  const { groups } = partitionRssItemsForWebFeed(items, { excludeClutterLinks: true })
  return groups
}

/** HTTP(S) article groups for combined cards; everything else stays as plain RSS rows. */
export function partitionRssItemsForWebFeed(
  items: RssFeedItem[],
  options?: { excludeClutterLinks?: boolean }
): {
  groups: RssUrlGroup[]
  nonHttpItems: RssFeedItem[]
} {
  const excludeClutter = options?.excludeClutterLinks !== false
  const map = new Map<string, RssFeedItem[]>()
  const nonHttpItems: RssFeedItem[] = []
  for (const item of items) {
    const link = item.link?.trim()
    if (!link || !isHttpArticleUrl(link)) {
      nonHttpItems.push(item)
      continue
    }
    if (excludeClutter && isRssWebUnifiedClutterUrl(link)) {
      nonHttpItems.push(item)
      continue
    }
    const key = canonicalizeRssArticleUrl(link)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  const groups: RssUrlGroup[] = []
  for (const [canonicalUrl, groupItems] of map) {
    let latestPub = 0
    for (const it of groupItems) {
      const t = it.pubDate?.getTime() ?? 0
      if (t > latestPub) latestPub = t
    }
    groups.push({ canonicalUrl, items: groupItems, latestPub })
  }
  groups.sort((a, b) => b.latestPub - a.latestPub)
  return { groups, nonHttpItems }
}

/**
 * One row per article URL for the “web” side of RSS+Web.
 *
 * **Sources (Nostr-first):** URLs from relay discovery (`relayDiscoveredEntries`) and persisted manual
 * URLs (`manualEntries`) are merged in so each becomes a card even when RSS has no row for that URL
 * — {@link RssWebFeedCard} then uses a faux RSS item / preview for empty `rssItems`.
 *
 * **RSS** only *enriches* rows: items from feeds are grouped by canonical link; Nostr-only URLs keep
 * `rssItems: []`.
 */
export type ArticleUrlFeedWebRow = {
  kind: 'web'
  canonicalUrl: string
  rssItems: RssFeedItem[]
  latestPub: number
}

export function buildArticleUrlFeedRows(
  filteredItems: RssFeedItem[],
  manualEntries: ManualRssWebUrlEntry[],
  relayDiscoveredEntries: ManualRssWebUrlEntry[],
  options?: { excludeClutterLinks?: boolean }
): { webRows: ArticleUrlFeedWebRow[]; nonHttpItems: RssFeedItem[] } {
  const { groups, nonHttpItems } = partitionRssItemsForWebFeed(filteredItems, options)
  const excludeClutter = options?.excludeClutterLinks !== false
  const webByUrl = new Map<string, { rssItems: RssFeedItem[]; latestPub: number }>()

  for (const g of groups) {
    webByUrl.set(g.canonicalUrl, { rssItems: g.items, latestPub: g.latestPub })
  }

  const mergeNostrTimestamp = (url: string, ts: number) => {
    const cur = webByUrl.get(url)
    if (cur) {
      webByUrl.set(url, {
        ...cur,
        latestPub: Math.max(cur.latestPub, ts)
      })
    } else {
      webByUrl.set(url, { rssItems: [], latestPub: ts })
    }
  }

  for (const { url, addedAt } of manualEntries) {
    if (!isHttpArticleUrl(url)) continue
    if (excludeClutter && isRssWebUnifiedClutterUrl(url)) continue
    mergeNostrTimestamp(canonicalizeRssArticleUrl(url), addedAt)
  }
  for (const { url, addedAt } of relayDiscoveredEntries) {
    if (!isHttpArticleUrl(url)) continue
    if (excludeClutter && isRssWebUnifiedClutterUrl(url)) continue
    mergeNostrTimestamp(canonicalizeRssArticleUrl(url), addedAt)
  }

  const webRows: ArticleUrlFeedWebRow[] = Array.from(webByUrl.entries()).map(
    ([canonicalUrl, v]) => ({
      kind: 'web' as const,
      canonicalUrl,
      rssItems: v.rssItems,
      latestPub: v.latestPub
    })
  )
  webRows.sort((a, b) => b.latestPub - a.latestPub)
  return { webRows, nonHttpItems }
}

function highlightSourceUrl(evt: Event): string | undefined {
  const u = getHighlightSourceHttpUrl(evt)
  return u && isHttpArticleUrl(u) ? u : undefined
}

function dedupeRelayUrlsForRssWeb(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const n = normalizeUrl(u) || u
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * Inbox + favorites + fast read: one normalized list for RSS+Web relay queries.
 * Logged-out users get favorites tier + fast read only.
 */
export async function buildRssWebNostrQueryRelayUrls(options: {
  accountPubkey: string | null
  favoriteRelays: string[]
  blockedRelays: string[]
}): Promise<string[]> {
  const { accountPubkey, favoriteRelays, blockedRelays } = options
  const inboxAndFavorites: string[] = accountPubkey
    ? await buildAccountListRelayUrlsForMerge({
        accountPubkey,
        favoriteRelays,
        blockedRelays
      })
    : getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)
  return dedupeRelayUrlsForRssWeb([...inboxAndFavorites, ...FAST_READ_RELAY_URLS])
}

/** One REQ per kind in {@link fetchDiscoveredWebUrlsFromRelays} (includes kind 7 with page `r` tags). */
const RSS_WEB_RELAY_DISCOVERY_KINDS: number[] = [
  ExtendedKind.COMMENT,
  ExtendedKind.EXTERNAL_REACTION,
  kinds.Highlights,
  kinds.Reaction,
  ExtendedKind.VOICE_COMMENT,
  ExtendedKind.WEB_BOOKMARK
]

function extractArticleUrlFromWebActivityEvent(evt: Event): string | undefined {
  if (evt.kind === ExtendedKind.COMMENT || evt.kind === ExtendedKind.VOICE_COMMENT) {
    const u = getArticleUrlFromCommentITags(evt)
    if (!u || !isHttpArticleUrl(u)) return undefined
    return canonicalizeRssArticleUrl(u)
  }
  if (evt.kind === kinds.Reaction) {
    const u = getReactionPageUrlFromRTags(evt)
    return u && isHttpArticleUrl(u) ? canonicalizeRssArticleUrl(u) : undefined
  }
  if (evt.kind === ExtendedKind.EXTERNAL_REACTION) {
    const u = getWebExternalReactionTargetUrl(evt)
    return u && isHttpArticleUrl(u) ? canonicalizeRssArticleUrl(u) : undefined
  }
  if (evt.kind === kinds.Highlights) {
    return highlightSourceUrl(evt)
  }
  if (evt.kind === ExtendedKind.WEB_BOOKMARK) {
    const u = getWebBookmarkArticleUrl(evt)
    return u ? canonicalizeRssArticleUrl(u) : undefined
  }
  return undefined
}

/**
 * One REQ per kind, no `authors` filter: latest events from aggregated relays, grouped by canonical URL.
 */
export async function fetchDiscoveredWebUrlsFromRelays(options: {
  accountPubkey: string | null
  favoriteRelays: string[]
  blockedRelays: string[]
  /** When true (default), omit localhost, media files, and feed-document URLs from discovery. */
  excludeClutterUrls?: boolean
}): Promise<ManualRssWebUrlEntry[]> {
  const excludeClutter = options.excludeClutterUrls !== false
  const relayUrls = await buildRssWebNostrQueryRelayUrls(options)
  if (relayUrls.length === 0) {
    logger.info('[RssWebFeed] Relay URL discovery skipped (no relays)')
    return []
  }

  logger.info('[RssWebFeed] Relay URL discovery starting', {
    relayCount: relayUrls.length,
    kinds: RSS_WEB_RELAY_DISCOVERY_KINDS,
    perKindLimit: RSS_WEB_NOSTR_PER_KIND_LIMIT
  })

  const latestByUrl = new Map<string, number>()
  const onEvent = (evt: Event) => {
    const url = extractArticleUrlFromWebActivityEvent(evt)
    if (!url) return
    if (excludeClutter && isRssWebUnifiedClutterUrl(url)) return
    const key = canonicalizeRssArticleUrl(url)
    const prev = latestByUrl.get(key) ?? 0
    if (evt.created_at > prev) latestByUrl.set(key, evt.created_at)
  }

  await Promise.all(
    RSS_WEB_RELAY_DISCOVERY_KINDS.map(async (kind) => {
      try {
        await queryService.fetchEvents(
          relayUrls,
          [
            {
              kinds: [kind],
              limit: RSS_WEB_NOSTR_PER_KIND_LIMIT,
              since: Math.floor(Date.now() / 1000) - RSS_WEB_RELAY_DISCOVERY_SINCE_SEC
            }
          ],
          {
            onevent: onEvent,
            eoseTimeout: 5000,
            globalTimeout: 15000
          }
        )
      } catch {
        /* per-kind */
      }
    })
  )

  const entries = [...latestByUrl.entries()].map(([url, addedAt]) => ({ url, addedAt }))
  logger.info('[RssWebFeed] Relay URL discovery finished', {
    uniqueUrls: entries.length
  })
  return entries
}

export async function loadRssWebSuppressClawstrPreference(): Promise<boolean> {
  const v = await indexedDb.getSetting(RSS_WEB_SUPPRESS_CLAWSTR_SETTING)
  if (v === '0' || v === 'false') return false
  if (v === '1' || v === 'true') return true
  return true
}

export async function saveRssWebSuppressClawstrPreference(suppress: boolean): Promise<void> {
  await indexedDb.setSetting(RSS_WEB_SUPPRESS_CLAWSTR_SETTING, suppress ? '1' : '0')
}

export async function loadRssWebHideUnifiedClutterPreference(): Promise<boolean> {
  const v = await indexedDb.getSetting(RSS_WEB_HIDE_UNIFIED_CLUTTER_SETTING)
  if (v === '0' || v === 'false') return false
  if (v === '1' || v === 'true') return true
  return true
}

export async function saveRssWebHideUnifiedClutterPreference(hide: boolean): Promise<void> {
  await indexedDb.setSetting(RSS_WEB_HIDE_UNIFIED_CLUTTER_SETTING, hide ? '1' : '0')
}

export async function loadRssWebFeedScopePreference(): Promise<RssWebFeedScope> {
  const v = await indexedDb.getSetting(RSS_WEB_FEED_SCOPE_SETTING)
  return parseRssWebFeedScope(v)
}

export async function saveRssWebFeedScopePreference(scope: RssWebFeedScope): Promise<void> {
  await indexedDb.setSetting(RSS_WEB_FEED_SCOPE_SETTING, scope)
}

export function filterEventsByPubkey(events: Event[], pubkey: string | null | undefined): Event[] {
  if (!pubkey) return events
  return events.filter((e) => e.pubkey === pubkey)
}
