/**
 * Verbose content/spacing traces for debugging (e.g. "Name: nostr:npub…" collapsing).
 *
 * Enable in dev: localStorage.setItem('jumble-debug-content', 'true') then reload.
 * Disable: localStorage.removeItem('jumble-debug-content')
 */

const STORAGE_KEY = 'jumble-debug-content'

export function isContentSpacingDebug(): boolean {
  try {
    return import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true'
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
  console.log(`[jumble content-spacing] ${phase}`, detail)
}
