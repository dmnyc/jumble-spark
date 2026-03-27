import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import Content from './Content'

export default function NormalContentPreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const emojiInfos = useMemo(() => getEmojiInfosFromEmojiTags(event.tags), [event.tags])
  return <Content content={event.content} className={className} emojiInfos={emojiInfos} />
}
