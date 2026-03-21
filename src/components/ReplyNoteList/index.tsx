import { ExtendedKind } from '@/constants'
import {
  getParentETag,
  getReplaceableCoordinateFromEvent,
  getRootATag,
  getRootETag,
  getRootEventHexId,
  isMentioningMutedUsers,
  isReplaceableEvent,
  isReplyNoteEvent
} from '@/lib/event'
import { shouldHideInteractions } from '@/lib/event-filtering'
import logger from '@/lib/logger'
import { toNote } from '@/lib/link'
import { generateBech32IdFromETag, tagNameEquals } from '@/lib/tag'
import { useSmartNoteNavigation, useSecondaryPage } from '@/PageManager'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useReply } from '@/providers/ReplyProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import { eventService, queryService } from '@/services/client.service'
import noteStatsService from '@/services/note-stats.service'
import discussionFeedCache from '@/services/discussion-feed-cache.service'
import { buildReplyReadRelayList } from '@/lib/relay-list-builder'
import { Filter, Event as NEvent, kinds } from 'nostr-tools'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingBar } from '../LoadingBar'
import QuoteList from '../QuoteList'
import ReplyNote, { ReplyNoteSkeleton } from '../ReplyNote'
import ZapReplyFeedRow from './ZapReplyFeedRow'

type TRootInfo =
  | { type: 'E'; id: string; pubkey: string }
  | { type: 'A'; id: string; eventId: string; pubkey: string; relay?: string }
  | { type: 'I'; id: string }

const LIMIT = 100
const SHOW_COUNT = 10

function ReplyNoteList({
  index,
  event,
  sort = 'oldest',
  showQuotes = true
}: {
  index?: number
  event: NEvent
  sort?: 'newest' | 'oldest' | 'top' | 'controversial' | 'most-zapped'
  /** When false, omit the quotes section (e.g. discussion threads). */
  showQuotes?: boolean
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const { currentIndex } = useSecondaryPage()
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const noteStats = useNoteStatsById(event.id)
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const { relayList: userRelayList, pubkey: userPubkey } = useNostr()
  const { blockedRelays } = useFavoriteRelays()
  const [rootInfo, setRootInfo] = useState<TRootInfo | undefined>(undefined)
  const { repliesMap, addReplies } = useReply()

  // Helper function to get vote score for a reply
  const getReplyVoteScore = (reply: NEvent) => {
    const stats = noteStatsService.getNoteStats(reply.id)
    if (!stats?.likes) {
      return 0
    }
    
    const upvoteReactions = stats.likes.filter(r => r.emoji === '⬆️')
    const downvoteReactions = stats.likes.filter(r => r.emoji === '⬇️')
    const score = upvoteReactions.length - downvoteReactions.length
    
    return score
  }

  // Helper function to get controversy score for a reply
  const getReplyControversyScore = (reply: NEvent) => {
    const stats = noteStatsService.getNoteStats(reply.id)
    if (!stats?.likes) {
      return 0
    }
    
    const upvoteReactions = stats.likes.filter(r => r.emoji === '⬆️')
    const downvoteReactions = stats.likes.filter(r => r.emoji === '⬇️')
    
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
      : event.id
    // For replaceable events, also check the event ID in case replies are stored there
    const eventIdKey = event.id
    let parentEventKeys = [currentEventKey]
    if (isReplaceableEvent(event.kind) && currentEventKey !== eventIdKey) {
      parentEventKeys.push(eventIdKey)
    }

    
    const processedEventIds = new Set<string>() // Prevent infinite loops
    let iterationCount = 0
    const MAX_ITERATIONS = 10 // Prevent infinite loops
    
    while (parentEventKeys.length > 0 && iterationCount < MAX_ITERATIONS) {
      iterationCount++
      const events = parentEventKeys.flatMap((id) => repliesMap.get(id)?.events || [])
      
      events.forEach((evt) => {
        if (replyIdSet.has(evt.id)) return
        if (mutePubkeySet.has(evt.pubkey)) {
          return
        }
        if (hideContentMentioningMutedUsers && isMentioningMutedUsers(evt, mutePubkeySet)) {
          return
        }

        replyIdSet.add(evt.id)
        replyEvents.push(evt)
      })
      
      // Prevent infinite loops by tracking processed event IDs
      const newParentEventKeys = events
        .map((evt) => evt.id)
        .filter((id) => !processedEventIds.has(id))
      
      newParentEventKeys.forEach((id) => processedEventIds.add(id))
      parentEventKeys = newParentEventKeys
    }
    
    if (iterationCount >= MAX_ITERATIONS) {
      logger.warn('ReplyNoteList: Maximum iterations reached, possible circular reference in replies')
    }
    


    // Apply sorting based on the sort parameter
    switch (sort) {
      case 'oldest':
        return replyEvents.sort((a, b) => a.created_at - b.created_at)
      case 'newest':
        return replyEvents.sort((a, b) => b.created_at - a.created_at)
      case 'top':
        // Sort by vote score (upvotes - downvotes), then by newest if tied
        return replyEvents.sort((a, b) => {
          const scoreA = getReplyVoteScore(a)
          const scoreB = getReplyVoteScore(b)
          if (scoreA !== scoreB) {
            return scoreB - scoreA // Higher scores first
          }
          return b.created_at - a.created_at // Newest first if tied
        })
      case 'controversial':
        // Sort by controversy score (min of upvotes and downvotes), then by newest if tied
        return replyEvents.sort((a, b) => {
          const controversyA = getReplyControversyScore(a)
          const controversyB = getReplyControversyScore(b)
          if (controversyA !== controversyB) {
            return controversyB - controversyA // Higher controversy first
          }
          return b.created_at - a.created_at // Newest first if tied
        })
      case 'most-zapped':
        // Sort by total zap amount, then by newest if tied
        return replyEvents.sort((a, b) => {
          const zapAmountA = getReplyZapAmount(a)
          const zapAmountB = getReplyZapAmount(b)
          if (zapAmountA !== zapAmountB) {
            return zapAmountB - zapAmountA // Higher zap amounts first
          }
          return b.created_at - a.created_at // Newest first if tied
        })
      default:
        return replyEvents.sort((a, b) => b.created_at - a.created_at)
    }
  }, [event.id, repliesMap, mutePubkeySet, hideContentMentioningMutedUsers, sort])

  const zapsForFeed = useMemo(() => {
    if (shouldHideInteractions(event)) return []
    const raw = noteStats?.zaps ?? []
    const filtered = hideUntrustedInteractions ? raw.filter((z) => isUserTrusted(z.pubkey)) : raw
    return [...filtered].sort((a, b) => b.amount - a.amount)
  }, [event, noteStats, hideUntrustedInteractions, isUserTrusted])

  const [timelineKey] = useState<string | undefined>(undefined)
  const [until, setUntil] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState<boolean>(false)
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const [highlightReplyId, setHighlightReplyId] = useState<string | undefined>(undefined)
  const replyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const fetchRootEvent = async () => {
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
        root = { type: 'E', id: event.id, pubkey: event.pubkey }
      }
      
      const rootETag = getRootETag(event)
      if (rootETag) {
        const [, rootEventHexId, , , rootEventPubkey] = rootETag
        if (rootEventHexId && rootEventPubkey) {
          root = { type: 'E', id: rootEventHexId, pubkey: rootEventPubkey }
        } else {
          const rootEventId = generateBech32IdFromETag(rootETag)
          if (rootEventId) {
            const rootEvent = await eventService.fetchEvent(rootEventId)
            if (rootEvent) {
              root = { type: 'E', id: rootEvent.id, pubkey: rootEvent.pubkey }
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
        const rootITag = event.tags.find(tagNameEquals('I'))
        if (rootITag) {
          root = { type: 'I', id: rootITag[1] }
        }
      }
      setRootInfo(root)
    }
    fetchRootEvent()
  }, [event])

  const onNewReply = useCallback((evt: NEvent) => {
    addReplies([evt])
    // Also update the discussion cache so the reply persists
    if (rootInfo) {
      const cachedReplies = discussionFeedCache.getCachedReplies(rootInfo) || []
      const existingReplyIds = new Set(cachedReplies.map(r => r.id))
      if (!existingReplyIds.has(evt.id)) {
        discussionFeedCache.setCachedReplies(rootInfo, [...cachedReplies, evt])
      }
    }
  }, [addReplies, rootInfo])

  useEffect(() => {
    if (!rootInfo) return
    const handleEventPublished = (data: Event) => {
      const customEvent = data as CustomEvent<NEvent>
      const evt = customEvent.detail
      const rootId = getRootEventHexId(evt)
      if (rootId === rootInfo.id && isReplyNoteEvent(evt)) {
        onNewReply(evt)
      }
    }

    client.addEventListener('newEvent', handleEventPublished)
    return () => {
      client.removeEventListener('newEvent', handleEventPublished)
    }
  }, [rootInfo, onNewReply])

  useEffect(() => {
    if (!rootInfo || currentIndex !== index) return

    const init = async () => {
      // Check cache first - get cached data even if stale (for instant display)
      const cachedData = discussionFeedCache.getCachedReplies(rootInfo)
      const hasFreshCache = discussionFeedCache.hasFreshCache(rootInfo)
      const hasCache = cachedData !== null
      
      if (hasCache) {
        // Display cached data immediately (even if stale) for instant switching
        addReplies(cachedData)
        setLoading(false)
      } else {
        // No cache at all, show loading while fetching
        setLoading(true)
      }
      
      // Always fetch fresh data from relays to update cache
      // If we have fresh cache, we can skip fetching (but still do it in background after a delay)
      // If we have stale cache or no cache, fetch immediately
      if (hasFreshCache) {
        // Fresh cache: fetch in background after a short delay to avoid unnecessary requests
        setTimeout(() => {
          fetchFromRelays()
        }, 2000) // Wait 2 seconds before background refresh
      } else {
        // Stale or no cache: fetch immediately
        fetchFromRelays()
      }
      
      async function fetchFromRelays() {
        if (!rootInfo) return // Type guard
        
        try {
          // READ from: FAST_READ_RELAY_URLS + user's inboxes + local relays + OP author's outboxes
          const opAuthorPubkey = rootInfo.type === 'E' || rootInfo.type === 'A' ? rootInfo.pubkey : undefined
          const finalRelayUrls = await buildReplyReadRelayList(
            opAuthorPubkey,
            userPubkey || undefined,
            blockedRelays || []
          )

          const filters: Filter[] = []
          if (rootInfo.type === 'E') {
            // Fetch all reply types for event-based replies
            filters.push({
              '#e': [rootInfo.id],
              kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
              limit: LIMIT
            })
            // Also fetch with uppercase E tag for replaceable events
            filters.push({
              '#E': [rootInfo.id],
              kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
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
                kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
                limit: LIMIT
              },
              {
                '#A': [rootInfo.id],
                kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
                limit: LIMIT
              }
            )
            if (rootInfo.relay) {
              finalRelayUrls.push(rootInfo.relay)
            }
          }

          // Use fetchEvents instead of subscribeTimeline for one-time fetching
          const allReplies = await queryService.fetchEvents(finalRelayUrls, filters)

          // Filter and add replies
          const regularReplies = allReplies.filter((evt) => isReplyNoteEvent(evt))
          
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
          if (!hasCache) {
            // Only set loading to false if we don't have cache to fall back on
            setLoading(false)
          }
        }
      }
    }

    init()
  }, [rootInfo, currentIndex, index, userRelayList, event.kind, addReplies])

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
      if (entries[0].isIntersecting && showCount < replies.length) {
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
  }, [replies, showCount])

  const loadMore = useCallback(async () => {
    if (loading || !until || !timelineKey) return

    setLoading(true)
    const events = await client.loadMoreTimeline(timelineKey, until, LIMIT)
    const olderEvents = events.filter((evt) => isReplyNoteEvent(evt))
    if (olderEvents.length > 0) {
      addReplies(olderEvents)
    }
    setUntil(events.length ? events[events.length - 1].created_at - 1 : undefined)
    setLoading(false)
  }, [loading, until, timelineKey])

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

  return (
    <div className="min-h-[80vh]">
      {loading && <LoadingBar />}
      {zapsForFeed.map((zap) => (
        <ZapReplyFeedRow key={zap.pr} zap={zap} />
      ))}
      {!loading && until && (
        <div
          className={`text-sm text-center text-muted-foreground border-b py-2 ${!loading ? 'hover:text-foreground cursor-pointer' : ''}`}
          onClick={loadMore}
        >
          {t('load more older replies')}
        </div>
      )}
      <div>
        {replies.slice(0, showCount).map((reply) => {
          if (hideUntrustedInteractions && !isUserTrusted(reply.pubkey)) {
            const repliesForThisReply = repliesMap.get(reply.id)
            // If the reply is not trusted and there are no trusted replies for this reply, skip rendering
            if (
              !repliesForThisReply ||
              repliesForThisReply.events.every((evt) => !isUserTrusted(evt.pubkey))
            ) {
              return null
            }
          }

          const parentETag = getParentETag(reply)
          const parentEventHexId = parentETag?.[1]
          const parentEventId = parentETag ? generateBech32IdFromETag(parentETag) : undefined
          
          // Check if this reply belongs to the same thread as the root event
          const replyRootId = getRootEventHexId(reply)
          const belongsToSameThread = rootInfo && (
            (rootInfo.type === 'E' && replyRootId === rootInfo.id) ||
            (rootInfo.type === 'A' && getRootATag(reply)?.[1] === rootInfo.id) ||
            (rootInfo.type === 'I' && reply.tags.find(tagNameEquals('I'))?.[1] === rootInfo.id)
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
                onClickParent={() => {
                  if (!parentEventHexId) return
                  if (replies.every((r) => r.id !== parentEventHexId)) {
                    navigateToNote(toNote(parentEventId ?? parentEventHexId))
                    return
                  }
                  highlightReply(parentEventHexId)
                }}
                onClickReply={belongsToSameThread ? (replyEvent) => {
                  // Update URL without full navigation
                  const replyNoteUrl = toNote(replyEvent.id)
                  window.history.pushState(null, '', replyNoteUrl)
                  
                  // Ensure the reply is visible by expanding the list if needed
                  const replyIndex = replies.findIndex(r => r.id === replyEvent.id)
                  if (replyIndex >= 0 && replyIndex >= showCount) {
                    setShowCount(replyIndex + 1)
                  }
                  
                  // Highlight and scroll to the reply (use setTimeout to ensure DOM is updated)
                  setTimeout(() => {
                    highlightReply(replyEvent.id, true)
                  }, 50)
                } : undefined}
                highlight={highlightReplyId === reply.id}
              />
            </div>
          )
        })}
      </div>
      {!loading && (
        <div className="text-sm mt-2 mb-3 text-center text-muted-foreground">
          {replies.length > 0 ? t('no more replies') : t('no replies')}
        </div>
      )}
      <div ref={bottomRef} />
      {loading && <ReplyNoteSkeleton />}
      {showQuotes && <QuoteList event={event} embedded />}
    </div>
  )
}

export default ReplyNoteList