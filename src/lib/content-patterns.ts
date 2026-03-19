/**
 * Single source of truth for :emoji: shortcodes and nostr: bech32 patterns.
 * Used by MarkdownArticle, parseContent, nostr-parser, previews, post editor, AsciiDoc, etc.
 */

// --- Emoji (:shortcode:) ----------------------------------------------------

export const EMOJI_SHORT_CODE_MAX_INNER_LENGTH = 20 as const

const _emojiInnerQuantifier = EMOJI_SHORT_CODE_MAX_INNER_LENGTH - 1

/**
 * - (?<!:) avoids AsciiDoc double-colon macros (link::, image::, citation::, etc.)
 * - First char after ":" must be [a-zA-Z0-9_-] so "Name: nostr:npub…" is not ": nostr:"
 * - Inner body max length so URLs/paths/nostr ids are not treated as shortcodes
 */
export const EMOJI_SHORT_CODE_REGEX = new RegExp(
  `(?<!:):([a-zA-Z0-9_\\-][^:]{0,${_emojiInnerQuantifier}}):`,
  'g'
)

// --- Nostr bech32 (after "nostr:") ------------------------------------------

/** Standard npub / note payload length in hex */
export const BECH32_NPUB = 'npub1[a-z0-9]{58}'
export const BECH32_NPROFILE = 'nprofile1[a-z0-9]+'
export const BECH32_NOTE = 'note1[a-z0-9]{58}'
export const BECH32_NEVENT = 'nevent1[a-z0-9]+'
export const BECH32_NADDR = 'naddr1[a-z0-9]+'

/** AsciiDoc / forgiving passes: allow longer npub/note encodings ({58,}) */
export const BECH32_NPUB_LOOSE = 'npub1[a-z0-9]{58,}'
export const BECH32_NOTE_LOOSE = 'note1[a-z0-9]{58,}'

/** All kinds we render from note content (strict lengths for Markdown / parseContent) */
export const NOSTR_CONTENT_BECH32_ALT = [
  BECH32_NPUB,
  BECH32_NPROFILE,
  BECH32_NOTE,
  BECH32_NEVENT,
  BECH32_NADDR
].join('|')

/** AsciiDoc early conversion + text-node extraction (loose npub/note) */
export const NOSTR_ASCIIDOC_SOURCE_BECH32_ALT = [
  BECH32_NPUB_LOOSE,
  BECH32_NPROFILE,
  BECH32_NOTE_LOOSE,
  BECH32_NEVENT,
  BECH32_NADDR
].join('|')

/** Relaxed tail for HTML href / fallback matching (naddr can be very long) */
export const NOSTR_HTML_BECH32_RELAXED = '(?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]{20,}'

export const NOSTR_PROFILE_BECH32_ALT = [BECH32_NPUB, BECH32_NPROFILE].join('|')
export const NOSTR_EVENT_BECH32_ALT = [BECH32_NOTE, BECH32_NEVENT, BECH32_NADDR].join('|')
export const NOSTR_NOTE_AND_NEVENT_ALT = [BECH32_NOTE, BECH32_NEVENT].join('|')

/** nostr:… anywhere in text (Markdown inline, relay scan, editor, preprocess) */
export const NOSTR_URI_INLINE_REGEX = new RegExp(`nostr:(${NOSTR_CONTENT_BECH32_ALT})`, 'g')

/** parseContent: profile mentions only */
export const EMBEDDED_MENTION_REGEX = new RegExp(`nostr:(${NOSTR_PROFILE_BECH32_ALT})`, 'g')

/** parseContent: embedded notes (note / nevent / naddr) */
export const EMBEDDED_EVENT_REGEX = new RegExp(`nostr:(${NOSTR_EVENT_BECH32_ALT})`, 'g')

/** event helpers: note + nevent only */
export const NOSTR_EMBEDDED_NOTE_REGEX = new RegExp(`nostr:(${NOSTR_NOTE_AND_NEVENT_ALT})`, 'g')

/** naddr-only (e.g. URL / deep links) */
export const NOSTR_URI_NADDR_REGEX = new RegExp(`nostr:(${BECH32_NADDR})`, 'g')

/** Post editor / reply pubkey scan: npub, nprofile, note, nevent (not naddr) */
export const NOSTR_URI_FOR_REPLY_PUBKEYS_REGEX = new RegExp(
  `nostr:(${[BECH32_NPUB, BECH32_NPROFILE, BECH32_NOTE, BECH32_NEVENT].join('|')})`,
  'g'
)

/** Legacy bare bech32 (no nostr: prefix) */
export const LEGACY_PROFILE_BECH32_REGEX = new RegExp(`${BECH32_NPUB}|${BECH32_NPROFILE}`, 'g')

/** nostr-parser.tsx: boundary + lookahead so punctuation does not stick to bech32 */
export const NOSTR_PARSER_LOOKAHEAD = '(?=\\s|$|>|\\]|,|\\.|!|\\?|;|:)'
export const NOSTR_PARSER_REGEX = new RegExp(
  `(?:^|\\s|>|\\[)nostr:(${NOSTR_CONTENT_BECH32_ALT})${NOSTR_PARSER_LOOKAHEAD}`,
  'g'
)

/** AsciiDoc: optional [] after nostr id */
export const NOSTR_ASCIIDOC_EARLY_LINK_REGEX = new RegExp(
  `nostr:(${NOSTR_ASCIIDOC_SOURCE_BECH32_ALT})(\\[\\])?`,
  'g'
)

/** AsciiDoc HTML: same capture groups as early link, for text-node scanning */
export const NOSTR_ASCIIDOC_TEXT_NODE_REGEX = new RegExp(
  `nostr:(${NOSTR_ASCIIDOC_SOURCE_BECH32_ALT})(\\[\\])?`,
  'g'
)
