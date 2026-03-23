import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { checkAlgoRelay } from '@/lib/relay'
import { useFeed } from '@/providers/FeedProvider'
import { useKindFilter } from '@/providers/KindFilterProvider'
import relayInfoService from '@/services/relay-info.service'
import { kinds } from 'nostr-tools'
import React, { forwardRef, useEffect, useMemo, useState, useRef } from 'react'

const RelaysFeed = forwardRef<
  TNoteListRef,
  {
    setSubHeader?: (node: React.ReactNode) => void
    onSubHeaderRefresh?: () => void
    /** When set, subscription kinds (fixed list); otherwise uses KindFilterProvider. */
    kindsOverride?: number[]
  }
>(function RelaysFeed({ setSubHeader, onSubHeaderRefresh, kindsOverride }, ref) {
  const { feedInfo, relayUrls } = useFeed()
  const { showKinds } = useKindFilter()
  const [areAlgoRelays, setAreAlgoRelays] = useState(false)
  const relayInfoFetchedRef = useRef(false)

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
      } catch (_error) {
        // Default to false - feed will work without this info
        setAreAlgoRelays(false)
      }
    }
    
    // Don't await - let it run in background
    init().catch(() => {
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
    return null
  }

  return (
    <NormalFeed
      ref={ref}
      subRequests={subRequests}
      areAlgoRelays={areAlgoRelays}
      isMainFeed
      setSubHeader={setSubHeader}
      onSubHeaderRefresh={onSubHeaderRefresh}
    />
  )
})

RelaysFeed.displayName = 'RelaysFeed'
export default RelaysFeed
