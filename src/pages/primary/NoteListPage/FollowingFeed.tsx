import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { augmentSubRequestsWithFavoritesFastReadAndInbox } from '@/lib/favorites-feed-relays'
import { buildFollowingFeedDeltaSubRequests } from '@/lib/following-feed-delta'
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
  const [deltaSubRequests, setDeltaSubRequests] = useState<TFeedSubRequest[]>([])

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

  const followingFeedSubscriptionKey = useMemo(
    () => (pubkey ? `home-following:${pubkey.toLowerCase()}` : undefined),
    [pubkey]
  )

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (feedInfo.feedType !== 'following' || !pubkey) {
        setSubRequests([])
        setDeltaSubRequests([])
        return
      }

      setDeltaSubRequests([])

      const augment = (raw: TFeedSubRequest[]) =>
        augmentSubRequestsWithFavoritesFastReadAndInbox(
          raw,
          favoriteRelays,
          blockedRelays,
          relayList?.read ?? [],
          { userWriteRelays: relayList?.write ?? [] }
        )

      const fromTags = followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
      const provisionalAuthors = [...new Set([pubkey, ...fromTags])]
      const provisionalAuthorLower = provisionalAuthors.map((p) => p.toLowerCase())

      let rawProv: TFeedSubRequest[] = []
      try {
        rawProv = await client.generateSubRequestsForPubkeys(provisionalAuthors, pubkey)
      } catch (error) {
        logger.warn('[FollowingFeed] provisional generateSubRequestsForPubkeys failed', { error })
      }
      const provAug = augment(rawProv)
      if (!cancelled) setSubRequests(provAug)

      let followings: string[] = fromTags
      try {
        followings = await client.fetchFollowings(pubkey)
      } catch (error) {
        followings = followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
        logger.warn('[FollowingFeed] fetchFollowings failed; using cached follow list fallback', {
          error,
          fallbackCount: followings.length
        })
      }

      const fullAuthors = [...new Set([pubkey, ...followings])]

      try {
        const rawFull = await client.generateSubRequestsForPubkeys(fullAuthors, pubkey)
        if (cancelled) return
        const fullAug = augment(rawFull)
        const delta = buildFollowingFeedDeltaSubRequests(fullAug, provAug, provisionalAuthorLower)
        if (!cancelled) {
          setDeltaSubRequests(delta)
          if (delta.length > 0) {
            logger.info('[FollowingFeed] delta wave subRequests', {
              deltaShardCount: delta.length,
              provisionalShardCount: provAug.length,
              fullShardCount: fullAug.length
            })
          }
        }
      } catch (error) {
        logger.error('[FollowingFeed] full generateSubRequestsForPubkeys failed', error)
        if (!cancelled) setDeltaSubRequests([])
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
      followingFeedDeltaSubRequests={deltaSubRequests}
      feedSubscriptionKey={followingFeedSubscriptionKey}
      preserveTimelineOnSubRequestsChange
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
