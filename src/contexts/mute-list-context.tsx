import { createContext, useContext } from 'react'

export type TMuteListContext = {
  mutePubkeySet: Set<string>
  changing: boolean
  getMutePubkeys: () => string[]
  getMuteType: (pubkey: string) => 'public' | 'private' | null
  mutePubkeyPublicly: (pubkey: string) => Promise<void>
  mutePubkeyPrivately: (pubkey: string) => Promise<void>
  unmutePubkey: (pubkey: string) => Promise<void>
  switchToPublicMute: (pubkey: string) => Promise<void>
  switchToPrivateMute: (pubkey: string) => Promise<void>
}

/**
 * Dedicated module so lazy chunks share the same context as MuteListProvider (avoids duplicate
 * createContext when useMuteList is imported from MuteListProvider.tsx in a lazy-loaded bundle).
 */
export const MuteListContext = createContext<TMuteListContext | undefined>(undefined)

export function useMuteList(): TMuteListContext {
  const context = useContext(MuteListContext)
  if (!context) {
    throw new Error('useMuteList must be used within a MuteListProvider')
  }
  return context
}
