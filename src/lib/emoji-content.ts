import { EMOJI_SHORT_CODE_REGEX } from '@/lib/content-patterns'
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji'

const STANDARD_EMOJI_LIMIT = 20

/**
 * Returns standard emoji shortcodes matching the query (for autocomplete).
 */
export function searchStandardEmojiShortcodes(query: string, limit = STANDARD_EMOJI_LIMIT): string[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of emojis) {
    const shortcodes = item.shortcodes ?? []
    const tags = item.tags ?? []
    const name = item.name ?? ''
    const match =
      shortcodes.some((s) => String(s).toLowerCase().includes(q)) ||
      tags.some((t) => String(t).toLowerCase().includes(q)) ||
      name.toLowerCase().includes(q)
    if (match) {
      const shortcode = shortcodes[0] ?? name
      if (shortcode && !seen.has(shortcode)) {
        seen.add(shortcode)
        out.push(shortcode)
        if (out.length >= limit) break
      }
    }
  }
  return out
}

/**
 * Replaces standard (non-custom) :shortcode: in content with their Unicode emoji
 * so they render correctly in all content fields (preview, feed, note page, etc.).
 * Custom shortcodes (e.g. from event emoji tags) are left as-is so they render via emoji tags.
 */
export function replaceStandardEmojiShortcodesInContent(
  content: string,
  customShortcodes?: Set<string> | string[]
): string {
  const customSet = customShortcodes instanceof Set
    ? customShortcodes
    : new Set(customShortcodes ?? [])
  return content.replace(EMOJI_SHORT_CODE_REGEX, (match, shortcode: string) => {
    const trimmed = shortcode.trim()
    if (customSet.has(trimmed)) return match
    const native = shortcodeToEmoji(trimmed, emojis) ?? shortcodeToEmoji(trimmed.replace(/\s+/g, '_'), emojis)
    return native?.emoji ?? match
  })
}
