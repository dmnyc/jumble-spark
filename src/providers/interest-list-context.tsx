import { createContext, useContext } from 'react'

export type TInterestListContext = {
  subscribedTopics: Set<string>
  changing: boolean
  isSubscribed: (topic: string) => boolean
  subscribe: (topic: string) => Promise<void>
  unsubscribe: (topic: string) => Promise<void>
  getSubscribedTopics: () => string[]
}

export const InterestListContext = createContext<TInterestListContext | undefined>(undefined)

export const useInterestList = (): TInterestListContext => {
  const context = useContext(InterestListContext)
  if (!context) {
    throw new Error('useInterestList must be used within an InterestListProvider')
  }
  return context
}

/**
 * Optional variant for routes/components that can be mounted
 * during transient navigation/HMR paths before providers settle.
 */
export const useInterestListOptional = (): TInterestListContext | undefined =>
  useContext(InterestListContext)
