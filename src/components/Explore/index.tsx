import { Skeleton } from '@/components/ui/skeleton'
import { useFetchRelayInfo } from '@/hooks'
import { toRelay } from '@/lib/link'
import { useSmartRelayNavigation } from '@/PageManager'
import relayInfoService from '@/services/relay-info.service'
import { TAwesomeRelayCollection } from '@/types'
import { useEffect, useState } from 'react'
import RelaySimpleInfo, { RelaySimpleInfoSkeleton } from '../RelaySimpleInfo'

export default function Explore() {
  const [collections, setCollections] = useState<TAwesomeRelayCollection[] | null>(null)

  useEffect(() => {
    relayInfoService.getAwesomeRelayCollections().then(setCollections)
  }, [])

  if (!collections) {
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
