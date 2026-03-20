import NormalFeed from '@/components/NormalFeed'
import { checkAlgoRelay } from '@/lib/relay'
import logger from '@/lib/logger'
import { useFeed } from '@/providers/FeedProvider'
import { useKindFilter } from '@/providers/KindFilterProvider'
import relayInfoService from '@/services/relay-info.service'
import { kinds } from 'nostr-tools'
import React, { useEffect, useMemo, useState, useRef } from 'react'

export default function RelaysFeed({
  setSubHeader
}: {
  setSubHeader?: (node: React.ReactNode) => void
}) {
  logger.debug('RelaysFeed component rendering')
  const { feedInfo, relayUrls } = useFeed()
  const { showKinds } = useKindFilter()
  const [areAlgoRelays, setAreAlgoRelays] = useState(false)
  const relayInfoFetchedRef = useRef(false)

  // Debug logging
  logger.debug('RelaysFeed debug:', {
    feedInfo,
    relayUrls: relayUrls.length,
    showKinds: showKinds.length
  })

  // Fetch relay info in background (non-blocking) - don't wait for it to render
  useEffect(() => {
    // Only fetch once per relayUrls change
    if (relayInfoFetchedRef.current || relayUrls.length === 0) {
      return
    }

    const init = async () => {
      relayInfoFetchedRef.current = true
      
      // Add aggressive timeout to prevent hanging (reduced from 5s to 2s)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('getRelayInfos timeout after 2 seconds'))
        }, 2000)
      })
      
      try {
        const relayInfos = await Promise.race([
          relayInfoService.getRelayInfos(relayUrls),
          timeoutPromise
        ])
        const areAlgo = relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo))
        setAreAlgoRelays(areAlgo)
        logger.debug('RelaysFeed: Relay info fetched successfully', {
          relayCount: relayUrls.length,
          areAlgoRelays: areAlgo
        })
      } catch (error) {
        logger.debug('RelaysFeed: Failed to get relay infos (non-blocking)', {
          error: error instanceof Error ? error.message : String(error),
          relayUrls: relayUrls.length
        })
        // Default to false - feed will work without this info
        setAreAlgoRelays(false)
      }
    }
    
    // Don't await - let it run in background
    init().catch((err) => {
      logger.debug('RelaysFeed: Unhandled error in init', { error: err })
      setAreAlgoRelays(false)
    })
  }, [relayUrls])

  // Reset fetch flag when relayUrls change
  useEffect(() => {
    relayInfoFetchedRef.current = false
  }, [relayUrls])

  // Early returns for invalid feed types
  if (feedInfo.feedType !== 'relay' && feedInfo.feedType !== 'relays' && feedInfo.feedType !== 'all-favorites') {
    return null
  }

  // CRITICAL: Don't render feed if relayUrls is empty - this would cause subscription to fail
  if (relayUrls.length === 0) {
    logger.debug('RelaysFeed: relayUrls is empty, not rendering feed')
    return null
  }

  // CRITICAL: Provide proper filter with default kinds - NoteList requires kinds in filter
  // Use showKinds from KindFilterProvider if available, otherwise default to kind 1
  const defaultKinds = showKinds.length > 0 ? showKinds : [kinds.ShortTextNote]
  
  // Memoize subRequests with proper filter - this ensures NoteList gets valid filter
  const subRequests = useMemo(() => {
    return [{
      urls: relayUrls,
      filter: {
        kinds: defaultKinds
      }
    }]
  }, [relayUrls, defaultKinds])

  logger.component('RelaysFeed', 'Rendering NormalFeed', { 
    subRequests: subRequests.length, 
    relayUrls: relayUrls.length, 
    areAlgoRelays,
    filterKinds: subRequests[0]?.filter?.kinds?.length || 0
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
