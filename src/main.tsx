import './index.css'
import './polyfill'

import { restoreElectronLocalStorage } from './lib/electron-local-storage'
import { ensureElectronStorageUnlocked } from './lib/electron-unlock'

const setVh = () => {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`)
}
window.addEventListener('resize', setVh)
window.addEventListener('orientationchange', setVh)
setVh()

const bootstrap = async () => {
  // Electron without an OS keychain encrypts its stores with a password-derived
  // key; gate the boot behind the unlock screen first. Returns true when a
  // post-unlock reload is pending, in which case booting stops here.
  if (await ensureElectronStorageUnlocked()) return

  // Electron restores its main-process snapshot before modules that read
  // localStorage are evaluated. Web mode returns immediately.
  await restoreElectronLocalStorage()

  // This is the only deferred module boundary: application modules must not
  // read localStorage until Electron has restored its durable snapshot.
  const { startApplication } = await import('./app-bootstrap')
  await startApplication()
}

bootstrap().catch((error) => {
  console.error('[main] failed to bootstrap application:', error)
})
