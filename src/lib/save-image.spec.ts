import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadImage, saveImage, type PreparedImage } from './save-image'

const preparedImage: PreparedImage = {
  blob: new Blob(['image'], { type: 'image/png' }),
  file: new File(['image'], 'image.png', { type: 'image/png' }),
  filename: 'image.png'
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('saveImage', () => {
  it('opens the mobile share sheet synchronously with a prepared image', () => {
    const share = vi.fn(() => new Promise<void>(() => undefined))
    vi.stubGlobal('navigator', createMobileNavigator(share))
    const saveAs = vi.fn()

    saveImage('https://example.com/image.png', preparedImage, saveAs)

    expect(share).toHaveBeenCalledWith({ files: [preparedImage.file] })
    expect(saveAs).not.toHaveBeenCalled()
  })

  it('reuses the prepared blob when sharing fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const share = vi.fn(() => Promise.reject(new Error('Share failed')))
    vi.stubGlobal('navigator', createMobileNavigator(share))
    const saveAs = vi.fn()

    saveImage('https://example.com/image.png', preparedImage, saveAs)
    await vi.waitFor(() => expect(saveAs).toHaveBeenCalled())

    expect(saveAs).toHaveBeenCalledWith(preparedImage.blob, preparedImage.filename)
  })

  it('keeps download behavior on touch-enabled Windows devices', () => {
    const share = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', {
      canShare: () => true,
      maxTouchPoints: 10,
      platform: 'Win32',
      share,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0 Safari/537.36'
    })
    const saveAs = vi.fn()

    saveImage('https://example.com/image.png', preparedImage, saveAs)

    expect(share).not.toHaveBeenCalled()
    expect(saveAs).toHaveBeenCalledWith(preparedImage.blob, preparedImage.filename)
  })
})

describe('downloadImage', () => {
  it('downloads a fetched cross-origin image as a blob', async () => {
    vi.stubGlobal('navigator', createDesktopNavigator())
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(new Blob(['downloaded image'], { type: 'image/png' }), { status: 200 })
        )
      )
    )
    const saveAs = vi.fn()

    await downloadImage('https://example.com/image.png', undefined, saveAs)

    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'image.png')
  })

  it('opens the original image when CORS prevents fetching it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('navigator', createDesktopNavigator())
    vi.stubGlobal('window', { location: { href: 'https://beta.jumble.social' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    )
    const link = {
      click: vi.fn(),
      download: '',
      href: '',
      rel: '',
      target: ''
    }
    vi.stubGlobal('document', { createElement: vi.fn(() => link) })
    const saveAs = vi.fn()

    await downloadImage('https://example.com/image.png', undefined, saveAs)

    expect(saveAs).not.toHaveBeenCalled()
    expect(link).toMatchObject({
      download: 'image.png',
      href: 'https://example.com/image.png',
      rel: 'noopener noreferrer',
      target: '_blank'
    })
    expect(link.click).toHaveBeenCalledOnce()
  })
})

function createMobileNavigator(share: (data?: ShareData) => Promise<void>) {
  return {
    canShare: () => true,
    maxTouchPoints: 1,
    platform: 'iPhone',
    share,
    userAgent: 'iPhone'
  }
}

function createDesktopNavigator() {
  return {
    maxTouchPoints: 0,
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
  }
}
