import { cn, isInViewport } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import mediaManager from '@/services/media-manager.service'
import { useEffect, useRef, useState } from 'react'
import ExternalLink from '../ExternalLink'
import { MediaErrorBoundary } from '../MediaErrorBoundary'
import logger from '@/lib/logger'

export default function VideoPlayer({ src, className, poster }: { src: string; className?: string; poster?: string }) {
  const { autoplay } = useContentPolicy()
  const [error, setError] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!autoplay) return

    const video = videoRef.current
    const container = containerRef.current

    if (!video || !container) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            if (isInViewport(container)) {
              mediaManager.autoPlay(video)
            }
          }, 200)
        } else {
          mediaManager.pause(video)
        }
      },
      { threshold: 1 }
    )

    observer.observe(container)

    return () => {
      observer.unobserve(container)
    }
  }, [autoplay])

  if (error) {
    return <ExternalLink url={src} />
  }

  return (
    <MediaErrorBoundary
      fallback={<ExternalLink url={src} />}
      onError={(error) => {
        // Don't log expected media errors
        if (error.name !== 'AbortError' && !error.message.includes('play() request was interrupted')) {
          logger.warn('Video player error', error)
        }
        setError(true)
      }}
    >
      <div ref={containerRef} className="w-full max-w-full overflow-hidden">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="none"
          className={cn('rounded-lg max-h-[80vh] sm:max-h-[60vh] border w-full h-auto max-w-full', className)}
          src={src}
          poster={poster}
          onClick={(e) => e.stopPropagation()}
          onPlay={(event) => {
            mediaManager.play(event.currentTarget)
          }}
          muted
          onError={() => setError(true)}
        />
      </div>
    </MediaErrorBoundary>
  )
}
