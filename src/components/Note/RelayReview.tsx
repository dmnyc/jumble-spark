import { getRelayUrlFromRelayReviewEvent, getStarsFromRelayReviewEvent } from '@/lib/event-metadata'
import { toRelay } from '@/lib/link'
import { simplifyUrl } from '@/lib/url'
import { useSmartRelayNavigationOptional } from '@/PageManager'
import { Link2 } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import Content from '../Content'
import Stars from '../Stars'

export default function RelayReview({ event, className }: { event: Event; className?: string }) {
  const { navigateToRelay } = useSmartRelayNavigationOptional()
  const stars = useMemo(() => getStarsFromRelayReviewEvent(event), [event])
  const relayUrl = useMemo(() => getRelayUrlFromRelayReviewEvent(event), [event])

  return (
    <div className={className}>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Stars stars={stars} className="gap-0.5 [&_svg]:size-4 shrink-0" />
        {relayUrl ? (
          <button
            type="button"
            className="flex min-w-0 max-w-full items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              navigateToRelay(toRelay(relayUrl))
            }}
          >
            <Link2 className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate font-mono">{simplifyUrl(relayUrl)}</span>
          </button>
        ) : null}
      </div>
      <Content event={event} className="mt-2" />
    </div>
  )
}
