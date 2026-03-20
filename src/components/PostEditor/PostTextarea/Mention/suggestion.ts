import {
  searchNpubsForMention,
  type PickerSearchMode
} from '@/services/mention-event-search.service'
import postEditor from '@/services/post-editor.service'
import type { Editor } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import { SuggestionKeyDownProps } from '@tiptap/suggestion'
import tippy, { GetReferenceClientRect, Instance, Props } from 'tippy.js'
import MentionList, { MentionListHandle, MentionListProps, type MentionListItem } from './MentionList'
import { NEVENT_NADDR_PICKER_ID } from './constants'

export { NEVENT_NADDR_PICKER_ID } from './constants'

export type { PickerSearchMode }

const MENTION_EXTENSION_NAME = 'mention'
const MENTION_CHAR = '@'

export const OPEN_NEVENT_PICKER_EVENT = 'open-nevent-picker'

// Shared state for incremental updates
let currentComponent: ReactRenderer<MentionListHandle, MentionListProps> | undefined
let currentQuery = ''
let backgroundSearchController: AbortController | null = null

/** Extend range.to to include any trailing word chars (handle, NIP-05) so the full @handle is replaced. Exported for nevent picker. */
export function extendMentionRangeToEndOfWord(editor: Editor, range: { from: number; to: number }): number {
  const { doc } = editor.state
  let pos = range.to
  while (pos < doc.content.size) {
    const $pos = doc.resolve(pos)
    const node = $pos.nodeAfter
    if (!node || !node.isText) break
    const text = node.text ?? ''
    const offset = pos - $pos.start()
    let i = offset
    while (i < text.length && /[\w.-]/.test(text[i]!)) i++
    if (i === offset) break
    pos += i - offset
  }
  return pos
}

const suggestion = {
  command: ({
    editor,
    range,
    props
  }: {
    editor: Editor
    range: { from: number; to: number }
    props: { id: string | null; label?: string | null; mode?: PickerSearchMode }
  }) => {
    if (props.id === NEVENT_NADDR_PICKER_ID) {
      postEditor.closeSuggestionPopup()
      window.dispatchEvent(
        new CustomEvent(OPEN_NEVENT_PICKER_EVENT, {
          detail: { editor, range, initialMode: props.mode ?? 'nevent' }
        })
      )
      return
    }
    if (props.id == null) return
    const to = extendMentionRangeToEndOfWord(editor, range)
    const nodeAfter = editor.view.state.selection.$to.nodeAfter
    const overrideSpace = nodeAfter?.text?.startsWith(' ')
    const toWithSpace = overrideSpace ? to + 1 : to
    editor
      .chain()
      .focus()
      .insertContentAt({ from: range.from, to: toWithSpace }, [
        { type: MENTION_EXTENSION_NAME, attrs: { ...props, mentionSuggestionChar: MENTION_CHAR } },
        { type: 'text', text: ' ' }
      ])
      .run()
    editor.view.dom.ownerDocument.defaultView?.getSelection()?.collapseToEnd()
  },

  items: async ({ query }: { query: string }) => {
    const q = query.trim().toLowerCase()
    if (q === 'nevent' || q === 'naddr' || q.startsWith('nevent') || q.startsWith('naddr')) {
      const mode: PickerSearchMode = q === 'naddr' || q.startsWith('naddr') ? 'naddr' : 'nevent'
      return [{ id: NEVENT_NADDR_PICKER_ID, mode }]
    }
    
    // Abort previous background search if query changed
    if (currentQuery !== q && backgroundSearchController) {
      backgroundSearchController.abort()
      backgroundSearchController = null
    }
    currentQuery = q
    
    // Update component as results arrive (incremental updates)
    const updateComponent = (npubs: string[]) => {
      if (currentComponent && currentQuery === q) {
        const items: MentionListItem[] = npubs
        currentComponent.updateProps({ items })
      }
    }
    
    // Start search with callback - returns cached results immediately, then updates with relay results
    backgroundSearchController = new AbortController()
    const results = await searchNpubsForMention(query, 20, updateComponent)
    
    return results ?? []
  },

  render: () => {
    let component: ReactRenderer<MentionListHandle, MentionListProps> | undefined
    let popup: Instance[] = []
    let touchListener: (e: TouchEvent) => void
    let closePopup: () => void
    let exited = false

    return {
      onBeforeStart: () => {
        touchListener = (e: TouchEvent) => {
          if (popup && popup[0] && postEditor.isSuggestionPopupOpen) {
            const popupElement = popup[0].popper
            if (popupElement && !popupElement.contains(e.target as Node)) {
              popup[0].hide()
            }
          }
        }
        document.addEventListener('touchstart', touchListener)

        closePopup = () => {
          if (popup && popup[0]) {
            popup[0].hide()
          }
        }
        postEditor.addEventListener('closeSuggestionPopup', closePopup)
      },
      onStart: (props: { editor: Editor; clientRect?: (() => DOMRect | null) | null }) => {
        component = new ReactRenderer(MentionList, {
          ...props,
          editor: props.editor
        })
        
        // Store component reference for incremental updates
        currentComponent = component

        if (!props.clientRect) {
          return
        }

        popup = tippy('body', {
          getReferenceClientRect: props.clientRect as GetReferenceClientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          hideOnClick: true,
          touch: true,
          onShow() {
            postEditor.isSuggestionPopupOpen = true
          },
          onHide() {
            postEditor.isSuggestionPopupOpen = false
          }
        })
      },

      onUpdate(props: { clientRect?: (() => DOMRect | null) | null | undefined }) {
        component?.updateProps(props)

        if (!props.clientRect) {
          return
        }

        popup[0]?.setProps({
          getReferenceClientRect: props.clientRect
        } as Partial<Props>)
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === 'Escape') {
          popup[0]?.hide()
          return true
        }
        return component?.ref?.onKeyDown(props) ?? false
      },

      onExit() {
        if (exited) return
        exited = true
        postEditor.isSuggestionPopupOpen = false
        
        // Abort background search
        if (backgroundSearchController) {
          backgroundSearchController.abort()
          backgroundSearchController = null
        }
        currentComponent = undefined
        currentQuery = ''
        
        if (popup[0]) {
          popup[0].destroy()
          popup = []
        }
        if (component) {
          component.destroy()
          component = undefined
        }

        document.removeEventListener('touchstart', touchListener)
        postEditor.removeEventListener('closeSuggestionPopup', closePopup)
      }
    }
  }
}

export default suggestion
