import { createContext, useContext } from 'react'

/**
 * Dedicated module so lazy chunks (e.g. Sidebar) share the same context as PageManager's
 * KeyboardShortcutsHelpProvider. Importing the hook from the heavy KeyboardShortcutsHelp barrel
 * in a separate chunk can duplicate the module and break Provider matching.
 */
export type KeyboardShortcutsHelpContextValue = {
  openHelp: () => void
}

export const KeyboardShortcutsHelpContext = createContext<KeyboardShortcutsHelpContextValue | null>(
  null
)

export function useKeyboardShortcutsHelp(): KeyboardShortcutsHelpContextValue {
  const ctx = useContext(KeyboardShortcutsHelpContext)
  if (!ctx) {
    throw new Error('useKeyboardShortcutsHelp must be used within KeyboardShortcutsHelpProvider')
  }
  return ctx
}
