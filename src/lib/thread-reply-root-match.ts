import { getRootATag, getRootEventHexId } from '@/lib/event'
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
    return false
  }
  return getRootEventHexId(evt) === root.id
}
