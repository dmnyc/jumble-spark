import { createContext, useContext } from 'react'
import type { Event } from 'nostr-tools'

export type NoteDrawerContextValue = {
  openDrawer: (noteId: string, initialEvent?: Event) => void
  closeDrawer: () => void
  isDrawerOpen: boolean
  drawerNoteId: string | null
  drawerInitialEvent: Event | null
}

/**
 * Same rationale as {@link PrimaryNoteViewContext}: keep context identity out of PageManager.tsx
 * so lazy chunks never instantiate a duplicate context.
 */
export const NoteDrawerContext = createContext<NoteDrawerContextValue | undefined>(undefined)

export function useNoteDrawer(): NoteDrawerContextValue {
  const context = useContext(NoteDrawerContext)
  if (!context) {
    throw new Error('useNoteDrawer must be used within a NoteDrawerContext.Provider')
  }
  return context
}
