import TTEmoji from '@tiptap/extension-emoji'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ReactNodeViewRenderer } from '@tiptap/react'
import EmojiNode from './EmojiNode'

const Emoji = TTEmoji.extend({
  selectable: true,

  addNodeView() {
    return ReactNodeViewRenderer(EmojiNode)
  },

  addProseMirrorPlugins() {
    const extensionName = this.name
    return [
      // Preserve the base extension's plugins (the `:shortcode:` suggestion).
      ...(this.parent?.() ?? []),
      // The emoji renders as an inline atom node view (contenteditable=false),
      // which the browser's native range selection won't paint. Decorate any
      // emoji that falls inside the current text selection so it visibly looks
      // selected along with the surrounding text.
      new Plugin({
        props: {
          decorations(state) {
            const { from, to } = state.selection
            if (from === to) return DecorationSet.empty

            const decorations: Decoration[] = []
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === extensionName) {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, { class: 'emoji-selected' })
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          }
        }
      })
    ]
  }
})
export default Emoji
