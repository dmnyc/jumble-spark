import { Skeleton } from '@/components/ui/skeleton'
import { useFetchRelayInfo } from '@/hooks'
import { toRelay } from '@/lib/link'
import { useSmartRelayNavigation } from '@/PageManager'
import relayInfoService from '@/services/relay-info.service'
import { TAwesomeRelayCollection } from '@/types'
import { useEffect, useState } from 'react'
import RelaySimpleInfo, { RelaySimpleInfoSkeleton } from '../RelaySimpleInfo'
import logger from '@/lib/logger'

export default function Explore() {
  const [collections, setCollections] = useState<TAwesomeRelayCollection[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    
    // Add timeout to prevent hanging forever
    timeoutId = setTimeout(() => {
      if (!cancelled) {
        logger.warn('[Explore] Timeout loading relay collections after 10 seconds')
        setError('Timeout loading relay collections')
        setCollections([]) // Set empty array to stop showing skeletons
      }
    }, 10000) // 10 second timeout
    
    logger.debug('[Explore] Fetching awesome relay collections')
    relayInfoService.getAwesomeRelayCollections()
      .then((data) => {
        if (!cancelled) {
          if (timeoutId) clearTimeout(timeoutId)
          logger.debug('[Explore] Loaded collections', { count: data?.length || 0 })
          setCollections(data || [])
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (timeoutId) clearTimeout(timeoutId)
          logger.error('[Explore] Error loading collections', { error: err })
          setError(err instanceof Error ? err.message : 'Failed to load relay collections')
          setCollections([]) // Set empty array to stop showing skeletons
        }
      })
    
    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  if (collections === null) {
    return (
      <div>
        <div className="p-4 max-md:border-b">
          <Skeleton className="h-6 w-20" />
        </div>
        <div className="grid md:px-4 md:grid-cols-2 md:gap-2">
          <RelaySimpleInfoSkeleton className="h-auto px-4 py-3 md:rounded-lg md:border" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-red-500 mb-2">Error: {error}</div>
        <button 
          onClick={() => {
            setCollections(null)
            setError(null)
            // Trigger reload
            relayInfoService.getAwesomeRelayCollections()
              .then(setCollections)
              .catch((err) => {
                setError(err instanceof Error ? err.message : 'Failed to load')
                setCollections([])
              })
          }}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    )
  }

  if (collections.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No relay collections available
      </div>
    )
  }

  return (
    <div className="min-w-0 w-full overflow-x-hidden space-y-6 pb-8">
      {collections.map((collection) => (
        <RelayCollection key={collection.id} collection={collection} />
      ))}
    </div>
  )
}

function RelayCollection({ collection }: { collection: TAwesomeRelayCollection }) {
  return (
    <div className="min-w-0">
      <div className="px-4 pt-3 pb-3.5 text-2xl font-semibold max-md:border-b min-w-0 break-words">
        {collection.name}
      </div>
      <div className="grid min-w-0 md:px-4 md:grid-cols-2 md:gap-3">
        {collection.relays.map((url) => (
          <RelayItem key={url} url={url} />
        ))}
      </div>
    </div>
  )
}

function RelayItem({ url }: { url: string }) {
  const { navigateToRelay } = useSmartRelayNavigation()
  const { relayInfo, isFetching } = useFetchRelayInfo(url)

  if (isFetching) {
    return <RelaySimpleInfoSkeleton className="h-auto px-4 py-3 border-b md:rounded-lg md:border" />
  }

  if (!relayInfo) {
    return null
  }

  return (
    <div className="min-w-0">
      <RelaySimpleInfo
        key={relayInfo.url}
        className="clickable h-auto px-4 py-3 border-b md:rounded-lg md:border min-w-0"
        relayInfo={relayInfo}
        onClick={(e) => {
          e.stopPropagation()
          navigateToRelay(toRelay(relayInfo.url))
        }}
      />
    </div>
  )
}
