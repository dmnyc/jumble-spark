import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { augmentSubRequestsWithFavoritesFastReadAndInbox } from '@/lib/favorites-feed-relays'
import { normalizeUrl } from '@/lib/url'
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
  const { pubkey, relayList } = useNostr()
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
    async function init() {
      if (feedInfo.feedType !== 'following' || !pubkey) {
        setSubRequests([])
        return
      }

      const followings = await client.fetchFollowings(pubkey)
      const raw = await client.generateSubRequestsForPubkeys([pubkey, ...followings], pubkey)
      setSubRequests(
        augmentSubRequestsWithFavoritesFastReadAndInbox(
          raw,
          favoriteRelays,
          blockedRelays,
          relayList?.read ?? [],
          { userWriteRelays: relayList?.write ?? [] }
        )
      )
    }

    void init()
  }, [feedInfo.feedType, pubkey, favoriteRelaysKey, blockedRelaysKey, relayReadKey, relayWriteKey])

  return (
    <NormalFeed
      ref={ref}
      subRequests={subRequests}
      isMainFeed
      setSubHeader={setSubHeader}
      onSubHeaderRefresh={onSubHeaderRefresh}
      showFeedClientFilter={false}
    />
  )
})

FollowingFeed.displayName = 'FollowingFeed'
export default FollowingFeed
