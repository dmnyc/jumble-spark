import NormalFeed from '@/components/NormalFeed'
import { checkAlgoRelay } from '@/lib/relay'
import logger from '@/lib/logger'
import { useFeed } from '@/providers/FeedProvider'
import relayInfoService from '@/services/relay-info.service'
import React, { useEffect, useMemo, useState } from 'react'

export default function RelaysFeed({
  setSubHeader
}: {
  setSubHeader?: (node: React.ReactNode) => void
}) {
  logger.debug('RelaysFeed component rendering')
  const { feedInfo, relayUrls } = useFeed()
  const [isReady, setIsReady] = useState(false)
  const [areAlgoRelays, setAreAlgoRelays] = useState(false)

  // Debug logging
  logger.debug('RelaysFeed debug:', {
    feedInfo,
    relayUrls,
    isReady
  })

  useEffect(() => {
    const init = async () => {
      // If relayUrls is empty, we can't initialize the feed
      if (relayUrls.length === 0) {
        logger.debug('RelaysFeed: relayUrls is empty, not initializing')
        setIsReady(false)
        return
      }
      const relayInfos = await relayInfoService.getRelayInfos(relayUrls)
      setAreAlgoRelays(relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo)))
      setIsReady(true)
    }
    init()
  }, [relayUrls])

  // Memoize subRequests before any early returns to avoid Rules of Hooks violation
  const subRequests = useMemo(() => [{ urls: relayUrls, filter: {} }], [relayUrls])

  if (!isReady) {
    return null
  }

  if (feedInfo.feedType !== 'relay' && feedInfo.feedType !== 'relays' && feedInfo.feedType !== 'all-favorites') {
    return null
  }
  logger.component('RelaysFeed', 'Rendering NormalFeed', { 
    subRequests: subRequests.length, 
    relayUrls: relayUrls.length, 
    areAlgoRelays 
  })

  return (
    <NormalFeed
      subRequests={subRequests}
      areAlgoRelays={areAlgoRelays}
      isMainFeed
      showRelayCloseReason
      setSubHeader={setSubHeader}
    />
  )
}
