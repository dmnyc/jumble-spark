import { forwardRef, useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Search } from 'lucide-react'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useSmartNoteNavigation } from '@/PageManager'
import { toNote } from '@/lib/link'
import logger from '@/lib/logger'
import { NostrEvent, Event as NostrEventType } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import { normalizeUrl } from '@/lib/url'
import { BIG_RELAY_URLS, FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import client from '@/services/client.service'
import discussionFeedCache from '@/services/discussion-feed-cache.service'
import { DISCUSSION_TOPICS } from './discussionTopics'
import ThreadCard from './ThreadCard'
import CreateThreadDialog from './CreateThreadDialog'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { extractGroupInfo } from '@/lib/discussion-topics'

// Simple event map type
type EventMapEntry = {
  event: NostrEvent
  relaySources: string[]
  tTags: string[]
  hashtags: string[]
  allTopics: string[]
  categorizedTopic: string
  commentCount: number
  lastCommentTime: number
  lastVoteTime: number
  upVotes: number
  downVotes: number
  // Group-related fields
  groupId: string | null
  groupRelay: string | null
  groupDisplayName: string | null
  isGroupDiscussion: boolean
}

// Vote counting function - separate and clean
function countVotesForThread(threadId: string, reactions: NostrEvent[], threadAuthor: string): { upVotes: number, downVotes: number, lastVoteTime: number } {
  const userVotes = new Map<string, { type: string, created_at: number }>()
  let lastVoteTime = 0
  
  // Normalize reaction content according to NIP-25
  const normalizeReaction = (content: string): string => {
    const normalized = content.trim()
    if (normalized === '' || normalized === '+') return '+'
    if (normalized === '-') return '-'
    if (normalized === '⬆️' || normalized === '↑' || normalized === '👍' || normalized === '❤️' || normalized === '🔥') return '+'
    if (normalized === '⬇️' || normalized === '↓' || normalized === '👎' || normalized === '💩') return '-'
    return 'emoji'
  }
  
  logger.debug('[DiscussionsPage] Counting votes for thread', threadId.substring(0, 8), 'with', reactions.length, 'reactions')
  
  // Process all reactions for this thread
  reactions.forEach(reaction => {
    const eTags = reaction.tags.filter(tag => tag[0] === 'e' && tag[1])
    eTags.forEach(tag => {
      if (tag[1] === threadId) {
        logger.debug('[DiscussionsPage] Found reaction for thread', threadId.substring(0, 8), ':', {
          content: reaction.content,
          pubkey: reaction.pubkey.substring(0, 8),
          isSelf: reaction.pubkey === threadAuthor,
          created_at: reaction.created_at
        })
        
        // Skip self-votes
        if (reaction.pubkey === threadAuthor) {
          logger.debug('[DiscussionsPage] Skipping self-vote')
          return
        }
        
        const normalizedReaction = normalizeReaction(reaction.content)
        logger.debug('[DiscussionsPage] Normalized reaction:', normalizedReaction)
        
        if (normalizedReaction === '+' || normalizedReaction === '-') {
          const existingVote = userVotes.get(reaction.pubkey)
          // Only keep the newest vote from each user
          if (!existingVote || reaction.created_at > existingVote.created_at) {
            userVotes.set(reaction.pubkey, { type: normalizedReaction, created_at: reaction.created_at })
            logger.debug('[DiscussionsPage] Added vote:', normalizedReaction, 'from', reaction.pubkey.substring(0, 8))
          }
        }
      }
    })
  })
  
  // Count votes
  let upVotes = 0
  let downVotes = 0
  userVotes.forEach(({ type, created_at }) => {
    if (type === '+') upVotes++
    else if (type === '-') downVotes++
    if (created_at > lastVoteTime) lastVoteTime = created_at
  })
  
  return { upVotes, downVotes, lastVoteTime }
}

// Comment counting function - separate and clean
function countCommentsForThread(threadId: string, comments: NostrEvent[], threadAuthor: string): { commentCount: number, lastCommentTime: number } {
  let commentCount = 0
  let lastCommentTime = 0
  
  comments.forEach(comment => {
    const eTags = comment.tags.filter(tag => tag[0] === 'e' && tag[1])
    eTags.forEach(tag => {
      if (tag[1] === threadId) {
        // Skip self-comments
        if (comment.pubkey === threadAuthor) return
        
        commentCount++
        if (comment.created_at > lastCommentTime) {
          lastCommentTime = comment.created_at
        }
      }
    })
  })
  
  return { commentCount, lastCommentTime }
}

// Topic categorization function
function getTopicFromTags(allTopics: string[], predefinedTopicIds: string[], isGroupDiscussion: boolean = false): string {
  // If it's a group discussion, categorize as 'groups'
  if (isGroupDiscussion) {
    return 'groups'
  }
  
  for (const topic of allTopics) {
    if (predefinedTopicIds.includes(topic)) {
      return topic
    }
  }
  return 'general'
}

// Normalize topic function
function normalizeTopic(topic: string): string {
  return topic.toLowerCase().replace(/\s+/g, '-')
}

// Search function for threads
async function searchThreads(entries: EventMapEntry[], query: string): Promise<EventMapEntry[]> {
  if (!query.trim()) return entries
  
  const searchTerm = query.toLowerCase().trim()
  
  // Search for profiles that match the query
  const matchingPubkeys = new Set<string>()
  try {
    const profiles = await client.searchProfilesFromLocal(searchTerm, 50)
    profiles.forEach(profile => {
      matchingPubkeys.add(profile.pubkey)
    })
  } catch (error) {
    logger.debug('[DiscussionsPage] Profile search failed:', error)
  }
  
  return entries.filter(entry => {
    const thread = entry.event
    
    // Search in title (from tags)
    const titleTag = thread.tags.find(tag => tag[0] === 'title')
    const title = titleTag ? titleTag[1].toLowerCase() : ''
    
    // Search in content
    const content = thread.content.toLowerCase()
    
    // Search in tags (t-tags and hashtags)
    const allTags = [...entry.tTags, ...entry.hashtags].join(' ').toLowerCase()
    
    // Search in full author npub
    const authorNpub = thread.pubkey.toLowerCase()
    
    // Search in author tag (for readings)
    const authorTag = thread.tags.find(tag => tag[0] === 'author')
    const author = authorTag ? authorTag[1].toLowerCase() : ''
    
    // Search in subject tag (for readings)
    const subjectTag = thread.tags.find(tag => tag[0] === 'subject')
    const subject = subjectTag ? subjectTag[1].toLowerCase() : ''
    
    // Check if author matches profile search
    const authorMatchesProfile = matchingPubkeys.has(thread.pubkey)
    
    return title.includes(searchTerm) ||
           content.includes(searchTerm) ||
           allTags.includes(searchTerm) ||
           authorNpub.includes(searchTerm) ||
           author.includes(searchTerm) ||
           subject.includes(searchTerm) ||
           authorMatchesProfile
  })
}

// Dynamic topic analysis
interface DynamicTopic {
  id: string
  label: string
  count: number
  isMainTopic: boolean
  isSubtopic: boolean
  parentTopic?: string
}

function analyzeDynamicTopics(entries: EventMapEntry[]): {
  mainTopics: DynamicTopic[]
  subtopics: DynamicTopic[]
  allTopics: DynamicTopic[]
} {
  const hashtagCounts = new Map<string, number>()
  const groupCounts = new Map<string, number>()
  const predefinedTopicIds = DISCUSSION_TOPICS.map(t => t.id)
  
  // Count hashtag frequency
  entries.forEach(entry => {
    const allTopics = [...entry.tTags, ...entry.hashtags]
    allTopics.forEach(topic => {
      if (topic && topic !== 'general' && !predefinedTopicIds.includes(topic)) {
        hashtagCounts.set(topic, (hashtagCounts.get(topic) || 0) + 1)
      }
    })
    
    // Count group discussions
    if (entry.isGroupDiscussion && entry.groupDisplayName) {
      groupCounts.set(entry.groupDisplayName, (groupCounts.get(entry.groupDisplayName) || 0) + 1)
    }
  })
  
  const mainTopics: DynamicTopic[] = []
  const subtopics: DynamicTopic[] = []
  
  // Create dynamic topics based on frequency
  hashtagCounts.forEach((count, hashtag) => {
    const topic: DynamicTopic = {
      id: hashtag,
      label: hashtag.charAt(0).toUpperCase() + hashtag.slice(1).replace(/-/g, ' '),
      count,
      isMainTopic: count >= 10,
      isSubtopic: count >= 3 && count < 10
    }
    
    if (topic.isMainTopic) {
      mainTopics.push(topic)
    } else if (topic.isSubtopic) {
      subtopics.push(topic)
    }
  })
  
  // Add "Groups" as a pseudo main-topic if we have group discussions
  if (groupCounts.size > 0) {
    const totalGroupDiscussions = Array.from(groupCounts.values()).reduce((sum, count) => sum + count, 0)
    const groupsMainTopic: DynamicTopic = {
      id: 'groups',
      label: 'Groups',
      count: totalGroupDiscussions,
      isMainTopic: true,
      isSubtopic: false
    }
    mainTopics.push(groupsMainTopic)
    
    // Add individual groups as subtopics under "Groups"
    groupCounts.forEach((count, groupDisplayName) => {
      const groupSubtopic: DynamicTopic = {
        id: `groups-${groupDisplayName}`,
        label: groupDisplayName,
        count,
        isMainTopic: false,
        isSubtopic: true,
        parentTopic: 'groups'
      }
      subtopics.push(groupSubtopic)
    })
  }
  
  // Sort by count (most popular first)
  mainTopics.sort((a, b) => b.count - a.count)
  subtopics.sort((a, b) => b.count - a.count)
  
  const allTopics = [...mainTopics, ...subtopics]
  
  // Debug logging (commented out to reduce console spam)
  // console.log('Dynamic topics analysis:', {
  //   hashtagCounts: Object.fromEntries(hashtagCounts),
  //   mainTopics: mainTopics.map(t => ({ id: t.id, count: t.count })),
  //   subtopics: subtopics.map(t => ({ id: t.id, count: t.count })),
  //   allTopics: allTopics.map(t => ({ id: t.id, count: t.count, isMainTopic: t.isMainTopic, isSubtopic: t.isSubtopic }))
  // })
  
  return { mainTopics, subtopics, allTopics }
}

// Enhanced topic categorization with dynamic topics
function getEnhancedTopicFromTags(allTopics: string[], predefinedTopicIds: string[], dynamicTopics: DynamicTopic[], isGroupDiscussion: boolean = false): string {
  // If it's a group discussion, categorize as 'groups'
  if (isGroupDiscussion) {
    return 'groups'
  }
  
  // First check predefined topics (these are main topics)
  for (const topic of allTopics) {
    if (predefinedTopicIds.includes(topic)) {
      return topic
    }
  }
  
  // Then check dynamic main topics
  for (const topic of allTopics) {
    const dynamicTopic = dynamicTopics.find(dt => dt.id === topic && dt.isMainTopic)
    if (dynamicTopic) {
      return topic
    }
  }
  
  // If no main topic found, return 'general' as the main topic
  // The grouping logic will handle subtopics under their main topics
  return 'general'
}

function DiscussionsPageTitlebar() {
  const { t } = useTranslation()
  
  return (
    <div className="flex items-center gap-2 px-3 h-full">
      <h1 className="text-lg font-semibold">{t('Discussions')}</h1>
    </div>
  )
}

const DiscussionsPage = forwardRef((_, ref) => {
  const { t } = useTranslation()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { pubkey } = useNostr()
  const { navigateToNote } = useSmartNoteNavigation()
  
  // State
  const [allEventMap, setAllEventMap] = useState<Map<string, EventMapEntry>>(new Map())
  const [eventMap, setEventMap] = useState<Map<string, EventMapEntry>>(new Map())
  const [timeSpan, setTimeSpan] = useState<'30days' | '90days' | 'all'>('30days')
  const [timeSpanCounts, setTimeSpanCounts] = useState<{ '30days': number, '90days': number, 'all': number }>({ '30days': 0, '90days': 0, 'all': 0 })
  const [loading, setLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [dynamicTopics, setDynamicTopics] = useState<{
    mainTopics: DynamicTopic[]
    subtopics: DynamicTopic[]
    allTopics: DynamicTopic[]
  }>({ mainTopics: [], subtopics: [], allTopics: [] })
  
  // Track if we've initialized to prevent re-fetching on re-renders
  const hasInitializedRef = useRef(false)
  const isFetchingRef = useRef(false)
  
  // Build comprehensive relay list (same as pins)
  const buildComprehensiveRelayList = useCallback(async () => {
    const myRelayList = pubkey ? await client.fetchRelayList(pubkey) : { write: [], read: [] }
    const allRelays = [
      ...(myRelayList.read || []), // User's inboxes (kind 10002)
      ...(myRelayList.write || []), // User's outboxes (kind 10002)
      ...(favoriteRelays || []), // User's favorite relays (kind 10012)
      ...BIG_RELAY_URLS,         // Big relays
      ...FAST_READ_RELAY_URLS,   // Fast read relays
      ...FAST_WRITE_RELAY_URLS   // Fast write relays
    ]
    
    // Normalize and deduplicate relay URLs
    const normalizedRelays = allRelays
          .map(url => normalizeUrl(url))
      .filter((url): url is string => !!url)
    
    // Filter blocked relays
    const finalRelays = normalizedRelays.filter(relay => 
      !blockedRelays.some(blocked => relay.includes(blocked))
    )
    
    logger.debug('[DiscussionsPage] Using', finalRelays.length, 'comprehensive relays')
    return Array.from(new Set(finalRelays))
  }, []) // No dependencies - will be called fresh each time from fetchAllEvents
  
  // Fetch all events
  const fetchAllEvents = useCallback(async (forceRefresh = false) => {
    if (isFetchingRef.current && !forceRefresh) return
    isFetchingRef.current = true
    
    // Check cache first (unless forcing refresh)
    let hasCachedData = false
    if (!forceRefresh) {
      const cachedData = discussionFeedCache.getCachedDiscussionsList()
      if (cachedData) {
        logger.debug('[DiscussionsPage] Using cached discussions list:', cachedData.eventMap.size, 'threads')
        setAllEventMap(cachedData.eventMap)
        setDynamicTopics(cachedData.dynamicTopics)
        setLoading(false) // Display cached data immediately
        hasCachedData = true
        // Still fetch in background to update cache (but don't show loading or refreshing)
      } else {
        setLoading(true)
        setIsRefreshing(true)
      }
    } else {
      setLoading(true)
      setIsRefreshing(true)
    }
    
    try {
      logger.debug('[DiscussionsPage] Fetching all discussion threads...', forceRefresh ? '(forced refresh)' : '')
      
      // Get comprehensive relay list
      const allRelays = await buildComprehensiveRelayList()
      
      logger.debug('[DiscussionsPage] Using relays:', allRelays.slice(0, 10), '... (total:', allRelays.length, ')')
      
      // Step 1: Fetch all discussion threads (kind 11)
      const discussionThreads = await client.fetchEvents(allRelays, [
        {
          kinds: [11], // ExtendedKind.DISCUSSION
          limit: 100
        }
      ])
      
      logger.debug('[DiscussionsPage] Fetched', discussionThreads.length, 'discussion threads')
      if (discussionThreads.length > 0) {
        logger.debug('[DiscussionsPage] Sample threads:', discussionThreads.slice(0, 3).map(t => ({
          id: t.id.substring(0, 8),
          pubkey: t.pubkey.substring(0, 8),
          created_at: new Date(t.created_at * 1000).toISOString()
        })))
      }
      
      // Step 2: Get thread IDs for comment/reaction fetching
      // Get cached data first to include cached thread IDs in the fetch
      // We ALWAYS include cached thread IDs to get updated counts for all threads we know about
      const cachedDataBeforeFetch = discussionFeedCache.getCachedDiscussionsList()
      const threadIds = discussionThreads.map((thread: NostrEvent) => thread.id)
      const allThreadIds = new Set(threadIds)
      
      // Add cached thread IDs to fetch comments/reactions for all threads we know about
      // This ensures we get updated counts for cached threads too, regardless of whether we're refreshing
      if (cachedDataBeforeFetch) {
        cachedDataBeforeFetch.eventMap.forEach((_entry, threadId) => {
          allThreadIds.add(threadId)
        })
      }
      
      const allThreadIdsArray = Array.from(allThreadIds)
      
      const [comments, reactions] = await Promise.all([
        allThreadIdsArray.length > 0 ? client.fetchEvents(allRelays, [
          {
            kinds: [1111], // ExtendedKind.COMMENT
            '#e': allThreadIdsArray,
            limit: 100
          }
        ]) : Promise.resolve([]),
        allThreadIdsArray.length > 0 ? client.fetchEvents(allRelays, [
          {
            kinds: [kinds.Reaction],
            '#e': allThreadIdsArray,
              limit: 100
            }
        ]) : Promise.resolve([])
      ])
      
      logger.debug('[DiscussionsPage] Fetched', comments.length, 'comments and', reactions.length, 'reactions for', allThreadIdsArray.length, 'threads (', threadIds.length, 'new,', (cachedDataBeforeFetch?.eventMap.size || 0), 'cached)')
      
      // Debug: Log some reaction details
      if (reactions.length > 0) {
        logger.debug('[DiscussionsPage] Sample reactions:', reactions.slice(0, 3).map(r => ({
          id: r.id.substring(0, 8),
          content: r.content,
          pubkey: r.pubkey.substring(0, 8),
          tags: r.tags.filter(t => t[0] === 'e')
        })))
      }
      
      // Step 3: Build event map with vote and comment counts for newly fetched threads
      const newEventMap = new Map<string, EventMapEntry>()
      
      discussionThreads.forEach((thread: NostrEvent) => {
        const threadId = thread.id
        const threadAuthor = thread.pubkey
        
        // Count votes and comments for this thread
        const voteStats = countVotesForThread(threadId, reactions, threadAuthor)
        const commentStats = countCommentsForThread(threadId, comments, threadAuthor)
        
        // Debug: Log vote stats for threads with votes
        if (voteStats.upVotes > 0 || voteStats.downVotes > 0) {
          logger.debug('[DiscussionsPage] Thread', threadId.substring(0, 8), 'has votes:', voteStats)
        }
        
        // Get relay sources
        const eventHints = client.getEventHints(threadId)
        const relaySources = eventHints.length > 0 ? eventHints : ['unknown']
        
        // Extract group information
        const groupInfo = extractGroupInfo(thread, relaySources)
        
        // Extract topics
        const tTagsRaw = thread.tags.filter((tag: string[]) => tag[0] === 't' && tag[1]).map((tag: string[]) => tag[1].toLowerCase())
        const hashtagsRaw = (thread.content.match(/#\w+/g) || []).map((tag: string) => tag.slice(1).toLowerCase())
        const allTopicsRaw = [...new Set([...tTagsRaw, ...hashtagsRaw])]
        
        // Categorize topic (will be updated after dynamic topics are analyzed)
        const predefinedTopicIds = DISCUSSION_TOPICS.map((t: any) => t.id)
        const categorizedTopic = getTopicFromTags(allTopicsRaw, predefinedTopicIds, groupInfo.isGroupDiscussion)
        
        // Normalize topics
        const tTags = tTagsRaw.map((tag: string) => normalizeTopic(tag))
        const hashtags = hashtagsRaw.map((tag: string) => normalizeTopic(tag))
        const allTopics = [...new Set([...tTags, ...hashtags])]
        
        newEventMap.set(threadId, {
          event: thread,
          relaySources,
          tTags,
          hashtags,
          allTopics,
          categorizedTopic,
          commentCount: commentStats.commentCount,
          lastCommentTime: commentStats.lastCommentTime,
          lastVoteTime: voteStats.lastVoteTime,
          upVotes: voteStats.upVotes,
          downVotes: voteStats.downVotes,
          // Group-related fields
          groupId: groupInfo.groupId,
          groupRelay: groupInfo.groupRelay,
          groupDisplayName: groupInfo.groupDisplayName,
          isGroupDiscussion: groupInfo.isGroupDiscussion
        })
      })
      
      logger.debug('[DiscussionsPage] Built event map with', newEventMap.size, 'new threads')
      
      // Log vote counts for debugging
      newEventMap.forEach((entry, threadId) => {
        if (entry.upVotes > 0 || entry.downVotes > 0) {
          logger.debug('[DiscussionsPage] Thread', threadId.substring(0, 8) + '...', 'has', entry.upVotes, 'upvotes,', entry.downVotes, 'downvotes')
        }
      })
      
      // Start with cached threads (if any) to preserve all threads we've ever seen
      // This ensures thread counts and topic counts don't go down when different relays return different subsets
      const allThreadsMap = new Map<string, EventMapEntry>()
      
      // First, add all cached threads to preserve them
      // CRITICAL: Always preserve cached threads, even if they're not in the new fetch
      if (cachedDataBeforeFetch) {
        logger.debug('[DiscussionsPage] Preserving', cachedDataBeforeFetch.eventMap.size, 'cached threads')
        cachedDataBeforeFetch.eventMap.forEach((entry, threadId) => {
          allThreadsMap.set(threadId, { ...entry }) // Create a copy to avoid mutations
        })
      }
      
      // Then, add or update with newly fetched threads
      // New threads will be added, existing threads will be updated with fresh data
      newEventMap.forEach((entry, threadId) => {
        allThreadsMap.set(threadId, { ...entry }) // Always use the fresh data from new fetch
      })
      
      const threadsBeforeCountUpdate = allThreadsMap.size
      logger.debug('[DiscussionsPage] Total threads after merge:', threadsBeforeCountUpdate, '(cached:', cachedDataBeforeFetch?.eventMap.size || 0, '+ new:', newEventMap.size, ', overlaps:', (cachedDataBeforeFetch?.eventMap.size || 0) + newEventMap.size - threadsBeforeCountUpdate, ')')
      
      // Now update comment/vote counts for ALL threads using fresh comments/reactions
      // This ensures cached threads get updated counts from the latest fetch
      const finalEventMap = new Map<string, EventMapEntry>()
      allThreadsMap.forEach((entry, threadId) => {
        const thread = entry.event
        const threadAuthor = thread.pubkey
        
        // Count votes and comments for this thread (using all fetched comments/reactions)
        const voteStats = countVotesForThread(threadId, reactions, threadAuthor)
        const commentStats = countCommentsForThread(threadId, comments, threadAuthor)
        
        // Update the entry with latest counts, but preserve all other data
        finalEventMap.set(threadId, {
          ...entry,
          commentCount: commentStats.commentCount,
          lastCommentTime: commentStats.lastCommentTime,
          lastVoteTime: voteStats.lastVoteTime,
          upVotes: voteStats.upVotes,
          downVotes: voteStats.downVotes
        })
      })
      
      logger.debug('[DiscussionsPage] Final event map has', finalEventMap.size, 'threads after count update')
      
      // Analyze dynamic topics from ALL threads (cached + new)
      const dynamicTopicsAnalysis = analyzeDynamicTopics(Array.from(finalEventMap.values()))
      
      // Update event map with enhanced topic categorization for all threads
      const categorizedEventMap = new Map<string, EventMapEntry>()
      finalEventMap.forEach((entry, threadId) => {
        const predefinedTopicIds = DISCUSSION_TOPICS.map((t: any) => t.id)
        const enhancedTopic = getEnhancedTopicFromTags(entry.allTopics, predefinedTopicIds, dynamicTopicsAnalysis.allTopics, entry.isGroupDiscussion)
        
        categorizedEventMap.set(threadId, {
          ...entry,
          categorizedTopic: enhancedTopic
        })
      })
      
      logger.debug('[DiscussionsPage] Categorized event map has', categorizedEventMap.size, 'threads')
      
      // Store final merged and categorized event map in cache
      // IMPORTANT: We've already manually merged all cached + new threads above
      // So categorizedEventMap contains ALL threads we want to preserve
      // We store with merge=false because we've already done the merge manually
      // This ensures we don't lose threads due to the cache service's merge logic
      const expectedThreadCount = categorizedEventMap.size
      discussionFeedCache.setCachedDiscussionsList(categorizedEventMap, dynamicTopicsAnalysis, false)
      
      // Verify the cache has all our threads (immediately after storing)
      const cachedAfterStore = discussionFeedCache.getCachedDiscussionsList()
      if (cachedAfterStore) {
        const actualThreadCount = cachedAfterStore.eventMap.size
        logger.debug('[DiscussionsPage] Cache verification - stored:', expectedThreadCount, 'threads, cache has:', actualThreadCount, 'threads')
        if (actualThreadCount !== expectedThreadCount) {
          logger.error('[DiscussionsPage] ERROR: Thread count mismatch! Expected', expectedThreadCount, 'but cache has', actualThreadCount)
          // If we lost threads, try to recover by storing again with the categorized map
          // This shouldn't happen, but if it does, at least log it
        }
      } else {
        logger.error('[DiscussionsPage] ERROR: Cache returned null after storing!')
      }
      
      // Always update state with the merged and categorized event map
      // This ensures we show all threads we've ever seen, with updated counts
      setAllEventMap(categorizedEventMap)
      setDynamicTopics(dynamicTopicsAnalysis)
      
      logger.debug('[DiscussionsPage] Updated UI with', categorizedEventMap.size, 'threads (merged from cache and new fetch)')
      
    } catch (error) {
      logger.error('[DiscussionsPage] Error fetching events:', error)
      // If we had cached data and fetch failed, at least we have something to show
      if (!hasCachedData) {
        setLoading(false)
      }
    } finally {
      if (!hasCachedData || forceRefresh) {
        setLoading(false)
      }
      setIsRefreshing(false)
      isFetchingRef.current = false
    }
  }, [buildComprehensiveRelayList]) // Only depend on buildComprehensiveRelayList
  
  // Calculate time span counts
  const calculateTimeSpanCounts = useCallback(() => {
    const now = Date.now()
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000)
    
    let count30 = 0
    let count90 = 0
    let countAll = 0
    
    allEventMap.forEach((entry) => {
      const threadTime = entry.event.created_at * 1000
      const lastCommentTime = entry.lastCommentTime > 0 ? entry.lastCommentTime * 1000 : 0
      const lastVoteTime = entry.lastVoteTime > 0 ? entry.lastVoteTime * 1000 : 0
      
      // For threads without comments/votes, only use thread creation time
      const mostRecentActivity = Math.max(
        threadTime,
        lastCommentTime,
        lastVoteTime
      )
      
      if (mostRecentActivity > thirtyDaysAgo) count30++
      if (mostRecentActivity > ninetyDaysAgo) count90++
      countAll++
    })
    
    setTimeSpanCounts({ '30days': count30, '90days': count90, 'all': countAll })
  }, [allEventMap])
  
  // Filter event map for display
  const filterEventMapForDisplay = useCallback(() => {
    const now = Date.now()
    const timeSpanAgo = timeSpan === '30days' ? now - (30 * 24 * 60 * 60 * 1000) : 
                       timeSpan === '90days' ? now - (90 * 24 * 60 * 60 * 1000) : 0
    
    const filteredMap = new Map<string, EventMapEntry>()
    
    allEventMap.forEach((entry) => {
      // Filter by time span
      let passesTimeFilter = false
      if (timeSpan === 'all') {
        passesTimeFilter = true
      } else {
        const threadTime = entry.event.created_at * 1000
        const lastCommentTime = entry.lastCommentTime > 0 ? entry.lastCommentTime * 1000 : 0
        const lastVoteTime = entry.lastVoteTime > 0 ? entry.lastVoteTime * 1000 : 0
        
        const mostRecentActivity = Math.max(
          threadTime,
          lastCommentTime,
          lastVoteTime
        )
        
        passesTimeFilter = mostRecentActivity > timeSpanAgo
      }
      
      // Filter by topic (including group filtering)
      let passesTopicFilter = false
      if (selectedTopic === 'all') {
        passesTopicFilter = true
      } else if (selectedTopic === 'groups') {
        // Show all group discussions when "Groups" main topic is selected
        passesTopicFilter = entry.isGroupDiscussion
      } else if (selectedTopic.startsWith('groups-')) {
        // Show specific group when group subtopic is selected
        const groupDisplayName = selectedTopic.replace('groups-', '')
        passesTopicFilter = entry.isGroupDiscussion && entry.groupDisplayName === groupDisplayName
      } else {
        // Regular topic filtering
        passesTopicFilter = entry.categorizedTopic === selectedTopic
      }
      
      if (passesTimeFilter && passesTopicFilter) {
        filteredMap.set(entry.event.id, entry)
      }
    })
    
    setEventMap(filteredMap)
  }, [allEventMap, timeSpan, selectedTopic, searchQuery])
  
  // Effects
  useEffect(() => {
    // Only initialize once
    if (hasInitializedRef.current) {
      logger.debug('[DiscussionsPage] Already initialized, skipping fetch')
      return
    }
    
    hasInitializedRef.current = true
    fetchAllEvents(false) // Don't force refresh on mount - use cache if available
  }, [fetchAllEvents])
  
  useEffect(() => {
    if (allEventMap.size > 0) {
      calculateTimeSpanCounts()
    }
  }, [allEventMap]) // Run when allEventMap changes
  
  useEffect(() => {
    if (allEventMap.size > 0) {
      filterEventMapForDisplay()
    }
  }, [allEventMap, timeSpan, selectedTopic]) // Run when allEventMap, timeSpan, or selectedTopic changes

  // Listen for state requests and restoration from PageManager
  useEffect(() => {
    const handleStateRequest = () => {
      window.dispatchEvent(new CustomEvent('discussionsStateResponse', {
        detail: { selectedTopic, timeSpan }
      }))
    }
    
    const handleRestore = (e: CustomEvent<{ page: string, discussionsState?: { selectedTopic: string, timeSpan: '30days' | '90days' | 'all' } }>) => {
      if (e.detail.page === 'discussions' && e.detail.discussionsState) {
        setSelectedTopic(e.detail.discussionsState.selectedTopic)
        setTimeSpan(e.detail.discussionsState.timeSpan)
      }
    }
    
    window.addEventListener('requestDiscussionsState', handleStateRequest as EventListener)
    window.addEventListener('restoreDiscussionsState', handleRestore as EventListener)
    return () => {
      window.removeEventListener('requestDiscussionsState', handleStateRequest as EventListener)
      window.removeEventListener('restoreDiscussionsState', handleRestore as EventListener)
    }
  }, [selectedTopic, timeSpan])
  
  // Get available topics sorted by most recent activity (including dynamic topics)
  // Topic counts are calculated based on the current time span filter
  const availableTopics = useMemo(() => {
    const topicMap = new Map<string, { count: number, lastActivity: number, isDynamic: boolean, isMainTopic: boolean, isSubtopic: boolean }>()
    
    // Calculate time span filter
    const now = Date.now()
    const timeSpanAgo = timeSpan === '30days' ? now - (30 * 24 * 60 * 60 * 1000) : 
                       timeSpan === '90days' ? now - (90 * 24 * 60 * 60 * 1000) : 0
    
    allEventMap.forEach((entry) => {
      // Filter by time span - only count topics for threads that match the time filter
      let passesTimeFilter = false
      if (timeSpan === 'all') {
        passesTimeFilter = true
      } else {
        const threadTime = entry.event.created_at * 1000
        const lastCommentTime = entry.lastCommentTime > 0 ? entry.lastCommentTime * 1000 : 0
        const lastVoteTime = entry.lastVoteTime > 0 ? entry.lastVoteTime * 1000 : 0
        
        const mostRecentActivity = Math.max(
          threadTime,
          lastCommentTime,
          lastVoteTime
        )
        
        passesTimeFilter = mostRecentActivity > timeSpanAgo
      }
      
      // Only count topics for threads that pass the time filter
      if (!passesTimeFilter) return
      
      const topic = entry.categorizedTopic
      const lastActivity = Math.max(
        entry.event.created_at * 1000,
        entry.lastCommentTime > 0 ? entry.lastCommentTime * 1000 : 0,
        entry.lastVoteTime > 0 ? entry.lastVoteTime * 1000 : 0
      )
      
      if (!topicMap.has(topic)) {
        const dynamicTopic = dynamicTopics.allTopics.find(dt => dt.id === topic)
        topicMap.set(topic, { 
          count: 0, 
          lastActivity: 0, 
          isDynamic: !!dynamicTopic,
          isMainTopic: dynamicTopic?.isMainTopic || false,
          isSubtopic: dynamicTopic?.isSubtopic || false
        })
      }
      
      const current = topicMap.get(topic)!
      current.count++
      current.lastActivity = Math.max(current.lastActivity, lastActivity)
    })
    
    // Convert to array and sort by most recent activity
    return Array.from(topicMap.entries())
      .map(([topic, data]) => ({ topic, ...data }))
      .sort((a, b) => b.lastActivity - a.lastActivity)
  }, [allEventMap, dynamicTopics, timeSpan]) // Include timeSpan in dependencies
  
  // State for search results
  const [searchedEntries, setSearchedEntries] = useState<EventMapEntry[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // Handle search with debouncing
  useEffect(() => {
    const performSearch = async () => {
      if (!searchQuery.trim()) {
        setSearchedEntries(Array.from(eventMap.values()))
        return
      }

      setIsSearching(true)
      try {
        const allEntries = Array.from(eventMap.values())
        const results = await searchThreads(allEntries, searchQuery)
        setSearchedEntries(results)
      } catch (error) {
        logger.error('[DiscussionsPage] Search failed:', error)
        setSearchedEntries(Array.from(eventMap.values()))
      } finally {
        setIsSearching(false)
      }
    }

    const timeoutId = setTimeout(performSearch, 300) // 300ms debounce
    return () => clearTimeout(timeoutId)
  }, [eventMap, searchQuery])

  // Group events by topic with hierarchy (main topics and subtopics)
  const groupedEvents = useMemo(() => {
    const mainTopicGroups = new Map<string, {
      entries: EventMapEntry[]
      subtopics: Map<string, EventMapEntry[]>
    }>()
    
    searchedEntries.forEach((entry) => {
      // Check if this entry has any dynamic subtopics
      const entrySubtopics = entry.allTopics.filter(topic => {
        const dynamicTopic = dynamicTopics.allTopics.find(dt => dt.id === topic && dt.isSubtopic)
        return !!dynamicTopic
      })
      
      if (entrySubtopics.length > 0) {
        // This entry has subtopics - group under the main topic with the subtopic
        const mainTopic = entry.categorizedTopic
        const subtopic = entrySubtopics[0]
        
        // Initialize main topic group if it doesn't exist
        if (!mainTopicGroups.has(mainTopic)) {
          mainTopicGroups.set(mainTopic, {
            entries: [],
            subtopics: new Map()
          })
        }
        
        const group = mainTopicGroups.get(mainTopic)!
        
        // Add to subtopic group
        if (!group.subtopics.has(subtopic)) {
          group.subtopics.set(subtopic, [])
        }
        group.subtopics.get(subtopic)!.push(entry)
      } else {
        // No subtopic, add to main topic
        const mainTopic = entry.categorizedTopic
        
        // Initialize main topic group if it doesn't exist
        if (!mainTopicGroups.has(mainTopic)) {
          mainTopicGroups.set(mainTopic, {
            entries: [],
            subtopics: new Map()
          })
        }
        
        const group = mainTopicGroups.get(mainTopic)!
        group.entries.push(entry)
      }
    })
    
    // Sort threads within each group and subtopic by newest-first
    mainTopicGroups.forEach((group) => {
      const sortEntries = (entries: EventMapEntry[]) => {
        entries.sort((a, b) => {
          const aActivity = Math.max(
            a.event.created_at * 1000,
            a.lastCommentTime > 0 ? a.lastCommentTime * 1000 : 0,
            a.lastVoteTime > 0 ? a.lastVoteTime * 1000 : 0
          )
          const bActivity = Math.max(
            b.event.created_at * 1000,
            b.lastCommentTime > 0 ? b.lastCommentTime * 1000 : 0,
            b.lastVoteTime > 0 ? b.lastVoteTime * 1000 : 0
          )
          return bActivity - aActivity // Newest first
        })
      }
      
      sortEntries(group.entries)
      group.subtopics.forEach((entries) => sortEntries(entries))
    })
    
    // Sort groups by most recent activity (newest first)
    const sortedGroups = new Map<string, { entries: EventMapEntry[], subtopics: Map<string, EventMapEntry[]> }>()
    
    const sortedEntries = Array.from(mainTopicGroups.entries()).sort(([, aGroup], [, bGroup]) => {
      const aEntries = aGroup.entries
      const bEntries = bGroup.entries
      
      if (aEntries.length === 0 && bEntries.length === 0) return 0
      if (aEntries.length === 0) return 1
      if (bEntries.length === 0) return -1
      
      const aMostRecent = Math.max(
        aEntries[0].event.created_at * 1000,
        aEntries[0].lastCommentTime > 0 ? aEntries[0].lastCommentTime * 1000 : 0,
        aEntries[0].lastVoteTime > 0 ? aEntries[0].lastVoteTime * 1000 : 0
      )
      const bMostRecent = Math.max(
        bEntries[0].event.created_at * 1000,
        bEntries[0].lastCommentTime > 0 ? bEntries[0].lastCommentTime * 1000 : 0,
        bEntries[0].lastVoteTime > 0 ? bEntries[0].lastVoteTime * 1000 : 0
      )
      
      return bMostRecent - aMostRecent // Newest first
    })
    
    sortedEntries.forEach(([topic, group]) => {
      sortedGroups.set(topic, group)
    })
    
    return sortedGroups
  }, [searchedEntries, dynamicTopics])
  
  // Handle refresh
  const handleRefresh = () => {
    fetchAllEvents(true) // Force refresh when user clicks refresh button
  }
  
  // Handle create thread
  const handleCreateThread = (publishedEvent?: NostrEventType) => {
    if (!publishedEvent) return
    
    // Add to event map immediately
    const threadId = publishedEvent.id
    const tTagsRaw = publishedEvent.tags.filter((tag: string[]) => tag[0] === 't' && tag[1]).map((tag: string[]) => tag[1].toLowerCase())
    const hashtagsRaw = (publishedEvent.content.match(/#\w+/g) || []).map((tag: string) => tag.slice(1).toLowerCase())
    const allTopicsRaw = [...new Set([...tTagsRaw, ...hashtagsRaw])]
    const predefinedTopicIds = DISCUSSION_TOPICS.map((t: any) => t.id)
    const tTags = tTagsRaw.map((tag: string) => normalizeTopic(tag))
    const hashtags = hashtagsRaw.map((tag: string) => normalizeTopic(tag))
    const allTopics = [...new Set([...tTags, ...hashtags])]
    const eventHints = client.getEventHints(threadId)
    const relaySources = eventHints.length > 0 ? eventHints : ['unknown']
    
    // Extract group information
    const groupInfo = extractGroupInfo(publishedEvent, relaySources)
    const categorizedTopic = getTopicFromTags(allTopicsRaw, predefinedTopicIds, groupInfo.isGroupDiscussion)
    
    const newEntry: EventMapEntry = {
      event: publishedEvent,
      relaySources,
      tTags,
      hashtags,
      allTopics,
      categorizedTopic,
      commentCount: 0,
      lastCommentTime: 0,
      lastVoteTime: 0,
      upVotes: 0,
      downVotes: 0,
      // Group-related fields
      groupId: groupInfo.groupId,
      groupRelay: groupInfo.groupRelay,
      groupDisplayName: groupInfo.groupDisplayName,
      isGroupDiscussion: groupInfo.isGroupDiscussion
    }
    
    setAllEventMap(prev => new Map(prev).set(threadId, newEntry))
    
    // Close the dialog
    setShowCreateDialog(false)
  }
  
  // Handle close dialog
  const handleCloseDialog = () => {
    setShowCreateDialog(false)
  }
  
  // Handle thread click
  const handleThreadClick = (threadId: string) => {
    navigateToNote(toNote(threadId))
  }

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="discussions"
      titlebar={<DiscussionsPageTitlebar />}
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-2 flex flex-col gap-4 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 w-full sm:w-auto"
          >
            {t('Create Thread')}
          </button>
        </div>
        
        {/* Search Bar */}
        <div className="relative">
          {isSearching ? (
            <RefreshCw className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 animate-spin" />
          ) : (
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          )}
          <input
            type="text"
            placeholder={t('Search threads by title, content, tags, npub, author...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-black dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        
        {/* Filters - Stack on mobile, row on desktop */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* Topic Selection Dropdown */}
          <select 
            value={selectedTopic} 
            onChange={(e) => setSelectedTopic(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 bg-white dark:bg-gray-800 text-black dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Topics ({timeSpanCounts[timeSpan]})</option>
            {availableTopics.map(({ topic, count, isDynamic, isMainTopic, isSubtopic }) => {
              const isGroupsTopic = topic === 'groups'
              return (
                <option key={topic} value={topic}>
                  {isGroupsTopic ? '👥 ' : ''}
                  {isDynamic && isMainTopic && !isGroupsTopic ? '🔥 ' : ''}
                  {isDynamic && isSubtopic ? '📌 ' : ''}
                  {topic} ({count})
                  {isDynamic && isMainTopic ? ' [Main Topic]' : ''}
                  {isDynamic && isSubtopic ? ' [Subtopic]' : ''}
                </option>
              )
            })}
          </select>
          
          {/* Time Span Dropdown */}
          <select 
            value={timeSpan} 
            onChange={(e) => setTimeSpan(e.target.value as '30days' | '90days' | 'all')}
            className="w-full sm:w-auto px-3 py-2 bg-white dark:bg-gray-800 text-black dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="30days">30 days ({timeSpanCounts['30days']})</option>
            <option value="90days">90 days ({timeSpanCounts['90days']})</option>
            <option value="all">All found ({timeSpanCounts.all})</option>
          </select>
          
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded w-full sm:w-auto flex items-center justify-center sm:justify-start"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="ml-2 sm:hidden">{t('Refresh')}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-2 sm:p-4 pb-20 sm:pb-4">
        {loading ? (
          <div className="text-center py-8">{t('Loading...')}</div>
        ) : isSearching ? (
          <div className="text-center py-8">{t('Searching...')}</div>
        ) : (
          <div className="space-y-6 pb-8">
            {Array.from(groupedEvents.entries()).map(([mainTopic, group]) => {
              const topicInfo = availableTopics.find(t => t.topic === mainTopic)
              const isDynamicMain = topicInfo?.isDynamic && topicInfo?.isMainTopic
              const isGroupsTopic = mainTopic === 'groups'
              
              return (
                <div key={mainTopic} className="space-y-4">
                  {/* Main Topic Header */}
                  <h2 className="text-lg font-semibold mb-3 capitalize flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    <span className="flex items-center gap-2">
                      {isGroupsTopic && <span className="text-blue-500">👥</span>}
                      {isDynamicMain && !isGroupsTopic && <span className="text-orange-500">🔥</span>}
                      {mainTopic} ({group.entries.length + Array.from(group.subtopics.values()).reduce((sum, events) => sum + events.length, 0)} {group.entries.length + Array.from(group.subtopics.values()).reduce((sum, events) => sum + events.length, 0) === 1 ? t('thread') : t('threads')})
                    </span>
                    {isDynamicMain && <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 px-2 py-1 rounded w-fit">Main Topic</span>}
                  </h2>
                  
                  {/* Main Topic Threads */}
                  {group.entries.length > 0 && (
                    <div className="space-y-3">
                      {group.entries.map((entry) => (
                        <ThreadCard
                          key={entry.event.id}
                          thread={entry.event}
                          lastCommentTime={entry.lastCommentTime}
                          lastVoteTime={entry.lastVoteTime}
                          upVotes={entry.upVotes}
                          downVotes={entry.downVotes}
                          onThreadClick={() => handleThreadClick(entry.event.id)}
                        />
                      ))}
                    </div>
                  )}
                  
                  {/* Subtopic Groups */}
                  {group.subtopics.size > 0 && (
                    <div className="ml-2 sm:ml-4 space-y-4">
                      {Array.from(group.subtopics.entries()).map(([subtopic, subtopicEvents]) => {
                        const subtopicInfo = availableTopics.find(t => t.topic === subtopic)
                        const isSubtopicDynamic = subtopicInfo?.isDynamic && subtopicInfo?.isSubtopic
                        
                        return (
                          <div key={subtopic} className="space-y-2">
                            <h3 className="text-sm sm:text-md font-medium capitalize flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-muted-foreground">
                              <span className="flex items-center gap-2">
                                {isSubtopicDynamic && <span className="text-blue-500">📌</span>}
                                {subtopic} ({subtopicEvents.length} {subtopicEvents.length === 1 ? t('thread') : t('threads')})
                              </span>
                              {isSubtopicDynamic && <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded w-fit">Subtopic</span>}
                            </h3>
                            <div className="space-y-3">
                              {subtopicEvents.map((entry) => (
                                <ThreadCard
                                  key={entry.event.id}
                                  thread={entry.event}
                                  lastCommentTime={entry.lastCommentTime}
                                  lastVoteTime={entry.lastVoteTime}
                                  upVotes={entry.upVotes}
                                  downVotes={entry.downVotes}
                                  onThreadClick={() => handleThreadClick(entry.event.id)}
                                />
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create Thread Dialog */}
      {showCreateDialog && (
        <CreateThreadDialog
          topic="general"
          availableRelays={[]}
          relaySets={[]}
          dynamicTopics={dynamicTopics}
          onClose={handleCloseDialog}
          onThreadCreated={handleCreateThread} 
        />
      )}
    </PrimaryPageLayout>
  )
})

DiscussionsPage.displayName = 'DiscussionsPage'

export default DiscussionsPage
