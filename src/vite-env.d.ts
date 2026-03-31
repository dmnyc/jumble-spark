/// <reference types="vite/client" />
import { TNip07 } from '@/types'

declare module '*.md?raw' {
  const content: string
  export default content
}

declare global {
  interface Window {
    nostr?: TNip07
    /** Set by {@link electron/preload.cjs} when running inside Electron. */
    jumbleElectron?: {
      isElectron: true
      /** Ask Electron main to reload index safely (avoids file:// history path reload issues). */
      reloadApp?: () => Promise<boolean>
    }
  }
}
