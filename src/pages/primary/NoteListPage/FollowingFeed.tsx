import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { useFeed } from '@/providers/FeedProvider'
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
  const { pubkey } = useNostr()
  const { feedInfo } = useFeed()
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])

  useEffect(() => {
    async function init() {
      if (feedInfo.feedType !== 'following' || !pubkey) {
        setSubRequests([])
        return
      }

      const followings = await client.fetchFollowings(pubkey)
      setSubRequests(await client.generateSubRequestsForPubkeys([pubkey, ...followings], pubkey))
    }

    init()
  }, [feedInfo.feedType, pubkey])

  return <NormalFeed ref={ref} subRequests={subRequests} isMainFeed setSubHeader={setSubHeader} />
})

FollowingFeed.displayName = 'FollowingFeed'
export default FollowingFeed
