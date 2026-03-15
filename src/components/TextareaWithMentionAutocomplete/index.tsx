import { Textarea } from '@/components/ui/textarea'
import MentionList from '@/components/PostEditor/PostTextarea/Mention/MentionList'
import client from '@/services/client.service'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'

const MENTION_LIMIT = 20
const MENTION_INSERT_PREFIX = 'nostr:'

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const closeMention = useCallback(() => {
    setMentionOpen(false)
    setMentionQuery('')
    setMentionItems([])
  }, [])

  const insertMention = useCallback(
    (npub: string) => {
      const ta = textareaRef.current
      if (!ta) return
      const start = mentionStart
      const end = start + 1 + mentionQuery.length
      const before = value.slice(0, start)
      const after = value.slice(end)
      const insert = MENTION_INSERT_PREFIX + npub
      onChange(before + insert + after)
      closeMention()
      setTimeout(() => {
        ta.focus()
        const newPos = start + insert.length
        ta.setSelectionRange(newPos, newPos)
      }, 0)
    },
    [value, mentionStart, mentionQuery.length, onChange, closeMention]
  )

  useEffect(() => {
    if (!mentionQuery.trim()) {
      setMentionItems([])
      setMentionOpen(false)
      return
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      client
        .searchNpubsFromLocal(mentionQuery.trim(), MENTION_LIMIT)
        .then((npubs) => {
          setMentionItems(npubs)
          setMentionOpen(npubs.length > 0)
          setSelectedIndex(0)
        })
        .catch(() => {
          setMentionItems([])
          setMentionOpen(false)
        })
    }, 150)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [mentionQuery])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    const cursor = e.target.selectionStart ?? v.length
    onChange(v)

    const textBeforeCursor = v.slice(0, cursor)
    const lastAt = textBeforeCursor.lastIndexOf('@')
    if (lastAt === -1) {
      closeMention()
      return
    }
    const afterAt = textBeforeCursor.slice(lastAt + 1)
    if (/\s/.test(afterAt)) {
      closeMention()
      return
    }
    setMentionStart(lastAt)
    setMentionQuery(afterAt)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div className="relative">
      <Textarea
        {...textareaProps}
        ref={setRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {mentionOpen && mentionItems.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1" role="listbox">
          <MentionList
            items={mentionItems}
            command={({ id }) => insertMention(id)}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
          />
        </div>
      )}
    </div>
  )
})
export default TextareaWithMentionAutocomplete
