import { parseEmojiPickerUnified } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useTheme } from '@/providers/ThemeProvider'
import customEmojiService from '@/services/custom-emoji.service'
import { TEmoji } from '@/types'
import EmojiPickerReact, {
  EmojiStyle,
  SkinTonePickerLocation,
  SuggestionMode,
  Theme
} from 'emoji-picker-react'
import { useEffect, useMemo, useState } from 'react'

export { EMOJI_PICKER_REACTIONS } from '@/lib/like-reaction-emojis'

export default function EmojiPicker({
  onEmojiClick,
  reactionsDefaultOpen,
  reactions
}: {
  onEmojiClick: (emoji: string | TEmoji | undefined, event: MouseEvent) => void
  /** When true, show the compact reactions row first (tap + for full picker). */
  reactionsDefaultOpen?: boolean
  /** Unified ids for the reactions row; for likes use {@link EMOJI_PICKER_REACTIONS}. */
  reactions?: string[]
}) {
  const { themeSetting } = useTheme()
  const { isSmallScreen } = useScreenSize()
  const { pubkey } = useNostr()
  const [viewportW, setViewportW] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 390)
  )
  const [viewportH, setViewportH] = useState(
    () => (typeof window !== 'undefined' ? window.innerHeight : 700)
  )
  useEffect(() => {
    const onResize = () => {
      setViewportW(window.innerWidth)
      setViewportH(window.innerHeight)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [customEmojiTick, setCustomEmojiTick] = useState(0)
  useEffect(() => customEmojiService.subscribeIndexUpdate(() => setCustomEmojiTick((t) => t + 1)), [])
  const customEmojis = useMemo(
    () => customEmojiService.getAllCustomEmojisForPicker(pubkey ?? null),
    [pubkey, customEmojiTick]
  )

  const pickerWidth = isSmallScreen ? Math.max(260, viewportW - 24) : 350
  const pickerHeight = isSmallScreen
    ? Math.max(280, Math.min(Math.round(viewportH * 0.52), 460))
    : 450

  return (
    <EmojiPickerReact
      theme={
        themeSetting === 'system' ? Theme.AUTO : themeSetting === 'dark' ? Theme.DARK : Theme.LIGHT
      }
      width={pickerWidth}
      height={pickerHeight}
      autoFocusSearch={false}
      emojiStyle={EmojiStyle.NATIVE}
      skinTonePickerLocation={SkinTonePickerLocation.PREVIEW}
      style={
        {
          '--epr-bg-color': 'hsl(var(--background))',
          '--epr-category-label-bg-color': 'hsl(var(--background))',
          '--epr-text-color': 'hsl(var(--foreground))',
          '--epr-hover-bg-color': 'hsl(var(--muted) / 0.5)',
          '--epr-picker-border-color': 'transparent',
          '--epr-search-input-bg-color': 'hsl(var(--muted) / 0.5)'
        } as React.CSSProperties
      }
      suggestedEmojisMode={SuggestionMode.FREQUENT}
      onEmojiClick={(data, e) => {
        const emoji = parseEmojiPickerUnified(data.unified)
        onEmojiClick(emoji, e)
      }}
      customEmojis={customEmojis}
      {...(reactionsDefaultOpen !== undefined ? { reactionsDefaultOpen } : {})}
      {...(reactions !== undefined ? { reactions } : {})}
    />
  )
}
