import { useFetchEvent } from '@/hooks'
import { cn } from '@/lib/utils'
import { Event, nip19 } from 'nostr-tools'

/**
 * NIP-89 handler badge: when an event carries a `client` tag pointing at a
 * handler (31990:<pubkey>:<d>), fetch that handler event and show its logo.
 * Clicking opens the handler's web action. Nothing renders when the client
 * tag or the handler event is missing.
 */
export function HandlerBadge({ event, className }: { event: Event; className?: string }) {
  const clientTag = event.tags.find(([n]) => n === 'client')
  const name = clientTag?.[1]
  const handlerAddress = clientTag?.[2] ?? ''
  const isValid = handlerAddress.startsWith('31990:')
  // client.fetchEvent needs a bech32 id, not a raw coordinate — encode the
  // handler address as an naddr first.
  let handlerId: string | undefined
  if (isValid) {
    const [, handlerPubkey, handlerD] = handlerAddress.split(':')
    try {
      handlerId = nip19.naddrEncode({
        kind: 31990,
        pubkey: handlerPubkey,
        identifier: handlerD ?? ''
      })
    } catch {
      handlerId = undefined
    }
  }
  const { event: handler } = useFetchEvent(handlerId)

  const picture = handler?.tags.find(([n]) => n === 'picture')?.[1]
  const web = handler?.tags.find(([n]) => n === 'web')?.[1]
  if (!isValid || !handler || !picture) return null

  return (
    <a
      href={web}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={`Published via ${name}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex items-center opacity-90 transition-opacity hover:opacity-100',
        className
      )}
    >
      <img src={picture} alt={name} className="h-3 w-auto" loading="lazy" />
    </a>
  )
}
