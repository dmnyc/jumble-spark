import { createContext, useContext, type ReactNode } from 'react'

export type TPrimaryOverlayViewType =
  | 'note'
  | 'settings'
  | 'settings-sub'
  | 'profile'
  | 'hashtag'
  | 'relay'
  | 'following'
  | 'mute'
  | 'bookmarks'
  | 'pins'
  | 'others-relay-settings'

export type PrimaryNoteViewContextValue = {
  setPrimaryNoteView: (view: ReactNode | null, type?: TPrimaryOverlayViewType) => void
  primaryViewType: TPrimaryOverlayViewType | null
  getNavigationCounter: () => number
  /** Top URL in the secondary stack (right panel), or undefined if empty. */
  getTopSecondaryUrl: () => string | undefined
  /** Primary overlay (mobile / narrow): child calls this to expose refresh for the chrome bar. */
  registerPrimaryPanelRefresh: (fn: (() => void) | null) => void
  triggerPrimaryPanelRefresh: () => void
}

/**
 * Dedicated module so lazy chunks (e.g. BottomNavigationBar) share the same context as PageManager.
 * Importing these hooks from PageManager into those chunks can duplicate the module and break
 * Provider matching ("must be used within PrimaryNoteViewContext.Provider").
 */
export const PrimaryNoteViewContext = createContext<PrimaryNoteViewContextValue | undefined>(undefined)

export function usePrimaryNoteView(): PrimaryNoteViewContextValue {
  const context = useContext(PrimaryNoteViewContext)
  if (!context) {
    throw new Error('usePrimaryNoteView must be used within a PrimaryNoteViewContext.Provider')
  }
  return context
}

/** Returns undefined when outside provider (e.g. embedded notes in createRoot trees). */
export function usePrimaryNoteViewOptional(): PrimaryNoteViewContextValue | undefined {
  return useContext(PrimaryNoteViewContext)
}
