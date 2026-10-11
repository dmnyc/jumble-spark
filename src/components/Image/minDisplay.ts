// A small image (a 220×164 GIF, say) must not render at natural size in the
// note view: it gets upscaled to at least MIN_IMAGE_DISPLAY_WIDTH (container
// permitting), preserving the aspect ratio. Larger media keeps the default
// shrink-wrap sizing, so big photos render exactly as before.
export const MIN_IMAGE_DISPLAY_WIDTH = 480

export function isSmallImage(width?: number | null): boolean {
  return width != null && width < MIN_IMAGE_DISPLAY_WIDTH
}

// w-full lets the wrapper's capped width drive the display size; h-auto
// preserves the aspect ratio. The max-w cap must match MIN_IMAGE_DISPLAY_WIDTH
// (Tailwind arbitrary values are static, hence the literal).
export const smallImageDisplayClasses = {
  img: 'h-auto w-full object-contain max-h-[80vh]',
  wrapper: 'w-full max-w-[480px]'
}
