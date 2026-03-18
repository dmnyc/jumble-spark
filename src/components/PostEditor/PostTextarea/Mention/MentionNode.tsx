import { useFetchProfile } from '@/hooks'
import { formatUserId } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { NodeViewRendererProps, NodeViewWrapper } from '@tiptap/react'
import { useCallback } from 'react'
import { NEVENT_NADDR_PICKER_ID } from './constants'
import { useNeventPicker } from './useNeventPicker'

export default function MentionNode(props: NodeViewRendererProps & { selected: boolean }) {
  const id = props.node.attrs.id as string
  const isNeventNaddrPlaceholder = id === NEVENT_NADDR_PICKER_ID
  const neventPicker = useNeventPicker()
  const { profile } = useFetchProfile(isNeventNaddrPlaceholder ? '' : id)

  const label =
    isNeventNaddrPlaceholder
      ? (props.node.attrs.label as string) || 'event/address'
      : profile
        ? profile.username
        : formatUserId(id)

  const handlePlaceholderClick = useCallback(() => {
    const { editor, getPos, node } = props
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (pos === undefined || pos === null) return
    neventPicker?.openNeventPicker((nostrLink: string) => {
      const from = pos
      const to = pos + node.nodeSize
      editor.chain().focus().insertContentAt({ from, to }, nostrLink + ' ').run()
    })
  }, [props, neventPicker])

  if (isNeventNaddrPlaceholder && neventPicker) {
    return (
      <NodeViewWrapper
        className={cn(
          'inline cursor-pointer text-primary underline decoration-dotted hover:bg-primary/10 rounded px-0.5',
          props.selected ? 'bg-primary/20 rounded-sm' : ''
        )}
      >
        <button type="button" onClick={handlePlaceholderClick} className="text-left">
          {'@'}
          {label}
        </button>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      className={cn('inline text-primary', props.selected ? 'bg-primary/20 rounded-sm' : '')}
    >
      {'@'}
      {label}
    </NodeViewWrapper>
  )
}
