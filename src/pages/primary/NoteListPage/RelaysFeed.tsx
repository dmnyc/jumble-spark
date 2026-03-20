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
      
      // Add timeout to prevent hanging if getRelayInfos is slow
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('getRelayInfos timeout after 5 seconds'))
        }, 5000)
      })
      
      try {
        const relayInfos = await Promise.race([
          relayInfoService.getRelayInfos(relayUrls),
          timeoutPromise
        ])
        setAreAlgoRelays(relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo)))
        setIsReady(true)
        logger.debug('RelaysFeed: Initialized successfully', {
          relayCount: relayUrls.length,
          areAlgoRelays: relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo))
        })
      } catch (error) {
        logger.warn('RelaysFeed: Failed to get relay infos, proceeding anyway', {
          error: error instanceof Error ? error.message : String(error),
          relayUrls
        })
        // Proceed anyway - we can still show the feed even without relay info
        setAreAlgoRelays(false)
        setIsReady(true)
      }
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
