import { cn } from '@/lib/utils'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import noteStatsService from '@/services/note-stats.service'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'
import VoteButtons from './VoteButtons'

export default function DiscussionNoteStats({
  event,
  className,
  classNames,
  fetchIfNotExisting = false
}: {
  event: Event
  className?: string
  classNames?: {
    buttonBar?: string
  }
  fetchIfNotExisting?: boolean
}) {
  const { isSmallScreen } = useScreenSize()
  const { pubkey } = useNostr()
  const { relays: statsRelays, key: statsRelaysKey } = useNoteStatsRelayHints()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!fetchIfNotExisting) return
    setLoading(true)
    noteStatsService.fetchNoteStats(event, pubkey, statsRelays).finally(() => setLoading(false))
  }, [event.id, event.kind, event.created_at, event.sig, fetchIfNotExisting, pubkey, statsRelaysKey])

  if (isSmallScreen) {
    return (
      <div className={cn('select-none', className)}>
        <div
          className={cn(
            'flex justify-between items-center h-5 [&_svg]:size-5',
            loading ? 'animate-pulse' : '',
            classNames?.buttonBar
          )}
        >
          <VoteButtons event={event} />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('select-none', className)}>
      <div className="flex justify-between h-5 [&_svg]:size-4">
        <div
          className={cn('flex items-center gap-2', loading ? 'animate-pulse' : '')}
        >
        </div>
        <div className="flex items-center gap-2">
          <VoteButtons event={event} />
        </div>
      </div>
    </div>
  )
}
