/**
 * Standalone React context for Nostr so HMR on `NostrProvider/index.tsx` does not recreate
 * `createContext()` (which breaks `useNostr` in providers like InterestListProvider after Fast Refresh).
 */
import type {
  TAccountPointer,
  TDraftEvent,
  TProfile,
  TPublishOptions,
  TRelayList
} from '@/types'
import { Event, VerifiedEvent } from 'nostr-tools'
import { createContext, useContext } from 'react'

export type TNostrContext = {
  isInitialized: boolean
  pubkey: string | null
  profile: TProfile | null
  profileEvent: Event | null
  relayList: TRelayList | null
  cacheRelayListEvent: Event | null
  followListEvent: Event | null
  muteListEvent: Event | null
  bookmarkListEvent: Event | null
  interestListEvent: Event | null
  favoriteRelaysEvent: Event | null
  blockedRelaysEvent: Event | null
  userEmojiListEvent: Event | null
  rssFeedListEvent: Event | null
  account: TAccountPointer | null
  accounts: TAccountPointer[]
  nsec: string | null
  ncryptsec: string | null
  switchAccount: (account: TAccountPointer | null) => Promise<void>
  nsecLogin: (nsec: string, password?: string, needSetup?: boolean) => Promise<string>
  ncryptsecLogin: (ncryptsec: string) => Promise<string>
  nip07Login: () => Promise<string>
  bunkerLogin: (bunker: string) => Promise<string>
  nostrConnectionLogin: (clientSecretKey: Uint8Array, connectionString: string) => Promise<string>
  npubLogin(npub: string): Promise<string>
  removeAccount: (account: TAccountPointer) => void
  publish: (draftEvent: TDraftEvent, options?: TPublishOptions) => Promise<Event>
  attemptDelete: (targetEvent: Event) => Promise<void>
  signHttpAuth: (url: string, method: string) => Promise<string>
  signEvent: (draftEvent: TDraftEvent) => Promise<VerifiedEvent>
  nip04Encrypt: (pubkey: string, plainText: string) => Promise<string>
  nip04Decrypt: (pubkey: string, cipherText: string) => Promise<string>
  startLogin: () => void
  checkLogin: <T>(cb?: () => T) => Promise<T | void>
  updateRelayListEvent: (relayListEvent: Event) => Promise<void>
  updateCacheRelayListEvent: (cacheRelayListEvent: Event) => Promise<void>
  updateProfileEvent: (profileEvent: Event) => Promise<void>
  updateFollowListEvent: (followListEvent: Event) => Promise<void>
  updateMuteListEvent: (muteListEvent: Event, privateTags: string[][]) => Promise<void>
  updateBookmarkListEvent: (bookmarkListEvent: Event) => Promise<void>
  updateInterestListEvent: (interestListEvent: Event) => Promise<void>
  updateFavoriteRelaysEvent: (favoriteRelaysEvent: Event) => Promise<void>
  updateBlockedRelaysEvent: (blockedRelaysEvent: Event) => Promise<void>
  updateRssFeedListEvent: (rssFeedListEvent: Event) => Promise<void>
}

export const NostrContext = createContext<TNostrContext | undefined>(undefined)

export function useNostr(): TNostrContext {
  const context = useContext(NostrContext)
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider')
  }
  return context
}
