import {
  DISCUSSION_DOWNVOTE_DISPLAY,
  DISCUSSION_UPVOTE_DISPLAY,
  DISCUSSION_VOTE_EMOJIS
} from '@/lib/discussion-votes'
import { TEmoji } from '@/types'

const GLYPHS = [DISCUSSION_UPVOTE_DISPLAY, DISCUSSION_DOWNVOTE_DISPLAY] as const

export default function DiscussionEmojis({
  onEmojiClick
}: {
  onEmojiClick: (emoji: string | TEmoji) => void
}) {
  return (
    <div className="flex gap-1 p-1" style={{ width: '60px', maxWidth: '60px' }} onClick={(e) => e.stopPropagation()}>
      {DISCUSSION_VOTE_EMOJIS.map((emoji, i) => (
        <div
          key={emoji}
          className="w-6 h-6 rounded-lg clickable flex justify-center items-center text-base hover:bg-muted flex-shrink-0"
          onClick={() => onEmojiClick(emoji)}
        >
          {GLYPHS[i]}
        </div>
      ))}
    </div>
  )
}
