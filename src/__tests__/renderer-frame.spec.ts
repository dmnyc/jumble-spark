import { isRendererFrameUrl } from '../../electron/main/renderer-frame'
import { describe, expect, it } from 'vitest'

describe('isRendererFrameUrl', () => {
  it('recognizes pages served from the Electron app origin', () => {
    expect(isRendererFrameUrl('app://renderer/notes/123', 'app://renderer')).toBe(true)
  })

  it('rejects other hosts using the app scheme', () => {
    expect(isRendererFrameUrl('app://third-party/frame', 'app://renderer')).toBe(false)
  })

  it('matches the Vite development server by origin', () => {
    expect(isRendererFrameUrl('http://localhost:5173/notes/123', 'http://localhost:5173')).toBe(
      true
    )
    expect(isRendererFrameUrl('http://localhost:5174/notes/123', 'http://localhost:5173')).toBe(
      false
    )
  })

  it('rejects missing or malformed URLs', () => {
    expect(isRendererFrameUrl(undefined, 'app://renderer')).toBe(false)
    expect(isRendererFrameUrl('not a URL', 'app://renderer')).toBe(false)
  })
})
