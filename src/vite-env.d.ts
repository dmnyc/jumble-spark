/// <reference types="vite/client" />
import { TNip07 } from '@/types'

declare module '*.md?raw' {
  const content: string
  export default content
}

declare global {
  interface Window {
    nostr?: TNip07
  }
}
