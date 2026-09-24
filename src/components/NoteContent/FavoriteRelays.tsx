import { useFetchRelayInfo } from '@/hooks'
import { getFavoriteRelayUrlsFromEvent } from '@/lib/event-metadata'
import { toRelay } from '@/lib/link'
import { simplifyUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/PageManager'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'
import RelaySimpleInfo, { RelaySimpleInfoSkeleton } from '../RelaySimpleInfo'

export default function FavoriteRelays({
  event,
  className,
  embedded = false
}: {
  event: Event
  className?: string
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const relayUrls = useMemo(() => getFavoriteRelayUrlsFromEvent(event), [event])

  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-xl font-semibold">{t('Favorite Relays')}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t('n relays', { n: relayUrls.length })}
        </span>
      </div>
      <div
        className={cn(
          'grid md:mx-0 md:grid-cols-2 md:gap-2',
          // Bleed to the edge of the surrounding note card. Embedded note cards
          // have p-3 sm:p-4 padding, while feed/detail notes use px-4.
          embedded ? '-mx-3 sm:-mx-4' : '-mx-4'
        )}
      >
        {relayUrls.map((url) => (
          <RelayItem key={url} url={url} embedded={embedded} />
        ))}
      </div>
    </div>
  )
}

function RelayItem({ url, embedded }: { url: string; embedded: boolean }) {
  const { push } = useSecondaryPage()
  const { relayInfo, isFetching } = useFetchRelayInfo(url)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    push(toRelay(url))
  }

  const itemClassName = cn(
    'border-b py-3 max-md:last:border-b-0 max-md:last:pb-0 md:rounded-lg md:border md:p-3',
    embedded ? 'px-3 sm:px-4' : 'px-4'
  )

  if (isFetching) {
    return <RelaySimpleInfoSkeleton className={cn('h-auto', itemClassName)} />
  }

  if (!relayInfo) {
    return (
      <div
        role="button"
        className={cn('clickable flex items-center gap-2', itemClassName)}
        onClick={handleClick}
      >
        <RelayIcon url={url} />
        <div className="w-0 flex-1 truncate font-semibold">{simplifyUrl(url)}</div>
      </div>
    )
  }

  return (
    <RelaySimpleInfo
      className={cn('clickable h-auto', itemClassName)}
      relayInfo={relayInfo}
      onClick={handleClick}
    />
  )
}
