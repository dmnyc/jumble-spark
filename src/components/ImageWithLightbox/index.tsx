import { randomString } from '@/lib/random'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import modalManager from '@/services/modal-manager.service'
import { TImetaInfo } from '@/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/plugins/captions.css'
import Image from '../Image'

export default function ImageWithLightbox({
  image,
  className,
  classNames = {}
}: {
  image: TImetaInfo
  className?: string
  classNames?: {
    wrapper?: string
  }
}) {
  const id = useMemo(() => `image-with-lightbox-${randomString()}`, [])
  const { t } = useTranslation()
  const { autoLoadMedia } = useContentPolicy()
  const [display, setDisplay] = useState(autoLoadMedia)
  const [index, setIndex] = useState(-1)

  const logLightboxEvent = useCallback((stage: string, details?: Record<string, unknown>) => {
    logger.info('[LightboxTrace]', {
      stage,
      id,
      imageUrl: image.url,
      index,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      ...details
    })
  }, [id, image.url, index])

  useEffect(() => {
    if (index >= 0) {
      logLightboxEvent('modal-register')
      modalManager.register(id, () => {
        logLightboxEvent('modal-callback-close')
        setIndex(-1)
      })
    } else {
      logLightboxEvent('modal-unregister')
      modalManager.unregister(id)
    }
  }, [id, index, logLightboxEvent])

  useEffect(() => {
    if (index < 0) return

    const onCaptureKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        logLightboxEvent('escape-keydown-capture', {
          defaultPrevented: event.defaultPrevented,
          eventPhase: event.eventPhase
        })
      }
    }
    const onPopState = (event: PopStateEvent) => {
      logLightboxEvent('window-popstate-while-open', {
        hasState: !!event.state,
        state: event.state
      })
    }

    window.addEventListener('keydown', onCaptureKeydown, true)
    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('keydown', onCaptureKeydown, true)
      window.removeEventListener('popstate', onPopState)
    }
  }, [index, logLightboxEvent])

  if (!display) {
    return (
      <span
        className="text-primary hover:underline truncate w-fit cursor-pointer inline-block"
        onClick={(e) => {
          e.stopPropagation()
          setDisplay(true)
        }}
      >
        [{t('Click to load image')}]
      </span>
    )
  }

  const handlePhotoClick = (event: React.MouseEvent) => {
    logLightboxEvent('thumbnail-click', {
      defaultPreventedBefore: event.defaultPrevented
    })
    event.stopPropagation()
    event.preventDefault()
    logLightboxEvent('set-open-index')
    setIndex(0)
  }

  return (
    <div className="max-w-[400px]">
      <Image
        key={0}
        className={className}
        classNames={{
          wrapper: cn('rounded-lg cursor-zoom-in', classNames.wrapper),
          errorPlaceholder: 'aspect-square h-[30vh]'
        }}
        image={image}
        onClick={(e) => handlePhotoClick(e)}
      />
      {index >= 0 &&
        createPortal(
          <div
            data-lightbox-overlay
            onClick={(e) => {
              logLightboxEvent('overlay-click', { target: (e.target as HTMLElement)?.tagName })
              e.stopPropagation()
            }}
            onPointerDown={(e) => {
              logLightboxEvent('overlay-pointerdown', { target: (e.target as HTMLElement)?.tagName })
              e.stopPropagation()
            }}
            onMouseDown={(e) => {
              logLightboxEvent('overlay-mousedown', { target: (e.target as HTMLElement)?.tagName })
              e.stopPropagation()
            }}
            onTouchStart={(e) => {
              logLightboxEvent('overlay-touchstart', { target: (e.target as HTMLElement)?.tagName })
              e.stopPropagation()
            }}
          >
            <Lightbox
              index={index}
              slides={[{
                src: image.url,
                alt: image.alt || image.url,
                title: image.alt || undefined
              }]}
              plugins={[Zoom, Captions]}
              open={index >= 0}
              close={() => {
                logLightboxEvent('lightbox-close-callback')
                setIndex(-1)
              }}
              controller={{
                closeOnBackdropClick: false,
                closeOnPullUp: true,
                closeOnPullDown: true
              }}
              render={{
                buttonPrev: () => null,
                buttonNext: () => null
              }}
              styles={{
                toolbar: { paddingTop: '2.25rem' }
              }}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
