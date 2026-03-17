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

async function bootstrap() {
  try {
    const r = await fetch('/config.json')
    if (r.ok) {
      const config = (await r.json()) as { NIP66_MONITOR_NPUB?: string }
      window.__RUNTIME_CONFIG__ = config
    }
  } catch {
    window.__RUNTIME_CONFIG__ = {}
  }
  await storage.initAsync()
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
