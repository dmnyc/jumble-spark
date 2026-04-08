import { Button } from '@/components/ui/button'
import { DEFAULT_SUGGESTED_EMOJIS } from '@/lib/like-reaction-emojis'
import { getRecentlyUsedEmojis } from '@/lib/recently-used-emojis'
import { TEmoji } from '@/types'
import { MoreHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import Emoji from '../Emoji'

export default function SuggestedEmojis({
  onEmojiClick,
  onMoreButtonClick
}: {
  onEmojiClick: (emoji: string | TEmoji) => void
  onMoreButtonClick: () => void
}) {
  const [suggestedEmojis, setSuggestedEmojis] =
    useState<(string | TEmoji)[]>(() => [...DEFAULT_SUGGESTED_EMOJIS])

  useEffect(() => {
    try {
      const recent = getRecentlyUsedEmojis()
      if (recent.length === 0) return

      const emojiSet = new Set<string>()
      const merged = [...recent, ...DEFAULT_SUGGESTED_EMOJIS].filter((emoji) => {
        const key = typeof emoji === 'string' ? emoji : emoji.shortcode
        if (emojiSet.has(key)) return false
        emojiSet.add(key)
        return true
      })
      setSuggestedEmojis(merged.slice(0, 9))
    } catch {
      // ignore
    }
  }, [])

  return (
    <div className="flex gap-1 p-1" onClick={(e) => e.stopPropagation()}>
      <div
        className="w-8 h-8 rounded-lg clickable flex justify-center items-center text-xl"
        onClick={() => onEmojiClick('+')}
      >
        <Emoji emoji="+" />
      </div>
      {suggestedEmojis.map((emoji, index) =>
        typeof emoji === 'string' ? (
          <div
            key={index}
            className="w-8 h-8 rounded-lg clickable flex justify-center items-center text-xl"
            onClick={() => onEmojiClick(emoji)}
          >
            {emoji}
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center p-1 rounded-lg clickable"
            key={index}
            onClick={() => onEmojiClick(emoji)}
          >
            <Emoji emoji={emoji} classNames={{ img: 'size-6 rounded-md' }} />
          </div>
        )
      )}
      <Button variant="ghost" className="w-8 h-8 text-muted-foreground" onClick={onMoreButtonClick}>
        <MoreHorizontal size={24} />
      </Button>
    </div>
  )
}
