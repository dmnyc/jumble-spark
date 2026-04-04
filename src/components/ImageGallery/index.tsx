import { randomString } from '@/lib/random'
import { preferBlossomPrimalDisplayUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import modalManager from '@/services/modal-manager.service'
import { TImetaInfo } from '@/types'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/plugins/captions.css'
import Image from '../Image'
import ImageWithLightbox from '../ImageWithLightbox'

export default function ImageGallery({
  className,
  images,
  start = 0,
  end = images.length,
  mustLoad = false
}: {
  className?: string
  images: TImetaInfo[]
  start?: number
  end?: number
  mustLoad?: boolean
}) {
  const id = useMemo(() => `image-gallery-${randomString()}`, [])
  const { autoLoadMedia } = useContentPolicy()
  const [index, setIndex] = useState(-1)
  useEffect(() => {
    if (index >= 0) {
      modalManager.register(id, () => {
        setIndex(-1)
      })
    } else {
      modalManager.unregister(id)
    }
  }, [index])

  const handlePhotoClick = (event: React.MouseEvent, current: number) => {
    event.stopPropagation()
    event.preventDefault()
    const newIndex = start + current
    logger.debug('[ImageGallery] Click:', { start, current, newIndex, totalImages: images.length, displayImages: displayImages.length })
    setIndex(newIndex)
  }

  const displayImages = images.slice(start, end)

  if (!mustLoad && !autoLoadMedia) {
    return displayImages.map((image, i) => (
      <ImageWithLightbox
        key={i}
        image={image}
        className="max-h-[80vh] sm:max-h-[50vh] object-contain"
        classNames={{
          wrapper: cn('w-fit max-w-full', className)
        }}
      />
    ))
  }

  let imageContent: ReactNode | null = null
  if (displayImages.length === 1) {
    imageContent = (
      <Image
        key={0}
        className="max-h-[80vh] sm:max-h-[50vh] cursor-zoom-in object-contain max-w-[400px]"
        classNames={{
          errorPlaceholder: 'aspect-square h-[30vh]'
        }}
        image={displayImages[0]}
        onClick={(e) => handlePhotoClick(e, 0)}
      />
    )
  } else if (displayImages.length === 2 || displayImages.length === 4) {
    imageContent = (
      <div className="grid grid-cols-2 gap-2 w-full max-w-[400px]">
        {displayImages.map((image, i) => (
          <Image
            key={i}
            className="aspect-square w-full cursor-zoom-in"
            image={image}
            onClick={(e) => handlePhotoClick(e, i)}
          />
        ))}
      </div>
    )
  } else {
    imageContent = (
      <div className="grid grid-cols-3 gap-2 w-full max-w-[400px]">
        {displayImages.map((image, i) => (
          <Image
            key={i}
            className="aspect-square w-full cursor-zoom-in"
            image={image}
            onClick={(e) => handlePhotoClick(e, i)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className={cn(displayImages.length === 1 ? 'w-fit max-w-[400px]' : 'w-full', className)}>
      {imageContent}
      {index >= 0 &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()}>
            <Lightbox
              index={index}
              slides={(() => {
                const slides = images.map(({ url, alt }) => ({
                  src: preferBlossomPrimalDisplayUrl(url),
                  alt: alt || url,
                  title: alt || undefined
                }))
                logger.debug('[ImageGallery] Lightbox slides:', { index, slidesCount: slides.length, slides })
                return slides
              })()}
              plugins={[Zoom, Captions]}
              open={index >= 0}
              close={() => setIndex(-1)}
              controller={{
                closeOnBackdropClick: false,
                closeOnPullUp: true,
                closeOnPullDown: true
              }}
              render={{
                buttonPrev: images.length <= 1 ? () => null : undefined,
                buttonNext: images.length <= 1 ? () => null : undefined
              }}
              styles={{
                toolbar: { paddingTop: '2.25rem' }
              }}
              carousel={{
                finite: false
              }}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
