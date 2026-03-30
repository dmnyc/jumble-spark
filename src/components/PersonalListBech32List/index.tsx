import PersonalListNoteRefRow from '@/components/PersonalListNoteRefRow'
import { useEffect, useRef, useState } from 'react'

const PAGE = 10

type TListMode = 'bookmark' | 'pin'

/** Paginated list of nevent/naddr ids (same infinite-scroll pattern as mute list / {@link ProfileList}). */
export default function PersonalListBech32List({
  bech32Ids,
  listMode,
  onEntryRemoved
}: {
  bech32Ids: string[]
  listMode?: TListMode
  onEntryRemoved?: () => void
}) {
  const [visible, setVisible] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisible(bech32Ids.slice(0, PAGE))
  }, [bech32Ids])

  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && bech32Ids.length > visible.length) {
          setVisible((prev) => [...prev, ...bech32Ids.slice(prev.length, prev.length + PAGE)])
        }
      },
      { root: null, rootMargin: '10px', threshold: 1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [visible, bech32Ids])

  return (
    <div className="space-y-0">
      {visible.map((id) => (
        <PersonalListNoteRefRow
          key={id}
          bech32Id={id}
          listMode={listMode}
          onEntryRemoved={onEntryRemoved}
        />
      ))}
      {bech32Ids.length > visible.length ? <div ref={bottomRef} className="h-4" /> : null}
    </div>
  )
}
