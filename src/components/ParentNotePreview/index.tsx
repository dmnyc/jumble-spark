import { Skeleton } from '@/components/ui/skeleton'
import { SEARCHABLE_RELAY_URLS } from '@/constants'
import { useFetchEvent } from '@/hooks'
import { cn } from '@/lib/utils'
import client from '@/services/client.service'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Event } from 'nostr-tools'
import ContentPreview from '../ContentPreview'
import UserAvatar from '../UserAvatar'
import logger from '@/lib/logger'

export default function ParentNotePreview({
  eventId,
  className,
  onClick
}: {
  eventId: string
  className?: string
  onClick?: React.MouseEventHandler<HTMLDivElement> | undefined
}) {
  const { t } = useTranslation()
  const { event, isFetching } = useFetchEvent(eventId)
  const [fallbackEvent, setFallbackEvent] = useState<Event | undefined>(undefined)
  const [isFetchingFallback, setIsFetchingFallback] = useState(false)
  /** One automatic searchable-relay attempt per eventId; without this, the effect re-fires forever after each 20s timeout. */
  const autoSearchableAttemptedRef = useRef(false)

  // Helper function to fetch from searchable relays (hex, note1, nevent1, naddr1)
  const fetchFromSearchableRelays = useCallback(async () => {
    if (!eventId?.trim()) return

    setIsFetchingFallback(true)
    try {
      const foundEvent = await client.fetchEventWithExternalRelays(eventId, SEARCHABLE_RELAY_URLS)
      if (foundEvent) {
        setFallbackEvent(foundEvent)
      }
    } catch (error) {
      logger.warn('Fallback fetch from searchable relays failed', error as Error)
    } finally {
      setIsFetchingFallback(false)
    }
  }, [eventId])

  useEffect(() => {
    autoSearchableAttemptedRef.current = false
  }, [eventId])

  // If the initial fetch fails, try searchable relays once (manual retry still works via onClick).
  useEffect(() => {
    if (
      !isFetching &&
      !event &&
      !fallbackEvent &&
      !isFetchingFallback &&
      eventId &&
      !autoSearchableAttemptedRef.current
    ) {
      autoSearchableAttemptedRef.current = true
      void fetchFromSearchableRelays()
    }
  }, [isFetching, event, eventId, fallbackEvent, isFetchingFallback, fetchFromSearchableRelays])

  const finalEvent = event || fallbackEvent
  const finalIsFetching = isFetching || isFetchingFallback

  if (finalIsFetching) {
    return (
      <div
        data-parent-note-preview
        className={cn(
          'flex gap-1 items-center text-sm rounded-full px-2 bg-muted w-44 max-w-full text-muted-foreground',
          className
        )}
      >
        <div className="shrink-0">{t('reply to')}</div>
        <Skeleton className="w-4 h-4 rounded-full" />
        <div className="py-1 flex-1">
          <Skeleton className="h-3" />
        </div>
      </div>
    )
  }

  // Handle click for retry when event not found
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (finalEvent) {
      onClick?.(e)
    } else if (!finalEvent && !finalIsFetching && eventId) {
      // Retry fetch from searchable relays when clicking "Note not found"
      e.stopPropagation()
      fetchFromSearchableRelays()
    }
  }

  return (
    <div
      data-parent-note-preview
      className={cn(
        'flex gap-1 items-center text-sm rounded-full px-2 bg-muted w-fit max-w-full text-muted-foreground',
        (finalEvent || (!finalEvent && !finalIsFetching)) && 'hover:text-foreground cursor-pointer',
        className
      )}
      onClick={handleClick}
    >
      <div className="shrink-0">{t('reply to')}</div>
      {finalEvent && <UserAvatar className="shrink-0" userId={finalEvent.pubkey} size="tiny" />}
      <div className="truncate flex-1 min-w-0">
        <ContentPreview className="pointer-events-none" event={finalEvent} />
      </div>
    </div>
  )
}
