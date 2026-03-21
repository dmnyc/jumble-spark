import { ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'

/**
 * Get the description for a given kind number
 * @param kind - The kind number
 * @returns An object with the kind number and description
 */
export function getKindDescription(kind: number): { number: number; description: string } {
  switch (kind) {
    case kinds.ShortTextNote:
      return { number: 1, description: 'Short Text Note' }
    case ExtendedKind.COMMENT:
      return { number: 1111, description: 'Comment' }
    case ExtendedKind.VOICE:
      return { number: 1222, description: 'Voice Note' }
    case ExtendedKind.VOICE_COMMENT:
      return { number: 1244, description: 'Voice Comment' }
    case ExtendedKind.PICTURE:
      return { number: 20, description: 'Picture Note' }
    case ExtendedKind.VIDEO:
      return { number: 21, description: 'Video Note' }
    case ExtendedKind.SHORT_VIDEO:
      return { number: 22, description: 'Short Video Note' }
    case kinds.LongFormArticle:
      return { number: 30023, description: 'Long-form Article' }
    case ExtendedKind.WIKI_ARTICLE:
      return { number: 30818, description: 'Wiki Article (AsciiDoc)' }
    case ExtendedKind.WIKI_ARTICLE_MARKDOWN:
      return { number: 30817, description: 'Wiki Article (Markdown)' }
    case ExtendedKind.PUBLICATION_CONTENT:
      return { number: 30041, description: 'Publication Content' }
    case ExtendedKind.CITATION_INTERNAL:
      return { number: 30, description: 'Internal Citation' }
    case ExtendedKind.CITATION_EXTERNAL:
      return { number: 31, description: 'External Web Citation' }
    case ExtendedKind.CITATION_HARDCOPY:
      return { number: 32, description: 'Hardcopy Citation' }
    case ExtendedKind.CITATION_PROMPT:
      return { number: 33, description: 'Prompt Citation' }
    case kinds.Highlights:
      return { number: 9802, description: 'Highlight' }
    case ExtendedKind.POLL:
      return { number: 1068, description: 'Poll' }
    case ExtendedKind.PUBLIC_MESSAGE:
      return { number: 24, description: 'Public Message' }
    case ExtendedKind.DISCUSSION:
      return { number: 11, description: 'Discussion' }
    default:
      return { number: kind, description: `Event (kind ${kind})` }
  }
}

