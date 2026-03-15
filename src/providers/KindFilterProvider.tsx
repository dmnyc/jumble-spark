import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import storage from '@/services/local-storage.service'
import { SUPPORTED_KINDS, ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'

const KIND_1 = kinds.ShortTextNote
const KIND_1111 = ExtendedKind.COMMENT

/** Build showKinds array from base kinds (excluding 1 and 1111) plus the two post/reply flags */
function buildShowKinds(
  baseKinds: number[],
  showKind1OPs: boolean,
  showRepliesAndComments: boolean
): number[] {
  const rest = baseKinds.filter((k) => k !== KIND_1 && k !== KIND_1111)
  const out = [...rest]
  if (showKind1OPs || showRepliesAndComments) out.push(KIND_1)
  if (showRepliesAndComments) out.push(KIND_1111)
  return out.sort((a, b) => a - b)
}

type TKindFilterContext = {
  showKinds: number[]
  showKind1OPs: boolean
  showRepliesAndComments: boolean
  updateShowKinds: (kinds: number[], options?: { showKind1OPs?: boolean; showRepliesAndComments?: boolean }) => void
  updateShowKind1OPs: (value: boolean) => void
  updateShowRepliesAndComments: (value: boolean) => void
}

const KindFilterContext = createContext<TKindFilterContext | undefined>(undefined)

export const useKindFilter = () => {
  const context = useContext(KindFilterContext)
  if (!context) {
    throw new Error('useKindFilter must be used within a KindFilterProvider')
  }
  return context
}

export function KindFilterProvider({ children }: { children: React.ReactNode }) {
  // Ensure we always have a default value - show all supported kinds except reposts, publications, and publication content
  const defaultShowKinds = SUPPORTED_KINDS.filter(
    (kind) =>
      kind !== kinds.Repost &&
      kind !== ExtendedKind.PUBLICATION &&
      kind !== ExtendedKind.PUBLICATION_CONTENT
  )
  const storedShowKinds = storage.getShowKinds()
  const storedShowKind1OPs = storage.getShowKind1OPs()
  const storedShowRepliesAndComments = storage.getShowRepliesAndComments()

  const [showKinds, setShowKindsState] = useState<number[]>(
    storedShowKinds.length > 0 ? storedShowKinds : defaultShowKinds
  )
  const [showKind1OPs, setShowKind1OPsState] = useState(storedShowKind1OPs)
  const [showRepliesAndComments, setShowRepliesAndCommentsState] = useState(storedShowRepliesAndComments)

  const updateShowKinds = useCallback(
    (newKinds: number[], options?: { showKind1OPs?: boolean; showRepliesAndComments?: boolean }) => {
      const op = options?.showKind1OPs ?? newKinds.includes(KIND_1)
      const replies = options?.showRepliesAndComments ?? newKinds.includes(KIND_1111)
      storage.setShowKind1OPs(op)
      storage.setShowRepliesAndComments(replies)
      setShowKind1OPsState(op)
      setShowRepliesAndCommentsState(replies)
      storage.setShowKinds(newKinds)
      setShowKindsState(newKinds)
    },
    []
  )

  const updateShowKind1OPs = useCallback((value: boolean) => {
    storage.setShowKind1OPs(value)
    setShowKind1OPsState(value)
    const next = buildShowKinds(showKinds, value, showRepliesAndComments)
    storage.setShowKinds(next)
    setShowKindsState(next)
  }, [showKinds, showRepliesAndComments])

  const updateShowRepliesAndComments = useCallback((value: boolean) => {
    storage.setShowRepliesAndComments(value)
    setShowRepliesAndCommentsState(value)
    const next = buildShowKinds(showKinds, showKind1OPs, value)
    storage.setShowKinds(next)
    setShowKindsState(next)
  }, [showKinds, showKind1OPs])

  const value = useMemo(
    () => ({
      showKinds,
      showKind1OPs,
      showRepliesAndComments,
      updateShowKinds,
      updateShowKind1OPs,
      updateShowRepliesAndComments
    }),
    [showKinds, showKind1OPs, showRepliesAndComments, updateShowKinds, updateShowKind1OPs, updateShowRepliesAndComments]
  )

  return <KindFilterContext.Provider value={value}>{children}</KindFilterContext.Provider>
}
