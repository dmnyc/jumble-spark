import { Skeleton } from '@/components/ui/skeleton'
import { useFetchProfile } from '@/hooks'
import { generateImageByPubkey, userIdToPubkey } from '@/lib/pubkey'
import { toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSmartProfileNavigationOptional } from '@/PageManager'
import { useMemo, useState, useEffect, useRef, type RefObject } from 'react'

/** Only defer network fetches for typical profile picture URLs (not data:, blob:, etc.). */
function isHttpOrHttpsUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

/**
 * Defer loading remote profile pictures until the avatar is near the viewport so handles/text
 * can paint first; identicon (data URL) shows until then.
 */
function useDeferRemoteProfileAvatar(
  profileAvatar: string | undefined,
  fallbackSrc: string,
  containerRef: RefObject<HTMLDivElement | null>
): string {
  const remoteHttp = useMemo(() => {
    const a = profileAvatar?.trim()
    if (!a || !isHttpOrHttpsUrl(a)) return ''
    return a
  }, [profileAvatar])

  const nonHttpAvatar = useMemo(() => {
    const a = profileAvatar?.trim()
    if (a && !isHttpOrHttpsUrl(a)) return a
    return ''
  }, [profileAvatar])

  const [allowRemote, setAllowRemote] = useState(() => remoteHttp === '')

  useEffect(() => {
    setAllowRemote(remoteHttp === '')
  }, [remoteHttp])

  useEffect(() => {
    if (!remoteHttp || allowRemote) return
    if (typeof IntersectionObserver === 'undefined') {
      setAllowRemote(true)
      return
    }
    const el = containerRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setAllowRemote(true)
        }
      },
      { root: null, rootMargin: '200px', threshold: 0.01 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [remoteHttp, allowRemote, containerRef])

  return nonHttpAvatar || (remoteHttp && allowRemote ? remoteHttp : '') || fallbackSrc
}

const UserAvatarSizeCnMap = {
  large: 'w-24 h-24',
  big: 'w-16 h-16',
  semiBig: 'w-12 h-12',
  normal: 'w-10 h-10',
  medium: 'w-9 h-9',
  small: 'w-7 h-7',
  xSmall: 'w-5 h-5',
  tiny: 'w-4 h-4'
}

export default function UserAvatar({
  userId,
  className,
  size = 'normal'
}: {
  userId: string
  className?: string
  size?: 'large' | 'big' | 'semiBig' | 'normal' | 'medium' | 'small' | 'xSmall' | 'tiny'
}) {
  const { profile } = useFetchProfile(userId)
  const { navigateToProfile } = useSmartProfileNavigationOptional()
  
  // Extract pubkey from userId if it's npub/nprofile format
  const pubkey = useMemo(() => {
    if (!userId) return ''
    const decodedPubkey = userIdToPubkey(userId)
    return decodedPubkey || profile?.pubkey || ''
  }, [userId, profile?.pubkey])
  
  const defaultAvatar = useMemo(
    () => (pubkey ? generateImageByPubkey(pubkey) : ''),
    [pubkey]
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const avatarSrc = useDeferRemoteProfileAvatar(profile?.avatar, defaultAvatar, containerRef)

  // All hooks must be called before any early returns
  const [imgError, setImgError] = useState(false)
  const [currentSrc, setCurrentSrc] = useState(avatarSrc)

  // Reset error state when src changes
  useEffect(() => {
    setImgError(false)
    setCurrentSrc(avatarSrc)
  }, [avatarSrc])

  const handleImageError = () => {
    if (profile?.avatar && defaultAvatar && currentSrc !== defaultAvatar) {
      setCurrentSrc(defaultAvatar)
      setImgError(false)
    } else {
      setImgError(true)
    }
  }

  const handleImageLoad = () => {
    setImgError(false)
  }

  // Use pubkey from decoded userId if profile isn't loaded yet
  const displayPubkey = profile?.pubkey || pubkey || ''

  // If we have a pubkey (from decoding npub/nprofile or profile), show avatar even without profile
  // Otherwise show skeleton while loading
  if (!profile && !pubkey) {
    return (
      <Skeleton className={cn('shrink-0', UserAvatarSizeCnMap[size], 'rounded-full', className)} />
    )
  }

  // Render image directly instead of using Radix UI Avatar for better reliability
  return (
    <div 
      ref={containerRef}
      data-user-avatar
      className={cn('shrink-0 cursor-pointer block overflow-hidden rounded-full bg-muted', UserAvatarSizeCnMap[size], className)}
      style={{ position: 'relative', zIndex: 10, isolation: 'isolate', display: 'block' }}
      onClick={(e) => {
        e.stopPropagation()
        navigateToProfile(toProfile(displayPubkey))
      }}
    >
      {!imgError && currentSrc ? (
        <img 
          src={currentSrc}
          alt=""
          className="block w-full h-full object-cover object-center"
          style={{ display: 'block', position: 'static', margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}
          onError={handleImageError}
          onLoad={handleImageLoad}
          loading="lazy"
          decoding="async"
        />
      ) : (
        // Show initials or placeholder when image fails
        <div className="h-full w-full flex items-center justify-center text-xs font-medium text-muted-foreground">
          {displayPubkey ? displayPubkey.slice(0, 2).toUpperCase() : ''}
        </div>
      )}
    </div>
  )
}

export function SimpleUserAvatar({
  userId,
  size = 'normal',
  className
}: {
  userId: string
  size?: 'large' | 'big' | 'semiBig' | 'normal' | 'medium' | 'small' | 'xSmall' | 'tiny'
  className?: string
}) {
  const { profile } = useFetchProfile(userId)
  // Always generate default avatar from userId/pubkey, even if profile isn't loaded yet
  const pubkey = useMemo(() => {
    if (!userId) return ''
    const decodedPubkey = userIdToPubkey(userId)
    return decodedPubkey || profile?.pubkey || ''
  }, [userId, profile?.pubkey])
  
  const defaultAvatar = useMemo(
    () => (pubkey ? generateImageByPubkey(pubkey) : ''),
    [pubkey]
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const avatarSrc = useDeferRemoteProfileAvatar(profile?.avatar, defaultAvatar, containerRef)
  
  // All hooks must be called before any early returns
  const [imgError, setImgError] = useState(false)
  const [currentSrc, setCurrentSrc] = useState(avatarSrc)

  // Reset error state when src changes
  useEffect(() => {
    setImgError(false)
    setCurrentSrc(avatarSrc)
  }, [avatarSrc])

  const handleImageError = () => {
    if (profile?.avatar && defaultAvatar && currentSrc !== defaultAvatar) {
      setCurrentSrc(defaultAvatar)
      setImgError(false)
    } else {
      setImgError(true)
    }
  }

  const handleImageLoad = () => {
    setImgError(false)
  }

  // If we have a pubkey (from decoding npub/nprofile or profile), show avatar even without profile
  // Otherwise show skeleton while loading
  if (!profile && !pubkey) {
    return (
      <Skeleton className={cn('shrink-0', UserAvatarSizeCnMap[size], 'rounded-full', className)} />
    )
  }

  // Use pubkey from decoded userId if profile isn't loaded yet
  const displayPubkey = profile?.pubkey || pubkey || ''
  
  // Render image directly instead of using Radix UI Avatar for better reliability
  return (
    <div 
      ref={containerRef}
      className={cn('shrink-0 relative overflow-hidden rounded-full bg-muted', UserAvatarSizeCnMap[size], className)}
    >
      {!imgError && currentSrc ? (
        <img 
          src={currentSrc}
          alt=""
          className="block w-full h-full object-cover object-center"
          style={{ display: 'block', position: 'static', margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}
          onError={handleImageError}
          onLoad={handleImageLoad}
          loading="lazy"
          decoding="async"
        />
      ) : (
        // Show initials or placeholder when image fails
        <div className="h-full w-full flex items-center justify-center text-xs font-medium text-muted-foreground">
          {displayPubkey ? displayPubkey.slice(0, 2).toUpperCase() : ''}
        </div>
      )}
    </div>
  )
}