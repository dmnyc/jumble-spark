/**
 * Standalone React context for favorite relays so HMR on `FavoriteRelaysProvider.tsx` does not
 * recreate `createContext()` (which breaks `useFavoriteRelays` in InterestListProvider,
 * FeedProvider, etc. after Fast Refresh).
 */
import { TRelaySet } from '@/types'
import { Event } from 'nostr-tools'
import { createContext, useContext } from 'react'

export type TFavoriteRelaysContext = {
  favoriteRelays: string[]
  addFavoriteRelays: (relayUrls: string[]) => Promise<void>
  deleteFavoriteRelays: (relayUrls: string[]) => Promise<void>
  reorderFavoriteRelays: (reorderedRelays: string[]) => Promise<void>
  blockedRelays: string[]
  addBlockedRelays: (relayUrls: string[]) => Promise<void>
  deleteBlockedRelays: (relayUrls: string[]) => Promise<void>
  relaySets: TRelaySet[]
  createRelaySet: (relaySetName: string, relayUrls?: string[]) => Promise<void>
  addRelaySets: (newRelaySetEvents: Event[]) => Promise<void>
  deleteRelaySet: (id: string) => Promise<void>
  updateRelaySet: (newSet: TRelaySet) => Promise<void>
  reorderRelaySets: (reorderedSets: TRelaySet[]) => Promise<void>
}

export const FavoriteRelaysContext = createContext<TFavoriteRelaysContext | undefined>(undefined)

export function useFavoriteRelays(): TFavoriteRelaysContext {
  const context = useContext(FavoriteRelaysContext)
  if (!context) {
    throw new Error('useFavoriteRelays must be used within a FavoriteRelaysProvider')
  }
  return context
}
