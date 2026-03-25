import { createContext, useCallback, useContext, useMemo, useState } from 'react'

type TCurrentRelaysContext = {
  relayUrls: string[]
  addRelayUrls: (urls: string[]) => void
  removeRelayUrls: (urls: string[]) => void
}

const CurrentRelaysContext = createContext<TCurrentRelaysContext | undefined>(undefined)

export const useCurrentRelays = () => {
  const context = useContext(CurrentRelaysContext)
  if (!context) {
    throw new Error('useCurrentRelays must be used within a CurrentRelaysProvider')
  }
  return context
}

/** Same URLs as {@link useCurrentRelays} but safe when no provider (e.g. tests, embedded previews). */
export function useCurrentRelayUrlsOptional(): string[] {
  return useContext(CurrentRelaysContext)?.relayUrls ?? []
}

export function CurrentRelaysProvider({ children }: { children: React.ReactNode }) {
  const [relayRefCount, setRelayRefCount] = useState<Record<string, number>>({})
  const relayUrls = useMemo(() => Object.keys(relayRefCount), [relayRefCount])

  const addRelayUrls = useCallback((urls: string[]) => {
    if (!urls.length) return
    setRelayRefCount((prev) => {
      const newCounts = { ...prev }
      urls.forEach((url) => {
        newCounts[url] = (newCounts[url] || 0) + 1
      })
      return newCounts
    })
  }, [])

  const removeRelayUrls = useCallback((urls: string[]) => {
    if (!urls.length) return
    setRelayRefCount((prev) => {
      const newCounts = { ...prev }
      urls.forEach((url) => {
        if (newCounts[url]) {
          newCounts[url] -= 1
          if (newCounts[url] <= 0) {
            delete newCounts[url]
          }
        }
      })
      return newCounts
    })
  }, [])

  const contextValue = useMemo(
    () => ({ relayUrls, addRelayUrls, removeRelayUrls }),
    [relayUrls, addRelayUrls, removeRelayUrls]
  )

  return (
    <CurrentRelaysContext.Provider value={contextValue}>
      {children}
    </CurrentRelaysContext.Provider>
  )
}
