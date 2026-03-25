import { Event as NEvent, kinds } from 'nostr-tools'
import logger from '@/lib/logger'

interface CachedThreadData {
  replies: NEvent[]
  timestamp: number
  rootInfo: {
    type: 'E' | 'A' | 'I'
    id: string
    pubkey?: string
    eventId?: string
    relay?: string
  }
}

interface CachedDiscussionsListData {
  eventMap: Map<string, any>
  dynamicTopics: {
    mainTopics: any[]
    subtopics: any[]
    allTopics: any[]
  }
  timestamp: number
}

/**
 * Cache service for discussion feed data (thread replies/comments)
 * Uses in-memory cache with timestamp-based expiration
 */
class DiscussionFeedCacheService {
  static instance: DiscussionFeedCacheService
  private cache: Map<string, CachedThreadData> = new Map()
  private discussionsListCache: CachedDiscussionsListData | null = null
  private readonly CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
  private readonly DISCUSSIONS_LIST_CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes for discussions list

  static getInstance(): DiscussionFeedCacheService {
    if (!DiscussionFeedCacheService.instance) {
      DiscussionFeedCacheService.instance = new DiscussionFeedCacheService()
    }
    return DiscussionFeedCacheService.instance
  }

  /**
   * Get cache key for a thread
   */
  private getCacheKey(rootInfo: CachedThreadData['rootInfo']): string {
    if (rootInfo.type === 'E') {
      return `thread:E:${rootInfo.id}`
    } else if (rootInfo.type === 'A') {
      return `thread:A:${rootInfo.id}`
    } else if (rootInfo.type === 'I') {
      return `thread:I:${rootInfo.id}`
    }
    return `thread:unknown:${rootInfo.id}`
  }

  /**
   * Check if cached data is stale
   */
  private isStale(cachedData: CachedThreadData): boolean {
    const age = Date.now() - cachedData.timestamp
    return age > this.CACHE_TTL_MS
  }

  /**
   * Get cached replies for a thread
   * Returns null if cache is empty, but returns data even if stale (for instant display)
   */
  getCachedReplies(rootInfo: CachedThreadData['rootInfo']): NEvent[] | null {
    const cacheKey = this.getCacheKey(rootInfo)
    const cachedData = this.cache.get(cacheKey)

    if (!cachedData) {
      logger.debug('[DiscussionFeedCache] Cache miss for thread:', cacheKey)
      return null
    }

    // Verify rootInfo matches (in case thread structure changed)
    if (
      cachedData.rootInfo.type !== rootInfo.type ||
      cachedData.rootInfo.id !== rootInfo.id
    ) {
      logger.debug('[DiscussionFeedCache] Cache rootInfo mismatch for thread:', cacheKey)
      this.cache.delete(cacheKey)
      return null
    }

    // Return cached data even if stale (caller will fetch fresh data in background)
    const isStale = this.isStale(cachedData)
    if (isStale) {
      logger.debug('[DiscussionFeedCache] Cache hit (stale) for thread:', cacheKey, 'age:', Date.now() - cachedData.timestamp, 'ms', 'replies:', cachedData.replies.length)
    } else {
      logger.debug('[DiscussionFeedCache] Cache hit (fresh) for thread:', cacheKey, 'replies:', cachedData.replies.length)
    }
    
    return cachedData.replies.filter((r) => r.kind !== kinds.Reaction)
  }

  /**
   * Check if cached data exists and is fresh (not stale)
   */
  hasFreshCache(rootInfo: CachedThreadData['rootInfo']): boolean {
    const cacheKey = this.getCacheKey(rootInfo)
    const cachedData = this.cache.get(cacheKey)

    if (!cachedData) {
      return false
    }

    // Verify rootInfo matches
    if (
      cachedData.rootInfo.type !== rootInfo.type ||
      cachedData.rootInfo.id !== rootInfo.id
    ) {
      return false
    }

    return !this.isStale(cachedData)
  }

  /**
   * Store replies in cache
   * Merges new replies with existing cached replies to prevent count from going down
   */
  setCachedReplies(rootInfo: CachedThreadData['rootInfo'], replies: NEvent[]): void {
    const cacheKey = this.getCacheKey(rootInfo)
    const existingData = this.cache.get(cacheKey)
    
    let mergedReplies: NEvent[]
    if (existingData && 
        existingData.rootInfo.type === rootInfo.type &&
        existingData.rootInfo.id === rootInfo.id) {
      // Merge with existing cached replies - keep all unique replies
      const existingReplyIds = new Set(existingData.replies.map(r => r.id))
      const newReplies = replies.filter(r => !existingReplyIds.has(r.id))
      mergedReplies = [...existingData.replies, ...newReplies].filter(
        (r) => r.kind !== kinds.Reaction
      )
      logger.debug('[DiscussionFeedCache] Merged replies for thread:', cacheKey, 'existing:', existingData.replies.length, 'new:', newReplies.length, 'total:', mergedReplies.length)
    } else {
      // No existing cache or rootInfo mismatch, use new replies
      mergedReplies = replies.filter((r) => r.kind !== kinds.Reaction)
      logger.debug('[DiscussionFeedCache] Cached new replies for thread:', cacheKey, 'replies:', replies.length)
    }
    
    const cachedData: CachedThreadData = {
      replies: mergedReplies, // Create a copy to avoid mutations
      timestamp: Date.now(),
      rootInfo: { ...rootInfo } // Create a copy
    }

    this.cache.set(cacheKey, cachedData)

    // Clean up stale entries periodically (every 10th set operation)
    if (this.cache.size > 50 && Math.random() < 0.1) {
      this.cleanupStaleEntries()
    }
  }

  /**
   * Clear cache for a specific thread
   */
  clearCache(rootInfo: CachedThreadData['rootInfo']): void {
    const cacheKey = this.getCacheKey(rootInfo)
    this.cache.delete(cacheKey)
    logger.debug('[DiscussionFeedCache] Cleared cache for thread:', cacheKey)
  }

  /**
   * Clear all cached data
   */
  clearAllCache(): void {
    this.cache.clear()
    logger.debug('[DiscussionFeedCache] Cleared all cache')
  }

  /**
   * Remove stale entries from cache
   */
  private cleanupStaleEntries(): void {
    let cleaned = 0
    for (const [key, data] of this.cache.entries()) {
      if (this.isStale(data)) {
        this.cache.delete(key)
        cleaned++
      }
    }
    if (cleaned > 0) {
      logger.debug('[DiscussionFeedCache] Cleaned up', cleaned, 'stale entries')
    }
  }

  /**
   * Get cache statistics (for debugging)
   */
  getCacheStats(): { size: number; entries: Array<{ key: string; age: number; replyCount: number }> } {
    const entries = Array.from(this.cache.entries()).map(([key, data]) => ({
      key,
      age: Date.now() - data.timestamp,
      replyCount: data.replies.length
    }))
    return {
      size: this.cache.size,
      entries
    }
  }

  /**
   * Get cached discussions list data
   * Returns null if cache is empty, but returns data even if stale (for merging purposes)
   */
  getCachedDiscussionsList(): CachedDiscussionsListData | null {
    if (!this.discussionsListCache) {
      logger.debug('[DiscussionFeedCache] Discussions list cache miss')
      return null
    }

    const age = Date.now() - this.discussionsListCache.timestamp
    const isStale = age > this.DISCUSSIONS_LIST_CACHE_TTL_MS
    
    if (isStale) {
      logger.debug('[DiscussionFeedCache] Discussions list cache hit (stale), age:', age, 'ms')
    } else {
      logger.debug('[DiscussionFeedCache] Discussions list cache hit (fresh), age:', age, 'ms')
    }
    
    // Return cached data even if stale (caller will merge and update)
    return this.discussionsListCache
  }

  /**
   * Check if cached discussions list data exists and is fresh (not stale)
   */
  hasFreshDiscussionsListCache(): boolean {
    if (!this.discussionsListCache) {
      return false
    }

    const age = Date.now() - this.discussionsListCache.timestamp
    return age <= this.DISCUSSIONS_LIST_CACHE_TTL_MS
  }

  /**
   * Store discussions list data in cache
   * Merges new threads with existing cached threads to prevent count from going down
   * When merge=true, ALWAYS preserves all existing threads and adds new ones
   */
  setCachedDiscussionsList(eventMap: Map<string, any>, dynamicTopics: { mainTopics: any[]; subtopics: any[]; allTopics: any[] }, merge = true): void {
    let mergedEventMap: Map<string, any>
    const existingCacheSize = this.discussionsListCache?.eventMap.size || 0
    const newDataSize = eventMap.size
    
    if (merge && this.discussionsListCache) {
      // Merge with existing cached threads - keep all threads we've ever seen
      // Start with ALL existing cached threads - this is critical to prevent thread loss
      mergedEventMap = new Map(this.discussionsListCache.eventMap)
      
      // Add or update threads from the new fetch
      // For existing threads, prefer the new data (which has fresher counts)
      // For new threads, add them
      eventMap.forEach((entry, threadId) => {
        // Always update with new data if it exists (new data has fresher counts from latest fetch)
        // This ensures we get updated comment/vote counts for all threads
        mergedEventMap.set(threadId, entry)
      })
      
      const finalSize = mergedEventMap.size
      logger.debug('[DiscussionFeedCache] Merged discussions list: existing:', existingCacheSize, 'new:', newDataSize, 'total:', finalSize, '(expected at least:', Math.max(existingCacheSize, newDataSize), ')')
      
      // Safety check: we should never have fewer threads than we started with (unless new data has fewer)
      // But we should always have at least as many as the larger of the two sets
      if (finalSize < Math.max(existingCacheSize, newDataSize)) {
        logger.warn('[DiscussionFeedCache] WARNING: Merge resulted in fewer threads! Existing:', existingCacheSize, 'New:', newDataSize, 'Final:', finalSize)
      }
    } else {
      // No existing cache or merge=false, use new data directly
      mergedEventMap = new Map(eventMap)
      logger.debug('[DiscussionFeedCache] Cached new discussions list (no merge):', eventMap.size, 'threads')
    }
    
    // Store merged event map
    this.discussionsListCache = {
      eventMap: mergedEventMap,
      dynamicTopics: {
        mainTopics: [...dynamicTopics.mainTopics],
        subtopics: [...dynamicTopics.subtopics],
        allTopics: [...dynamicTopics.allTopics]
      },
      timestamp: Date.now()
    }
    
    // Final verification
    if (this.discussionsListCache.eventMap.size !== mergedEventMap.size) {
      logger.error('[DiscussionFeedCache] ERROR: Cache eventMap size mismatch after storing! Expected:', mergedEventMap.size, 'Got:', this.discussionsListCache.eventMap.size)
    }
  }

  /**
   * Clear discussions list cache
   */
  clearDiscussionsListCache(): void {
    this.discussionsListCache = null
    logger.debug('[DiscussionFeedCache] Cleared discussions list cache')
  }
}

const instance = DiscussionFeedCacheService.getInstance()
export default instance

