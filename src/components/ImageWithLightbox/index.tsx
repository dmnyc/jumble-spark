import { randomString } from '@/lib/random'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import modalManager from '@/services/modal-manager.service'
import { TImetaInfo } from '@/types'
import { useEffect, useMemo, useState } from 'react'
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
    event.stopPropagation()
    event.preventDefault()
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
          <div onClick={(e) => e.stopPropagation()}>
            <Lightbox
              index={index}
              slides={[{
                src: image.url,
                alt: image.alt || image.url,
                title: image.alt || undefined
              }]}
              plugins={[Zoom, Captions]}
              open={index >= 0}
              close={() => setIndex(-1)}
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
