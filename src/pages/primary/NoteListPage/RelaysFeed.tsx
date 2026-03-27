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
  const [relayAlgoReady, setRelayAlgoReady] = useState(false)

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
    if (relayUrls.length === 0) {
      setRelayAlgoReady(false)
      return
    }
    let cancelled = false
    setRelayAlgoReady(false)

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
      } finally {
        if (!cancelled) setRelayAlgoReady(true)
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

  /** One relay + user kind filter: avoid huge `kinds` REQ (many relays error with "too many kinds"). */
  const singleRelayKindlessExplore =
    feedInfo.feedType === 'relay' && relayUrls.length === 1 && !kindsOverride?.length

  const canRenderFeed =
    (feedInfo.feedType === 'relay' ||
      feedInfo.feedType === 'relays' ||
      feedInfo.feedType === 'all-favorites') &&
    relayUrls.length > 0

  /** Distinguishes home relay chips so we do not keep the previous timeline on single→all-favorites (strict superset). */
  const feedTimelineScopeKey = useMemo(() => {
    if (feedInfo.feedType === 'all-favorites') return 'all-favorites'
    if (feedInfo.feedType === 'relays') return `relays:${feedInfo.id ?? ''}`
    if (feedInfo.feedType === 'relay') {
      const id = feedInfo.id ? normalizeUrl(feedInfo.id) || feedInfo.id : ''
      return `relay:${id}`
    }
    return undefined
  }, [feedInfo.feedType, feedInfo.id])

  // Hooks must run every render — never place useMemo after conditional returns.
  const subRequests = useMemo(() => {
    if (!canRenderFeed) return []
    if (singleRelayKindlessExplore) {
      return [{ urls: relayUrls, filter: {} }]
    }
    return [
      {
        urls: relayUrls,
        filter: {
          kinds: defaultKinds
        }
      }
    ]
  }, [canRenderFeed, relayUrls, defaultKinds, kindsOverride, singleRelayKindlessExplore])

  if (!canRenderFeed) {
    return null
  }

  // preserveTimeline: merge when relay list grows (e.g. all-favorites list fills in). Do not use
  // mergeTimelineWhenSubRequestFiltersMatch here — same kinds + different URLs would keep the old
  // timeline when switching home feed chips (all-favorites ↔ set ↔ single relay).
  return (
    <NormalFeed
      ref={ref}
      subRequests={subRequests}
      areAlgoRelays={areAlgoRelays}
      relayCapabilityReady={relayAlgoReady}
      isMainFeed
      setSubHeader={setSubHeader}
      onSubHeaderRefresh={onSubHeaderRefresh}
      preserveTimelineOnSubRequestsChange
      feedTimelineScopeKey={feedTimelineScopeKey}
      useFilterAsIs={singleRelayKindlessExplore}
      allowKindlessRelayExplore={singleRelayKindlessExplore}
      clientSideKindFilter={singleRelayKindlessExplore}
      showFeedClientFilter
    />
  )
})

RelaysFeed.displayName = 'RelaysFeed'
export default RelaysFeed
