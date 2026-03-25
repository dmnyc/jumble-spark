import { ExtendedKind, FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import {
  canonicalizeRssArticleUrl,
  getArticleUrlFromCommentITags,
  getHighlightSourceHttpUrl,
  getWebExternalReactionTargetUrl
} from '@/lib/rss-article'
import { normalizeUrl } from '@/lib/url'
import { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { RssFeedItem } from '@/services/rss-feed.service'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/** IndexedDB settings key: `'1'` = show only current user’s web comments/highlights in RSS+Web feed. */
export const RSS_WEB_ONLY_MY_EVENTS_SETTING = 'rssWebOnlyMyEvents'

/** IndexedDB: merged RSS+Web cards + Nostr vs flat RSS-only list. */
export const RSS_WEB_FEED_SCOPE_SETTING = 'rssWebFeedScope'

/** IndexedDB: JSON array of `{ url, addedAt }` for URLs added from “Add URL” (no RSS row yet). */
export const RSS_WEB_MANUAL_URLS_SETTING = 'rssWebManualUrls'

export type RssWebFeedScope = 'webOnly' | 'webAndRss' | 'rssOnly'

export type ManualRssWebUrlEntry = { url: string; addedAt: number }

const MAX_MANUAL_WEB_URLS = 200

/** Keep newest URLs by `addedAt`; drops oldest when over limit. */
function trimManualRssWebUrlsToLimit(entries: ManualRssWebUrlEntry[]): ManualRssWebUrlEntry[] {
  if (entries.length <= MAX_MANUAL_WEB_URLS) return entries
  return [...entries]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, MAX_MANUAL_WEB_URLS)
}

/** Cap how many pubkeys we scan (self + follows) per discovery pass. */
const MAX_WEB_DISCOVERY_AUTHORS = 400
const WEB_DISCOVERY_AUTHORS_CHUNK = 10
const WEB_DISCOVERY_EVENTS_LIMIT = 400

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

/** Small chunks keep each Nostr filter JSON under relay limits ("filter item too large"). */
const URL_CHUNK = 5

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
 * Group RSS entries by canonical article URL (NIP-22 / web thread key).
 */
export function groupRssItemsByCanonicalUrl(items: RssFeedItem[]): RssUrlGroup[] {
  const { groups } = partitionRssItemsForWebFeed(items)
  return groups
}

/** HTTP(S) article groups for combined cards; everything else stays as plain RSS rows. */
export function partitionRssItemsForWebFeed(items: RssFeedItem[]): {
  groups: RssUrlGroup[]
  nonHttpItems: RssFeedItem[]
} {
  const map = new Map<string, RssFeedItem[]>()
  const nonHttpItems: RssFeedItem[] = []
  for (const item of items) {
    const link = item.link?.trim()
    if (!link || !isHttpArticleUrl(link)) {
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

function buildStatsRelayList(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (u: string) => {
    const n = normalizeUrl(u) || u
    if (!n || seen.has(n)) return
    seen.add(n)
    out.push(n)
  }
  SEARCHABLE_RELAY_URLS.forEach(add)
  FAST_READ_RELAY_URLS.forEach(add)
  return out
}

function highlightSourceUrl(evt: Event): string | undefined {
  const u = getHighlightSourceHttpUrl(evt)
  return u && isHttpArticleUrl(u) ? u : undefined
}

function extractArticleUrlFromWebActivityEvent(evt: Event): string | undefined {
  if (evt.kind === ExtendedKind.COMMENT || evt.kind === ExtendedKind.VOICE_COMMENT) {
    const u = getArticleUrlFromCommentITags(evt)
    if (!u || !isHttpArticleUrl(u)) return undefined
    return canonicalizeRssArticleUrl(u)
  }
  if (evt.kind === ExtendedKind.EXTERNAL_REACTION) {
    const u = getWebExternalReactionTargetUrl(evt)
    return u && isHttpArticleUrl(u) ? canonicalizeRssArticleUrl(u) : undefined
  }
  if (evt.kind === kinds.Highlights) {
    return highlightSourceUrl(evt)
  }
  return undefined
}

/**
 * Recent kind 1111 / 1244 / 17 / 9802 from the given authors; returns canonical article URLs with latest event time.
 * Used to seed manual URL cards so the RSS+Web feed can load thread stats and Nostr activity for pages not in RSS.
 */
export async function fetchDiscoveredWebUrlsFromAuthorPubkeys(pubkeys: string[]): Promise<ManualRssWebUrlEntry[]> {
  const unique = [...new Set(pubkeys.filter(Boolean))].slice(0, MAX_WEB_DISCOVERY_AUTHORS)
  if (unique.length === 0) return []

  const relayUrls = buildStatsRelayList()
  if (relayUrls.length === 0) return []

  const latestByUrl = new Map<string, number>()
  const webKinds = [
    ExtendedKind.COMMENT,
    ExtendedKind.VOICE_COMMENT,
    ExtendedKind.EXTERNAL_REACTION,
    kinds.Highlights
  ] as number[]

  for (let i = 0; i < unique.length; i += WEB_DISCOVERY_AUTHORS_CHUNK) {
    const chunk = unique.slice(i, i + WEB_DISCOVERY_AUTHORS_CHUNK)
    try {
      await queryService.fetchEvents(
        relayUrls,
        [{ kinds: webKinds, authors: chunk, limit: WEB_DISCOVERY_EVENTS_LIMIT }],
        {
          onevent: (evt: Event) => {
            const url = extractArticleUrlFromWebActivityEvent(evt)
            if (!url) return
            const prev = latestByUrl.get(url) ?? 0
            if (evt.created_at > prev) latestByUrl.set(url, evt.created_at)
          },
          eoseTimeout: 5000,
          globalTimeout: 15000
        }
      )
    } catch {
      /* ignore chunk */
    }
  }

  return [...latestByUrl.entries()].map(([url, addedAt]) => ({ url, addedAt }))
}

export type NostrWebActivityByUrl = Map<
  string,
  {
    comments: Event[]
    highlights: Event[]
    externalReactions: Event[]
  }
>

/**
 * Pull kind 1111 (i-tag) comments, kind 17 (i-tag web) reactions, and kind 9802 (r-tag URL) highlights.
 */
export async function fetchNostrWebActivityForUrls(urls: string[]): Promise<NostrWebActivityByUrl> {
  const out: NostrWebActivityByUrl = new Map()
  const httpUrls = [...new Set(urls.filter((u) => isHttpArticleUrl(u)).map((u) => canonicalizeRssArticleUrl(u)))]
  if (httpUrls.length === 0) return out

  const relayUrls = buildStatsRelayList()
  if (relayUrls.length === 0) return out

  const urlSet = new Set(httpUrls)
  const commentById = new Map<string, Event>()
  const highlightById = new Map<string, Event>()
  const externalReactionById = new Map<string, Event>()

  const webActivityOpts = {
    onevent: (evt: Event) => {
      if (evt.kind === ExtendedKind.COMMENT) {
        commentById.set(evt.id, evt)
      } else if (evt.kind === ExtendedKind.EXTERNAL_REACTION) {
        externalReactionById.set(evt.id, evt)
      } else if (evt.kind === kinds.Highlights) {
        highlightById.set(evt.id, evt)
      }
    },
    eoseTimeout: 4000,
    globalTimeout: 12000
  }

  for (let i = 0; i < httpUrls.length; i += URL_CHUNK) {
    const chunk = httpUrls.slice(i, i + URL_CHUNK)
    try {
      // One filter per REQ — multiple large #i/#r arrays in one subscription hit relay size limits.
      await queryService.fetchEvents(
        relayUrls,
        [{ kinds: [ExtendedKind.COMMENT], '#i': chunk, limit: 120 }],
        webActivityOpts
      )
      await queryService.fetchEvents(
        relayUrls,
        [{ kinds: [ExtendedKind.EXTERNAL_REACTION], '#i': chunk, limit: 120 }],
        webActivityOpts
      )
      await queryService.fetchEvents(
        relayUrls,
        [{ kinds: [kinds.Highlights], '#r': chunk, limit: 120 }],
        webActivityOpts
      )
    } catch {
      /* ignore chunk */
    }
  }

  const addTo = (
    urlKey: string,
    type: 'comments' | 'highlights' | 'externalReactions',
    evt: Event
  ) => {
    let bucket = out.get(urlKey)
    if (!bucket) {
      bucket = { comments: [], highlights: [], externalReactions: [] }
      out.set(urlKey, bucket)
    }
    bucket[type].push(evt)
  }

  for (const evt of commentById.values()) {
    const u = getArticleUrlFromCommentITags(evt)
    if (!u || !isHttpArticleUrl(u)) continue
    const key = canonicalizeRssArticleUrl(u)
    if (!urlSet.has(key)) continue
    addTo(key, 'comments', evt)
  }

  for (const evt of highlightById.values()) {
    const u = highlightSourceUrl(evt)
    if (!u) continue
    const key = canonicalizeRssArticleUrl(u)
    if (!urlSet.has(key)) continue
    addTo(key, 'highlights', evt)
  }

  for (const evt of externalReactionById.values()) {
    const u = getWebExternalReactionTargetUrl(evt)
    if (!u) continue
    const key = canonicalizeRssArticleUrl(u)
    if (!urlSet.has(key)) continue
    addTo(key, 'externalReactions', evt)
  }

  for (const [, bucket] of out) {
    bucket.comments.sort((a, b) => b.created_at - a.created_at)
    bucket.highlights.sort((a, b) => b.created_at - a.created_at)
    bucket.externalReactions.sort((a, b) => b.created_at - a.created_at)
  }

  return out
}

/**
 * Latest kind-17 web reaction time per canonical URL for this pubkey (for feed rows not in RSS).
 */
export async function fetchPubkeyWebExternalReactionUrls(pubkey: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const relayUrls = buildStatsRelayList()
  if (!pubkey || relayUrls.length === 0) return out
  try {
    await queryService.fetchEvents(
      relayUrls,
      [{ kinds: [ExtendedKind.EXTERNAL_REACTION], authors: [pubkey], limit: 500 }],
      {
        onevent: (evt: Event) => {
          const url = getWebExternalReactionTargetUrl(evt)
          if (!url) return
          const key = canonicalizeRssArticleUrl(url)
          const prev = out.get(key) ?? 0
          if (evt.created_at > prev) out.set(key, evt.created_at)
        },
        eoseTimeout: 5000,
        globalTimeout: 15000
      }
    )
  } catch {
    /* ignore */
  }
  return out
}

export async function loadRssWebOnlyMyEventsPreference(): Promise<boolean> {
  const v = await indexedDb.getSetting(RSS_WEB_ONLY_MY_EVENTS_SETTING)
  return v === '1' || v === 'true'
}

export async function saveRssWebOnlyMyEventsPreference(onlyMine: boolean): Promise<void> {
  await indexedDb.setSetting(RSS_WEB_ONLY_MY_EVENTS_SETTING, onlyMine ? '1' : '0')
}

export async function loadRssWebFeedScopePreference(): Promise<RssWebFeedScope> {
  const v = await indexedDb.getSetting(RSS_WEB_FEED_SCOPE_SETTING)
  if (v === 'webOnly' || v === 'webAndRss' || v === 'rssOnly') return v
  if (v === 'all') return 'webAndRss'
  return 'webAndRss'
}

export async function saveRssWebFeedScopePreference(scope: RssWebFeedScope): Promise<void> {
  await indexedDb.setSetting(RSS_WEB_FEED_SCOPE_SETTING, scope)
}

export function filterEventsByPubkey(events: Event[], pubkey: string | null | undefined): Event[] {
  if (!pubkey) return events
  return events.filter((e) => e.pubkey === pubkey)
}
