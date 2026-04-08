import {
  getParentEventHexId,
  getQuotedEventHexIdFromQTags,
  getRootATag,
  getRootEventHexId,
  isNip25ReactionKind,
  kind1QuotesThreadRoot,
  resolveDeclaredThreadRootEventHex
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

const THREAD_PARENT_WALK_MAX = 14

/**
 * Whether a note (hex id) sits in the thread under `rootHexLower`: it is the root, declares that root,
 * or we can reach the root by walking `e` parents in the session cache.
 */
function hexNoteParticipatesInThread(noteHexLower: string, rootHexLower: string): boolean {
  const root = rootHexLower.trim().toLowerCase()
  const start = noteHexLower.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(start)) return false
  if (start === root) return true

  const seen = new Set<string>()
  let curId: string | undefined = start

  for (let hop = 0; hop < THREAD_PARENT_WALK_MAX && curId; hop++) {
    const k = curId.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    if (k === root) return true

    const ev = client.peekSessionCachedEvent(k)
    if (!ev) return false
    if (ev.id.toLowerCase() === root) return true

    const declaredRoot = getRootEventHexId(ev)?.toLowerCase()
    if (declaredRoot === root) return true

    const parent = getParentEventHexId(ev)?.toLowerCase()
    if (!parent || !/^[0-9a-f]{64}$/i.test(parent)) return false
    curId = parent
  }
  return false
}

/** Reply whose direct parent is a zap receipt whose zapped note is in this thread (OP or nested under OP). */
function replyParentIsZapToThreadHex(reply: Event, rootHexLower: string): boolean {
  const parentHex = getParentEventHexId(reply)
  if (!parentHex || !/^[0-9a-f]{64}$/i.test(parentHex)) return false
  const pl = parentHex.toLowerCase()
  if (pl === rootHexLower) return false
  const parentEv = client.peekSessionCachedEvent(pl)
  if (!parentEv || parentEv.kind !== kinds.Zap) return false
  const zapped = getZapInfoFromEvent(parentEv)?.originalEventId
  if (!zapped || !/^[0-9a-f]{64}$/i.test(zapped)) return false
  return hexNoteParticipatesInThread(zapped.toLowerCase(), rootHexLower)
}

function reactionTargetNoteHex(reaction: Event): string | undefined {
  const fromParent = getParentEventHexId(reaction)
  if (fromParent && /^[0-9a-f]{64}$/i.test(fromParent)) return fromParent.toLowerCase()
  const first = getFirstHexEventIdFromETags(reaction.tags)
  if (first && /^[0-9a-f]{64}$/i.test(first)) return first.toLowerCase()
  return undefined
}

/** Reply whose direct parent is a reaction to some note in this thread (OP or a nested reply under OP). */
function replyParentIsReactionToThreadHex(reply: Event, rootHexLower: string): boolean {
  const parentHex = getParentEventHexId(reply)
  if (!parentHex || !/^[0-9a-f]{64}$/i.test(parentHex)) return false
  const pl = parentHex.toLowerCase()
  if (pl === rootHexLower) return false
  const parentEv = client.peekSessionCachedEvent(pl)
  if (!parentEv || !isNip25ReactionKind(parentEv.kind)) return false
  const targetHex = reactionTargetNoteHex(parentEv)
  if (!targetHex) return false
  return hexNoteParticipatesInThread(targetHex, rootHexLower)
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
    // Some clients omit the root I tag on nested replies. Walk one level up via the session
    // cache: if the declared root or direct parent is a URL-thread comment, accept this event.
    const urlMatchesRoot = (hexId: string | undefined): boolean => {
      if (!hexId || !/^[0-9a-f]{64}$/i.test(hexId)) return false
      const ancestor = client.peekSessionCachedEvent(hexId.toLowerCase())
      if (!ancestor) return false
      const aUrl = getArticleUrlFromCommentITags(ancestor)
      return !!aUrl && canonicalizeRssArticleUrl(aUrl) === canonicalizeRssArticleUrl(root.id)
    }
    if (urlMatchesRoot(getRootEventHexId(evt))) return true
    if (urlMatchesRoot(getParentEventHexId(evt))) return true
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
  if (evtRootHex && resolveDeclaredThreadRootEventHex(evtRootHex) === rid) return true
  if (replyParentIsZapToThreadHex(evt, rid)) return true
  if (replyParentIsReactionToThreadHex(evt, rid)) return true
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
