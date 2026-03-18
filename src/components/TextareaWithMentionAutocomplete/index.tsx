import { Textarea } from '@/components/ui/textarea'
import MentionList from '@/components/PostEditor/PostTextarea/Mention/MentionList'
import { NEVENT_NADDR_PICKER_ID } from '@/components/PostEditor/PostTextarea/Mention/constants'
import { useNeventPicker } from '@/components/PostEditor/PostTextarea/Mention/NeventNaddrPickerDialog'
import { EmojiList } from '@/components/PostEditor/PostTextarea/Emoji/EmojiList'
import client from '@/services/client.service'
import customEmojiService from '@/services/custom-emoji.service'
import { searchStandardEmojiShortcodes } from '@/lib/emoji-content'
import { createPortal } from 'react-dom'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'

const MENTION_LIMIT = 20
const MENTION_INSERT_PREFIX = 'nostr:'
const EMOJI_LIMIT = 25

export type TextareaWithMentionAutocompleteProps = Omit<
  React.ComponentProps<typeof Textarea>,
  'value' | 'onChange'
> & {
  value: string
  onChange: (value: string) => void
}

/**
 * Plain textarea with @-mention autocomplete (same npub search as post form).
 * When user types @query, shows a dropdown of matching profiles; on select inserts nostr:npub...
 */
const TextareaWithMentionAutocomplete = forwardRef<HTMLTextAreaElement, TextareaWithMentionAutocompleteProps>(function TextareaWithMentionAutocomplete({
  value,
  onChange,
  onKeyDown,
  ...textareaProps
}, refProp) {
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionItems, setMentionItems] = useState<string[]>([])
  const [mentionStart, setMentionStart] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [emojiQuery, setEmojiQuery] = useState('')
  const [emojiItems, setEmojiItems] = useState<string[]>([])
  const [emojiStart, setEmojiStart] = useState(0)
  const [selectedEmojiIndex, setSelectedEmojiIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emojiSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mentionQueryRef = useRef(mentionQuery)
  const neventPicker = useNeventPicker()
  mentionQueryRef.current = mentionQuery
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null)

  const closeMention = useCallback(() => {
    setMentionOpen(false)
    setMentionQuery('')
    setMentionItems([])
  }, [])

  const closeEmoji = useCallback(() => {
    setEmojiOpen(false)
    setEmojiQuery('')
    setEmojiItems([])
  }, [])

  // When value is cleared or changed from outside, or @/: segment is gone, close dropdowns so they don't linger
  useEffect(() => {
    if (!value) {
      closeMention()
      closeEmoji()
      return
    }
    if (mentionOpen) {
      if (value.length <= mentionStart || value[mentionStart] !== '@' || !value.includes('@')) {
        closeMention()
      }
    }
    if (emojiOpen) {
      if (value.length <= emojiStart || value[emojiStart] !== ':') {
        closeEmoji()
      }
    }
  }, [value, mentionOpen, emojiOpen, mentionStart, emojiStart, closeMention, closeEmoji])

  /** Find end of @-mention segment in value (from start, after the @): alphanumeric, underscore, hyphen, dot (NIP-05). */
  const findMentionSegmentEnd = useCallback((val: string, from: number) => {
    let i = from + 1
    while (i < val.length && /[\w.-]/.test(val[i]!)) i++
    return i
  }, [])

  const insertMention = useCallback(
    (id: string) => {
      const ta = textareaRef.current
      if (!ta) return
      const start = mentionStart
      const end = findMentionSegmentEnd(value, start)
      const before = value.slice(0, start)
      const after = value.slice(end)

      if (id === NEVENT_NADDR_PICKER_ID && neventPicker) {
        closeMention()
        neventPicker.openNeventPicker((link: string) => {
          const insert = link + ' '
          onChange(before + insert + after)
          setTimeout(() => {
            ta.focus()
            const newPos = start + insert.length
            ta.setSelectionRange(newPos, newPos)
          }, 0)
        })
        return
      }

      const insert = MENTION_INSERT_PREFIX + id
      onChange(before + insert + after)
      closeMention()
      setTimeout(() => {
        ta.focus()
        const newPos = start + insert.length
        ta.setSelectionRange(newPos, newPos)
      }, 0)
    },
    [value, mentionStart, onChange, closeMention, neventPicker, findMentionSegmentEnd]
  )

  const insertEmoji = useCallback(
    (shortcode: string) => {
      const ta = textareaRef.current
      if (!ta) return
      const end = emojiStart + 1 + emojiQuery.length
      const before = value.slice(0, emojiStart)
      const after = value.slice(end)
      const insert = `:${shortcode}:`
      onChange(before + insert + after)
      closeEmoji()
      setTimeout(() => {
        ta.focus()
        const newPos = emojiStart + insert.length
        ta.setSelectionRange(newPos, newPos)
      }, 0)
    },
    [value, emojiStart, emojiQuery.length, onChange, closeEmoji]
  )

  useEffect(() => {
    if (!mentionQuery.trim()) {
      setMentionItems([])
      setMentionOpen(false)
      return
    }
    const q = mentionQuery.trim().toLowerCase()
    if (q === 'nevent' || q === 'naddr' || q.startsWith('nevent') || q.startsWith('naddr')) {
      setMentionItems([NEVENT_NADDR_PICKER_ID])
      setMentionOpen(true)
      setSelectedIndex(0)
      return
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      client
        .searchNpubsForMention(mentionQuery.trim(), MENTION_LIMIT)
        .then((npubs) => {
          const q = mentionQueryRef.current.trim().toLowerCase()
          if (q === 'nevent' || q === 'naddr' || q.startsWith('nevent') || q.startsWith('naddr')) {
            return
          }
          const list = npubs ?? []
          setMentionItems(list)
          setMentionOpen(list.length > 0)
          setSelectedIndex(0)
        })
        .catch(() => {
          const q = mentionQueryRef.current.trim().toLowerCase()
          if (q === 'nevent' || q === 'naddr' || q.startsWith('nevent') || q.startsWith('naddr')) {
            return
          }
          setMentionItems([])
          setMentionOpen(false)
        })
    }, 150)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [mentionQuery])

  useEffect(() => {
    if (!emojiQuery.trim()) {
      setEmojiItems([])
      setEmojiOpen(false)
      return
    }
    const q = emojiQuery.trim().toLowerCase()
    if (emojiSearchTimeoutRef.current) clearTimeout(emojiSearchTimeoutRef.current)
    emojiSearchTimeoutRef.current = setTimeout(() => {
      Promise.all([
        customEmojiService.searchEmojis(q),
        Promise.resolve(searchStandardEmojiShortcodes(q, EMOJI_LIMIT))
      ]).then(([custom, standard]) => {
        const customSet = new Set(custom)
        const merged = [...custom, ...standard.filter((s) => !customSet.has(s))].slice(0, 50)
        setEmojiItems(merged)
        setEmojiOpen(merged.length > 0)
        setSelectedEmojiIndex(0)
      })
    }, 150)
    return () => {
      if (emojiSearchTimeoutRef.current) clearTimeout(emojiSearchTimeoutRef.current)
    }
  }, [emojiQuery])

  const open = (emojiOpen && emojiItems.length > 0) || (mentionOpen && mentionItems.length > 0)
  useEffect(() => {
    if (!open) {
      setDropdownRect(null)
      return
    }
    const el = textareaRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setDropdownRect({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    const cursor = e.target.selectionStart ?? v.length
    onChange(v)

    const textBeforeCursor = v.slice(0, cursor)
    const lastAt = textBeforeCursor.lastIndexOf('@')
    const lastColon = textBeforeCursor.lastIndexOf(':')
    const segmentAfterColon = lastColon >= 0 ? textBeforeCursor.slice(lastColon + 1) : ''
    const segmentAfterAt = lastAt >= 0 ? textBeforeCursor.slice(lastAt + 1) : ''

    const inEmoji = lastColon >= 0 && !/\s/.test(segmentAfterColon) && (lastColon > lastAt || lastAt === -1)
    const inMention = lastAt >= 0 && !/\s/.test(segmentAfterAt)

    if (inEmoji) {
      closeMention()
      setEmojiStart(lastColon)
      setEmojiQuery(segmentAfterColon)
      return
    }
    if (inMention) {
      closeEmoji()
      setMentionStart(lastAt)
      setMentionQuery(segmentAfterAt)
      return
    }
    closeMention()
    closeEmoji()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (emojiOpen && emojiItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedEmojiIndex((i) => (i + 1) % emojiItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedEmojiIndex((i) => (i + emojiItems.length - 1) % emojiItems.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        insertEmoji(emojiItems[selectedEmojiIndex]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeEmoji()
        return
      }
    }
    if (mentionOpen && mentionItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % mentionItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i + mentionItems.length - 1) % mentionItems.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        insertMention(mentionItems[selectedIndex]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMention()
        return
      }
    }
    onKeyDown?.(e)
  }

  const setRef = (el: HTMLTextAreaElement | null) => {
    textareaRef.current = el
    if (typeof refProp === 'function') {
      refProp(el)
    } else if (refProp) {
      (refProp as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
    }
  }

  const dropdownContent =
    dropdownRect && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="border rounded-lg bg-background shadow-lg overflow-hidden"
            role="listbox"
            style={{
              position: 'fixed',
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              maxWidth: 'min(400px, 95vw)',
              zIndex: 10000
            }}
          >
            {emojiOpen && emojiItems.length > 0 && (
              <EmojiList
                items={emojiItems}
                command={({ name }) => name != null && insertEmoji(name)}
                selectedIndex={selectedEmojiIndex}
                onSelectIndex={setSelectedEmojiIndex}
              />
            )}
            {mentionOpen && mentionItems.length > 0 && !emojiOpen && (
              <MentionList
                items={mentionItems}
                command={({ id }) => insertMention(id as string)}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
              />
            )}
          </div>,
          document.body
        )
      : null

  return (
    <div className="relative">
      <Textarea
        {...textareaProps}
        ref={setRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {dropdownContent}
    </div>
  )
})
export default TextareaWithMentionAutocomplete
