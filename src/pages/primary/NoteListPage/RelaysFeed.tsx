import NormalFeed from '@/components/NormalFeed'
import { checkAlgoRelay } from '@/lib/relay'
import logger from '@/lib/logger'
import { useFeed } from '@/providers/FeedProvider'
import { useKindFilter } from '@/providers/KindFilterProvider'
import relayInfoService from '@/services/relay-info.service'
import { kinds } from 'nostr-tools'
import React, { useEffect, useMemo, useState, useRef } from 'react'

export default function RelaysFeed({
  setSubHeader,
  kindsOverride
}: {
  setSubHeader?: (node: React.ReactNode) => void
  /** When set, subscription kinds (fixed list); otherwise uses KindFilterProvider. */
  kindsOverride?: number[]
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

  const defaultKinds =
    kindsOverride && kindsOverride.length > 0
      ? kindsOverride
      : showKinds.length > 0
        ? showKinds
        : [kinds.ShortTextNote]

  const canRenderFeed =
    (feedInfo.feedType === 'relay' ||
      feedInfo.feedType === 'relays' ||
      feedInfo.feedType === 'all-favorites') &&
    relayUrls.length > 0

  // Hooks must run every render — never place useMemo after conditional returns.
  const subRequests = useMemo(() => {
    if (!canRenderFeed) return []
    return [
      {
        urls: relayUrls,
        filter: {
          kinds: defaultKinds
        }
      }
    ]
  }, [canRenderFeed, relayUrls, defaultKinds, kindsOverride])

  if (!canRenderFeed) {
    if (relayUrls.length === 0) {
      logger.debug('RelaysFeed: relayUrls is empty, not rendering feed')
    }
    return null
  }

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
