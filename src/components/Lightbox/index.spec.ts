import { describe, expect, it } from 'vitest'
import { upscaleDisplayStyle } from '.'

const UPSCALED = {
  maxWidth: '100%',
  maxHeight: '100%'
}

describe('lightbox upscaleDisplayStyle', () => {
  it('upscales a small image to the declared minimum', () => {
    expect(upscaleDisplayStyle({ w: 220, h: 164 }, 1440, 900)).toEqual({
      width: 724,
      height: 540,
      ...UPSCALED
    })
  })

  it('returns null for large media so the default CSS sizing scales it down', () => {
    expect(upscaleDisplayStyle({ w: 2000, h: 1000 }, 1440, 900)).toBeNull()
    expect(upscaleDisplayStyle({ w: 3024, h: 4032 }, 1440, 900)).toBeNull()
  })

  it('returns null for an image that is already above the minimum', () => {
    expect(upscaleDisplayStyle({ w: 800, h: 600 }, 1440, 900)).toBeNull()
  })

  it('upscales an image that is below the minimum in one axis only', () => {
    expect(upscaleDisplayStyle({ w: 700, h: 500 }, 1440, 900)).toEqual({
      width: 756,
      height: 540,
      ...UPSCALED
    })
  })

  it('caps the minimum at what the pane can hold', () => {
    expect(upscaleDisplayStyle({ w: 220, h: 164 }, 600, 300)).toEqual({
      width: 402,
      height: 300,
      ...UPSCALED
    })
  })

  it('fills the constraining dimension when the minimum is unreachable', () => {
    expect(upscaleDisplayStyle({ w: 1000, h: 100 }, 1440, 900)).toEqual({
      width: 1440,
      height: 144,
      ...UPSCALED
    })
  })
})
