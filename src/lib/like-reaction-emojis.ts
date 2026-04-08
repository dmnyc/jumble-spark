/**
 * Single source for the quick-like emoji row used by SuggestedEmojis and the EmojiPicker
 * reactions row. Also re-exported as EMOJI_PICKER_REACTIONS for LikeButton.
 */
export const DEFAULT_SUGGESTED_EMOJIS = ['❤️', '👍', '🔥', '😂', '😢', '🫂', '🚀'] as const

/** Emoji characters for the reactions row in the like-button picker. */
export const EMOJI_PICKER_REACTIONS: readonly string[] = DEFAULT_SUGGESTED_EMOJIS
