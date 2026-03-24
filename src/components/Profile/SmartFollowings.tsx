import { useFetchFollowings } from '@/hooks'
import { toFollowingList } from '@/lib/link'
import { useSmartFollowingListNavigation } from '@/PageManager'
import { useFollowListOptional } from '@/providers/FollowListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from 'react-i18next'

export default function SmartFollowings({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey } = useNostr()
  const followList = useFollowListOptional()
  const selfFollowings = followList?.followings ?? []
  const { followings, isFetching } = useFetchFollowings(pubkey)
  const { navigateToFollowingList } = useSmartFollowingListNavigation()

  const handleClick = () => {
    navigateToFollowingList(toFollowingList(pubkey))
  }

  return (
    <span
      className="flex gap-1 hover:underline w-fit items-center cursor-pointer"
      onClick={handleClick}
    >
      {accountPubkey === pubkey ? (
        selfFollowings.length
      ) : isFetching ? (
        <Skeleton className="inline-block size-4 shrink-0 rounded-sm" aria-hidden />
      ) : (
        followings.length
      )}
      <div className="text-muted-foreground">{t('Following')}</div>
    </span>
  )
}
