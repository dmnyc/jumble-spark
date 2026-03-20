/**
 * Unified search for mentions (npubs) and event/note picker (nevent/naddr).
 * Both use the same pattern: cache first, then IndexedDB, then relays, up to limit.
 */

import { ExtendedKind, SEARCHABLE_RELAY_URLS } from '@/constants'
import { kinds, type Event as NEvent } from 'nostr-tools'
import { eventService, queryService } from './client.service'
import client from './client.service'
import indexedDb from './indexed-db.service'

const DEFAULT_NOTES_LIMIT = 20
const DEFAULT_NPUBS_LIMIT = 100

/** Kinds for nevent search: notes, threads, long-form, etc. */
export const NEVENT_KINDS = [
  kinds.ShortTextNote,
  ExtendedKind.PICTURE, 
  ExtendedKind.VIDEO, 
  ExtendedKind.SHORT_VIDEO, 
  ExtendedKind.POLL, 
  ExtendedKind.COMMENT, 
  ExtendedKind.VOICE, 
  ExtendedKind.VOICE_COMMENT, 
  ExtendedKind.PUBLIC_MESSAGE, 
  ExtendedKind.DISCUSSION,
  ExtendedKind.CITATION_INTERNAL, 
  ExtendedKind.CITATION_EXTERNAL, 
  ExtendedKind.CITATION_HARDCOPY, 
  ExtendedKind.CITATION_PROMPT, 
] as const

/** Kinds for naddr search: calendar, publications, wiki, etc. */
export const NADDR_KINDS = [
  ExtendedKind.CALENDAR_EVENT_DATE, 
  ExtendedKind.CALENDAR_EVENT_TIME, 
  ExtendedKind.PUBLICATION, 
  ExtendedKind.WIKI_ARTICLE, 
  ExtendedKind.WIKI_ARTICLE_MARKDOWN, 
  ExtendedKind.PUBLICATION_CONTENT,
  kinds.LongFormArticle,
] as const

export type PickerSearchMode = 'nevent' | 'naddr'

/**
 * Search for events: session cache → IndexedDB → relays. Merges and dedupes by event id, up to limit.
 * @param mode - 'nevent' uses NEVENT_KINDS (1,11,20,21,22,9802), 'naddr' uses NADDR_KINDS (30023,30817,30818,30040).
 */
export async function searchEventsForPicker(
  query: string,
  limit: number = DEFAULT_NOTES_LIMIT,
  mode: PickerSearchMode = 'nevent'
): Promise<NEvent[]> {
  const q = query.trim()
  if (!q) return []

  const kindsList = mode === 'nevent' ? [...NEVENT_KINDS] : [...NADDR_KINDS]
  const seen = new Set<string>()
  const out: NEvent[] = []

  const addUnique = (evt: NEvent) => {
    if (seen.has(evt.id)) return
    seen.add(evt.id)
    out.push(evt)
  }

  const fromSession = eventService.getSessionEventsMatchingSearch(q, limit, kindsList)
  fromSession.forEach(addUnique)
  if (out.length >= limit) return out.slice(0, limit)

  const fromIdb = await indexedDb.getCachedEventsForSearch(q, limit - out.length, kindsList)
  fromIdb.forEach(addUnique)
  if (out.length >= limit) return out.slice(0, limit)

  const fromRelays = await queryService.fetchEvents(
    SEARCHABLE_RELAY_URLS,
    { kinds: kindsList, search: q, limit: limit - out.length },
    { eoseTimeout: 5000, globalTimeout: 8000 }
  )
  fromRelays.forEach(addUnique)
  return out.slice(0, limit)
}

/**
 * @deprecated Use searchEventsForPicker(query, limit, 'nevent') instead.
 */
export async function searchNotesForPicker(
  query: string,
  limit: number = DEFAULT_NOTES_LIMIT
): Promise<NEvent[]> {
  return searchEventsForPicker(query, limit, 'nevent')
}

/**
 * Search for npubs for @-mentions. Uses same pattern as note search: cache (follow + local index) then relays.
 * Delegates to client which already does follow-list → local index → relay search.
 * Supports incremental updates via onUpdate callback for faster UI updates.
 */
export async function searchNpubsForMention(
  query: string,
  limit: number = DEFAULT_NPUBS_LIMIT,
  onUpdate?: (npubs: string[]) => void
): Promise<string[]> {
  return client.searchNpubsForMention(query, limit, onUpdate)
}
