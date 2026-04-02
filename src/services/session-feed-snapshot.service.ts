import type { Event } from 'nostr-tools'
import logger from '@/lib/logger'
import { isImwaldElectron } from '@/lib/client-platform'

/** Max events stored per feed key (matches typical initial timeline cap). */
const MAX_EVENTS_PER_FEED = 120
/** Max distinct feeds kept in memory for the tab session. */
const MAX_FEED_KEYS = 48

const HARD_REFRESH_SESSION_KEY = 'jumble:hardRefreshFeedSnapshots'

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

/**
 * Persist in-memory feed snapshots to sessionStorage, then call {@link window.location.reload}.
 * {@link restoreSessionFeedSnapshotsAfterHardRefresh} runs on next boot (see `main.tsx`).
 */
export function hardReloadPreservingFeedSnapshots(): void {
  persistSessionFeedSnapshotsForHardRefresh()
  if (isImwaldElectron() && typeof window.imwaldElectron?.reloadApp === 'function') {
    void window.imwaldElectron.reloadApp()
    return
  }
  window.location.reload()
}

export function persistSessionFeedSnapshotsForHardRefresh(): void {
  try {
    if (snapshots.size === 0) {
      sessionStorage.removeItem(HARD_REFRESH_SESSION_KEY)
      return
    }
    const payload: Record<string, Event[]> = {}
    for (const [k, rows] of snapshots) {
      if (rows?.length) {
        payload[k] = rows.map((e) => ({ ...e }))
      }
    }
    if (Object.keys(payload).length === 0) {
      sessionStorage.removeItem(HARD_REFRESH_SESSION_KEY)
      return
    }
    sessionStorage.setItem(HARD_REFRESH_SESSION_KEY, JSON.stringify(payload))
    logger.info('[feed-snapshot] Persisted for hard reload', { feedKeys: Object.keys(payload).length })
  } catch (e) {
    logger.warn('[feed-snapshot] Could not persist for hard reload', { error: e })
  }
}

export function restoreSessionFeedSnapshotsAfterHardRefresh(): void {
  try {
    const raw = sessionStorage.getItem(HARD_REFRESH_SESSION_KEY)
    if (!raw) return
    sessionStorage.removeItem(HARD_REFRESH_SESSION_KEY)
    const payload = JSON.parse(raw) as Record<string, unknown>
    if (!payload || typeof payload !== 'object') return
    let restored = 0
    for (const [k, rows] of Object.entries(payload)) {
      if (!k || !Array.isArray(rows) || rows.length === 0) continue
      const capped = rows
        .filter((e): e is Event => e != null && typeof (e as Event).id === 'string')
        .slice(0, MAX_EVENTS_PER_FEED)
        .map((e) => ({ ...e }))
      if (capped.length > 0) {
        setSessionFeedSnapshot(k, capped)
        restored++
      }
    }
    if (restored > 0) {
      logger.info('[feed-snapshot] Restored after hard reload', { feeds: restored })
    }
  } catch (e) {
    logger.warn('[feed-snapshot] Could not restore after hard reload', { error: e })
    try {
      sessionStorage.removeItem(HARD_REFRESH_SESSION_KEY)
    } catch {
      // ignore
    }
  }
}
