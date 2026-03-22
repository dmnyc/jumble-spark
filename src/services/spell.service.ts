/**
 * NIP-A7 Spells: parse and execute kind 777 events as portable relay query filters.
 */

import { ExtendedKind, FAST_WRITE_RELAY_URLS } from '@/constants'
import { getRelayUrlsWithFavoritesFastReadAndInbox } from '@/lib/favorites-feed-relays'
import { tagNameEquals } from '@/lib/tag'
import logger from '@/lib/logger'
import type { TRelayList } from '@/types'
import { normalizeUrl } from '@/lib/url'
import type { Event } from 'nostr-tools'
import type { Filter } from 'nostr-tools'

const RELATIVE_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  mo: 2592000,
  y: 31536000
}

/**
 * Resolve relative time to Unix timestamp.
 * "now" -> current time; "7d" -> now - 7*86400; "1704067200" -> 1704067200.
 */
export function resolveRelativeTime(value: string): number {
  const trimmed = (value || '').trim()
  if (trimmed === 'now' || trimmed === '') {
    return Math.floor(Date.now() / 1000)
  }
  const num = parseInt(trimmed, 10)
  if (!Number.isNaN(num) && trimmed === String(num)) {
    return num
  }
  const match = trimmed.match(/^(\d+)(s|m|h|d|w|mo|y)$/)
  if (!match) {
    return Math.floor(Date.now() / 1000)
  }
  const n = parseInt(match[1]!, 10)
  const unit = match[2]!
  const sec = RELATIVE_UNIT_SECONDS[unit] ?? 86400
  return Math.floor(Date.now() / 1000) - n * sec
}

export type SpellExecutionContext = {
  pubkey: string | null
  contacts: string[]
}

/** When the spell has no `relays` tag and NIP-65 write list is empty: known-good write relays. */
function defaultSpellWriteFallbackRelays(): string[] {
  return dedupeRelayUrls([...FAST_WRITE_RELAY_URLS])
}

/** Max kind-777 events to pull when syncing spell definitions from relays (you only). */
export const SPELL_CATALOG_SYNC_LIMIT = 200

/**
 * When also syncing spells authored by people you follow, allow a larger merged result so
 * follow-authored spells are not squeezed out by your own.
 */
export const SPELL_CATALOG_SYNC_LIMIT_WITH_FOLLOWS = 600

/** Max distinct pubkeys in one catalog REQ (relay compatibility). Your pubkey is always first. */
export const SPELL_CATALOG_MAX_AUTHORS = 400

/**
 * If no relay sends EOSE, stop showing the catalog sync state and close the sub after this long.
 * Keeps the UI from feeling stuck when relays are slow or silent.
 */
export const SPELL_CATALOG_SYNC_TIMEOUT_MS = 12_000

/** Build author list for spell catalog sync: always include `pubkey`, then follows, deduped. */
export function buildSpellCatalogAuthors(pubkey: string, contacts: string[]): string[] {
  const rest = contacts.filter((c) => typeof c === 'string' && c.length > 0 && c !== pubkey)
  const uniqueFollows = [...new Set(rest)]
  const combined = [pubkey, ...uniqueFollows]
  return combined.slice(0, SPELL_CATALOG_MAX_AUTHORS)
}

/**
 * Relays to fetch the user's kind-777 spells: favorites + default fast-read relays + user read/inboxes
 * (same extension as other non–favorites-feed reads; not the favorites-only home list).
 */
export function getRelaysForSpellCatalogSync(
  favoriteRelays: string[],
  blockedRelays: string[],
  userInboxReadRelays: string[]
): string[] {
  return getRelayUrlsWithFavoritesFastReadAndInbox(favoriteRelays, blockedRelays, userInboxReadRelays)
}

function dedupeRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const key = normalizeUrl(u) || u
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export type GetRelaysForSpellOptions = {
  /**
   * When true (default): merge FAST_WRITE after the primary list (REQ feeds) for resilience.
   * When false: use only spell `relays` tag, NIP-65 write relays, or write fallback — no extra padding (COUNT).
   */
  mergeDefaultReadRelays?: boolean
}

/**
 * Get relay URLs for executing a spell: spell `relays` tag, else the user's NIP-65 **write** (outbox) relays.
 * Publishing and running spells use outboxes only (plus optional FAST_WRITE padding when mergeDefaults is true).
 */
export function getRelaysForSpell(
  spell: Event,
  context: { relayListWrite: string[] },
  options?: GetRelaysForSpellOptions
): string[] {
  const mergeDefaults = options?.mergeDefaultReadRelays !== false
  let primary: string[] = []
  const relayTag = spell.tags.find(tagNameEquals('relays'))
  if (relayTag && relayTag.length > 1) {
    const urls = relayTag
      .slice(1)
      .filter((u): u is string => typeof u === 'string' && (u.startsWith('wss://') || u.startsWith('ws://')))
    if (urls.length) primary = urls
  }
  if (!primary.length && context.relayListWrite.length) {
    primary = [...context.relayListWrite]
  }
  if (!primary.length) {
    return defaultSpellWriteFallbackRelays()
  }
  if (mergeDefaults) {
    return dedupeRelayUrls([...primary, ...FAST_WRITE_RELAY_URLS])
  }
  return dedupeRelayUrls(primary)
}

/** Spell lists at least one relay URL in its `relays` tag. */
export function spellHasExplicitRelays(spell: Event): boolean {
  const relayTag = spell.tags.find(tagNameEquals('relays'))
  if (!relayTag || relayTag.length < 2) return false
  return relayTag
    .slice(1)
    .some((u) => typeof u === 'string' && (u.startsWith('wss://') || u.startsWith('ws://')))
}

/**
 * Resolve authors: replace $me with pubkey and $contacts with contacts array.
 */
function resolveAuthors(authorsTag: string[] | undefined, ctx: SpellExecutionContext): string[] | undefined {
  const raw = authorsTag?.slice(1) ?? []
  const out: string[] = []
  for (const v of raw) {
    if (v === '$me') {
      if (ctx.pubkey) out.push(ctx.pubkey)
    } else if (v === '$contacts') {
      out.push(...ctx.contacts)
    } else {
      out.push(v)
    }
  }
  return out.length ? out : undefined
}

/**
 * Resolve tag filter values: replace $me and $contacts in ["tag", "p", "$me", "x"] etc.
 */
function resolveTagFilterValues(values: string[], ctx: SpellExecutionContext): string[] {
  const out: string[] = []
  for (const v of values) {
    if (v === '$me') {
      if (ctx.pubkey) out.push(ctx.pubkey)
    } else if (v === '$contacts') {
      out.push(...ctx.contacts)
    } else {
      out.push(v)
    }
  }
  return out
}

/**
 * Build a Nostr REQ filter from a spell event, resolving variables and relative times.
 */
export function spellEventToFilter(spell: Event, ctx: SpellExecutionContext): Filter | null {
  const filter: Filter = {}

  const cmd = spell.tags.find(tagNameEquals('cmd'))?.[1]
  if (cmd !== 'REQ' && cmd !== 'COUNT') {
    logger.warn('[Spell] Unsupported cmd', { cmd })
    return null
  }

  const kTag = spell.tags.filter(tagNameEquals('k'))
  if (kTag.length) {
    const kinds = kTag
      .map((t) => t[1])
      .filter((x): x is string => x != null && x !== '')
      .map((x) => parseInt(x, 10))
      .filter((n) => !Number.isNaN(n))
    if (kinds.length) filter.kinds = kinds
  }

  const authorsTag = spell.tags.find(tagNameEquals('authors'))
  const authors = resolveAuthors(authorsTag ? [authorsTag[0]!, ...authorsTag.slice(1)] : undefined, ctx)
  if (authors?.length) filter.authors = authors

  const idsTag = spell.tags.find(tagNameEquals('ids'))
  if (idsTag && idsTag.length > 1) {
    filter.ids = idsTag.slice(1).filter((x): x is string => typeof x === 'string' && x.length > 0)
  }

  const limitTag = spell.tags.find(tagNameEquals('limit'))
  if (limitTag?.[1]) {
    const n = parseInt(limitTag[1], 10)
    if (!Number.isNaN(n)) filter.limit = n
  }

  const sinceTag = spell.tags.find(tagNameEquals('since'))
  if (sinceTag?.[1]) filter.since = resolveRelativeTime(sinceTag[1])

  const untilTag = spell.tags.find(tagNameEquals('until'))
  if (untilTag?.[1]) filter.until = resolveRelativeTime(untilTag[1])

  const searchTag = spell.tags.find(tagNameEquals('search'))
  if (searchTag?.[1]) filter.search = searchTag[1]

  for (const tag of spell.tags) {
    if (tag[0] === 'tag' && tag.length >= 2) {
      const letter = tag[1]
      const values = resolveTagFilterValues(tag.slice(2), ctx)
      if (letter && values.length) {
        (filter as any)[`#${letter}`] = values
      }
    }
  }

  return filter
}

/** Spell uses COUNT: run filter against relays and show a numeric result (not a feed). */
export function spellIsCount(spell: Event): boolean {
  return spell.tags.find(tagNameEquals('cmd'))?.[1] === 'COUNT'
}

/**
 * Get display name for a spell (from "name" tag or content).
 */
export function getSpellName(spell: Event): string {
  const nameTag = spell.tags.find(tagNameEquals('name'))
  if (nameTag?.[1]) return nameTag[1]
  if (spell.content?.trim()) return spell.content.trim().slice(0, 80)
  return `Spell ${spell.id.slice(0, 8)}`
}

export function isSpellEvent(event: Event): boolean {
  return event.kind === ExtendedKind.SPELL
}
