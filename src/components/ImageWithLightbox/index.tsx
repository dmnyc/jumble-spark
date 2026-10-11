import { useImageSave } from '@/hooks/useImageSave'
import { randomString } from '@/lib/random'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import modalManager from '@/services/modal-manager.service'
import { TImetaInfo } from '@/types'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Download from 'yet-another-react-lightbox/plugins/download'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import Image from '../Image'
import { isSmallImage, smallImageDisplayClasses } from '../Image/minDisplay'
import Lightbox from '../Lightbox'

export default function ImageWithLightbox({
  image,
  className,
  classNames = {},
  errorPlaceholder,
  ignoreAutoLoadPolicy = false,
  upscaleSmall = false
}: {
  image: TImetaInfo
  className?: string
  classNames?: {
    wrapper?: string
    skeleton?: string
  }
  errorPlaceholder?: string
  ignoreAutoLoadPolicy?: boolean
  upscaleSmall?: boolean
}) {
  const id = useMemo(() => `image-with-lightbox-${randomString()}`, [])
  const { t } = useTranslation()
  const { autoLoadMedia } = useContentPolicy()
  const [display, setDisplay] = useState(ignoreAutoLoadPolicy ? true : autoLoadMedia)
  const [index, setIndex] = useState(-1)
  const [lightboxUrl, setLightboxUrl] = useState(image.url)
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null)
  const saveLightboxImage = useImageSave(lightboxUrl, index >= 0)

  useEffect(() => setLightboxUrl(image.url), [image.url])

  // prefer the imeta dimensions; fall back to the loaded image's natural width
  const small = upscaleSmall && isSmallImage(image.dim?.width ?? naturalWidth)

  useEffect(() => {
    if (index >= 0) {
      modalManager.register(id, () => {
        setIndex(-1)
      })
    } else {
      modalManager.unregister(id)
    }
  }, [index])

  if (!display) {
    return (
      <div
        className="text-primary w-fit cursor-pointer truncate hover:underline"
        onClick={(e) => {
          e.stopPropagation()
          setDisplay(true)
        }}
      >
        [{t('Click to load image')}]
      </div>
    )
  }

  const handlePhotoClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    setIndex(0)
  }

  return (
    <div>
      <Image
        key={0}
        className={small ? smallImageDisplayClasses.img : className}
        classNames={{
          wrapper: cn('border cursor-zoom-in', classNames.wrapper, small && smallImageDisplayClasses.wrapper),
          errorPlaceholder: 'aspect-square h-[30vh]',
          skeleton: classNames.skeleton
        }}
        image={image}
        onClick={(e) => handlePhotoClick(e)}
        onImageLoad={(url, img) => {
          setLightboxUrl(url)
          setNaturalWidth(img.naturalWidth)
        }}
        errorPlaceholder={errorPlaceholder}
      />
      {index >= 0 &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()}>
            <Lightbox
              index={index}
              slides={[{ src: lightboxUrl }]}
              plugins={[Download, Zoom]}
              labels={{ Download: t('Save') }}
              download={{
                download: ({ saveAs }) => saveLightboxImage(saveAs)
              }}
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
