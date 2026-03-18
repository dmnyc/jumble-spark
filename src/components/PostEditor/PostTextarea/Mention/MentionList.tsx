import type { Editor } from '@tiptap/core'
import { formatNpub, userIdToPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { SuggestionKeyDownProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Nip05 from '../../../Nip05'
import { SimpleUserAvatar } from '../../../UserAvatar'
import { SimpleUsername } from '../../../Username'
import type { PickerSearchMode } from '@/services/mention-event-search.service'
import { NEVENT_NADDR_PICKER_ID } from './constants'

export type MentionListItem = string | { id: string; mode?: PickerSearchMode }

export interface MentionListProps {
  items: MentionListItem[]
  command: (payload: { id: string; label?: string; mode?: PickerSearchMode }) => void
  /** When provided, selection is controlled by parent (e.g. for plain textarea @-mentions). */
  selectedIndex?: number
  onSelectIndex?: (index: number) => void
  /** When provided, used to detect if we're inside a dialog (for z-index). */
  editor?: Editor
}

export interface MentionListHandle {
  onKeyDown: (args: SuggestionKeyDownProps) => boolean
}

const MentionList = forwardRef<MentionListHandle, MentionListProps>((props, ref) => {
  const { t } = useTranslation()
  const items = props.items ?? []
  const inDialog = Boolean(props.editor?.view?.dom?.closest?.('[role="dialog"]'))
  const [internalIndex, setInternalIndex] = useState<number>(0)
  const isControlled = props.selectedIndex !== undefined
  const selectedIndex = isControlled ? props.selectedIndex! : internalIndex
  const setSelectedIndex = isControlled ? (n: number) => props.onSelectIndex?.(n) : setInternalIndex

  const getItemId = (item: MentionListItem): string =>
    typeof item === 'string' ? item : item.id

  const getItemMode = (item: MentionListItem): PickerSearchMode | undefined =>
    typeof item === 'object' && item && 'mode' in item ? item.mode : undefined

  const selectItem = (index: number) => {
    const item = items[index]

    if (item) {
      const id = getItemId(item)
      const label =
        id === NEVENT_NADDR_PICKER_ID
          ? t('Search for event or address…')
          : formatNpub(id)
      props.command({ id, label, mode: getItemMode(item) })
    }
  }

  const upHandler = () => {
    if (!items.length) return
    setSelectedIndex((selectedIndex + items.length - 1) % items.length)
  }

  const downHandler = () => {
    if (!items.length) return
    setSelectedIndex((selectedIndex + 1) % items.length)
  }

  const enterHandler = () => {
    selectItem(selectedIndex)
  }

  useEffect(() => {
    if (!isControlled) {
      setInternalIndex(items.length ? 0 : -1)
    }
  }, [items, isControlled])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (event.key === 'ArrowUp') {
        upHandler()
        return true
      }

      if (event.key === 'ArrowDown') {
        downHandler()
        return true
      }

      if (event.key === 'Enter' && selectedIndex >= 0) {
        enterHandler()
        return true
      }

      return false
    }
  }))

  if (!items.length) {
    return null
  }

  return (
    <div
      className={cn(
        'border rounded-lg bg-background pointer-events-auto flex flex-col max-h-80 min-h-0 overflow-y-scroll overflow-x-hidden',
        inDialog ? 'z-[210]' : 'z-[110]'
      )}
      onWheel={(e: React.WheelEvent) => e.stopPropagation()}
      onTouchMove={(e: React.TouchEvent) => e.stopPropagation()}
    >
      {items.map((item, index) => (
        <button
          className={cn(
            'cursor-pointer text-start items-center m-1 p-2 outline-none transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 rounded-md',
            selectedIndex === index && 'bg-accent text-accent-foreground'
          )}
          key={getItemId(item)}
          onClick={() => selectItem(index)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <div className="flex gap-2 w-80 items-center truncate pointer-events-none">
            {getItemId(item) === NEVENT_NADDR_PICKER_ID ? (
              <span className="text-muted-foreground text-sm">
                {t('Search for event or address…')}
              </span>
            ) : (
              <>
                <SimpleUserAvatar userId={getItemId(item)} />
                <div className="flex-1 w-0">
                  <SimpleUsername userId={getItemId(item)} className="font-semibold truncate" />
                  <Nip05 pubkey={userIdToPubkey(getItemId(item))} />
                </div>
              </>
            )}
          </div>
        </button>
      ))}
    </div>
  )
})
MentionList.displayName = 'MentionList'
export default MentionList
