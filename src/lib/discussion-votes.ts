import type { TEmoji } from '@/types'

/** Canonical reaction `content` for discussion upvotes (kind 7). */
export const DISCUSSION_UPVOTE = '+'
/** Canonical reaction `content` for discussion downvotes (kind 7). */
export const DISCUSSION_DOWNVOTE = '-'

/** Shown in discussion UIs; legacy reaction `content` used the same characters. */
export const DISCUSSION_UPVOTE_DISPLAY = '⬆️'
export const DISCUSSION_DOWNVOTE_DISPLAY = '⬇️'

function emojiString(emoji: TEmoji | string | undefined | null): string | undefined {
  if (emoji === undefined || emoji === null) return undefined
  return typeof emoji === 'string' ? emoji : emoji.shortcode
}

/**
 * Relays/clients may use ⬆ (U+2B06) vs ⬆️ (U+2B06 U+FE0F); normalize before comparing.
 */
function normalizedVoteToken(s: string): string {
  return s.normalize('NFC').replace(/\ufe0f/g, '').trim()
}

const UP_ARROW = '\u2b06'
const DOWN_ARROW = '\u2b07'

export function isDiscussionUpvoteEmoji(emoji: TEmoji | string | undefined | null): boolean {
  const s = emojiString(emoji)
  if (s === undefined) return false
  const n = normalizedVoteToken(s)
  return n === DISCUSSION_UPVOTE || n === UP_ARROW
}

export function isDiscussionDownvoteEmoji(emoji: TEmoji | string | undefined | null): boolean {
  const s = emojiString(emoji)
  if (s === undefined) return false
  const n = normalizedVoteToken(s)
  return n === DISCUSSION_DOWNVOTE || n === DOWN_ARROW
}

export function isDiscussionVoteEmoji(emoji: TEmoji | string | undefined | null): boolean {
  return isDiscussionUpvoteEmoji(emoji) || isDiscussionDownvoteEmoji(emoji)
}

/** Group legacy arrow reactions with +/- for one pill per direction. */
export function canonicalDiscussionVoteKey(
  emoji: TEmoji | string | undefined | null
): typeof DISCUSSION_UPVOTE | typeof DISCUSSION_DOWNVOTE | null {
  if (isDiscussionUpvoteEmoji(emoji)) return DISCUSSION_UPVOTE
  if (isDiscussionDownvoteEmoji(emoji)) return DISCUSSION_DOWNVOTE
  return null
}

export const DISCUSSION_VOTE_EMOJIS = [DISCUSSION_UPVOTE, DISCUSSION_DOWNVOTE] as const

/** Same vote direction, including legacy ⬆️/⬇️ vs +/-. */
export function discussionVoteMatches(
  stored: TEmoji | string | undefined | null,
  clicked: string | TEmoji
): boolean {
  if (stored === undefined || stored === null) return false
  const clickStr = typeof clicked === 'string' ? clicked : clicked.shortcode
  const storeStr = typeof stored === 'string' ? stored : stored.shortcode
  if (storeStr === clickStr) return true
  return (
    (isDiscussionUpvoteEmoji(storeStr) && isDiscussionUpvoteEmoji(clickStr)) ||
    (isDiscussionDownvoteEmoji(storeStr) && isDiscussionDownvoteEmoji(clickStr))
  )
}
