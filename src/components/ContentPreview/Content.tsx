import { parseContent, PARSE_CONTENT_PARSERS_NOTE_TEXT } from '@/lib/content-parser'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji'
import { cn } from '@/lib/utils'
import { TEmoji } from '@/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import PaytoLink from '../PaytoLink'
import { EmbeddedMentionText } from '../Embedded'
import Emoji from '../Emoji'

export default function Content({
  content,
  className,
  emojiInfos
}: {
  content: string
  className?: string
  emojiInfos?: TEmoji[]
}) {
  const { t } = useTranslation()
  const nodes = useMemo(() => {
    const customShortcodes = emojiInfos?.map((e) => e.shortcode) ?? []
    const normalized = replaceStandardEmojiShortcodesInContent(content, customShortcodes)
    return parseContent(normalized, PARSE_CONTENT_PARSERS_NOTE_TEXT)
  }, [content, emojiInfos])

  return (
    <span className={cn(className)}>
      {nodes.map((node, index) => {
        if (node.type === 'image' || node.type === 'images') {
          return index > 0 ? ` [${t('Image')}]` : `[${t('Image')}]`
        }
        if (node.type === 'media') {
          return index > 0 ? ` [${t('Media')}]` : `[${t('Media')}]`
        }
        if (node.type === 'event') {
          return index > 0 ? ` [${t('Note')}]` : `[${t('Note')}]`
        }
        if (node.type === 'mention') {
          return <EmbeddedMentionText key={index} userId={node.data.split(':')[1]} />
        }
        if (node.type === 'payto') {
          return (
            <PaytoLink
              key={index}
              paytoUri={node.data}
              className="text-green-600 dark:text-green-400 hover:underline break-words"
            />
          )
        }
        if (node.type === 'emoji') {
          const shortcode = node.data.slice(1, -1).trim()
          const emoji = emojiInfos?.find((e) => e.shortcode === shortcode)
          if (emoji) return <Emoji key={index} emoji={emoji} classNames={{ img: 'size-4' }} />
          const native = shortcodeToEmoji(shortcode, emojis) ?? shortcodeToEmoji(shortcode.replace(/\s+/g, '_'), emojis)
          if (native?.emoji) return <Emoji key={index} emoji={native.emoji} classNames={{ img: 'size-4' }} />
          return node.data
        }
        return node.data
      })}
    </span>
  )
}
