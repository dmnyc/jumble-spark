import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { generateImageByPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { UserRound } from 'lucide-react'
import { useMemo } from 'react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function AccountButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { pubkey, profile } = useNostr()
  const defaultAvatar = useMemo(
    () => (profile?.pubkey ? generateImageByPubkey(profile.pubkey) : ''),
    [profile]
  )
  const active = useMemo(() => current === 'profile' && display, [display, current])

  return (
    <BottomNavigationBarItem
      onClick={() => {
        navigate(pubkey ? 'profile' : 'me')
      }}
      active={active}
    >
      {pubkey ? (
        profile ? (
          <Avatar className={cn('w-7 h-7', active ? 'ring-primary ring-1' : '')}>
            <AvatarImage src={profile.avatar} className="object-cover object-center" />
            <AvatarFallback>
              <img src={defaultAvatar} />
            </AvatarFallback>
          </Avatar>
        ) : (
          <Skeleton className={cn('w-7 h-7 rounded-full', active ? 'ring-primary ring-1' : '')} />
        )
      ) : (
        <UserRound />
      )}
    </BottomNavigationBarItem>
  )
}
