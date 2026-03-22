import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { augmentSubRequestsWithFavoritesFastReadAndInbox } from '@/lib/favorites-feed-relays'
import { useFeed } from '@/providers/FeedProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { TFeedSubRequest } from '@/types'
import type { ReactNode } from 'react'
import { forwardRef, useEffect, useState } from 'react'

const FollowingFeed = forwardRef<
  TNoteListRef,
  {
    setSubHeader?: (node: ReactNode) => void
  }
>(function FollowingFeed({ setSubHeader }, ref) {
  const { pubkey, relayList } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { feedInfo } = useFeed()
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])

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
          relayList?.read ?? []
        )
      )
    }

    void init()
  }, [feedInfo.feedType, pubkey, favoriteRelays, blockedRelays, relayList])

  return <NormalFeed ref={ref} subRequests={subRequests} isMainFeed setSubHeader={setSubHeader} />
})

FollowingFeed.displayName = 'FollowingFeed'
export default FollowingFeed
