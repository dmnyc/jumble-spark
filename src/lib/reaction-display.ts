import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import { isNip25ReactionKind } from '@/lib/event'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { TEmoji } from '@/types'
import { Event } from 'nostr-tools'

/** Whole-string :shortcode: (NIP-style); matches content-patterns rules. */
const WHOLE_SHORTCODE = /^:([a-zA-Z0-9_\-][^:]{0,19}):$/

export type TReactionEmojiSync =
  | { mode: 'display'; value: TEmoji | string }
  | { mode: 'profile'; shortcode: string; placeholder: string }

/**
 * Resolve reaction display without network: emoji tags on the reaction, standard :shortcode: → Unicode,
 * or defer to profile (reactor kind 0) for custom shortcodes.
 */
export function resolveReactionEmojiSync(event: Event, maxRawLength: number): TReactionEmojiSync {
  if (!isNip25ReactionKind(event.kind)) {
    return { mode: 'display', value: '' }
  }

  const raw = event.content?.trim() ?? ''
  if (!raw) {
    return { mode: 'display', value: '❤️' }
  }
  if (raw.length > maxRawLength) {
    return { mode: 'display', value: `${raw.slice(0, maxRawLength)}…` }
  }

  const fromReactionTags = getEmojiInfosFromEmojiTags(event.tags)
  const customShortcodes = fromReactionTags.map((e) => e.shortcode)

  const whole = raw.match(WHOLE_SHORTCODE)
  if (whole) {
    const shortcode = whole[1]
    const hit = fromReactionTags.find((e) => e.shortcode === shortcode)
    if (hit) {
      return { mode: 'display', value: hit }
    }
  }

  const normalized = replaceStandardEmojiShortcodesInContent(raw, customShortcodes)
  if (normalized !== raw && !WHOLE_SHORTCODE.test(normalized.trim())) {
    return { mode: 'display', value: normalized.trim() }
  }

  if (whole) {
    return { mode: 'profile', shortcode: whole[1], placeholder: raw }
  }

  return { mode: 'display', value: raw }
}
