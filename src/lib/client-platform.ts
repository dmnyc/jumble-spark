/** True when running inside the packaged Electron shell ({@link electron/preload.cjs}). */
export function isImwaldElectron(): boolean {
  return typeof window !== 'undefined' && window.imwaldElectron?.isElectron === true
}

/**
 * Coarse “phone / mobile browser” profile: touch-first or narrow viewport, excluding Electron.
 * Used for smaller in-memory LRU and tighter disk archive defaults (not a substitute for real UA tests).
 */
export function isMobileBrowserProfile(): boolean {
  if (typeof window === 'undefined' || isImwaldElectron()) return false
  const narrow = window.matchMedia?.('(max-width: 768px)')?.matches ?? false
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false
  return narrow || (coarse && (window.innerWidth ?? 1024) <= 900)
}
