/** Shared guards for app-wide keyboard shortcuts (help, focus panes, etc.). */

export function isRadixDialogOpen(): boolean {
  return !!document.querySelector('[data-radix-dialog-content][data-state="open"]')
}

export function shouldIgnoreKeyboardShortcutEvent(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const el = target
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (el.closest('[contenteditable="true"]')) return true
  if (el.closest('.ProseMirror')) return true
  if (el.getAttribute('role') === 'textbox') return true
  return false
}

export const FOCUS_PRIMARY_SCROLL_SHORTCUT_KEY = 'f'
export const FOCUS_SECONDARY_SCROLL_SHORTCUT_KEY = 's'
/** Shift+Alt+N — open new note composer (handled in KeyboardShortcutsHelpProvider). */
export const OPEN_NEW_POST_SHORTCUT_KEY = 'n'
