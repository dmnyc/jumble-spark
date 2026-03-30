import { ExtendedKind, SUPPORTED_KINDS } from '@/constants'
import { kinds } from 'nostr-tools'

/** Kinds the main `Note` component renders with a dedicated UI (not `UnknownNote`). */
const RENDERABLE_NOTE_KINDS = new Set<number>([
  ...SUPPORTED_KINDS,
  kinds.Reaction,
  ExtendedKind.EXTERNAL_REACTION,
  ExtendedKind.POLL_RESPONSE,
  kinds.CommunityDefinition,
  kinds.LiveEvent,
  ExtendedKind.GROUP_METADATA,
  ExtendedKind.PUBLIC_MESSAGE,
  ExtendedKind.ZAP_REQUEST,
  ExtendedKind.ZAP_RECEIPT,
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.FOLLOW_PACK,
  ExtendedKind.CITATION_INTERNAL,
  ExtendedKind.CITATION_EXTERNAL,
  ExtendedKind.CITATION_HARDCOPY,
  ExtendedKind.CITATION_PROMPT,
  ExtendedKind.ZAP_POLL,
  ExtendedKind.WEB_BOOKMARK
])

/**
 * Every kind the main `Note` component renders with a dedicated UI (not the unknown-event fallback).
 * Used by the notifications spell client filter so mention events use the same cards as elsewhere.
 */
export const RENDERABLE_NOTE_KINDS_SORTED = [...RENDERABLE_NOTE_KINDS].sort((a, b) => a - b)

export function isRenderableNoteKind(kind: number): boolean {
  return RENDERABLE_NOTE_KINDS.has(kind)
}
