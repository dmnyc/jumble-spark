/**
 * Verbose content/spacing traces for debugging (e.g. "Name: nostr:npub…" collapsing).
 *
 * Enable in dev: localStorage.setItem('imwald-debug-content', 'true') then reload.
 * Disable: localStorage.removeItem('imwald-debug-content')
 * Legacy key `jumble-debug-content` is still honored.
 */

const STORAGE_KEY = 'imwald-debug-content'
const LEGACY_STORAGE_KEY = 'jumble-debug-content'

export function isContentSpacingDebug(): boolean {
  try {
    if (!import.meta.env.DEV || typeof localStorage === 'undefined') return false
    return (
      localStorage.getItem(STORAGE_KEY) === 'true' || localStorage.getItem(LEGACY_STORAGE_KEY) === 'true'
    )
  } catch {
    return false
  }
}

/** JSON.stringify so spaces/newlines are visible in the console */
export function reprString(s: string, maxLen = 500): string {
  const t = s.length > maxLen ? `${s.slice(0, maxLen)}…(+${s.length - maxLen} chars)` : s
  return JSON.stringify(t)
}

export function logContentSpacing(phase: string, detail: Record<string, unknown>): void {
  if (!isContentSpacingDebug()) return
  // eslint-disable-next-line no-console
  console.log(`[imwald content-spacing] ${phase}`, detail)
}
