import { ExtendedKind, SUPPORTED_KINDS } from '@/constants'
import { kinds } from 'nostr-tools'

/** Kinds the main `Note` component renders with a dedicated UI (not `UnknownNote`). */
const RENDERABLE_NOTE_KINDS = new Set<number>([
  ...SUPPORTED_KINDS,
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
  ExtendedKind.CITATION_PROMPT
])

export function isRenderableNoteKind(kind: number): boolean {
  return RENDERABLE_NOTE_KINDS.has(kind)
}
