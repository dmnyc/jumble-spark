import { E_TAG_FILTER_BLOCKED_RELAY_URLS, ExtendedKind, THREAD_BACKLINK_STREAM_KINDS } from '@/constants'
import { isDiscussionDownvoteEmoji, isDiscussionUpvoteEmoji } from '@/lib/discussion-votes'
import {
  canonicalizeRssArticleUrl,
  getArticleUrlFromCommentITags,
  getHighlightSourceHttpUrl
} from '@/lib/rss-article'
import {
  getParentATag,
  getParentETag,
  getReplaceableCoordinateFromEvent,
  getRootATag,
  getRootETag,
  getRootEventHexId,
  isNip25ReactionKind,
  isNip56ReportEvent,
  isReplaceableEvent,
  kind1QuotesThreadRoot
} from '@/lib/event'
import logger from '@/lib/logger'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { normalizeUrl } from '@/lib/url'
import { shouldHideThreadResponseEvent } from '@/lib/thread-response-filter'
import { toNote } from '@/lib/link'
import { generateBech32IdFromETag } from '@/lib/tag'
import { useSmartNoteNavigation, useSecondaryPage } from '@/PageManager'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { useReply } from '@/providers/ReplyProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client, { eventService, queryService } from '@/services/client.service'
import noteStatsService from '@/services/note-stats.service'
import discussionFeedCache from '@/services/discussion-feed-cache.service'
import { buildReplyReadRelayList, relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { replyBelongsToNoteThread } from '@/lib/thread-reply-root-match'
import {
  buildRssArticleUrlThreadInteractionFilters,
  isRssArticleUrlThreadInteraction
} from '@/lib/rss-web-feed'
import { Filter, Event as NEvent, kinds } from 'nostr-tools'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useQuoteEvents } from '@/hooks'
import { LoadingBar } from '../LoadingBar'
import ReplyNote, { ReplyNoteSkeleton } from '../ReplyNote'
import ThreadQuoteBacklink, {
  BacklinkAvatarStrip,
  ThreadQuoteBacklinkSkeleton
} from './ThreadQuoteBacklink'

type TRootInfo =
  | { type: 'E'; id: string; pubkey: string }
  | { type: 'A'; id: string; eventId: string; pubkey: string; relay?: string }
  | { type: 'I'; id: string }

const LIMIT = 200
const SHOW_COUNT = 10

function partitionZapReceipts(items: NEvent[]) {
  const zaps: NEvent[] = []
  const nonZaps: NEvent[] = []
  for (const e of items) {
    if (e.kind === kinds.Zap) zaps.push(e)
    else nonZaps.push(e)
  }
  return { zaps, nonZaps }
}

/** Zap receipts (9735) at top of reply feeds: largest sats first */
function sortZapReceiptsBySatsDesc(zaps: NEvent[]) {
  return [...zaps].sort((a, b) => {
    const sa = getZapInfoFromEvent(a)?.amount ?? 0
    const sb = getZapInfoFromEvent(b)?.amount ?? 0
    if (sb !== sa) return sb - sa
    return b.created_at - a.created_at
  })
}

function replyFeedZapsFirst(sortedNonZapReplies: NEvent[], zaps: NEvent[]) {
  return [...sortZapReceiptsBySatsDesc(zaps), ...sortedNonZapReplies]
}

type TBacklinkSubsection = 'primary' | 'bookmark' | 'list' | 'report'

function sortWithinBacklinkGroup(events: NEvent[]): NEvent[] {
  return [...events].sort((a, b) => b.created_at - a.created_at)
}

function backlinkTailSubsection(item: NEvent): TBacklinkSubsection {
  if (isNip56ReportEvent(item)) return 'report'
  if (item.kind === kinds.BookmarkList) return 'bookmark'
  if (
    item.kind === kinds.Pinlist ||
    item.kind === kinds.Genericlists ||
    item.kind === kinds.Bookmarksets ||
    item.kind === kinds.Curationsets
  ) {
    return 'list'
  }
  return 'primary'
}

/** Quotes/highlights/citations → bookmarks → lists → reports; newest first within each group. */
function partitionAndSortBacklinkTail(tail: NEvent[]): NEvent[] {
  const primary: NEvent[] = []
  const bookmarks: NEvent[] = []
  const lists: NEvent[] = []
  const reports: NEvent[] = []
  for (const e of tail) {
    const sub = backlinkTailSubsection(e)
    if (sub === 'report') reports.push(e)
    else if (sub === 'bookmark') bookmarks.push(e)
    else if (sub === 'list') lists.push(e)
    else primary.push(e)
  }
  return [
    ...sortWithinBacklinkGroup(primary),
    ...sortWithinBacklinkGroup(bookmarks),
    ...sortWithinBacklinkGroup(lists),
    ...sortWithinBacklinkGroup(reports)
  ]
}

type TBacklinkDisplayRow =
  | { type: 'reply'; event: NEvent }
  | { type: 'backlink-run'; subsection: TBacklinkSubsection; events: NEvent[] }

function buildVisibleBacklinkRows(
  visibleFeed: NEvent[],
  quoteUiIdSet: Set<string>
): TBacklinkDisplayRow[] {
  const rows: TBacklinkDisplayRow[] = []
  let i = 0
  while (i < visibleFeed.length) {
    const item = visibleFeed[i]
    if (!quoteUiIdSet.has(item.id)) {
      rows.push({ type: 'reply', event: item })
      i++
      continue
    }
    const sub = backlinkTailSubsection(item)
    const run: NEvent[] = []
    while (
      i < visibleFeed.length &&
      quoteUiIdSet.has(visibleFeed[i].id) &&
      backlinkTailSubsection(visibleFeed[i]) === sub
    ) {
      run.push(visibleFeed[i])
      i++
    }
    if (run.length > 0) {
      rows.push({ type: 'backlink-run', subsection: sub, events: run })
    }
  }
  return rows
}

function backlinkRunSectionClass(
  subsection: TBacklinkSubsection,
  prev: TBacklinkDisplayRow | undefined
): string {
  if (!prev) {
    return subsection === 'report'
      ? 'mb-3 pt-1'
      : 'mb-3 pt-1'
  }
  if (prev.type === 'reply') {
    return subsection === 'report'
      ? 'mt-8 mb-3 border-t border-amber-500/40 pt-6 dark:border-amber-400/30'
      : 'mt-8 mb-3 border-t border-border/60 pt-6'
  }
  return subsection === 'report'
    ? 'mt-6 mb-3 border-t border-amber-500/40 pt-4 dark:border-amber-400/30'
    : 'mt-6 mb-3 border-t border-border/60 pt-4'
}

/** Preserve order except NIP-56 reports move to the end (after all non-reports). */
function moveReportsToEndPreserveOrder(events: NEvent[]): NEvent[] {
  const non = events.filter((e) => !isNip56ReportEvent(e))
  const rep = events.filter((e) => isNip56ReportEvent(e))
  return [...non, ...rep]
}

/** Shown after thread replies for E/A roots (quote stream + kind 1 #q-only); matches {@link THREAD_BACKLINK_STREAM_KINDS}. */
const EA_THREAD_TAIL_REFERENCE_KINDS = new Set<number>(THREAD_BACKLINK_STREAM_KINDS)

/** Web (NIP-22) thread: tail = reference-style rows + URL-scoped reactions (same block order as E/A). */
const WEB_THREAD_EXTRA_TAIL_KINDS = new Set<number>([kinds.Reaction, ExtendedKind.EXTERNAL_REACTION])

function isWebThreadTailKind(kind: number): boolean {
  return EA_THREAD_TAIL_REFERENCE_KINDS.has(kind) || WEB_THREAD_EXTRA_TAIL_KINDS.has(kind)
}

function threadBacklinkRelationLabel(item: NEvent, t: TFunction): string {
  if (item.kind === kinds.Highlights) return t('highlighted this note')
  if (item.kind === kinds.ShortTextNote) return t('quoted this note')
  if (
    item.kind === kinds.LongFormArticle ||
    item.kind === ExtendedKind.WIKI_ARTICLE ||
    item.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN ||
    item.kind === ExtendedKind.PUBLICATION_CONTENT
  ) {
    return t('cited in article')
  }
  if (item.kind === kinds.Label) return t('labeled this note')
  if (isNip56ReportEvent(item)) return t('reported this note')
  if (item.kind === kinds.BookmarkList) return t('bookmarked this note')
  if (item.kind === kinds.Pinlist) return t('pinned this note')
  if (item.kind === kinds.Genericlists) return t('listed this note')
  if (item.kind === kinds.Bookmarksets) return t('bookmark set reference')
  if (item.kind === kinds.Curationsets) return t('curated this note')
  if (item.kind === kinds.BadgeAward) return t('badge award for this note')
  return t('referenced this note')
}

function isKind1QuoteOnlyOfEaRoot(evt: NEvent, root: TRootInfo): boolean {
  if (root.type === 'I') return false
  if (evt.kind !== kinds.ShortTextNote) return false
  if (getParentETag(evt) || getParentATag(evt)) return false
  return kind1QuotesThreadRoot(evt, root)
}

function ReplyNoteList({
  index,
  event,
  sort = 'oldest',
  showQuotes = true,
  duplicateWebPreviewCleanedUrlHints
}: {
  index?: number
  event: NEvent
  sort?: 'newest' | 'oldest' | 'top' | 'controversial' | 'most-zapped'
  /** When false, omit the quotes section (e.g. discussion threads). */
  showQuotes?: boolean
  /** Suppress WebPreview for these URLs in replies (e.g. article URL already shown as OP). */
  duplicateWebPreviewCleanedUrlHints?: string[]
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const { currentIndex } = useSecondaryPage()
  const { hideUntrustedInteractions, isUserTrusted, isTrustLoaded } = useUserTrust()
  const noteStats = useNoteStatsById(event.id)
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const { pubkey: userPubkey } = useNostr()
  const { blockedRelays } = useFavoriteRelays()
  const { relayUrls: browsingRelayUrls } = useCurrentRelays()
  const [rootInfo, setRootInfo] = useState<TRootInfo | undefined>(undefined)
  const { repliesMap, addReplies } = useReply()
  const { quoteEvents, quoteLoading } = useQuoteEvents(
    event,
    showQuotes ?? false
  )
  const filteredQuoteEvents = useMemo(
    () =>
      quoteEvents.filter(
        (e) =>
          !shouldHideThreadResponseEvent(
            e,
            mutePubkeySet,
            hideContentMentioningMutedUsers
          )
      ),
    [quoteEvents, mutePubkeySet, hideContentMentioningMutedUsers]
  )

  const isDiscussionRoot = event.kind === ExtendedKind.DISCUSSION

  const replyDuplicateWebPreviewHints = useMemo(() => {
    const out: string[] = [...(duplicateWebPreviewCleanedUrlHints ?? [])]
    if (rootInfo?.type === 'I') out.push(rootInfo.id)
    return out.length ? out : undefined
  }, [duplicateWebPreviewCleanedUrlHints, rootInfo])

  // Helper function to get vote score for a reply
  const getReplyVoteScore = (reply: NEvent) => {
    const stats = noteStatsService.getNoteStats(reply.id)
    if (!stats?.likes) {
      return 0
    }

    const upvoteReactions = stats.likes.filter((r) =>
      isDiscussionRoot ? isDiscussionUpvoteEmoji(r.emoji) : r.emoji === '⬆️'
    )
    const downvoteReactions = stats.likes.filter((r) =>
      isDiscussionRoot ? isDiscussionDownvoteEmoji(r.emoji) : r.emoji === '⬇️'
    )
    const score = upvoteReactions.length - downvoteReactions.length

    return score
  }

  // Helper function to get controversy score for a reply
  const getReplyControversyScore = (reply: NEvent) => {
    const stats = noteStatsService.getNoteStats(reply.id)
    if (!stats?.likes) {
      return 0
    }

    const upvoteReactions = stats.likes.filter((r) =>
      isDiscussionRoot ? isDiscussionUpvoteEmoji(r.emoji) : r.emoji === '⬆️'
    )
    const downvoteReactions = stats.likes.filter((r) =>
      isDiscussionRoot ? isDiscussionDownvoteEmoji(r.emoji) : r.emoji === '⬇️'
    )
    
    // Controversy = minimum of upvotes and downvotes (both need to be high)
    const controversy = Math.min(upvoteReactions.length, downvoteReactions.length)
    return controversy
  }

  // Helper function to get total zap amount for a reply
  const getReplyZapAmount = (reply: NEvent) => {
    const stats = noteStatsService.getNoteStats(reply.id)
    if (!stats?.zaps) {
      return 0
    }
    
    const totalAmount = stats.zaps.reduce((sum, zap) => sum + zap.amount, 0)
    return totalAmount
  }
  const replies = useMemo(() => {
    const replyIdSet = new Set<string>()
    const replyEvents: NEvent[] = []
    const currentEventKey = isReplaceableEvent(event.kind)
      ? getReplaceableCoordinateFromEvent(event)
      : /^[0-9a-f]{64}$/i.test(event.id) ? event.id.toLowerCase() : event.id
    // For replaceable events, also check the event ID in case replies are stored there
    const eventIdKey = /^[0-9a-f]{64}$/i.test(event.id) ? event.id.toLowerCase() : event.id
    let parentEventKeys = [currentEventKey]
    if (isReplaceableEvent(event.kind) && currentEventKey !== eventIdKey) {
      parentEventKeys.push(eventIdKey)
    }
    // Web article threads: kind 1111 replies use #i (URL) only — ReplyProvider keys them by canonical URL, not synthetic root id.
    if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
      const u = getArticleUrlFromCommentITags(event)
      if (u) {
        const canon = canonicalizeRssArticleUrl(u)
        if (!parentEventKeys.includes(canon)) {
          parentEventKeys = [canon, ...parentEventKeys]
        }
      }
    }

    
    const processedEventIds = new Set<string>() // Prevent infinite loops
    let iterationCount = 0
    const MAX_ITERATIONS = 10 // Prevent infinite loops
    
    while (parentEventKeys.length > 0 && iterationCount < MAX_ITERATIONS) {
      iterationCount++
      const events = parentEventKeys.flatMap((id) => repliesMap.get(id)?.events || [])
      
      events.forEach((evt) => {
        if (replyIdSet.has(evt.id)) return
        if (isNip25ReactionKind(evt.kind)) return
        if (
          shouldHideThreadResponseEvent(
            evt,
            mutePubkeySet,
            hideContentMentioningMutedUsers
          )
        ) {
          return
        }
        if (rootInfo && !replyBelongsToNoteThread(evt, event, rootInfo)) return

        replyIdSet.add(evt.id)
        replyEvents.push(evt)
      })
      
      // Prevent infinite loops by tracking processed event IDs
      const newParentEventKeys = events
        .filter((evt) => !isNip25ReactionKind(evt.kind))
        .map((evt) => evt.id)
        .filter((id) => !processedEventIds.has(id))
      
      newParentEventKeys.forEach((id) => processedEventIds.add(id))
      parentEventKeys = newParentEventKeys
    }
    
    if (iterationCount >= MAX_ITERATIONS) {
      logger.warn('ReplyNoteList: Maximum iterations reached, possible circular reference in replies')
    }
    


    const { zaps, nonZaps } = partitionZapReceipts(replyEvents)

    // Sort notes/comments; zap receipts (9735) are always listed first, largest sats → smallest
    switch (sort) {
      case 'oldest':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => a.created_at - b.created_at),
          zaps
        )
      case 'newest':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => b.created_at - a.created_at),
          zaps
        )
      case 'top':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => {
            const scoreA = getReplyVoteScore(a)
            const scoreB = getReplyVoteScore(b)
            if (scoreA !== scoreB) {
              return scoreB - scoreA
            }
            return b.created_at - a.created_at
          }),
          zaps
        )
      case 'controversial':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => {
            const controversyA = getReplyControversyScore(a)
            const controversyB = getReplyControversyScore(b)
            if (controversyA !== controversyB) {
              return controversyB - controversyA
            }
            return b.created_at - a.created_at
          }),
          zaps
        )
      case 'most-zapped':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => {
            const zapAmountA = getReplyZapAmount(a)
            const zapAmountB = getReplyZapAmount(b)
            if (zapAmountA !== zapAmountB) {
              return zapAmountB - zapAmountA
            }
            return b.created_at - a.created_at
          }),
          zaps
        )
      default:
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => b.created_at - a.created_at),
          zaps
        )
    }
  }, [
    event,
    rootInfo,
    repliesMap,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    sort
  ])

  const replyIdSet = useMemo(() => new Set(replies.map((r) => r.id)), [replies])
  /** Render with quote card chrome (tail stream + kind 1 #q-only of E/A root). */
  const quoteUiIdSet = useMemo(() => {
    const s = new Set(filteredQuoteEvents.map((e) => e.id))
    if (rootInfo?.type === 'E' || rootInfo?.type === 'A') {
      for (const r of replies) {
        if (isKind1QuoteOnlyOfEaRoot(r, rootInfo)) s.add(r.id)
      }
    }
    if (rootInfo?.type === 'I') {
      for (const r of replies) {
        if (EA_THREAD_TAIL_REFERENCE_KINDS.has(r.kind)) s.add(r.id)
      }
    }
    return s
  }, [filteredQuoteEvents, replies, rootInfo])
  const mergedFeed = useMemo(() => {
    /** Quotes + time-sorted feeds must not interleave zap receipts chronologically */
    const zapsThenTimeSorted = (merged: NEvent[], direction: 'asc' | 'desc') => {
      const { zaps, nonZaps } = partitionZapReceipts(merged)
      const sortedNon = [...nonZaps].sort((a, b) =>
        direction === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
      )
      return moveReportsToEndPreserveOrder(replyFeedZapsFirst(sortedNon, zaps))
    }

    if (!showQuotes) return replies

    const quoteOnly = filteredQuoteEvents.filter((e) => !replyIdSet.has(e.id))

    // E/A: zaps (sats desc) → thread replies (1 / 1111 / 1244, excluding #q-only) → tail (quotes, highlights, long-form refs)
    if (rootInfo?.type === 'E' || rootInfo?.type === 'A') {
      const { zaps, nonZaps } = partitionZapReceipts(replies)
      const middle = nonZaps.filter((e) => !isKind1QuoteOnlyOfEaRoot(e, rootInfo))
      const qOnlyFromReplies = nonZaps.filter((e) => isKind1QuoteOnlyOfEaRoot(e, rootInfo))
      const tailSeen = new Set<string>()
      const tail: NEvent[] = []
      const pushTail = (e: NEvent) => {
        if (tailSeen.has(e.id)) return
        tailSeen.add(e.id)
        tail.push(e)
      }
      for (const e of qOnlyFromReplies) pushTail(e)
      for (const e of quoteOnly) pushTail(e)
      const tailSorted = partitionAndSortBacklinkTail(tail)
      return [...replyFeedZapsFirst(middle, zaps), ...tailSorted]
    }

    // Web article / URL thread (NIP-22): same zaps → middle → tail layout as E/A
    if (rootInfo?.type === 'I') {
      const { zaps, nonZaps } = partitionZapReceipts(replies)
      const middle = nonZaps.filter((e) => !isWebThreadTailKind(e.kind))
      const tailFromReplies = nonZaps.filter((e) => isWebThreadTailKind(e.kind))
      const tailSeen = new Set<string>()
      const tail: NEvent[] = []
      const pushTail = (e: NEvent) => {
        if (tailSeen.has(e.id)) return
        tailSeen.add(e.id)
        tail.push(e)
      }
      for (const e of tailFromReplies) pushTail(e)
      for (const e of quoteOnly) pushTail(e)
      const tailSorted = partitionAndSortBacklinkTail(tail)
      return [...replyFeedZapsFirst(middle, zaps), ...tailSorted]
    }

    const merged = [...replies, ...quoteOnly]
    if (sort === 'oldest') return zapsThenTimeSorted(merged, 'asc')
    if (sort === 'newest') return zapsThenTimeSorted(merged, 'desc')
    if (sort === 'top' || sort === 'controversial' || sort === 'most-zapped') {
      const replyIds = new Set(replies.map((r) => r.id))
      const sortedReplies = [...replies]
      const qo = merged.filter((e) => !replyIds.has(e.id))
      const sortedQuotes = partitionAndSortBacklinkTail([...qo])
      return [...sortedReplies, ...sortedQuotes]
    }
    return zapsThenTimeSorted(merged, 'desc')
  }, [replies, filteredQuoteEvents, showQuotes, sort, replyIdSet, rootInfo])

  const [timelineKey] = useState<string | undefined>(undefined)
  const [until, setUntil] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState<boolean>(false)
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const [highlightReplyId, setHighlightReplyId] = useState<string | undefined>(undefined)
  const replyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const fetchRootEvent = async () => {
      if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
        const url = getArticleUrlFromCommentITags(event)
        if (url) {
          setRootInfo({ type: 'I', id: canonicalizeRssArticleUrl(url) })
        }
        return
      }

      let root: TRootInfo

      if (isReplaceableEvent(event.kind)) {
        root = {
          type: 'A',
          id: getReplaceableCoordinateFromEvent(event),
          eventId: event.id,
          pubkey: event.pubkey,
          relay: client.getEventHint(event.id)
        }
      } else {
        const eid = event.id
        root = {
          type: 'E',
          id: /^[0-9a-f]{64}$/i.test(eid) ? eid.toLowerCase() : eid,
          pubkey: event.pubkey
        }
      }
      
      const rootETag = getRootETag(event)
      if (rootETag) {
        const [, rootEventHexId, , , rootEventPubkey] = rootETag
        if (rootEventHexId && rootEventPubkey) {
          const hid = rootEventHexId
          root = {
            type: 'E',
            id: /^[0-9a-f]{64}$/i.test(hid) ? hid.toLowerCase() : hid,
            pubkey: rootEventPubkey
          }
        } else {
          const rootEventId = generateBech32IdFromETag(rootETag)
          if (rootEventId) {
            const rootEvent = await eventService.fetchEvent(rootEventId)
            if (rootEvent) {
              const rid = rootEvent.id
              root = {
                type: 'E',
                id: /^[0-9a-f]{64}$/i.test(rid) ? rid.toLowerCase() : rid,
                pubkey: rootEvent.pubkey
              }
            }
          }
        }
      } else if (event.kind === ExtendedKind.COMMENT) {
        const rootATag = getRootATag(event)
        if (rootATag) {
          const [, coordinate, relay] = rootATag
          const [, pubkey] = coordinate.split(':')
          root = { type: 'A', id: coordinate, eventId: event.id, pubkey, relay }
        }
        const rootArticleUrl = getArticleUrlFromCommentITags(event)
        if (rootArticleUrl) {
          root = { type: 'I', id: canonicalizeRssArticleUrl(rootArticleUrl) }
        }
      }
      setRootInfo(root)
    }
    fetchRootEvent()
  }, [event])

  /** When stats saw a URL-thread reply on relays we didn't REQ in the reply list, fetch by id so count matches list. */
  const rssStatsHydratedReplyIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    rssStatsHydratedReplyIdsRef.current.clear()
  }, [event.id])

  useEffect(() => {
    if (event.kind !== ExtendedKind.RSS_THREAD_ROOT || rootInfo?.type !== 'I') return
    const fromStats = noteStats?.replies
    if (!fromStats?.length) return

    const urlKey = canonicalizeRssArticleUrl(rootInfo.id)
    const inBucket = new Set((repliesMap.get(urlKey)?.events ?? []).map((e) => e.id))

    const candidates = fromStats.filter(
      (r) => !inBucket.has(r.id) && !rssStatsHydratedReplyIdsRef.current.has(r.id)
    )
    if (candidates.length === 0) return

    let cancelled = false
    ;(async () => {
      const batch: NEvent[] = []
      for (const { id } of candidates) {
        rssStatsHydratedReplyIdsRef.current.add(id)
        try {
          const ev = await eventService.fetchEvent(id)
          if (cancelled) return
          if (ev && isRssArticleUrlThreadInteraction(ev, rootInfo.id)) {
            batch.push(ev)
          } else {
            rssStatsHydratedReplyIdsRef.current.delete(id)
          }
        } catch {
          rssStatsHydratedReplyIdsRef.current.delete(id)
        }
      }
      if (!cancelled && batch.length > 0) {
        const ok = batch.filter(
          (e) =>
            !shouldHideThreadResponseEvent(
              e,
              mutePubkeySet,
              hideContentMentioningMutedUsers
            )
        )
        if (ok.length > 0) addReplies(ok)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    event.kind,
    event.id,
    rootInfo,
    noteStats?.replies,
    noteStats?.updatedAt,
    repliesMap,
    addReplies,
    mutePubkeySet,
    hideContentMentioningMutedUsers
  ])

  const onNewReply = useCallback(
    (evt: NEvent) => {
      if (
        shouldHideThreadResponseEvent(
          evt,
          mutePubkeySet,
          hideContentMentioningMutedUsers
        )
      ) {
        return
      }
      addReplies([evt])
      if (rootInfo) {
        const cachedReplies = discussionFeedCache.getCachedReplies(rootInfo) || []
        const without = cachedReplies.filter((r) => r.id !== evt.id)
        discussionFeedCache.setCachedReplies(rootInfo, [...without, evt])
      }
    },
    [addReplies, rootInfo, mutePubkeySet, hideContentMentioningMutedUsers]
  )

  useEffect(() => {
    if (!rootInfo) return
    const handleEventPublished = (data: Event) => {
      const ce = data as CustomEvent<NEvent>
      const evt = ce.detail
      if (!evt || !replyBelongsToNoteThread(evt, event, rootInfo)) return
      onNewReply(evt)
    }

    client.addEventListener('newEvent', handleEventPublished)
    return () => {
      client.removeEventListener('newEvent', handleEventPublished)
    }
  }, [rootInfo, event, onNewReply])

  const replyFetchGenRef = useRef(0)

  useEffect(() => {
    if (!rootInfo) return
    // Hidden stack pages pass a numeric index that differs from the top panel's currentIndex.
    // When index is omitted (edge routes), still fetch so replies are not stuck empty.
    if (index !== undefined && currentIndex !== index) return

    const fetchGeneration = ++replyFetchGenRef.current

    const init = async () => {
      // Session LRU (timeline / note-stats / prior panels): thread replies before relay round-trip
      if (rootInfo.type === 'E' || rootInfo.type === 'A') {
        const fromSession = eventService.getSessionThreadInteractionEvents(rootInfo)
        if (fromSession.length > 0) {
          addReplies(fromSession)
        }
      }

      // Check cache next — discussion cache merges with relay results
      const cachedData = discussionFeedCache.getCachedReplies(rootInfo)
      const hasCache = cachedData !== null

      if (hasCache) {
        addReplies(cachedData)
        setLoading(false)
      } else {
        setLoading(true)
      }

      // Always refetch soon so relays fill gaps; no artificial delay (was 2s and caused empty threads)
      void fetchFromRelays()
      
      async function fetchFromRelays() {
        if (!rootInfo) return // Type guard

        try {
          // READ from: FAST_READ_RELAY_URLS + user's inboxes + local relays + OP author's outboxes
          const opAuthorPubkey = rootInfo.type === 'E' || rootInfo.type === 'A' ? rootInfo.pubkey : undefined
          const seenOn = client.getSeenEventRelayUrls(event.id).map((u) => normalizeUrl(u) || u).filter(Boolean)
          const fromBrowsingFeed = browsingRelayUrls.map((u) => normalizeUrl(u) || u).filter(Boolean)
          const threadRelayHints = [
            ...new Set([...relayHintsFromEventTags(event), ...seenOn, ...fromBrowsingFeed])
          ]
          const replyBlockedRelays = [
            ...(blockedRelays || []),
            ...E_TAG_FILTER_BLOCKED_RELAY_URLS
          ]
          const finalRelayUrls = await buildReplyReadRelayList(
            opAuthorPubkey,
            userPubkey || undefined,
            replyBlockedRelays,
            threadRelayHints
          )

          const filters: Filter[] = []
          if (rootInfo.type === 'E') {
            // Fetch all reply types for event-based replies
            filters.push({
              '#e': [rootInfo.id],
              kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
              limit: LIMIT
            })
            // Also fetch with uppercase E tag for replaceable events
            filters.push({
              '#E': [rootInfo.id],
              kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
              limit: LIMIT
            })
            // Kind-1 notes that quote via #q without e-tags (still part of this thread)
            filters.push({
              '#q': [rootInfo.id],
              kinds: [kinds.ShortTextNote],
              limit: LIMIT
            })
            // For public messages (kind 24), also look for replies using 'q' tags
            if (event.kind === ExtendedKind.PUBLIC_MESSAGE) {
              filters.push({
                '#q': [rootInfo.id],
                kinds: [ExtendedKind.PUBLIC_MESSAGE],
                limit: LIMIT
              })
            }
          } else if (rootInfo.type === 'A') {
            // Fetch all reply types for replaceable event-based replies
            filters.push(
              {
                '#a': [rootInfo.id],
                kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
                limit: LIMIT
              },
              {
                '#A': [rootInfo.id],
                kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
                limit: LIMIT
              }
            )
            const qVals = Array.from(
              new Set(
                [rootInfo.eventId, rootInfo.id]
                  .map((x) => (typeof x === 'string' ? x.trim() : ''))
                  .filter(Boolean)
              )
            )
            if (qVals.length > 0) {
              filters.push({
                '#q': qVals,
                kinds: [kinds.ShortTextNote],
                limit: LIMIT
              })
            }
            if (rootInfo.relay) {
              finalRelayUrls.push(rootInfo.relay)
            }
          } else if (rootInfo.type === 'I') {
            filters.push(...buildRssArticleUrlThreadInteractionFilters(rootInfo.id, LIMIT))
          }

          // Use fetchEvents instead of subscribeTimeline for one-time fetching
          const allReplies = await queryService.fetchEvents(finalRelayUrls, filters)

          if (fetchGeneration !== replyFetchGenRef.current) return

          // Filter and add replies (URL threads include kind 9802 highlights of this page)
          const regularReplies = allReplies.filter((evt) => {
            const match =
              rootInfo.type === 'I'
                ? isRssArticleUrlThreadInteraction(evt, rootInfo.id)
                : replyBelongsToNoteThread(evt, event, rootInfo)
            if (!match) return false
            return !shouldHideThreadResponseEvent(
              evt,
              mutePubkeySet,
              hideContentMentioningMutedUsers
            )
          })
          
          // Store in cache (this merges with existing cached replies)
          // After this call, the cache contains ALL replies we've ever seen for this thread
          discussionFeedCache.setCachedReplies(rootInfo, regularReplies)
          
          // Get the merged cache (which includes all replies we've ever seen, including new ones)
          const mergedCachedReplies = discussionFeedCache.getCachedReplies(rootInfo)
          
          // Always add all merged cached replies to UI
          // This ensures we keep all previously seen replies and add any new ones
          // addReplies will deduplicate, so it's safe to call even if some replies are already displayed
          if (mergedCachedReplies) {
            addReplies(mergedCachedReplies)
          } else {
            // Fallback: if cache somehow failed, at least add the fetched replies
            logger.warn('[ReplyNoteList] Cache returned null after store, using fetched replies only')
            addReplies(regularReplies)
          }
          
          if (!hasCache) {
            // No cache: stop loading after adding replies
            setLoading(false)
          }
        } catch (error) {
          logger.error('[ReplyNoteList] Error fetching replies:', error)
          if (fetchGeneration !== replyFetchGenRef.current) return
          if (!hasCache) {
            // Only set loading to false if we don't have cache to fall back on
            setLoading(false)
          }
        }
      }
    }

    init()
  }, [
    rootInfo,
    currentIndex,
    index,
    userPubkey,
    event.id,
    event.kind,
    blockedRelays,
    browsingRelayUrls,
    addReplies,
    mutePubkeySet,
    hideContentMentioningMutedUsers
  ])

  useEffect(() => {
    if (replies.length === 0 && !loading && timelineKey) {
      loadMore()
    }
  }, [replies.length, loading, timelineKey]) // More specific dependencies to prevent infinite loops

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 0.1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && showCount < mergedFeed.length) {
        setShowCount((prev) => prev + SHOW_COUNT)
      }
    }, options)

    const currentBottomRef = bottomRef.current

    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [mergedFeed.length, showCount])

  const loadMore = useCallback(async () => {
    if (loading || !until || !timelineKey) return

    setLoading(true)
    const events = await client.loadMoreTimeline(timelineKey, until, LIMIT)
    const olderEvents = events.filter((evt) => {
      if (!rootInfo) return false
      const matchesThread =
        rootInfo.type === 'I'
          ? isRssArticleUrlThreadInteraction(evt, rootInfo.id)
          : replyBelongsToNoteThread(evt, event, rootInfo)
      if (!matchesThread) return false
      return !shouldHideThreadResponseEvent(
        evt,
        mutePubkeySet,
        hideContentMentioningMutedUsers
      )
    })
    if (olderEvents.length > 0) {
      addReplies(olderEvents)
    }
    setUntil(events.length ? events[events.length - 1].created_at - 1 : undefined)
    setLoading(false)
  }, [
    loading,
    until,
    timelineKey,
    rootInfo,
    event,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    addReplies
  ])

  const highlightReply = useCallback((eventId: string, scrollTo = true) => {
    if (scrollTo) {
      const ref = replyRefs.current[eventId]
      if (ref) {
        // Use setTimeout to ensure DOM is updated before scrolling
        setTimeout(() => {
          ref.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 0)
      }
    }
    setHighlightReplyId(eventId)
    setTimeout(() => {
      setHighlightReplyId((pre) => (pre === eventId ? undefined : pre))
    }, 1500)
  }, [])

  const visibleFeed = mergedFeed.slice(0, showCount)

  const shouldShowFeedItem = useCallback(
    (item: NEvent) => {
      if (shouldHideThreadResponseEvent(item, mutePubkeySet, hideContentMentioningMutedUsers)) {
        return false
      }
      const isQuote = quoteUiIdSet.has(item.id)
      if (isTrustLoaded && hideUntrustedInteractions && !isUserTrusted(item.pubkey)) {
        if (isQuote) return false
        if (rootInfo?.type !== 'I') {
          const repliesForThisReply = repliesMap.get(item.id)
          if (
            !repliesForThisReply ||
            repliesForThisReply.events.every((evt) => !isUserTrusted(evt.pubkey))
          ) {
            return false
          }
        }
      }
      return true
    },
    [
      mutePubkeySet,
      hideContentMentioningMutedUsers,
      quoteUiIdSet,
      isTrustLoaded,
      hideUntrustedInteractions,
      isUserTrusted,
      rootInfo?.type,
      repliesMap
    ]
  )

  const visibleForRender = useMemo(
    () => visibleFeed.filter(shouldShowFeedItem),
    [visibleFeed, shouldShowFeedItem]
  )

  const displayRows = useMemo(
    () => buildVisibleBacklinkRows(visibleForRender, quoteUiIdSet),
    [visibleForRender, quoteUiIdSet]
  )

  return (
    <div className="min-h-[80vh] pb-12">
      {loading && <LoadingBar />}
      {!loading && until && (
        <div
          className={`text-sm text-center text-muted-foreground border-b py-2 ${!loading ? 'hover:text-foreground cursor-pointer' : ''}`}
          onClick={loadMore}
        >
          {t('load more older replies')}
        </div>
      )}
      <div>
        {displayRows.map((row, ri) => {
          const prevRow = ri > 0 ? displayRows[ri - 1] : undefined
          if (row.type === 'reply') {
            const reply = row.event
            const parentETag = getParentETag(reply)
            const parentEventHexId = parentETag?.[1]
            const parentEventId = parentETag ? generateBech32IdFromETag(parentETag) : undefined

            const replyRootId = getRootEventHexId(reply)
            const replyUrlForIThread =
              rootInfo?.type === 'I'
                ? reply.kind === kinds.Highlights
                  ? getHighlightSourceHttpUrl(reply)
                  : getArticleUrlFromCommentITags(reply)
                : undefined
            const belongsToSameThread = rootInfo && (
              (rootInfo.type === 'E' && replyRootId === rootInfo.id) ||
              (rootInfo.type === 'A' && getRootATag(reply)?.[1] === rootInfo.id) ||
              (rootInfo.type === 'I' &&
                !!replyUrlForIThread &&
                canonicalizeRssArticleUrl(replyUrlForIThread) === canonicalizeRssArticleUrl(rootInfo.id))
            )

            return (
              <div
                ref={(el) => (replyRefs.current[reply.id] = el)}
                key={reply.id}
                className="scroll-mt-12"
              >
                <ReplyNote
                  event={reply}
                  parentEventId={event.id !== parentEventHexId ? parentEventId : undefined}
                  duplicateWebPreviewCleanedUrlHints={replyDuplicateWebPreviewHints}
                  onClickParent={() => {
                    if (!parentEventHexId) return
                    if (replies.every((r) => r.id !== parentEventHexId)) {
                      navigateToNote(toNote(parentEventId ?? parentEventHexId))
                      return
                    }
                    highlightReply(parentEventHexId)
                  }}
                  onClickReply={belongsToSameThread ? (replyEvent) => {
                    const replyNoteUrl = toNote(replyEvent.id)
                    window.history.pushState(null, '', replyNoteUrl)
                    const replyIndex = mergedFeed.findIndex((r) => r.id === replyEvent.id)
                    if (replyIndex >= 0 && replyIndex >= showCount) {
                      setShowCount(replyIndex + 1)
                    }
                    setTimeout(() => {
                      highlightReply(replyEvent.id, true)
                    }, 50)
                  } : undefined}
                  highlight={highlightReplyId === reply.id}
                />
              </div>
            )
          }

          const { subsection, events: blEvents } = row
          const wrapClass = backlinkRunSectionClass(subsection, prevRow)

          if (subsection === 'bookmark') {
            return (
              <div
                key={`bl-bookmark-${blEvents[0].id}`}
                className={wrapClass}
              >
                <BacklinkAvatarStrip
                  events={blEvents}
                  sectionLabel={t('Thread backlinks bookmarks section')}
                  relationLabelForTitle={t('bookmarked this note')}
                />
              </div>
            )
          }

          if (subsection === 'list') {
            return (
              <div
                key={`bl-list-${blEvents[0].id}`}
                className={wrapClass}
              >
                <BacklinkAvatarStrip
                  events={blEvents}
                  sectionLabel={t('Thread backlinks lists section')}
                  getTitle={(e) => threadBacklinkRelationLabel(e, t)}
                />
              </div>
            )
          }

          if (subsection === 'report') {
            return (
              <div key={`bl-report-${blEvents[0].id}`} className={wrapClass}>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-950/90 dark:text-amber-100/90">
                  {t('Report events heading')}
                </h2>
                {blEvents.map((item) => (
                  <div
                    key={item.id}
                    ref={(el) => (replyRefs.current[item.id] = el)}
                    className="scroll-mt-12 mb-1"
                  >
                    <ThreadQuoteBacklink
                      event={item}
                      quoteKindLabel={threadBacklinkRelationLabel(item, t)}
                      variant="warning"
                    />
                  </div>
                ))}
              </div>
            )
          }

          return (
            <div key={`bl-primary-${blEvents[0].id}`} className={wrapClass}>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('Thread backlinks primary section')}
              </h2>
              {blEvents.map((item) => (
                <div
                  key={item.id}
                  ref={(el) => (replyRefs.current[item.id] = el)}
                  className="scroll-mt-12 mb-1"
                >
                  <ThreadQuoteBacklink
                    event={item}
                    quoteKindLabel={threadBacklinkRelationLabel(item, t)}
                    variant="default"
                  />
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {quoteLoading && showQuotes && (
        <div className="mt-4 space-y-2">
          <ThreadQuoteBacklinkSkeleton />
        </div>
      )}
      {!loading && !quoteLoading && (
        <div className="text-sm mt-2 mb-3 text-center text-muted-foreground">
          {mergedFeed.length > 0 ? t('no more replies') : t('no replies')}
        </div>
      )}
      <div ref={bottomRef} />
      {loading && <ReplyNoteSkeleton />}
    </div>
  )
}

export default ReplyNoteList