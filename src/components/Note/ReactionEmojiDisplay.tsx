import Emoji from '@/components/Emoji'
import { resolveReactionEmojiSync } from '@/lib/reaction-display'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { cn } from '@/lib/utils'
import { replaceableEventService } from '@/services/client.service'
import { TEmoji } from '@/types'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'

/**
 * Renders a reaction glyph (Unicode, standard :shortcode:, or NIP-30 custom image from reactor profile).
 */
export default function ReactionEmojiDisplay({
  event,
  className,
  maxRawLength = 64,
  variant = 'default'
}: {
  event: Event
  className?: string
  /** Truncate long reaction text beyond this length */
  maxRawLength?: number
  /** Compact row (notification list at-a-glance) */
  variant?: 'default' | 'compact'
}) {
  const sync = useMemo(
    () => resolveReactionEmojiSync(event, maxRawLength),
    [event, maxRawLength]
  )

  const initial: TEmoji | string =
    sync.mode === 'display' ? sync.value : sync.placeholder

  const [value, setValue] = useState<TEmoji | string>(initial)

  useEffect(() => {
    setValue(initial)
  }, [initial, event.id])

  useEffect(() => {
    if (sync.mode !== 'profile' || event.kind !== kinds.Reaction) return
    let cancelled = false
    replaceableEventService.fetchReplaceableEvent(event.pubkey, kinds.Metadata).then((pe) => {
      if (cancelled || !pe) return
      const infos = getEmojiInfosFromEmojiTags(pe.tags)
      const hit = infos.find((i) => i.shortcode === sync.shortcode)
      if (hit) setValue(hit)
    })
    return () => {
      cancelled = true
    }
  }, [event.pubkey, event.kind, sync])

  if (event.kind !== kinds.Reaction || (sync.mode === 'display' && sync.value === '')) {
    return null
  }

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center leading-none select-none', className)}
      aria-hidden
    >
      <Emoji
        emoji={value}
        classNames={{
          img:
            variant === 'compact'
              ? 'size-4 max-h-[1em] w-auto rounded-sm'
              : 'size-7 max-h-[1.5em] w-auto rounded-sm',
          text: variant === 'compact' ? 'text-base leading-none' : 'text-2xl leading-none'
        }}
      />
    </span>
  )
}
