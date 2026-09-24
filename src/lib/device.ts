import { isElectron } from './platform'

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean
  }
}

export function isMobileOperatingSystem(): boolean {
  if (typeof navigator === 'undefined') return false

  const currentNavigator = navigator as NavigatorWithUserAgentData
  const isIPadDesktopMode =
    currentNavigator.platform === 'MacIntel' && currentNavigator.maxTouchPoints > 1

  return (
    currentNavigator.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(currentNavigator.userAgent) ||
    isIPadDesktopMode
  )
}

/** Whether the hardware exposes touch input, independent of the preferred UI mode. */
export function hasTouchInput(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window
}

/** Mobile operating systems use touch-first interactions even at tablet widths. */
export function prefersTouchInteraction(): boolean {
  return isMobileOperatingSystem()
}

/** Whether the primary pointing device supports precise hover interactions. */
export function canHover(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return !prefersTouchInteraction()
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

export function shouldOfferDesktopAppDownload(): boolean {
  if (typeof navigator === 'undefined') return false
  return !isElectron() && !isMobileOperatingSystem()
}
