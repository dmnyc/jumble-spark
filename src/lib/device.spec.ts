import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canHover,
  hasTouchInput,
  isMobileOperatingSystem,
  prefersTouchInteraction,
  shouldOfferDesktopAppDownload
} from './device'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('device classification', () => {
  it('uses touch interactions and hides desktop downloads on Android tablets', () => {
    stubDevice({
      maxTouchPoints: 5,
      platform: 'Linux armv8l',
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 Chrome/132.0 Safari/537.36'
    })

    expect(isMobileOperatingSystem()).toBe(true)
    expect(hasTouchInput()).toBe(true)
    expect(prefersTouchInteraction()).toBe(true)
    expect(shouldOfferDesktopAppDownload()).toBe(false)
  })

  it('detects iPad desktop mode', () => {
    stubDevice({
      maxTouchPoints: 5,
      platform: 'MacIntel',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
    })

    expect(isMobileOperatingSystem()).toBe(true)
    expect(prefersTouchInteraction()).toBe(true)
    expect(shouldOfferDesktopAppDownload()).toBe(false)
  })

  it('detects the standard iPad user agent', () => {
    stubDevice({
      maxTouchPoints: 5,
      platform: 'iPad',
      userAgent:
        'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
    })

    expect(isMobileOperatingSystem()).toBe(true)
    expect(prefersTouchInteraction()).toBe(true)
    expect(shouldOfferDesktopAppDownload()).toBe(false)
  })

  it('keeps mouse-first interactions on touch-enabled Windows devices', () => {
    stubDevice({
      canHover: true,
      maxTouchPoints: 10,
      platform: 'Win32',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0 Safari/537.36'
    })

    expect(isMobileOperatingSystem()).toBe(false)
    expect(hasTouchInput()).toBe(true)
    expect(prefersTouchInteraction()).toBe(false)
    expect(canHover()).toBe(true)
    expect(shouldOfferDesktopAppDownload()).toBe(true)
  })

  it('uses the primary pointer capability for hover UI', () => {
    stubDevice({
      canHover: false,
      maxTouchPoints: 5,
      platform: 'iPad',
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile/15E148'
    })

    expect(canHover()).toBe(false)
  })

  it('does not offer the download from inside Electron', () => {
    stubDevice({
      electron: true,
      maxTouchPoints: 0,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    })

    expect(shouldOfferDesktopAppDownload()).toBe(false)
  })
})

function stubDevice({
  canHover = false,
  electron = false,
  maxTouchPoints,
  platform,
  userAgent
}: {
  canHover?: boolean
  electron?: boolean
  maxTouchPoints: number
  platform: string
  userAgent: string
}) {
  vi.stubGlobal('navigator', { maxTouchPoints, platform, userAgent })
  vi.stubGlobal('window', {
    electron: electron ? {} : undefined,
    matchMedia: vi.fn(() => ({ matches: canHover }))
  })
}
