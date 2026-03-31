import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { augmentSubRequestsWithFavoritesFastReadAndInbox } from '@/lib/favorites-feed-relays'
import { getPubkeysFromPTags } from '@/lib/tag'
import { normalizeUrl } from '@/lib/url'
import logger from '@/lib/logger'
import { useFeed } from '@/providers/FeedProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { TFeedSubRequest } from '@/types'
import type { ReactNode } from 'react'
import { forwardRef, useEffect, useMemo, useState } from 'react'

const FollowingFeed = forwardRef<
  TNoteListRef,
  {
    setSubHeader?: (node: ReactNode) => void
    onSubHeaderRefresh?: () => void
  }
>(function FollowingFeed({ setSubHeader, onSubHeaderRefresh }, ref) {
  const { pubkey, relayList, followListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { feedInfo } = useFeed()
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])

  const favoriteRelaysKey = useMemo(
    () =>
      [...favoriteRelays]
        .map((u) => normalizeUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('\0'),
    [favoriteRelays]
  )
  const blockedRelaysKey = useMemo(
    () =>
      [...blockedRelays]
        .map((u) => normalizeUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('\0'),
    [blockedRelays]
  )
  const relayReadKey = useMemo(
    () =>
      [...(relayList?.read ?? [])]
        .map((u) => normalizeUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('\0'),
    [relayList?.read]
  )
  const relayWriteKey = useMemo(
    () =>
      [...(relayList?.write ?? [])]
        .map((u) => normalizeUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('\0'),
    [relayList?.write]
  )

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (feedInfo.feedType !== 'following' || !pubkey) {
        setSubRequests([])
        return
      }

      let followings: string[] = []
      try {
        followings = await client.fetchFollowings(pubkey)
      } catch (error) {
        // Failsafe: keep follows feed usable when contacts fetch relay calls fail transiently.
        followings = followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
        logger.warn('[FollowingFeed] fetchFollowings failed; using cached follow list fallback', {
          error,
          fallbackCount: followings.length
        })
      }

      try {
        const raw = await client.generateSubRequestsForPubkeys([pubkey, ...followings], pubkey)
        const augmented = augmentSubRequestsWithFavoritesFastReadAndInbox(
          raw,
          favoriteRelays,
          blockedRelays,
          relayList?.read ?? [],
          { userWriteRelays: relayList?.write ?? [] }
        )
        if (!cancelled) setSubRequests(augmented)
      } catch (error) {
        logger.error('[FollowingFeed] generateSubRequestsForPubkeys failed', error)
        if (!cancelled) setSubRequests([])
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [
    feedInfo.feedType,
    pubkey,
    followListEvent?.id,
    favoriteRelaysKey,
    blockedRelaysKey,
    relayReadKey,
    relayWriteKey
  ])

  return (
    <NormalFeed
      ref={ref}
      subRequests={subRequests}
      isMainFeed
      setSubHeader={setSubHeader}
      onSubHeaderRefresh={onSubHeaderRefresh}
      showFeedClientFilter={false}
      hostPrimaryPageName="feed"
    />
  )
})

FollowingFeed.displayName = 'FollowingFeed'
export default FollowingFeed
