import './i18n'
import './index.css'
import './polyfill'
import './services/lightning.service'
import './lib/error-suppression'
import './lib/debug-utils'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { publishMonitorAnnouncementOnce } from './services/nip66-monitor'
import storage from './services/local-storage.service'

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: { NIP66_MONITOR_NPUB?: string }
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
  await Promise.all([
    storage.initAsync(),
    (async () => {
      try {
        const r = await fetch('/config.json')
        if (r.ok) {
          window.__RUNTIME_CONFIG__ = (await r.json()) as { NIP66_MONITOR_NPUB?: string }
        }
      } catch {
        window.__RUNTIME_CONFIG__ = {}
      }
    })()
  ])
  // Mark session storage as used so it's visible in DevTools; VersionUpdateBanner and NotePage also use it.
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, String(Date.now()))
  } catch {
    // ignore quota or private browsing
  }
  publishMonitorAnnouncementOnce()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}

bootstrap()
