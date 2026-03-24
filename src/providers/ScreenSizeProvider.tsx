import { createContext, useContext, useEffect, useState } from 'react'

type TScreenSizeContext = {
  isSmallScreen: boolean
  isLargeScreen: boolean
}

const ScreenSizeContext = createContext<TScreenSizeContext | undefined>(undefined)

export const useScreenSize = () => {
  const context = useContext(ScreenSizeContext)
  if (!context) {
    throw new Error('useScreenSize must be used within a ScreenSizeProvider')
  }
  return context
}

/** Returns undefined when outside provider (e.g. embedded notes in createRoot trees). */
export function useScreenSizeOptional(): TScreenSizeContext | undefined {
  return useContext(ScreenSizeContext)
}

export function ScreenSizeProvider({ children }: { children: React.ReactNode }) {
  const [isSmallScreen, setIsSmallScreen] = useState(() => window.innerWidth <= 768)
  const [isLargeScreen, setIsLargeScreen] = useState(() => window.innerWidth >= 1280)
  
  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth <= 768)
      setIsLargeScreen(window.innerWidth >= 1280)
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <ScreenSizeContext.Provider
      value={{
        isSmallScreen,
        isLargeScreen
      }}
    >
      {children}
    </ScreenSizeContext.Provider>
  )
}
