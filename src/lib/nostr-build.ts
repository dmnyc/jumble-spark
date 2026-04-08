/**
 * Utilities for nostr.build CDN URLs.
 *
 * nostr.build generates a lightweight thumbnail at /thumb/<filename> for every
 * uploaded image. Thumbnails are typically < 50 KB regardless of the original
 * file size — a huge bandwidth win for profile pictures and feed previews.
 * Note: the /thumb/ route only works for image files — never apply it to video URLs.
 */

import { isVideo } from './url'

/** Returns true when a URL is hosted on any nostr.build domain. */
export function isNostrBuildUrl(url: string): boolean {
  const u = (url ?? '').trim()
  if (!u) return false
  try {
    return new URL(u).hostname.endsWith('nostr.build')
  } catch {
    return false
  }
}

/** Returns true when the URL is on nostr.build but does NOT yet use the /thumb/ path, and is not a video file. */
export function canUseNostrBuildThumb(url: string): boolean {
  const u = (url ?? '').trim()
  if (!u) return false
  // /thumb/ is image-only on nostr.build — never apply it to video files
  if (isVideo(u)) return false
  try {
    const parsed = new URL(u)
    if (!parsed.hostname.endsWith('nostr.build')) return false
    const p = parsed.pathname
    return p !== '/thumb' && !p.startsWith('/thumb/')
  } catch {
    return false
  }
}

/**
 * Returns the nostr.build thumbnail URL for `url`, inserting `/thumb` before the
 * filename path segment. Returns the original URL unchanged if it is not on
 * nostr.build, already uses /thumb/, or cannot be parsed.
 */
export function toNostrBuildThumbUrl(url: string): string {
  const u = (url ?? '').trim()
  if (!canUseNostrBuildThumb(u)) return u
  try {
    const parsed = new URL(u)
    const p = parsed.pathname || '/'
    parsed.pathname = '/thumb' + (p.startsWith('/') ? p : `/${p}`)
    return parsed.toString()
  } catch {
    return u
  }
}
