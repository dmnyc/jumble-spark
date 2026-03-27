import {
  getParentEventHexId,
  getQuotedEventHexIdFromQTags,
  getRootATag,
  getRootEventHexId,
  kind1QuotesThreadRoot
} from '@/lib/event'
import {
  canonicalizeRssArticleUrl,
  getArticleUrlFromCommentITags,
  getHighlightSourceHttpUrl
} from '@/lib/rss-article'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

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
  if (getRootEventHexId(evt) === root.id) return true
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
