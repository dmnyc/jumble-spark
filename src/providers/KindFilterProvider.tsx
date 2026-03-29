import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import storage from '@/services/local-storage.service'
import { DEFAULT_FEED_SHOW_KINDS, ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'

const KIND_1 = kinds.ShortTextNote
const KIND_1111 = ExtendedKind.COMMENT

/** Build showKinds array from base kinds (excluding 1 and 1111) plus kind 1 OP/reply and kind 1111 flags */
function buildShowKinds(
  baseKinds: number[],
  showKind1OPs: boolean,
  showKind1Replies: boolean,
  showKind1111: boolean
): number[] {
  const rest = baseKinds.filter((k) => k !== KIND_1 && k !== KIND_1111)
  const out = [...rest]
  if (showKind1OPs || showKind1Replies) out.push(KIND_1)
  if (showKind1111) out.push(KIND_1111)
  return out.sort((a, b) => a - b)
}

type TKindFilterContext = {
  showKinds: number[]
  showKind1OPs: boolean
  showKind1Replies: boolean
  showKind1111: boolean
  /** When true, main feed omits REQ `kinds` and skips client-side kind filtering (testing). */
  feedKindFilterBypass: boolean
  updateShowKinds: (
    kinds: number[],
    options?: {
      showKind1OPs?: boolean
      showKind1Replies?: boolean
      showKind1111?: boolean
      /** When false, update the live feed only; do not write settings (IndexedDB). Default true. */
      persist?: boolean
    }
  ) => void
  updateShowKind1OPs: (value: boolean) => void
  updateShowKind1Replies: (value: boolean) => void
  updateShowKind1111: (value: boolean) => void
  updateFeedKindFilterBypass: (value: boolean, options?: { persist?: boolean }) => void
}

const KindFilterContext = createContext<TKindFilterContext | undefined>(undefined)

export const useKindFilter = () => {
  const context = useContext(KindFilterContext)
  if (!context) {
    throw new Error('useKindFilter must be used within a KindFilterProvider')
  }
  return context
}

/** When context is missing (e.g. Vite HMR / duplicate module instances), use storage-backed defaults. */
function createKindFilterFallback(): TKindFilterContext {
  const defaultShowKinds = DEFAULT_FEED_SHOW_KINDS
  const storedShowKinds = storage.getShowKinds()
  const showKinds = storedShowKinds.length > 0 ? storedShowKinds : defaultShowKinds
  const noop = () => {}
  return {
    showKinds,
    showKind1OPs: storage.getShowKind1OPs(),
    showKind1Replies: storage.getShowKind1Replies(),
    showKind1111: storage.getShowKind1111(),
    feedKindFilterBypass: storage.getFeedKindFilterBypass(),
    updateShowKinds: noop,
    updateShowKind1OPs: noop,
    updateShowKind1Replies: noop,
    updateShowKind1111: noop,
    updateFeedKindFilterBypass: noop
  }
}

export function useKindFilterOrDefaults(): TKindFilterContext {
  const context = useContext(KindFilterContext)
  const fallback = useMemo(() => createKindFilterFallback(), [])
  return context ?? fallback
}

export function KindFilterProvider({ children }: { children: ReactNode }) {
  const defaultShowKinds = DEFAULT_FEED_SHOW_KINDS
  const storedShowKinds = storage.getShowKinds()
  const storedShowKind1OPs = storage.getShowKind1OPs()
  const storedShowKind1Replies = storage.getShowKind1Replies()
  const storedShowKind1111 = storage.getShowKind1111()
  const storedFeedKindFilterBypass = storage.getFeedKindFilterBypass()

  const [showKinds, setShowKindsState] = useState<number[]>(
    storedShowKinds.length > 0 ? storedShowKinds : defaultShowKinds
  )
  const [showKind1OPs, setShowKind1OPsState] = useState(storedShowKind1OPs)
  const [showKind1Replies, setShowKind1RepliesState] = useState(storedShowKind1Replies)
  const [showKind1111, setShowKind1111State] = useState(storedShowKind1111)
  const [feedKindFilterBypass, setFeedKindFilterBypassState] = useState(storedFeedKindFilterBypass)

  const updateShowKinds = useCallback(
    (
      newKinds: number[],
      options?: {
        showKind1OPs?: boolean
        showKind1Replies?: boolean
        showKind1111?: boolean
        persist?: boolean
      }
    ) => {
      const op = options?.showKind1OPs ?? newKinds.includes(KIND_1)
      const kind1Replies = options?.showKind1Replies ?? newKinds.includes(KIND_1)
      const kind1111 = options?.showKind1111 ?? newKinds.includes(KIND_1111)
      const persist = options?.persist !== false
      if (persist) {
        storage.setShowKind1OPs(op)
        storage.setShowKind1Replies(kind1Replies)
        storage.setShowKind1111(kind1111)
        storage.setShowKinds(newKinds)
      }
      setShowKind1OPsState(op)
      setShowKind1RepliesState(kind1Replies)
      setShowKind1111State(kind1111)
      setShowKindsState(newKinds)
    },
    []
  )

  const updateShowKind1OPs = useCallback((value: boolean) => {
    storage.setShowKind1OPs(value)
    setShowKind1OPsState(value)
    const next = buildShowKinds(showKinds, value, showKind1Replies, showKind1111)
    storage.setShowKinds(next)
    setShowKindsState(next)
  }, [showKinds, showKind1Replies, showKind1111])

  const updateShowKind1Replies = useCallback((value: boolean) => {
    storage.setShowKind1Replies(value)
    setShowKind1RepliesState(value)
    const next = buildShowKinds(showKinds, showKind1OPs, value, showKind1111)
    storage.setShowKinds(next)
    setShowKindsState(next)
  }, [showKinds, showKind1OPs, showKind1111])

  const updateShowKind1111 = useCallback((value: boolean) => {
    storage.setShowKind1111(value)
    setShowKind1111State(value)
    const next = buildShowKinds(showKinds, showKind1OPs, showKind1Replies, value)
    storage.setShowKinds(next)
    setShowKindsState(next)
  }, [showKinds, showKind1OPs, showKind1Replies])

  const updateFeedKindFilterBypass = useCallback((value: boolean, options?: { persist?: boolean }) => {
    const persist = options?.persist !== false
    if (persist) storage.setFeedKindFilterBypass(value)
    setFeedKindFilterBypassState(value)
  }, [])

  const value = useMemo(
    () => ({
      showKinds,
      showKind1OPs,
      showKind1Replies,
      showKind1111,
      feedKindFilterBypass,
      updateShowKinds,
      updateShowKind1OPs,
      updateShowKind1Replies,
      updateShowKind1111,
      updateFeedKindFilterBypass
    }),
    [
      showKinds,
      showKind1OPs,
      showKind1Replies,
      showKind1111,
      feedKindFilterBypass,
      updateShowKinds,
      updateShowKind1OPs,
      updateShowKind1Replies,
      updateShowKind1111,
      updateFeedKindFilterBypass
    ]
  )

  return <KindFilterContext.Provider value={value}>{children}</KindFilterContext.Provider>
}
