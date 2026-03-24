import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { checkAlgoRelay } from '@/lib/relay'
import { normalizeUrl } from '@/lib/url'
import { useFeed } from '@/providers/FeedProvider'
import { useKindFilter } from '@/providers/KindFilterProvider'
import relayInfoService from '@/services/relay-info.service'
import { kinds } from 'nostr-tools'
import React, { forwardRef, useEffect, useMemo, useState } from 'react'

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

  const relayUrlsKey = useMemo(
    () =>
      [...relayUrls]
        .map((u) => normalizeUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('|'),
    [relayUrls]
  )

  useEffect(() => {
    if (relayUrls.length === 0) return
    let cancelled = false

    const init = async () => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('getRelayInfos timeout after 8 seconds'))
        }, 8000)
      })

      try {
        const relayInfos = await Promise.race([
          relayInfoService.getRelayInfos(relayUrls),
          timeoutPromise
        ])
        if (cancelled) return
        const areAlgo = relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo))
        setAreAlgoRelays(areAlgo)
      } catch (_error) {
        if (!cancelled) setAreAlgoRelays(false)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [relayUrlsKey, relayUrls.length])

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
