import type { Event } from 'nostr-tools'
import { createContext, useContext } from 'react'

export type TFavoriteRelaysActivityContext = {
  /** Active pubkeys you follow, most recent global activity first within this group */
  followPubkeys: string[]
  /** Active pubkeys you do not follow */
  otherPubkeys: string[]
  followCount: number
  otherCount: number
  /** `followPubkeys` then `otherPubkeys` */
  pubkeys: string[]
  totalCount: number
  loading: boolean
  /** True after at least one fetch has finished (so empty state is meaningful) */
  relayActivityReady: boolean
  /** Wall-clock ms when the last sample completed; null before first fetch */
  lastFetchedAtMs: number | null
  /** Kind 0 events loaded for active pubkeys (viewer excluded); used for avatars + drawer */
  profileKind0ByPubkey: Record<string, Event>
  profilesLoading: boolean
  activeNpubsDrawerOpen: boolean
  setActiveNpubsDrawerOpen: (open: boolean) => void
  refetch: () => void
}

export const FavoriteRelaysActivityContext = createContext<
  TFavoriteRelaysActivityContext | undefined
>(undefined)

export function useFavoriteRelaysActivity(): TFavoriteRelaysActivityContext {
  const ctx = useContext(FavoriteRelaysActivityContext)
  if (!ctx) {
    throw new Error('useFavoriteRelaysActivity must be used within FavoriteRelaysActivityProvider')
  }
  return ctx
}
