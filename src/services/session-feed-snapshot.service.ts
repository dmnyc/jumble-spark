import type { Event } from 'nostr-tools'

/** Max events stored per feed key (matches typical initial timeline cap). */
const MAX_EVENTS_PER_FEED = 120
/** Max distinct feeds kept in memory for the tab session. */
const MAX_FEED_KEYS = 48

const snapshots = new Map<string, Event[]>()
const accessOrder: string[] = []

function bumpAccess(key: string) {
  const i = accessOrder.indexOf(key)
  if (i >= 0) accessOrder.splice(i, 1)
  accessOrder.push(key)
  while (accessOrder.length > MAX_FEED_KEYS) {
    const oldest = accessOrder.shift()
    if (oldest) snapshots.delete(oldest)
  }
}

/**
 * In-memory feed rows for the current tab session. Lets NoteList restore immediately when
 * remounting the same feed (page / spell / relay) and merge fresh REQ results on top.
 */
export function getSessionFeedSnapshot(key: string): Event[] | undefined {
  if (!key) return undefined
  const rows = snapshots.get(key)
  if (!rows?.length) return undefined
  bumpAccess(key)
  return rows
}

export function setSessionFeedSnapshot(key: string, events: readonly Event[]): void {
  if (!key) return
  const capped = events.slice(0, MAX_EVENTS_PER_FEED).map((e) => ({ ...e }))
  snapshots.set(key, capped)
  bumpAccess(key)
}
