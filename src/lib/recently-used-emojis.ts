import { TEmoji } from '@/types'

const STORAGE_KEY = 'jumble-recently-used-emojis'
const MAX_ENTRIES = 18

type StoredEmoji = string | { shortcode: string; url: string }

export function getRecentlyUsedEmojis(): (string | TEmoji)[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as StoredEmoji[]
  } catch {
    return []
  }
}

export function recordEmojiUsed(emoji: string | TEmoji): void {
  try {
    const key = typeof emoji === 'string' ? emoji : emoji.shortcode
    const entries = getRecentlyUsedEmojis()
    const filtered = entries.filter((e) => (typeof e === 'string' ? e : e.shortcode) !== key)
    const updated = [emoji, ...filtered].slice(0, MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch {
    // ignore storage errors
  }
}
