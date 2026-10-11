import { describe, expect, it } from 'vitest'
import { isSmallImage, MIN_IMAGE_DISPLAY_WIDTH, smallImageDisplayClasses } from './minDisplay'

describe('isSmallImage', () => {
  it('treats images below the minimum display width as small', () => {
    expect(isSmallImage(220)).toBe(true)
    expect(isSmallImage(MIN_IMAGE_DISPLAY_WIDTH - 1)).toBe(true)
  })

  it('treats images at or above the minimum display width as not small', () => {
    expect(isSmallImage(MIN_IMAGE_DISPLAY_WIDTH)).toBe(false)
    expect(isSmallImage(3024)).toBe(false)
  })

  it('treats unknown widths as not small so the default sizing is kept', () => {
    expect(isSmallImage(undefined)).toBe(false)
    expect(isSmallImage(null)).toBe(false)
  })
})

describe('smallImageDisplayClasses', () => {
  it('caps the wrapper at the minimum display width', () => {
    expect(smallImageDisplayClasses.wrapper).toBe(`w-full max-w-[${MIN_IMAGE_DISPLAY_WIDTH}px]`)
  })

  it('preserves the aspect ratio and never overflows vertically', () => {
    expect(smallImageDisplayClasses.img).toBe('h-auto w-full object-contain max-h-[80vh]')
  })
})
