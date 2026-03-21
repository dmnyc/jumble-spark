import { TProfile } from '@/types'
import { createContext, useContext } from 'react'

export type NoteFeedProfileContextValue = {
  profiles: ReadonlyMap<string, TProfile>
  pendingPubkeys: ReadonlySet<string>
  version: number
}

export const NoteFeedProfileContext = createContext<NoteFeedProfileContextValue | null>(null)

export function useNoteFeedProfileContext() {
  return useContext(NoteFeedProfileContext)
}
