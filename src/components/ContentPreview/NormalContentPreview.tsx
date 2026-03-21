import { Event } from 'nostr-tools'
import Content from './Content'

export default function NormalContentPreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  return <Content content={event.content} className={className} />
}
