import { toRelay } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { X } from 'lucide-react'
import { useState } from 'react'
import RelayIcon from '../RelayIcon'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import logger from '@/lib/logger'

export default function BlockedRelayItem({ relay }: { relay: string }) {
  const { push } = useSecondaryPage()
  const { deleteBlockedRelays } = useFavoriteRelays()
  const [isLoading, setIsLoading] = useState(false)

  const handleUnblock = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isLoading) return

    setIsLoading(true)
    try {
      await deleteBlockedRelays([relay])
    } catch (error) {
      logger.error('Failed to unblock relay', { error, relay })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="relative group clickable flex gap-2 border rounded-lg p-2 pr-2.5 items-center justify-between select-none"
      onClick={() => push(toRelay(relay))}
    >
      <div className="flex items-center gap-2 flex-1">
        <RelayIcon url={relay} />
        <div className="flex-1 w-0 truncate font-semibold">{relay}</div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleUnblock}
        disabled={isLoading}
        className="h-8 w-8 p-0"
      >
        {isLoading ? (
          <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />
        ) : (
          <X className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}

