import { createContext, useContext } from 'react'

export type TFollowListContext = {
  followings: string[]
  follow: (pubkey: string) => Promise<void>
  unfollow: (pubkey: string) => Promise<void>
}

export const FollowListContext = createContext<TFollowListContext | undefined>(undefined)

export const useFollowList = (): TFollowListContext => {
  const context = useContext(FollowListContext)
  if (!context) {
    throw new Error('useFollowList must be used within a FollowListProvider')
  }
  return context
}

/** Same as {@link useFollowList} but returns undefined outside the provider (avoids HMR / refresh-boundary crashes). */
export function useFollowListOptional(): TFollowListContext | undefined {
  return useContext(FollowListContext)
}
