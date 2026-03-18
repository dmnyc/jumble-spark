import Emoji from '@/components/Emoji'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import customEmojiService from '@/services/custom-emoji.service'
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'

export interface EmojiListProps {
  items: string[]
  command: (params: { name?: string }) => void
  /** When provided, selection is controlled by parent (e.g. for plain textarea :emoji:). */
  selectedIndex?: number
  onSelectIndex?: (index: number) => void
}

export interface EmojiListHandler {
  onKeyDown: (params: { event: KeyboardEvent }) => boolean
}

export const EmojiList = forwardRef<EmojiListHandler, EmojiListProps>((props, ref) => {
  const items = props.items ?? []
  const isControlled = props.selectedIndex !== undefined
  const [internalIndex, setInternalIndex] = useState(0)
  const selectedIndex = isControlled ? props.selectedIndex! : internalIndex
  const setSelectedIndex = isControlled ? (n: number) => props.onSelectIndex?.(n) : setInternalIndex

  const selectItem = (index: number): void => {
    const item = items[index]

    if (item) {
      props.command({ name: item })
    }

    if (customEmojiService.getEmojiById(item)) {
      customEmojiService.updateSuggested(item)
    }
  }

  const upHandler = (): void => {
    if (!items.length) return
    setSelectedIndex((selectedIndex + items.length - 1) % items.length)
  }

  const downHandler = (): void => {
    if (!items.length) return
    setSelectedIndex((selectedIndex + 1) % items.length)
  }

  const enterHandler = (): void => {
    selectItem(selectedIndex)
  }

  useEffect(() => {
    if (!isControlled) setInternalIndex(items.length ? 0 : -1)
  }, [items, isControlled])

  useImperativeHandle(ref, () => {
    return {
      onKeyDown: (x: { event: KeyboardEvent }): boolean => {
        if (x.event.key === 'ArrowUp') {
          upHandler()
          return true
        }

        if (x.event.key === 'ArrowDown') {
          downHandler()
          return true
        }

        if (x.event.key === 'Enter' && selectedIndex >= 0) {
          enterHandler()
          return true
        }

        return false
      }
    }
  }, [upHandler, downHandler, enterHandler])

  if (!items.length) {
    return null
  }

  return (
    <ScrollArea
      className="border rounded-lg bg-background z-[110] pointer-events-auto flex flex-col max-h-80 overflow-y-auto"
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div className="p-1">
        {items.map((item, index) => {
          return (
            <EmojiListItem
              key={item}
              id={item}
              selectedIndex={selectedIndex}
              index={index}
              selectItem={selectItem}
              setSelectedIndex={setSelectedIndex}
            />
          )
        })}
      </div>
    </ScrollArea>
  )
})

function EmojiListItem({
  id,
  selectedIndex,
  index,
  selectItem,
  setSelectedIndex
}: {
  id: string
  selectedIndex: number
  index: number
  selectItem: (index: number) => void
  setSelectedIndex: (index: number) => void
}) {
  const { emoji, label } = useMemo(() => {
    const custom = customEmojiService.getEmojiById(id)
    if (custom) return { emoji: custom as import('@/types').TEmoji, label: `:${custom.shortcode}:` }
    const native = shortcodeToEmoji(id, emojis) ?? shortcodeToEmoji(id.replace(/\s+/g, '_'), emojis)
    return { emoji: native?.emoji as string | undefined, label: `:${id}:` }
  }, [id])

  return (
    <button
      className={cn(
        'cursor-pointer w-full p-1 rounded-lg transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        selectedIndex === index && 'bg-accent text-accent-foreground'
      )}
      onClick={() => selectItem(index)}
      onMouseEnter={() => setSelectedIndex(index)}
    >
      <div className="flex gap-2 items-center truncate pointer-events-none">
        {emoji ? (
          <Emoji
            emoji={emoji}
            classNames={{
              img: 'size-8 shrink-0 rounded-md',
              text: 'w-8 text-center shrink-0'
            }}
          />
        ) : (
          <span className="size-8 shrink-0 flex items-center justify-center text-muted-foreground text-xs font-mono" aria-hidden>{id.slice(0, 2)}</span>
        )}
        <span className="truncate">{label}</span>
      </div>
    </button>
  )
}
