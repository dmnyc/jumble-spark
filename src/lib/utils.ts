import { TEmoji } from '@/types'
import { clsx, type ClassValue } from 'clsx'
import { parseNativeEmoji } from 'emoji-picker-react/src/dataUtils/parseNativeEmoji'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function truncateText(text: string, maxWords: number): string {
  if (!text) return ''
  
  const words = text.trim().split(/\s+/)
  if (words.length <= maxWords) return text
  
  return words.slice(0, maxWords).join(' ') + '...'
}

/**
 * Remove emoji characters from a string
 * This regex covers most emoji ranges including:
 * - Emoticons (😀-🙏)
 * - Misc Symbols & Pictographs (🚀-🗿)
 * - Transport & Map Symbols (🚁-🛿)
 * - Enclosed characters (Ⓜ️, ©️, etc.)
 * - Regional indicator symbols (flags)
 * - And other emoji ranges
 */
export function removeEmojis(text: string): string {
  if (!text) return ''
  
  // Comprehensive emoji regex pattern covering major emoji Unicode ranges
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F018}-\u{1F270}]|[\u{238C}-\u{2454}]|[\u{20D0}-\u{20FF}]|[\u{FE00}-\u{FE0F}]|[\u{FE20}-\u{FE2F}]|[\u{E0020}-\u{E007F}]/gu
  
  return text.replace(emojiRegex, '').trim().replace(/\s+/g, ' ')
}

export function isSafari() {
  if (typeof window === 'undefined' || !window.navigator) return false
  const ua = window.navigator.userAgent
  const vendor = window.navigator.vendor
  return /Safari/.test(ua) && /Apple Computer/.test(vendor) && !/Chrome/.test(ua)
}

export function isAndroid() {
  if (typeof window === 'undefined' || !window.navigator) return false
  const ua = window.navigator.userAgent
  return /android/i.test(ua)
}

export function isTorBrowser() {
  if (typeof window === 'undefined' || !window.navigator) return false
  const ua = window.navigator.userAgent
  return /torbrowser/i.test(ua)
}

export function isTouchDevice() {
  if (typeof window === 'undefined' || !window.navigator) return false
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

export function isInViewport(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  )
}

export function isPartiallyInViewport(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  return (
    rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
    rect.bottom > 0 &&
    rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
    rect.right > 0
  )
}

export function isSupportCheckConnectionType() {
  if (typeof window === 'undefined' || !(navigator as any).connection) return false
  return typeof (navigator as any).connection.type === 'string'
}

export function isEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function isDevEnv() {
  return process.env.NODE_ENV === 'development'
}

export function parseEmojiPickerUnified(unified: string): string | TEmoji | undefined {
  if (unified.startsWith(':')) {
    const secondColonIndex = unified.indexOf(':', 1)
    if (secondColonIndex < 0) return undefined

    const shortcode = unified.slice(1, secondColonIndex)
    const url = unified.slice(secondColonIndex + 1)
    return { shortcode, url }
  } else {
    return parseNativeEmoji(unified)
  }
}
