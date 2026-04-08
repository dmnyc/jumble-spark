import { useSmartNoteNavigation, useSmartRelayNavigation } from '@/PageManager'
import { getRelayUrlFromRelayReviewEvent, getStarsFromRelayReviewEvent } from '@/lib/event-metadata'
import { toNote, toRelay } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useFetchRelayInfo } from '@/hooks'
import client from '@/services/client.service'
import { NostrEvent } from 'nostr-tools'
import { useMemo } from 'react'
import ClientTag from '../ClientTag'
import ContentPreview from '../ContentPreview'
import { FormattedTimestamp } from '../FormattedTimestamp'
import Nip05 from '../Nip05'
import RelayIcon from '../RelayIcon'
import Stars from '../Stars'
import { SimpleUserAvatar } from '../UserAvatar'
import { SimpleUsername } from '../Username'

export default function RelayReviewCard({
  event,
  className,
  showRelayInfo = true
}: {
  event: NostrEvent
  className?: string
  showRelayInfo?: boolean
}) {
  const { navigateToNote } = useSmartNoteNavigation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const stars = useMemo(() => getStarsFromRelayReviewEvent(event), [event])
  const relayUrl = useMemo(() => getRelayUrlFromRelayReviewEvent(event), [event])
  const { relayInfo } = useFetchRelayInfo(relayUrl)

  return (
    <div
      className={cn('clickable border rounded-lg bg-muted/20 p-3 h-full', className)}
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('[role="button"]') || target.closest('a') || target.closest('[data-embedded-note]') || target.closest('[data-parent-note-preview]')) {
          return
        }
        client.addEventToCache(event)
        navigateToNote(toNote(event), event)
      }}
    >
      {showRelayInfo && relayUrl && (
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-left hover:bg-muted/60 mb-2"
          onClick={(e) => {
            e.stopPropagation()
            navigateToRelay(toRelay(relayUrl))
          }}
        >
          <RelayIcon url={relayUrl} className="h-6 w-6 shrink-0" iconSize={12} />
          <div className="min-w-0 flex-1">
            {relayInfo?.name && (
              <div className="truncate text-xs font-semibold leading-tight">{relayInfo.name}</div>
            )}
            <div className="truncate font-mono text-xs text-muted-foreground leading-tight">{relayUrl}</div>
          </div>
        </button>
      )}
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center space-x-2 flex-1">
          <SimpleUserAvatar userId={event.pubkey} size="medium" />
          <div className="flex-1 w-0">
            <div className="flex gap-2 items-center">
              <SimpleUsername
                userId={event.pubkey}
                className="font-semibold flex truncate text-sm"
                skeletonClassName="h-3"
              />
              <ClientTag event={event} />
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Nip05 pubkey={event.pubkey} append="·" />
              <FormattedTimestamp timestamp={event.created_at} className="shrink-0" short />
            </div>
          </div>
        </div>
        <Stars stars={stars} className="gap-0.5 [&_svg]:size-3 shrink-0 mt-0.5" />
      </div>
      <ContentPreview className="mt-2 line-clamp-4" event={event} />
    </div>
  )
}
