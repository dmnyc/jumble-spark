import { CSSProperties, useEffect, useRef, useState } from 'react'
import ReactLightbox from 'yet-another-react-lightbox'
import type { LightboxExternalProps, Slide } from 'yet-another-react-lightbox'
import { isImageSlide } from 'yet-another-react-lightbox'

// A small image (a 220×164 GIF, say) must not render at natural size in a
// fullscreen overlay: it gets upscaled to at least MIN_DISPLAY_* (pane
// permitting). Large media is only ever scaled down to fit, and the aspect
// ratio is always preserved.
//
// The image is sized to the final box explicitly instead of relying on
// max-width/max-height, because "keep natural size, but at least 720×540,
// and never overflow the pane" cannot be expressed in pure CSS while
// preserving the aspect ratio on extreme pane shapes. The explicit box is
// only applied when upscaling is required — media that fits or needs to be
// scaled down keeps the library's own CSS sizing, which is already exact.
const MIN_DISPLAY_WIDTH = 720
const MIN_DISPLAY_HEIGHT = 540

// the lightbox preloads (2 * preload + 1) slides around the current index
// (default preload: 2); measure the same window so upscaling applies from
// the first frame of each slide
const PRELOAD_WINDOW = 2

type NaturalSize = { w: number; h: number }

// Returns the display box for an image that must be upscaled, or null when
// the image should keep the library's default CSS sizing (natural size,
// scaled down to fit the pane).
export function upscaleDisplayStyle(
  { w, h }: NaturalSize,
  paneWidth: number,
  paneHeight: number
): CSSProperties | null {
  const fit = Math.min(paneWidth / w, paneHeight / h)
  if (fit < 1) {
    // larger than the pane: the default CSS sizing already scales it down
    return null
  }
  // fits as-is: keep natural size unless that's below the minimum, capped
  // at what the pane can hold
  const minScale = Math.max(MIN_DISPLAY_WIDTH / w, MIN_DISPLAY_HEIGHT / h)
  const scale = Math.min(fit, Math.max(1, minScale))
  if (scale <= 1) {
    return null
  }
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
    // guard against pane estimation error; object-fit: contain (already set
    // by the library) keeps the aspect ratio should these ever clamp
    maxWidth: '100%',
    maxHeight: '100%'
  }
}

export default function Lightbox({ slides, index, carousel, ...rest }: LightboxExternalProps) {
  const [naturalSizes, setNaturalSizes] = useState<Record<string, NaturalSize>>({})
  const [pane, setPane] = useState<{ w: number; h: number } | null>(null)
  const measuredRef = useRef(new Set<string>())

  const open = rest.open ?? false
  const currentIndex = index ?? 0

  // The overlay covers the whole viewport, so the pane is the window itself.
  useEffect(() => {
    if (!open) return
    const updatePane = () => setPane({ w: window.innerWidth, h: window.innerHeight })
    updatePane()
    window.addEventListener('resize', updatePane)
    return () => window.removeEventListener('resize', updatePane)
  }, [open])

  useEffect(() => {
    if (!open) return
    slides
      ?.slice(Math.max(0, currentIndex - PRELOAD_WINDOW), currentIndex + PRELOAD_WINDOW + 1)
      .forEach((slide) => {
        if (!isImageSlide(slide)) return
        const { src } = slide
        if (measuredRef.current.has(src)) return
        measuredRef.current.add(src)
        const img = new Image()
        img.onload = () => {
          if (!img.naturalWidth || !img.naturalHeight) return
          setNaturalSizes((prev) => ({ ...prev, [src]: { w: img.naturalWidth, h: img.naturalHeight } }))
        }
        img.src = src
      })
  }, [open, currentIndex, slides])

  const imageProps = (slide: Slide) => {
    if (!isImageSlide(slide) || !pane) return {}
    const natural = naturalSizes[slide.src]
    if (!natural) return {}
    const style = upscaleDisplayStyle(natural, pane.w, pane.h)
    return style ? { style } : {}
  }

  return (
    <ReactLightbox
      slides={slides}
      index={index}
      carousel={{ ...carousel, imageProps }}
      {...rest}
    />
  )
}
