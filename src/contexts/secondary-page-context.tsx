import { createContext, useContext } from 'react'
import type { TPrimaryPageName } from '@/PageManager'

/**
 * Lives in a dedicated module so lazy chunks (e.g. TooManyRelaysAlertDialog) share the same
 * context instance as PageManager. Importing from PageManager into those chunks can duplicate
 * the module and break Provider matching (useSecondaryPage throws "must be used within Provider").
 * Use `import type` only so this file does not create a runtime dependency on PageManager.
 */
export type SecondaryPageContextValue = {
  push: (url: string) => void
  pop: () => void
  currentIndex: number
  navigateToPrimaryPage: (page: TPrimaryPageName, props?: object) => void
}

export const SecondaryPageContext = createContext<SecondaryPageContextValue | undefined>(undefined)

export function useSecondaryPage(): SecondaryPageContextValue {
  const context = useContext(SecondaryPageContext)
  if (!context) {
    throw new Error('useSecondaryPage must be used within a SecondaryPageContext.Provider')
  }
  return context
}

/** Returns undefined when outside provider (e.g. embedded notes in createRoot trees). */
export function useSecondaryPageOptional(): SecondaryPageContextValue | undefined {
  return useContext(SecondaryPageContext)
}
