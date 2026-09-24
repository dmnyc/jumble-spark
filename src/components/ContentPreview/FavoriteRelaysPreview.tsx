import { getFavoriteRelayUrlsFromEvent } from '@/lib/event-metadata'
import { simplifyUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function FavoriteRelaysPreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const relayUrls = useMemo(() => getFavoriteRelayUrlsFromEvent(event), [event])

  return (
    <div className={cn('truncate', className)}>
      [{t('Favorite Relays')}]{' '}
      <span className="pe-0.5 italic">{relayUrls.map(simplifyUrl).join(', ')}</span>
    </div>
  )
}
