/**
 * After a deploy, hashed chunks from the previous build are removed. A tab that still runs old JS
 * (HTTP cache, or a service worker precache race) can 404 on `import()`. One reload usually picks
 * up fresh `index.html` and the new asset graph.
 */
const SESSION_KEY = 'jumble:stale-chunk-reload'

export function isChunkLoadFailureMessage(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('failed to fetch dynamically imported module') ||
    m.includes('error loading dynamically imported module') ||
    m.includes('importing a module script failed') ||
    // Safari / some WebKit builds
    (m.includes('dynamically imported module') && (m.includes('failed') || m.includes('error')))
  )
}

/** Returns true if a reload was scheduled (at most once per session). */
export function tryStaleChunkReloadOnce(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function installStaleBuildChunkRecovery(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('unhandledrejection', (event) => {
    const r = event.reason
    const msg =
      typeof r === 'string' ? r : r instanceof Error ? r.message : String(r ?? '')
    if (!isChunkLoadFailureMessage(msg)) return
    event.preventDefault()
    tryStaleChunkReloadOnce()
  })

  window.addEventListener('error', (event) => {
    const msg = event.message ?? ''
    if (!isChunkLoadFailureMessage(msg)) return
    event.preventDefault()
    tryStaleChunkReloadOnce()
  })
}
