import { Skeleton } from '@/components/ui/skeleton'
import { useFetchProfile } from '@/hooks'
import { toProfile } from '@/lib/link'
import { formatPubkey, userIdToPubkey, pubkeyToNpub, formatNpub } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useSmartProfileNavigation } from '@/PageManager'
import { useMemo } from 'react'

export default function Username({
  userId,
  showAt = false,
  className,
  skeletonClassName,
  withoutSkeleton = false,
  style
}: {
  userId: string
  showAt?: boolean
  className?: string
  skeletonClassName?: string
  withoutSkeleton?: boolean
  style?: React.CSSProperties
}) {
  const { profile, isFetching } = useFetchProfile(userId)
  const { navigateToProfile } = useSmartProfileNavigation()
  
  // Get pubkey from userId (works even if profile isn't loaded)
  const pubkey = useMemo(() => {
    if (profile?.pubkey) return profile.pubkey
    return userIdToPubkey(userId) || ''
  }, [userId, profile?.pubkey])
  
  // Show skeleton while fetching (unless withoutSkeleton is true)
  if (isFetching && !withoutSkeleton) {
    return (
      <div className="py-1">
        <Skeleton className={cn('w-16', skeletonClassName)} />
      </div>
    )
  }

  // If we have a profile, show the username
  if (profile) {
    const { username, pubkey: profilePubkey } = profile
    return (
      <span 
        data-username
        className={cn('truncate hover:underline cursor-pointer', className)}
        style={{ verticalAlign: 'baseline', ...style }}
        onClick={(e) => {
          e.stopPropagation()
          navigateToProfile(toProfile(profilePubkey))
        }}
      >
        {showAt && '@'}
        {username}
      </span>
    )
  }

  // Fallback: show formatted npub (bech32) if we have a pubkey (even if profile fetch failed)
  if (pubkey) {
    // Convert to npub (bech32) format for display
    const npub = pubkeyToNpub(pubkey)
    const displayName = npub ? formatNpub(npub) : formatPubkey(pubkey)
    
    return (
      <span 
        data-username
        className={cn('truncate hover:underline cursor-pointer', className)}
        style={{ verticalAlign: 'baseline', ...style }}
        onClick={(e) => {
          e.stopPropagation()
          navigateToProfile(toProfile(pubkey))
        }}
      >
        {showAt && '@'}
        {displayName}
      </span>
    )
  }

  // No pubkey available - return null or skeleton based on withoutSkeleton
  if (!withoutSkeleton) {
    return (
      <div className="py-1">
        <Skeleton className={cn('w-16', skeletonClassName)} />
      </div>
    )
  }

  return null
}

export function SimpleUsername({
  userId,
  showAt = false,
  className,
  skeletonClassName,
  withoutSkeleton = false,
  style
}: {
  userId: string
  showAt?: boolean
  className?: string
  skeletonClassName?: string
  withoutSkeleton?: boolean
  style?: React.CSSProperties
}) {
  const { profile, isFetching } = useFetchProfile(userId)
  
  // Get pubkey from userId (works even if profile isn't loaded)
  const pubkey = useMemo(() => {
    if (profile?.pubkey) return profile.pubkey
    return userIdToPubkey(userId) || ''
  }, [userId, profile?.pubkey])
  
  // Show skeleton while fetching (unless withoutSkeleton is true)
  if (isFetching && !withoutSkeleton) {
    return (
      <div className="py-1">
        <Skeleton className={cn('w-16', skeletonClassName)} />
      </div>
    )
  }

  // If we have a profile, show the username
  if (profile) {
    const { username } = profile
    return (
      <span 
        className={cn('truncate', className)}
        style={{ verticalAlign: 'baseline', ...style }}
      >
        {showAt && '@'}
        {username}
      </span>
    )
  }

  // Fallback: show formatted npub (bech32) if we have a pubkey (even if profile fetch failed)
  if (pubkey) {
    // Convert to npub (bech32) format for display
    const npub = pubkeyToNpub(pubkey)
    const displayName = npub ? formatNpub(npub) : formatPubkey(pubkey)
    
    return (
      <span 
        className={cn('truncate', className)}
        style={{ verticalAlign: 'baseline', ...style }}
      >
        {showAt && '@'}
        {displayName}
      </span>
    )
  }

  // No pubkey available - return null or skeleton based on withoutSkeleton
  if (!withoutSkeleton) {
    return (
      <div className="py-1">
        <Skeleton className={cn('w-16', skeletonClassName)} />
      </div>
    )
  }

  return null
}