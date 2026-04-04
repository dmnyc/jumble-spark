/**
 * Single source for the quick-like emoji row (SuggestedEmojis “+” row uses the same glyphs;
 * emoji-picker-react needs hex unified ids — see {@link EMOJI_PICKER_REACTIONS}).
 */
export const DEFAULT_SUGGESTED_EMOJIS = ['❤️', '👍', '🔥', '😂', '😢', '🫂', '🚀'] as const

function emojiToPickerUnified(emoji: string): string {
  const parts: string[] = []
  for (const ch of emoji) {
    const cp = ch.codePointAt(0)
    if (cp != null) parts.push(cp.toString(16))
  }
  return parts.join('-')
}

/** Unified ids for `emoji-picker-react` reactions row — derived from {@link DEFAULT_SUGGESTED_EMOJIS}. */
export const EMOJI_PICKER_REACTIONS: readonly string[] = DEFAULT_SUGGESTED_EMOJIS.map((e) =>
  emojiToPickerUnified(e)
)
