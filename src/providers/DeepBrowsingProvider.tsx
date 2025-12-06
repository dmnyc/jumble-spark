import { createContext, useContext, useEffect, useRef, useState } from 'react'

type TDeepBrowsingContext = {
  deepBrowsing: boolean
  lastScrollTop: number
}

const DeepBrowsingContext = createContext<TDeepBrowsingContext | undefined>(undefined)

export const useDeepBrowsing = () => {
  const context = useContext(DeepBrowsingContext)
  if (!context) {
    throw new Error('useDeepBrowsing must be used within a DeepBrowsingProvider')
  }
  return context
}

export function DeepBrowsingProvider({
  children,
  active,
  scrollAreaRef
}: {
  children: React.ReactNode
  active: boolean
  scrollAreaRef?: React.RefObject<HTMLDivElement>
}) {
  const [deepBrowsing, setDeepBrowsing] = useState(false)
  const lastScrollTopRef = useRef(
    (!scrollAreaRef ? window.scrollY : scrollAreaRef.current?.scrollTop) || 0
  )
  const [lastScrollTop, setLastScrollTop] = useState(lastScrollTopRef.current)

  useEffect(() => {
    if (!active) return

    let rafId: number | null = null
    const handleScroll = () => {
      // Use requestAnimationFrame to throttle scroll updates and prevent scroll-linked positioning warnings
      if (rafId !== null) return
      
      rafId = requestAnimationFrame(() => {
        const scrollTop = (!scrollAreaRef ? window.scrollY : scrollAreaRef.current?.scrollTop) || 0
        const diff = scrollTop - lastScrollTopRef.current
        lastScrollTopRef.current = scrollTop
        setLastScrollTop(scrollTop)
        if (scrollTop <= 800) {
          setDeepBrowsing(false)
          rafId = null
          return
        }

        if (diff > 20) {
          setDeepBrowsing(true)
        } else if (diff < -20) {
          setDeepBrowsing(false)
        }
        rafId = null
      })
    }

    const target = scrollAreaRef ? scrollAreaRef.current : window

    target?.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      target?.removeEventListener('scroll', handleScroll)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [active, scrollAreaRef])

  return (
    <DeepBrowsingContext.Provider value={{ deepBrowsing, lastScrollTop }}>
      {children}
    </DeepBrowsingContext.Provider>
  )
}
