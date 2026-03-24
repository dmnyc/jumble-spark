import { createContext, useContext } from 'react'

export type TUserTrustContext = {
  isTrustLoaded: boolean
  hideUntrustedInteractions: boolean
  hideUntrustedNotifications: boolean
  hideUntrustedNotes: boolean
  updateHideUntrustedInteractions: (hide: boolean) => void
  updateHideUntrustedNotifications: (hide: boolean) => void
  updateHideUntrustedNotes: (hide: boolean) => void
  isUserTrusted: (pubkey: string) => boolean
}

/**
 * Lives in a dedicated module so lazy chunks (e.g. NoteListPage → NormalFeed) share the same
 * context instance as App’s UserTrustProvider. Importing useUserTrust from UserTrustProvider into
 * those chunks can duplicate the module and break Provider matching.
 */
export const UserTrustContext = createContext<TUserTrustContext | undefined>(undefined)

export function useUserTrust(): TUserTrustContext {
  const context = useContext(UserTrustContext)
  if (!context) {
    throw new Error('useUserTrust must be used within a UserTrustProvider')
  }
  return context
}
