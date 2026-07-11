import UserItem from '@/components/UserItem'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useFollowList } from '@/providers/FollowListProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const RECOMMEND_COUNT = 5

export default function RecommendedFollows() {
  const { t } = useTranslation()
  const { pubkey: currentPubkey } = useNostr()
  const { followingSet } = useFollowList()
  const { pickRecommendedPubkeys } = useUserTrust()
  const [pubkeys, setPubkeys] = useState<string[]>([])
  const [shuffleCount, setShuffleCount] = useState(0)

  const followingSetRef = useRef(followingSet)
  followingSetRef.current = followingSet

  // Reset on account change
  useEffect(() => {
    setPubkeys([])
    setShuffleCount(0)
  }, [currentPubkey])

  // First sample: keep trying as WoT data trickles in, then lock on first hit
  useEffect(() => {
    if (!currentPubkey) return
    const exclude = new Set(followingSetRef.current)
    exclude.add(currentPubkey)
    const next = pickRecommendedPubkeys(RECOMMEND_COUNT, exclude)
    if (next.length > 0) {
      setPubkeys(next)
    }
  }, [currentPubkey, pickRecommendedPubkeys])

  // Manual shuffle (user-driven only)
  useEffect(() => {
    if (shuffleCount === 0 || !currentPubkey) return
    const exclude = new Set(followingSetRef.current)
    exclude.add(currentPubkey)
    setPubkeys(pickRecommendedPubkeys(RECOMMEND_COUNT, exclude))
  }, [shuffleCount])

  if (!currentPubkey || pubkeys.length === 0) return null

  return (
    <div className="border-b px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{t('Followed by your follows')}</div>
        <button
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-sm"
          onClick={() => setShuffleCount((c) => c + 1)}
        >
          <RefreshCw
            key={shuffleCount}
            className={cn('size-4', shuffleCount > 0 && 'animate-[spin_0.5s_linear_1]')}
          />
          {t('Shuffle')}
        </button>
      </div>
      {pubkeys.map((pk) => (
        <UserItem key={pk} userId={pk} />
      ))}
    </div>
  )
}
