import { Skeleton } from '@/components/ui/skeleton'
import { useFetchProfile } from '@/hooks'
import { toNostrBuildThumbUrl } from '@/lib/nostr-build'
import { generateImageByPubkey, userIdToPubkey } from '@/lib/pubkey'
import { toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSmartProfileNavigationOptional } from '@/PageManager'
import type { TProfile } from '@/types'
import { useMemo, useState, useEffect, useRef, type RefObject } from 'react'

/** Only defer network fetches for typical profile picture URLs (not data:, blob:, etc.). */
function isHttpOrHttpsUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

/** Module-level cache: URL → file size in bytes, or null if unknown (CORS blocked / no header). */
const urlSizeCache = new Map<string, number | null>()

/**
 * URLs that have fired onLoad successfully this session.
 * When a URL is here the image is already in the browser's HTTP cache, so we can
 * skip both the IntersectionObserver delay and the HEAD-request size check.
 */
const loadedAvatarUrls = new Set<string>()

/**
 * Non-blocking HEAD request to get Content-Length for a URL.
 * Result is cached permanently in memory. Resolves null on CORS failure or missing header.
 */
async function fetchUrlSizeBytes(url: string): Promise<number | null> {
  if (urlSizeCache.has(url)) return urlSizeCache.get(url)!
  try {
    const res = await fetch(url, { method: 'HEAD' })
    const cl = res.headers.get('content-length')
    const size = cl ? parseInt(cl, 10) : null
    urlSizeCache.set(url, size)
    return size
  } catch {
    urlSizeCache.set(url, null)
    return null
  }
}

/**
 * Defer loading remote profile pictures until the avatar is near the viewport so handles/text
 * can paint first; identicon (data URL) shows until then.
 * Also enforces an optional maxFileSizeBytes cap — shows fallback for avatars that are confirmed
 * larger than the cap (based on a cached HEAD request).
 */
function useDeferRemoteProfileAvatar(
  profileAvatar: string | undefined,
  fallbackSrc: string,
  containerRef: RefObject<HTMLDivElement | null>,
  maxFileSizeBytes?: number
): string {
  const remoteHttp = useMemo(() => {
    const a = profileAvatar?.trim()
    if (!a || !isHttpOrHttpsUrl(a)) return ''
    // Always use the nostr.build thumbnail route for profile pictures — it's
    // typically < 50 KB regardless of the original file size.
    return toNostrBuildThumbUrl(a)
  }, [profileAvatar])

  // If this URL loaded successfully earlier this session it's already in the browser's
  // HTTP cache — skip both the viewport delay and the size check.
  const alreadyCached = remoteHttp ? loadedAvatarUrls.has(remoteHttp) : false

  const [sizeBlocked, setSizeBlocked] = useState(false)

  useEffect(() => {
    if (!remoteHttp || !maxFileSizeBytes || alreadyCached) {
      setSizeBlocked(false)
      return
    }
    if (urlSizeCache.has(remoteHttp)) {
      const cached = urlSizeCache.get(remoteHttp)
      setSizeBlocked(cached != null && cached > maxFileSizeBytes)
      return
    }
    fetchUrlSizeBytes(remoteHttp).then((size) => {
      setSizeBlocked(size != null && size > maxFileSizeBytes)
    })
  }, [remoteHttp, maxFileSizeBytes, alreadyCached])

  const nonHttpAvatar = useMemo(() => {
    const a = profileAvatar?.trim()
    if (a && !isHttpOrHttpsUrl(a)) return a
    return ''
  }, [profileAvatar])

  // Already cached → show immediately without waiting for IntersectionObserver.
  const [allowRemote, setAllowRemote] = useState(() => remoteHttp === '' || alreadyCached)

  useEffect(() => {
    setAllowRemote(remoteHttp === '' || alreadyCached)
  }, [remoteHttp, alreadyCached])

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

  if (sizeBlocked) return fallbackSrc
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
  size = 'normal',
  prefetchedProfile,
  maxFileSizeKb = 2048
}: {
  userId: string
  className?: string
  size?: 'large' | 'big' | 'semiBig' | 'normal' | 'medium' | 'small' | 'xSmall' | 'tiny'
  /** Same pubkey as userId; use avatar from search/cache until fetch completes. */
  prefetchedProfile?: TProfile
  /**
   * Skip avatar images larger than this (KB) — uses the generated placeholder instead.
   * Non-nostr.build sizes are checked via a cached HEAD request; unknown sizes are shown.
   * Defaults to 2048 (2 MB). Pass a lower value (e.g. 500) for dense feed contexts.
   */
  maxFileSizeKb?: number
}) {
  const { profile: fetchedProfile } = useFetchProfile(userId)
  const profile = useMemo(() => {
    const idPk = userId ? userIdToPubkey(userId) : ''
    if (prefetchedProfile && idPk && prefetchedProfile.pubkey === idPk) {
      return fetchedProfile ?? prefetchedProfile
    }
    return fetchedProfile
  }, [userId, prefetchedProfile, fetchedProfile])
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

  // Seed the size cache from imeta data on the profile event — avoids a HEAD request
  // when the kind-0 event already carries the file size.
  useMemo(() => {
    if (profile?.avatar && profile.pictureSize != null) {
      const thumbUrl = toNostrBuildThumbUrl(profile.avatar)
      if (!urlSizeCache.has(thumbUrl)) {
        urlSizeCache.set(thumbUrl, profile.pictureSize)
      }
    }
  }, [profile?.avatar, profile?.pictureSize])

  const avatarSrc = useDeferRemoteProfileAvatar(
    profile?.avatar,
    defaultAvatar,
    containerRef,
    maxFileSizeKb != null ? maxFileSizeKb * 1024 : undefined
  )

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
    if (currentSrc && isHttpOrHttpsUrl(currentSrc)) loadedAvatarUrls.add(currentSrc)
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
  className,
  prefetchedProfile,
  maxFileSizeKb = 2048
}: {
  userId: string
  size?: 'large' | 'big' | 'semiBig' | 'normal' | 'medium' | 'small' | 'xSmall' | 'tiny'
  className?: string
  prefetchedProfile?: TProfile
  maxFileSizeKb?: number
}) {
  const { profile: fetchedProfile } = useFetchProfile(userId)
  const profile = useMemo(() => {
    const idPk = userId ? userIdToPubkey(userId) : ''
    if (prefetchedProfile && idPk && prefetchedProfile.pubkey === idPk) {
      return fetchedProfile ?? prefetchedProfile
    }
    return fetchedProfile
  }, [userId, prefetchedProfile, fetchedProfile])
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

  useMemo(() => {
    if (profile?.avatar && profile.pictureSize != null) {
      const thumbUrl = toNostrBuildThumbUrl(profile.avatar)
      if (!urlSizeCache.has(thumbUrl)) {
        urlSizeCache.set(thumbUrl, profile.pictureSize)
      }
    }
  }, [profile?.avatar, profile?.pictureSize])

  const avatarSrc = useDeferRemoteProfileAvatar(
    profile?.avatar,
    defaultAvatar,
    containerRef,
    maxFileSizeKb != null ? maxFileSizeKb * 1024 : undefined
  )
  
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
    if (currentSrc && isHttpOrHttpsUrl(currentSrc)) loadedAvatarUrls.add(currentSrc)
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