import { DEFAULT_SUGGESTED_EMOJIS } from '@/lib/like-reaction-emojis'
import { recordEmojiUsed } from '@/lib/recently-used-emojis'
import { useNostr } from '@/providers/NostrProvider'
import { useTheme } from '@/providers/ThemeProvider'
import customEmojiService from '@/services/custom-emoji.service'
import { TEmoji } from '@/types'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export { DEFAULT_SUGGESTED_EMOJIS as EMOJI_PICKER_REACTIONS } from '@/lib/like-reaction-emojis'

export default function EmojiPicker({
  onEmojiClick,
  reactionsDefaultOpen,
  reactions
}: {
  onEmojiClick: (emoji: string | TEmoji | undefined, event: Event) => void
  reactionsDefaultOpen?: boolean
  reactions?: string[]
}) {
  const { themeSetting } = useTheme()
  const { pubkey } = useNostr()
  const [mode, setMode] = useState<'reactions' | 'full'>(
    reactionsDefaultOpen ? 'reactions' : 'full'
  )
  const [customEmojiTick, setCustomEmojiTick] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<(HTMLElement & { customEmoji: unknown[] }) | null>(null)

  useEffect(() => customEmojiService.subscribeIndexUpdate(() => setCustomEmojiTick((t) => t + 1)), [])

  const customEmojis = useMemo(
    () => customEmojiService.getAllCustomEmojisForPicker(pubkey ?? null),
    [pubkey, customEmojiTick]
  )

  const ownEmojis = useMemo(
    () => (pubkey ? customEmojiService.getOwnCustomEmojis(pubkey) : []),
    [pubkey, customEmojiTick]
  )

  useEffect(() => {
    if (mode !== 'full') return

    let cancelled = false

    import('emoji-picker-element').then(({ Picker }) => {
      if (cancelled || !containerRef.current) return

      const picker = new Picker() as HTMLElement & { customEmoji: unknown[] }
      pickerRef.current = picker

      picker.customEmoji = customEmojis

      if (themeSetting === 'dark') {
        picker.className = 'dark'
      } else if (themeSetting === 'light') {
        picker.className = 'light'
      }

      picker.style.width = '100%'
      picker.style.setProperty('--num-columns', '8')

      const handleClick = (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          unicode?: string
          emoji: { custom?: boolean; shortcodes?: string[]; url?: string }
        }
        let result: string | TEmoji | undefined
        if (detail.unicode) {
          result = detail.unicode
        } else if (detail.emoji?.custom && detail.emoji.shortcodes?.[0] && detail.emoji.url) {
          result = { shortcode: detail.emoji.shortcodes[0], url: detail.emoji.url }
        }
        if (result !== undefined) recordEmojiUsed(result)
        onEmojiClick(result, e)
      }

      picker.addEventListener('emoji-click', handleClick)
      containerRef.current.appendChild(picker)
    })

    return () => {
      cancelled = true
      if (pickerRef.current) {
        pickerRef.current.remove()
        pickerRef.current = null
      }
    }
  }, [mode])

  useEffect(() => {
    if (pickerRef.current) {
      pickerRef.current.customEmoji = customEmojis
    }
  }, [customEmojis])

  useEffect(() => {
    if (!pickerRef.current) return
    if (themeSetting === 'dark') {
      pickerRef.current.className = 'dark'
    } else if (themeSetting === 'light') {
      pickerRef.current.className = 'light'
    } else {
      pickerRef.current.className = ''
    }
  }, [themeSetting])

  const reactionsList = reactions ?? [...DEFAULT_SUGGESTED_EMOJIS]

  if (mode === 'reactions') {
    return (
      <div className="flex flex-wrap items-center gap-1 p-2">
        {reactionsList.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="text-2xl p-1 rounded hover:bg-muted leading-none"
            onClick={(e) => {
              recordEmojiUsed(emoji)
              onEmojiClick(emoji, e.nativeEvent)
            }}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          title="More emojis"
          className="p-1 rounded hover:bg-muted text-muted-foreground flex items-center justify-center"
          onClick={() => setMode('full')}
        >
          <Plus size={20} />
        </button>
      </div>
    )
  }

  return (
    <div className="w-full flex flex-col">
      {ownEmojis.length > 0 && (
        <div className="flex items-center gap-0.5 px-1 py-1 border-b overflow-x-auto scrollbar-hide">
          {ownEmojis.map((emoji) => (
            <button
              key={emoji.shortcode}
              type="button"
              title={`:${emoji.shortcode}:`}
              className="shrink-0 w-8 h-8 rounded hover:bg-muted flex items-center justify-center"
              onClick={(e) => {
                recordEmojiUsed(emoji)
                onEmojiClick(emoji, e.nativeEvent)
              }}
            >
              <img src={emoji.url} alt={emoji.shortcode} className="w-6 h-6 object-contain" />
            </button>
          ))}
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}
