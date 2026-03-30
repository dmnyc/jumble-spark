import { StorageKey } from '@/constants'
import { isJumbleElectron, isMobileBrowserProfile } from '@/lib/client-platform'

/** Platform defaults (overridable in Cache settings). */
export const EVENT_ARCHIVE_DEFAULTS = {
  sessionLruMobile: 100,
  sessionLruDesktopBrowser: 2500,
  sessionLruElectron: 5000,
  maxMbMobile: 48,
  maxMbElectron: 512,
  maxMbDesktopBrowser: 2048,
  maxEventsMobile: 500,
  maxEventsElectron: 400_000,
  maxEventsDesktopBrowser: 80_000
} as const

export type TEventArchiveConfig = {
  enabled: boolean
  /** Soft byte budget (approximate, from JSON size). */
  maxBytes: number
  maxEvents: number
  sessionLruMax: number
}

function readBool(key: string, defaultTrue: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key)
    if (v === null) return defaultTrue
    return v !== 'false' && v !== '0'
  } catch {
    return defaultTrue
  }
}

function readPositiveInt(key: string, fallback: number): number {
  try {
    const v = window.localStorage.getItem(key)
    if (v === null || v === '' || v === '0') return fallback
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

function defaultSessionLruMax(): number {
  if (isJumbleElectron()) return EVENT_ARCHIVE_DEFAULTS.sessionLruElectron
  if (isMobileBrowserProfile()) return EVENT_ARCHIVE_DEFAULTS.sessionLruMobile
  return EVENT_ARCHIVE_DEFAULTS.sessionLruDesktopBrowser
}

function defaultMaxMb(): number {
  if (isJumbleElectron()) return EVENT_ARCHIVE_DEFAULTS.maxMbElectron
  if (isMobileBrowserProfile()) return EVENT_ARCHIVE_DEFAULTS.maxMbMobile
  return EVENT_ARCHIVE_DEFAULTS.maxMbDesktopBrowser
}

function defaultMaxEvents(): number {
  if (isJumbleElectron()) return EVENT_ARCHIVE_DEFAULTS.maxEventsElectron
  if (isMobileBrowserProfile()) return EVENT_ARCHIVE_DEFAULTS.maxEventsMobile
  return EVENT_ARCHIVE_DEFAULTS.maxEventsDesktopBrowser
}

/**
 * Effective archive + session LRU limits (reads Cache settings from localStorage).
 */
export function getEventArchiveConfig(): TEventArchiveConfig {
  const enabled = readBool(StorageKey.EVENT_ARCHIVE_ENABLED, true)
  const maxMb = readPositiveInt(StorageKey.EVENT_ARCHIVE_MAX_MB, defaultMaxMb())
  const maxEvents = readPositiveInt(StorageKey.EVENT_ARCHIVE_MAX_EVENTS, defaultMaxEvents())
  const sessionLruMax = readPositiveInt(StorageKey.SESSION_EVENT_LRU_MAX, defaultSessionLruMax())
  return {
    enabled,
    maxBytes: Math.max(8, maxMb) * 1024 * 1024,
    maxEvents: Math.max(50, maxEvents),
    sessionLruMax: Math.max(32, Math.min(200_000, sessionLruMax))
  }
}

/** Session LRU max before localStorage overrides (for EventService constructor). */
export function getDefaultSessionLruMaxSync(): number {
  return readPositiveInt(StorageKey.SESSION_EVENT_LRU_MAX, defaultSessionLruMax())
}
