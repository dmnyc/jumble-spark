import { Event } from 'nostr-tools'
import Content from './Content'

export default function NormalContentPreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  return (
    <Content
      event={event}
      content={event.content}
      className={className}
    />
  )
}
