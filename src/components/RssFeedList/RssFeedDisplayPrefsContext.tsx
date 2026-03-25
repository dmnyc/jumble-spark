import { createContext, useContext, type ReactNode } from 'react'

export type RssFeedDisplayPrefs = {
  suppressClawstrLinks: boolean
}

const outsideProviderDefaults: RssFeedDisplayPrefs = {
  suppressClawstrLinks: false
}

const RssFeedDisplayPrefsContext = createContext<RssFeedDisplayPrefs | null>(null)

export function RssFeedDisplayPrefsProvider({
  value,
  children
}: {
  value: RssFeedDisplayPrefs
  children: ReactNode
}) {
  return (
    <RssFeedDisplayPrefsContext.Provider value={value}>
      {children}
    </RssFeedDisplayPrefsContext.Provider>
  )
}

/** Outside {@link RssFeedDisplayPrefsProvider}, Clawstr suppression is off (e.g. full article page). */
export function useRssFeedDisplayPrefs(): RssFeedDisplayPrefs {
  return useContext(RssFeedDisplayPrefsContext) ?? outsideProviderDefaults
}
