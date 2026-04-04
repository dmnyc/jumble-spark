import client from '@/services/client.service'
import customEmojiService from '@/services/custom-emoji.service'
import postEditor from '@/services/post-editor.service'
import type { Editor } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import { SuggestionKeyDownProps } from '@tiptap/suggestion'
import tippy, { GetReferenceClientRect, Instance, Props } from 'tippy.js'
import { emojis } from '@tiptap/extension-emoji'
import { EmojiList, EmojiListHandler, EmojiListProps } from './EmojiList'

const STANDARD_EMOJI_LIMIT = 20

function searchStandardEmojiShortcodes(query: string): string[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of emojis) {
    const shortcodes = item.shortcodes ?? []
    const tags = item.tags ?? []
    const name = item.name ?? ''
    const match =
      shortcodes.some((s) => String(s).toLowerCase().includes(q)) ||
      tags.some((t) => String(t).toLowerCase().includes(q)) ||
      name.toLowerCase().includes(q)
    if (match) {
      const shortcode = shortcodes[0] ?? name
      if (shortcode && !seen.has(shortcode)) {
        seen.add(shortcode)
        out.push(shortcode)
        if (out.length >= STANDARD_EMOJI_LIMIT) break
      }
    }
  }
  return out
}

const suggestion = {
  items: async ({ query }: { query: string }) => {
    const custom = await customEmojiService.searchEmojis(query, client.pubkey ?? null)
    const customSet = new Set(custom)
    const standard = searchStandardEmojiShortcodes(query).filter((s) => !customSet.has(s))
    return [...custom, ...standard].slice(0, 50)
  },

  render: () => {
    let component: ReactRenderer<EmojiListHandler, EmojiListProps> | undefined
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
        component = new ReactRenderer(EmojiList, {
          props,
          editor: props.editor
        })

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
