import { ExtendedKind } from '@/constants'
import { getParentATag, getParentETag, getQuotedReferenceFromQTags } from '@/lib/event'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/**
 * Get the description for a given kind number
 * @param kind - The kind number
 * @param event - When set, refines kind 1 (e.g. NIP-18 quote without thread parent → "Quote Note")
 * @returns An object with the kind number and description
 */
export function getKindDescription(
  kind: number,
  event?: Event
): { number: number; description: string } {
  switch (kind) {
    case kinds.ShortTextNote:
      if (
        event &&
        getQuotedReferenceFromQTags(event) &&
        !getParentETag(event) &&
        !getParentATag(event)
      ) {
        return { number: 1, description: 'Quote Note' }
      }
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
    case ExtendedKind.ZAP_POLL:
      return { number: 6969, description: 'Zap poll' }
    case ExtendedKind.PUBLIC_MESSAGE:
      return { number: 24, description: 'Public Message' }
    case ExtendedKind.DISCUSSION:
      return { number: 11, description: 'Discussion' }
    case kinds.Metadata:
      return { number: 0, description: 'Profile metadata' }
    case kinds.Repost:
      return { number: 6, description: 'Repost' }
    case ExtendedKind.GENERIC_REPOST:
      return { number: 16, description: 'Generic repost' }
    case kinds.Reaction:
      return { number: 7, description: 'Reaction' }
    case ExtendedKind.EXTERNAL_REACTION:
      return { number: 17, description: 'External reaction' }
    case kinds.CommunityDefinition:
      return { number: 34550, description: 'Community' }
    case kinds.LiveEvent:
      return { number: 30311, description: 'Live event' }
    case ExtendedKind.ZAP_REQUEST:
      return { number: 9734, description: 'Zap request' }
    case ExtendedKind.ZAP_RECEIPT:
      return { number: 9735, description: 'Zap receipt' }
    case ExtendedKind.RELAY_REVIEW:
      return { number: 31987, description: 'Relay review' }
    case ExtendedKind.PUBLICATION:
      return { number: 30040, description: 'Publication' }
    case ExtendedKind.CALENDAR_EVENT_DATE:
      return { number: 31922, description: 'Calendar event (date)' }
    case ExtendedKind.CALENDAR_EVENT_TIME:
      return { number: 31923, description: 'Calendar event (time)' }
    case ExtendedKind.CALENDAR_EVENT_RSVP:
      return { number: 31925, description: 'Calendar RSVP' }
    case ExtendedKind.POLL_RESPONSE:
      return { number: 1018, description: 'Poll vote' }
    case ExtendedKind.FOLLOW_PACK:
      return { number: 39089, description: 'Follow pack' }
    case ExtendedKind.GROUP_METADATA:
      return { number: 39000, description: 'Group metadata' }
    case ExtendedKind.APPLICATION_HANDLER_INFO:
      return { number: 31990, description: 'Application handler' }
    case ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION:
      return { number: 31989, description: 'Handler recommendation' }
    case ExtendedKind.SPELL:
      return { number: 777, description: 'Spell / filter' }
    case ExtendedKind.RSS_THREAD_ROOT:
      return { number: 99999, description: 'Web article thread' }
    case ExtendedKind.FILE_METADATA:
      return { number: 1063, description: 'File metadata' }
    case ExtendedKind.REPORT:
      return { number: 1984, description: 'Report' }
    case ExtendedKind.WEB_BOOKMARK:
      return { number: 39701, description: 'Web bookmark' }
    default:
      return { number: kind, description: `Event (kind ${kind})` }
  }
}

