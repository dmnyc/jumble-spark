import { getKeyForDeletedLookup } from '@/lib/deleted-event-key'
import { isTombstoneKeyForEvent } from '@/lib/event'
import { TOMBSTONES_UPDATED_EVENT } from '@/lib/tombstone-events'
import indexedDb from '@/services/indexed-db.service'
import { NostrEvent } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type TDeletedEventContext = {
  addDeletedEvent: (event: NostrEvent) => void
  addDeletedEventId: (eventId: string) => void
  isEventDeleted: (event: NostrEvent) => boolean
  /** Bumps when tombstones are reloaded from IndexedDB (for list re-filtering). */
  tombstoneEpoch: number
}

const DeletedEventContext = createContext<TDeletedEventContext | undefined>(undefined)

export const useDeletedEvent = () => {
  const context = useContext(DeletedEventContext)
  if (!context) {
    throw new Error('useDeletedEvent must be used within a DeletedEventProvider')
  }
  return context
}

export function DeletedEventProvider({ children }: { children: React.ReactNode }) {
  const [tombstoneKeys, setTombstoneKeys] = useState<Set<string>>(() => new Set())
  const [tombstoneEpoch, setTombstoneEpoch] = useState(0)

  const hydrateFromIndexedDb = useCallback(async () => {
    try {
      const keys = await indexedDb.getAllTombstones()
      setTombstoneKeys(keys)
      setTombstoneEpoch((e) => e + 1)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void hydrateFromIndexedDb()
  }, [hydrateFromIndexedDb])

  useEffect(() => {
    const onUpdate = () => {
      void hydrateFromIndexedDb()
    }
    window.addEventListener(TOMBSTONES_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(TOMBSTONES_UPDATED_EVENT, onUpdate)
  }, [hydrateFromIndexedDb])

  const isEventDeleted = useCallback(
    (event: NostrEvent) => isTombstoneKeyForEvent(event, tombstoneKeys),
    [tombstoneKeys]
  )

  const addDeletedEvent = useCallback((event: NostrEvent) => {
    const key = getKeyForDeletedLookup(event)
    setTombstoneKeys((prev) => new Set(prev).add(key))
    setTombstoneEpoch((e) => e + 1)
  }, [])

  const addDeletedEventId = useCallback((eventId: string) => {
    setTombstoneKeys((prev) => new Set(prev).add(eventId))
    setTombstoneEpoch((e) => e + 1)
  }, [])

  return (
    <DeletedEventContext.Provider
      value={{ addDeletedEvent, addDeletedEventId, isEventDeleted, tombstoneEpoch }}
    >
      {children}
    </DeletedEventContext.Provider>
  )
}
