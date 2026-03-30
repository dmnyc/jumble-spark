/**
 * Standalone bookmarks context so lazy routes (e.g. SpellsPage) and the app shell share one
 * `createContext()` identity. Without this, Vite can evaluate `BookmarksProvider.tsx` twice across
 * chunks and `useBookmarks` sees a different context than `<BookmarksProvider>` provides.
 */
import type { Event } from 'nostr-tools'
import { createContext, useContext } from 'react'

export type TBookmarksContext = {
  addBookmark: (event: Event) => Promise<void>
  /** `true` if a new list event was published. */
  removeBookmark: (event: Event) => Promise<boolean>
  /** Remove by nevent / note / naddr id when the row has no loaded event (or as fallback). */
  removeBookmarkByBech32: (bech32Id: string) => Promise<boolean>
}

export const BookmarksContext = createContext<TBookmarksContext | undefined>(undefined)

export function useBookmarks(): TBookmarksContext {
  const context = useContext(BookmarksContext)
  if (!context) {
    throw new Error('useBookmarks must be used within a BookmarksProvider')
  }
  return context
}

/** Returns undefined when outside BookmarksProvider (e.g. embedded notes in createRoot trees). */
export function useBookmarksOptional(): TBookmarksContext | undefined {
  return useContext(BookmarksContext)
}
