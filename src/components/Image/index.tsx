import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { isSafeMediaUrl } from '@/lib/url'
import { TImetaInfo } from '@/types'
import { decode } from 'blurhash'
import { ImageOff } from 'lucide-react'
import { CSSProperties, HTMLAttributes, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Browsers often never fire `onError` for invalid URIs, ORB, or stalled fetches — this forces a visible error. */
const IMAGE_LOAD_TIMEOUT_MS = 10_000

/** Without reserved height, `absolute` skeleton + `opacity-0` img collapse to 0×0 — looks like “nothing”. */
function wrapperReserveStyle(
  dim: { width: number; height: number } | undefined,
  showError: boolean
): CSSProperties | undefined {
  if (showError) return undefined
  if (dim && dim.width > 0 && dim.height > 0) {
    return { aspectRatio: `${dim.width} / ${dim.height}` }
  }
  return { minHeight: 'min(30vh, 280px)' }
}

export default function Image({
  image: { url, blurHash, dim, alt: imetaAlt, fallback },
  alt,
  className = '',
  classNames = {},
  hideIfError = false,
  errorPlaceholder = <ImageOff />,
  style: wrapperStyleProp,
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
  const { t } = useTranslation()
  const urlOk = !!url?.trim()
  const [isLoading, setIsLoading] = useState(urlOk)
  const [displaySkeleton, setDisplaySkeleton] = useState(urlOk)
  const [hasError, setHasError] = useState(!urlOk)
  const [imageUrl, setImageUrl] = useState(url)
  const [fallbackIndex, setFallbackIndex] = useState(0)
  const loadWatchRef = useRef<number | null>(null)

  const finalAlt = imetaAlt || alt
  const openLinkHref =
    (isSafeMediaUrl(url) && url.trim()) || (isSafeMediaUrl(imageUrl) && imageUrl.trim()) || ''

  const badSrc = !imageUrl?.trim() || !isSafeMediaUrl(imageUrl.trim())
  const showErrorState = hasError || badSrc

  const clearLoadWatch = () => {
    if (loadWatchRef.current != null) {
      clearTimeout(loadWatchRef.current)
      loadWatchRef.current = null
    }
  }

  useEffect(() => {
    setImageUrl(url)
    setIsLoading(true)
    setHasError(false)
    setDisplaySkeleton(true)
    setFallbackIndex(0)
    clearLoadWatch()
    if (!url?.trim()) {
      setIsLoading(false)
      setHasError(true)
      setDisplaySkeleton(false)
    }
  }, [url])

  useEffect(() => {
    clearLoadWatch()
    if (badSrc || !url?.trim()) return
    loadWatchRef.current = window.setTimeout(() => {
      loadWatchRef.current = null
      setIsLoading(false)
      setDisplaySkeleton(false)
      setHasError(true)
    }, IMAGE_LOAD_TIMEOUT_MS)
    return clearLoadWatch
  }, [imageUrl, badSrc, url])

  if (hideIfError && showErrorState) return null

  const handleError = () => {
    clearLoadWatch()
    if (fallback && fallbackIndex < fallback.length) {
      const next = fallback[fallbackIndex]
      setFallbackIndex((prev) => prev + 1)
      setImageUrl(next)
      return
    }
    setIsLoading(false)
    setDisplaySkeleton(false)
    setHasError(true)
  }

  const handleLoad = () => {
    clearLoadWatch()
    setIsLoading(false)
    setHasError(false)
    setTimeout(() => setDisplaySkeleton(false), 600)
  }

  const reserveStyle = wrapperReserveStyle(dim, showErrorState)
  const mergedWrapperStyle: CSSProperties | undefined =
    reserveStyle || wrapperStyleProp
      ? { ...reserveStyle, ...wrapperStyleProp }
      : undefined

  return (
    <span
      className={cn('relative overflow-hidden block w-full', classNames.wrapper)}
      style={mergedWrapperStyle}
      {...props}
    >
      {displaySkeleton && !showErrorState && (
        <span className="absolute inset-0 z-10 block rounded-lg bg-muted/30">
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
                'absolute inset-0 h-full min-h-[8rem] w-full transition-opacity duration-500 rounded-lg',
                isLoading ? 'opacity-100' : 'opacity-0'
              )}
            />
          )}
        </span>
      )}
      {!showErrorState && (
        <img
          src={imageUrl}
          alt={finalAlt}
          title={finalAlt || undefined}
          referrerPolicy="no-referrer"
          decoding="async"
          loading="eager"
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
        />
      )}
      {showErrorState && (
        <div
          role="alert"
          className={cn(
            'flex flex-col items-center justify-center gap-2 w-full min-h-[120px] p-4 rounded-lg bg-muted text-muted-foreground text-center',
            className,
            classNames.errorPlaceholder
          )}
        >
          <span className="flex shrink-0 text-muted-foreground [&_svg]:size-10">{errorPlaceholder}</span>
          <p className="text-sm leading-snug">{t('This image could not be loaded.')}</p>
          {badSrc && !hasError ? (
            <p className="text-xs opacity-80 break-all max-w-full">{t('Invalid or unsupported image address.')}</p>
          ) : null}
          {openLinkHref ? (
            <a
              href={openLinkHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline break-all max-w-full"
              onClick={(e) => e.stopPropagation()}
            >
              {t('Open image link')}
            </a>
          ) : null}
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
    } catch {
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
