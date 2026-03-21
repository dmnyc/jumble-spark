/**
 * Standalone React context for feed state so HMR on `FeedProvider.tsx` does not recreate
 * `createContext()` (which breaks `useFeed` after Fast Refresh).
 */
import { TFeedInfo, TFeedType } from '@/types'
import { createContext, useContext } from 'react'

export type TFeedContext = {
  feedInfo: TFeedInfo
  relayUrls: string[]
  isReady: boolean
  switchFeed: (
    feedType: TFeedType,
    options?: {
      activeRelaySetId?: string | null
      pubkey?: string | null
      relay?: string | null
    }
  ) => Promise<void>
}

export const FeedContext = createContext<TFeedContext | undefined>(undefined)

export function useFeed(): TFeedContext {
  const context = useContext(FeedContext)
  if (!context) {
    throw new Error('useFeed must be used within a FeedProvider')
  }
  return context
}
