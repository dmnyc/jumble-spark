import { useImageSave } from '@/hooks/useImageSave'
import { randomString } from '@/lib/random'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import blossomService from '@/services/blossom.service'
import modalManager from '@/services/modal-manager.service'
import { TImetaInfo } from '@/types'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Download from 'yet-another-react-lightbox/plugins/download'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import Image from '../Image'
import { isSmallImage, smallImageDisplayClasses } from '../Image/minDisplay'
import ImageWithLightbox from '../ImageWithLightbox'
import Lightbox from '../Lightbox'

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
  const { t } = useTranslation()
  const { autoLoadMedia } = useContentPolicy()
  const [index, setIndex] = useState(-1)
  const [slides, setSlides] = useState<{ src: string }[]>(images.map(({ url }) => ({ src: url })))
  const [naturalWidths, setNaturalWidths] = useState<Record<string, number>>({})
  const saveLightboxImage = useImageSave(slides[index]?.src, index >= 0)
  const handleImageLoad = (url: string, img: HTMLImageElement) => {
    setNaturalWidths((prev) => (prev[url] ? prev : { ...prev, [url]: img.naturalWidth }))
  }
  useEffect(() => {
    if (index >= 0) {
      modalManager.register(id, () => {
        setIndex(-1)
      })
    } else {
      modalManager.unregister(id)
    }
  }, [index])

  useEffect(() => {
    const loadImages = async () => {
      const slides = await Promise.all(
        images.map(({ url, pubkey }) => {
          return new Promise<{ src: string }>((resolve) => {
            const img = new window.Image()
            let validUrl = url
            img.onload = () => {
              blossomService.markAsSuccess(url, validUrl)
              resolve({ src: validUrl })
            }
            img.onerror = () => {
              blossomService.tryNextUrl(url).then((nextUrl) => {
                if (nextUrl) {
                  validUrl = nextUrl
                  resolve({ src: validUrl })
                } else {
                  resolve({ src: url })
                }
              })
            }
            if (pubkey) {
              blossomService
                .getValidUrl(url, pubkey)
                .then((u) => {
                  validUrl = u
                  img.src = validUrl
                })
                .catch(() => {
                  resolve({ src: url })
                })
            } else {
              img.src = url
            }
          })
        })
      )
      setSlides(slides)
    }

    loadImages()
  }, [images])

  const handlePhotoClick = (event: React.MouseEvent, current: number) => {
    event.stopPropagation()
    event.preventDefault()
    setIndex(start + current)
  }

  const displayImages = images.slice(start, end)

  if (!mustLoad && !autoLoadMedia) {
    return displayImages.map((image, i) => (
      <ImageWithLightbox
        key={i}
        image={image}
        className="max-h-[80vh] object-contain sm:max-h-[50vh]"
        classNames={{
          wrapper: cn('w-fit max-w-full border', className)
        }}
        upscaleSmall
      />
    ))
  }

  let imageContent: ReactNode | null = null
  if (displayImages.length === 1) {
    const image = displayImages[0]
    // prefer the imeta dimensions; fall back to the loaded image's natural width
    const small = isSmallImage(image.dim?.width ?? naturalWidths[image.url])
    imageContent = (
      <Image
        key={0}
        className={small ? smallImageDisplayClasses.img : 'max-h-[80vh] object-contain sm:max-h-[50vh]'}
        classNames={{
          errorPlaceholder: 'aspect-square h-[30vh]',
          wrapper: cn('cursor-zoom-in border', small && smallImageDisplayClasses.wrapper)
        }}
        image={image}
        onClick={(e) => handlePhotoClick(e, 0)}
        onImageLoad={handleImageLoad}
      />
    )
  } else if (displayImages.length === 2 || displayImages.length === 4) {
    imageContent = (
      <div className="grid w-full grid-cols-2 gap-2">
        {displayImages.map((image, i) => (
          <Image
            key={i}
            classNames={{ wrapper: 'aspect-square w-full cursor-zoom-in border' }}
            image={image}
            onClick={(e) => handlePhotoClick(e, i)}
          />
        ))}
      </div>
    )
  } else {
    imageContent = (
      <div className="grid w-full grid-cols-3 gap-2">
        {displayImages.map((image, i) => (
          <Image
            key={i}
            classNames={{ wrapper: 'aspect-square w-full cursor-zoom-in border' }}
            image={image}
            onClick={(e) => handlePhotoClick(e, i)}
          />
        ))}
      </div>
    )
  }

  const singleImage = displayImages.length === 1
  const singleImageSmall =
    singleImage && isSmallImage(displayImages[0].dim?.width ?? naturalWidths[displayImages[0].url])

  return (
    <div
      className={cn(
        singleImage ? (singleImageSmall ? smallImageDisplayClasses.wrapper : 'w-fit max-w-full') : 'w-full',
        className
      )}
    >
      {imageContent}
      {index >= 0 &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()}>
            <Lightbox
              index={index}
              slides={slides}
              plugins={[Download, Zoom]}
              labels={{ Download: t('Save') }}
              download={{
                download: ({ saveAs }) => saveLightboxImage(saveAs)
              }}
              on={{ view: ({ index }) => setIndex(index) }}
              open={index >= 0}
              close={() => setIndex(-1)}
              controller={{
                closeOnBackdropClick: true,
                closeOnPullUp: true,
                closeOnPullDown: true
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
