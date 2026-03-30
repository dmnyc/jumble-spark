import './index.css'
import './polyfill'
import './services/lightning.service'
import './lib/error-suppression'
import './lib/debug-utils'
import { fetchWithTimeout } from './lib/fetch-with-timeout'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { initI18n } from './i18n'
import storage from './services/local-storage.service'
import { restoreSessionFeedSnapshotsAfterHardRefresh } from './services/session-feed-snapshot.service'
import { installStaleBuildChunkRecovery } from './lib/stale-chunk-recovery'

installStaleBuildChunkRecovery()

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: { NIP66_MONITOR_NPUB?: string; DESKTOP_DOWNLOAD_URL?: string }
  }
}

const setVh = () => {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`)
}
window.addEventListener('resize', setVh)
window.addEventListener('orientationchange', setVh)
setVh()

const SESSION_STORAGE_KEY = 'jumble:session'

async function bootstrap() {
  // Always defined: fetch does not throw on 4xx/5xx, so non-OK responses must not leave this unset.
  window.__RUNTIME_CONFIG__ = {}
  console.info('[jumble] Boot: opening storage and loading config…')
  await Promise.all([
    initI18n(),
    storage.initAsync(),
    (async () => {
      try {
        const r = await fetchWithTimeout('/config.json', { timeoutMs: 10_000 })
        if (r.ok) {
          window.__RUNTIME_CONFIG__ = (await r.json()) as {
            NIP66_MONITOR_NPUB?: string
            DESKTOP_DOWNLOAD_URL?: string
          }
        }
      } catch {
        window.__RUNTIME_CONFIG__ = {}
      }
    })()
  ])
  console.info('[jumble] Boot: mounting React (UI shell will appear; Nostr session restores next)')
  restoreSessionFeedSnapshotsAfterHardRefresh()
  // Mark session storage as used so it's visible in DevTools; VersionUpdateBanner and NotePage also use it.
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, String(Date.now()))
  } catch {
    // ignore quota or private browsing
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}

bootstrap()
