import {
  getParentEventHexId,
  getQuotedEventHexIdFromQTags,
  getRootATag,
  getRootEventHexId,
  isNip25ReactionKind,
  kind1QuotesThreadRoot
} from '@/lib/event'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { getFirstHexEventIdFromETags } from '@/lib/tag'
import {
  canonicalizeRssArticleUrl,
  getArticleUrlFromCommentITags,
  getHighlightSourceHttpUrl
} from '@/lib/rss-article'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/** Reply whose direct parent is a zap receipt for this thread root (hex id). */
function replyParentIsZapToRootHex(reply: Event, rootHexLower: string): boolean {
  const parentHex = getParentEventHexId(reply)
  if (!parentHex || !/^[0-9a-f]{64}$/i.test(parentHex)) return false
  const pl = parentHex.toLowerCase()
  if (pl === rootHexLower) return false
  const parentEv = client.peekSessionCachedEvent(pl)
  if (!parentEv || parentEv.kind !== kinds.Zap) return false
  const zapped = getZapInfoFromEvent(parentEv)?.originalEventId
  return (
    !!zapped &&
    /^[0-9a-f]{64}$/i.test(zapped) &&
    zapped.toLowerCase() === rootHexLower
  )
}

function reactionTargetNoteHex(reaction: Event): string | undefined {
  const fromParent = getParentEventHexId(reaction)
  if (fromParent && /^[0-9a-f]{64}$/i.test(fromParent)) return fromParent.toLowerCase()
  const first = getFirstHexEventIdFromETags(reaction.tags)
  if (first && /^[0-9a-f]{64}$/i.test(first)) return first.toLowerCase()
  return undefined
}

/** Reply whose direct parent is a NIP-25 / kind-17 reaction to this thread root note. */
function replyParentIsReactionToRootHex(reply: Event, rootHexLower: string): boolean {
  const parentHex = getParentEventHexId(reply)
  if (!parentHex || !/^[0-9a-f]{64}$/i.test(parentHex)) return false
  const pl = parentHex.toLowerCase()
  if (pl === rootHexLower) return false
  const parentEv = client.peekSessionCachedEvent(pl)
  if (!parentEv || !isNip25ReactionKind(parentEv.kind)) return false
  return reactionTargetNoteHex(parentEv) === rootHexLower
}

/** Matches `ReplyNoteList` / discussion thread root shapes. */
export type TThreadRootRef =
  | { type: 'E'; id: string; pubkey: string }
  | { type: 'A'; id: string; eventId: string; pubkey: string; relay?: string }
  | { type: 'I'; id: string }

/** Whether a newly published/fetched reply belongs to the thread rooted at `root`. */
export function eventReplyMatchesThreadRoot(evt: Event, root: TThreadRootRef): boolean {
  if (root.type === 'I') {
    const u = getArticleUrlFromCommentITags(evt)
    if (u && canonicalizeRssArticleUrl(u) === canonicalizeRssArticleUrl(root.id)) return true
    if (evt.kind === kinds.Highlights) {
      const hu = getHighlightSourceHttpUrl(evt)
      return !!hu && canonicalizeRssArticleUrl(hu) === canonicalizeRssArticleUrl(root.id)
    }
    return false
  }
  if (root.type === 'A') {
    const coord = getRootATag(evt)?.[1]
    if (coord === root.id) return true
    const rootHex = getRootEventHexId(evt)
    if (rootHex && (rootHex === root.eventId || rootHex === root.id)) return true
    return kind1QuotesThreadRoot(evt, root)
  }
  const rid = root.id.trim().toLowerCase()
  const evtRootHex = getRootEventHexId(evt)?.toLowerCase()
  if (evtRootHex === rid) return true
  if (replyParentIsZapToRootHex(evt, rid)) return true
  if (replyParentIsReactionToRootHex(evt, rid)) return true
  return kind1QuotesThreadRoot(evt, root)
}

/**
 * Whether `evt` should appear in the reply list for note `opEvent` with thread root `root`.
 * Stricter than treating any kind-1 with an `e` tag as a reply: requires thread root / #q to match (so notes that only
 * tag the quoted inner note as `e`+`root` do not show under the quoter's thread).
 * For quote posts, also drops kind-1 replies whose **parent** is the embedded quoted id but not the OP.
 */
export function replyBelongsToNoteThread(evt: Event, opEvent: Event, root: TThreadRootRef): boolean {
  if (root.type === 'I') {
    return eventReplyMatchesThreadRoot(evt, root)
  }
  if (!eventReplyMatchesThreadRoot(evt, root)) return false
  if (root.type === 'A') return true

  if (opEvent.kind !== kinds.ShortTextNote) return true
  const quotedHex = getQuotedEventHexIdFromQTags(opEvent)?.toLowerCase()
  if (!quotedHex) return true
  const parentHex = getParentEventHexId(evt)?.toLowerCase()
  if (!parentHex) return true
  const rootId = root.id.trim().toLowerCase()
  if (parentHex === quotedHex && parentHex !== rootId) return false
  return true
}
