import type { Event } from 'nostr-tools'

/**
 * NIP-84 / Web Annotation style `textquoteselector` (prefix + exact + suffix).
 * `exact` is always {@link Event.content}; prefix/suffix are adjacent source text.
 *
 * Common shapes:
 * - `["textquoteselector", prefix, suffix]` (3 items)
 * - `["textquoteselector", "-", prefix, suffix]` — leading "-" = empty slot (Hypothesis-style)
 */
export function parseTextQuoteSelectorParts(tag: readonly string[]): { prefix: string; suffix: string } {
  if (tag.length < 2 || tag[0] !== 'textquoteselector') {
    return { prefix: '', suffix: '' }
  }
  if (tag.length >= 4 && tag[1] === '-') {
    return {
      prefix: (tag[2] ?? '').trim(),
      suffix: (tag[3] ?? '').trim()
    }
  }
  if (tag.length >= 3) {
    return {
      prefix: (tag[1] ?? '').trim(),
      suffix: (tag[2] ?? '').trim()
    }
  }
  return { prefix: '', suffix: '' }
}

/** `["textpositionselector", start, end]` — character offsets into a full document string. */
export function parseTextPositionSelector(tag: readonly string[]): { start: number; end: number } | null {
  if (tag.length < 3 || tag[0] !== 'textpositionselector') return null
  const start = parseInt(tag[1] ?? '', 10)
  const end = parseInt(tag[2] ?? '', 10)
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end <= start) return null
  return { start, end }
}

export type Nip84HighlightDisplay = {
  /** Full passage to show in the quote box */
  fullText: string
  /** Substring of fullText to wrap in <mark> */
  markedSpan: string
}

/**
 * Resolve which span to mark inside which full text, using `context`, `textquoteselector`,
 * and optionally `textpositionselector` (only when offsets fit the base string).
 */
export function resolveNip84HighlightDisplay(event: Pick<Event, 'content' | 'tags'>): Nip84HighlightDisplay {
  const highlightedText = event.content ?? ''
  const tags = event.tags

  const contextTag = tags.find((t) => t[0] === 'context')
  const contextBody = contextTag?.[1]?.trim() ? contextTag[1] : undefined

  const posTag = tags.find((t) => t[0] === 'textpositionselector')
  const pos = posTag ? parseTextPositionSelector(posTag) : null

  if (contextBody && pos) {
    const { start, end } = pos
    if (end <= contextBody.length) {
      const slice = contextBody.slice(start, end)
      if (slice.length > 0) {
        return { fullText: contextBody, markedSpan: slice }
      }
    }
  }

  if (contextBody) {
    return { fullText: contextBody, markedSpan: highlightedText }
  }

  const tqs = tags.find((t) => t[0] === 'textquoteselector')
  if (tqs) {
    const { prefix, suffix } = parseTextQuoteSelectorParts(tqs)
    const fullText = `${prefix}${highlightedText}${suffix}`
    return { fullText, markedSpan: highlightedText }
  }

  return { fullText: highlightedText, markedSpan: highlightedText }
}
