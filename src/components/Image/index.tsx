import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import client from '@/services/client.service'
import { TImetaInfo } from '@/types'
import { preferBlossomPrimalDisplayUrl, primalR2aMirrorForBlossomPrimalUrl } from '@/lib/url'
import { getHashFromURL } from 'blossom-client-sdk'
import { decode } from 'blurhash'
import { ImageOff } from 'lucide-react'
import { HTMLAttributes, useEffect, useMemo, useRef, useState } from 'react'
import logger from '@/lib/logger'

export default function Image({
  image: { url, blurHash, pubkey, dim, alt: imetaAlt, fallback },
  alt,
  className = '',
  classNames = {},
  hideIfError = false,
  errorPlaceholder = <ImageOff />,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  classNames?: {
    wrapper?: string
    errorPlaceholder?: string
  }
  image: TImetaInfo
  alt?: string
  hideIfError?: boolean
  errorPlaceholder?: React.ReactNode
}) {
  const [isLoading, setIsLoading] = useState(true)
  const [displaySkeleton, setDisplaySkeleton] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [imageUrl, setImageUrl] = useState(() => preferBlossomPrimalDisplayUrl(url))
  const [tried, setTried] = useState(new Set())
  const [fallbackIndex, setFallbackIndex] = useState(0)
  
  // Use imeta alt text if available, otherwise use the passed alt prop
  const finalAlt = imetaAlt || alt

  useEffect(() => {
    setImageUrl(preferBlossomPrimalDisplayUrl(url))
    setIsLoading(true)
    setHasError(false)
    setDisplaySkeleton(true)
    setTried(new Set())
    setFallbackIndex(0)
  }, [url])

  if (hideIfError && hasError) return null

  const handleError = async () => {
    // First, try fallback URLs from imeta if available
    if (fallback && fallbackIndex < fallback.length) {
      const nextFallbackUrl = fallback[fallbackIndex]
      setFallbackIndex(prev => prev + 1)
      setImageUrl(preferBlossomPrimalDisplayUrl(nextFallbackUrl))
      return
    }
    
    // If no more fallbacks, try Blossom servers
    let oldImageUrl: URL | undefined
    let hash: string | null = null
    try {
      oldImageUrl = new URL(imageUrl)
      hash = getHashFromURL(oldImageUrl)
    } catch (error) {
      logger.error('Invalid image URL', { error, imageUrl })
    }
    if (!hash || !oldImageUrl) {
      setIsLoading(false)
      setHasError(true)
      return
    }

    // r2a failed: try canonical blossom URL from props (some networks only allow one hop).
    if (
      oldImageUrl.hostname === 'r2a.primal.net' &&
      url &&
      url !== imageUrl &&
      url.includes('blossom.primal.net') &&
      !tried.has('blossom.primal.net-direct')
    ) {
      setTried((prev) => new Set(prev).add('blossom.primal.net-direct'))
      setImageUrl(url)
      return
    }

    // Primal: only mirror blossom → r2a when we did not already open the note with that CDN URL (avoids r2a↔blossom loops).
    if (oldImageUrl.hostname === 'blossom.primal.net') {
      const r2a = primalR2aMirrorForBlossomPrimalUrl(oldImageUrl)
      const noteAlreadyUsesPrimalCdnFirst = preferBlossomPrimalDisplayUrl(url) !== url
      if (r2a && !noteAlreadyUsesPrimalCdnFirst && !tried.has('blossom.primal.net')) {
        setTried((prev) => new Set(prev).add('blossom.primal.net'))
        setImageUrl(r2a)
        return
      }
    }

    if (!pubkey) {
      setIsLoading(false)
      setHasError(true)
      return
    }

    const extMatch = oldImageUrl.pathname.match(/\.\w+$/i)
    const extStr = extMatch?.[0] ?? ''
    setTried((prev) => new Set(prev).add(oldImageUrl.hostname))

    const blossomServerList = await client.fetchBlossomServerList(pubkey)
    const urls = blossomServerList
      .map((server) => {
        try {
          return new URL(server)
        } catch (error) {
          logger.error('Invalid Blossom server URL', { server, error })
          return undefined
        }
      })
      .filter((u) => !!u && !tried.has(u.hostname))
    const nextUrl = urls[0]
    if (!nextUrl) {
      setIsLoading(false)
      setHasError(true)
      return
    }

    nextUrl.pathname = '/' + hash + extStr
    setImageUrl(preferBlossomPrimalDisplayUrl(nextUrl.toString()))
  }

  const handleLoad = () => {
    setIsLoading(false)
    setHasError(false)
    setTimeout(() => setDisplaySkeleton(false), 600)
  }

  return (
    <span className={cn('relative overflow-hidden block', classNames.wrapper)} {...props}>
      {displaySkeleton && (
        <span className="absolute inset-0 z-10 inline-block">
          {blurHash ? (
            <BlurHashCanvas
              blurHash={blurHash}
              className={cn(
                'absolute inset-0 transition-opacity duration-500 rounded-lg',
                isLoading ? 'opacity-100' : 'opacity-0'
              )}
            />
          ) : (
            <Skeleton
              className={cn(
                'absolute inset-0 transition-opacity duration-500 rounded-lg',
                isLoading ? 'opacity-100' : 'opacity-0'
              )}
            />
          )}
        </span>
      )}
      {!hasError && (
        <img
          src={imageUrl}
          alt={finalAlt}
          title={finalAlt || undefined}
          referrerPolicy="no-referrer"
          decoding="async"
          loading="lazy"
          draggable={false}
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            'object-cover rounded-lg w-full h-full transition-opacity duration-500 pointer-events-none',
            isLoading ? 'opacity-0' : 'opacity-100',
            className
          )}
          width={dim?.width}
          height={dim?.height}
          {...props}
        />
      )}
      {hasError && (
        <div
          className={cn(
            'object-cover flex flex-col items-center justify-center w-full h-full bg-muted',
            className,
            classNames.errorPlaceholder
          )}
        >
          {errorPlaceholder}
        </div>
      )}
    </span>
  )
}

const blurHashWidth = 32
const blurHashHeight = 32
function BlurHashCanvas({ blurHash, className = '' }: { blurHash: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const pixels = useMemo(() => {
    if (!blurHash) return null
    try {
      return decode(blurHash, blurHashWidth, blurHashHeight)
    } catch (error) {
      logger.warn('Failed to decode blurhash', error as Error)
      return null
    }
  }, [blurHash])

  useEffect(() => {
    if (!pixels || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imageData = ctx.createImageData(blurHashWidth, blurHashHeight)
    imageData.data.set(pixels)
    ctx.putImageData(imageData, 0, 0)
  }, [pixels])

  if (!blurHash) return null

  return (
    <canvas
      ref={canvasRef}
      width={blurHashWidth}
      height={blurHashHeight}
      className={cn('w-full h-full object-cover rounded-lg', className)}
      style={{
        imageRendering: 'auto',
        filter: 'blur(0.5px)'
      }}
    />
  )
}
