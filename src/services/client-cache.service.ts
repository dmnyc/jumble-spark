import { ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'
import type { Event as NEvent } from 'nostr-tools'
import logger from '@/lib/logger'
import indexedDb from './indexed-db.service'
import { getProfileFromEvent } from '@/lib/event-metadata'
import type { TProfile, TRelayList } from '@/types'
import { getRelayListFromEvent } from '@/lib/event-metadata'

/** Cache TTLs in milliseconds */
const CACHE_TTLS = {
  PROFILE: 30 * 60 * 1000, // 30 minutes
  PAYMENT_INFO: 5 * 60 * 1000, // 5 minutes
  RELAY_LIST: 15 * 60 * 1000, // 15 minutes
  FOLLOW_LIST: 60 * 60 * 1000, // 1 hour
  MUTE_LIST: 60 * 60 * 1000, // 1 hour
  OTHER_REPLACEABLE: 60 * 60 * 1000 // 1 hour
} as const

/** Cache refresh thresholds - refresh if older than this */
const REFRESH_THRESHOLDS = {
  PROFILE: 15 * 60 * 1000, // 15 minutes
  PAYMENT_INFO: 2 * 60 * 1000, // 2 minutes
  RELAY_LIST: 10 * 60 * 1000, // 10 minutes
  FOLLOW_LIST: 30 * 60 * 1000, // 30 minutes
  MUTE_LIST: 30 * 60 * 1000, // 30 minutes
  OTHER_REPLACEABLE: 30 * 60 * 1000 // 30 minutes
} as const

interface CacheWarmupConfig {
  /** Pubkeys to warm up profiles for */
  profilePubkeys?: string[]
  /** Pubkeys to warm up relay lists for */
  relayListPubkeys?: string[]
  /** Whether to warm up follow lists */
  warmupFollowLists?: boolean
  /** Whether to warm up mute lists */
  warmupMuteLists?: boolean
}

class ClientCacheService {
  private static instance: ClientCacheService
  private refreshQueue = new Set<string>() // pubkey:kind strings
  private warmingUp = false
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null

  static getInstance(): ClientCacheService {
    if (!ClientCacheService.instance) {
      ClientCacheService.instance = new ClientCacheService()
    }
    return ClientCacheService.instance
  }

  /**
   * Check if a cached replaceable event is stale and needs refresh
   */
  isStale(_pubkey: string, kind: number, cachedAt?: number): boolean {
    if (!cachedAt) return true
    
    const threshold = this.getRefreshThreshold(kind)
    return Date.now() - cachedAt > threshold
  }

  /**
   * Get refresh threshold for a kind
   */
  private getRefreshThreshold(kind: number): number {
    if (kind === kinds.Metadata) return REFRESH_THRESHOLDS.PROFILE
    if (kind === ExtendedKind.PAYMENT_INFO) return REFRESH_THRESHOLDS.PAYMENT_INFO
    if (kind === kinds.RelayList) return REFRESH_THRESHOLDS.RELAY_LIST
    if (kind === kinds.Contacts) return REFRESH_THRESHOLDS.FOLLOW_LIST
    if (kind === kinds.Mutelist) return REFRESH_THRESHOLDS.MUTE_LIST
    return REFRESH_THRESHOLDS.OTHER_REPLACEABLE
  }

  /**
   * Get cache TTL for a kind
   */
  private getCacheTTL(kind: number): number {
    if (kind === kinds.Metadata) return CACHE_TTLS.PROFILE
    if (kind === ExtendedKind.PAYMENT_INFO) return CACHE_TTLS.PAYMENT_INFO
    if (kind === kinds.RelayList) return CACHE_TTLS.RELAY_LIST
    if (kind === kinds.Contacts) return CACHE_TTLS.FOLLOW_LIST
    if (kind === kinds.Mutelist) return CACHE_TTLS.MUTE_LIST
    return CACHE_TTLS.OTHER_REPLACEABLE
  }

  /**
   * Check if cached event should be invalidated (too old)
   */
  shouldInvalidate(kind: number, cachedAt?: number): boolean {
    if (!cachedAt) return false
    
    const ttl = this.getCacheTTL(kind)
    return Date.now() - cachedAt > ttl
  }

  /**
   * Warm up cache for common data on login/initialization
   */
  async warmupCache(config: CacheWarmupConfig, fetchFn: {
    fetchProfile: (id: string) => Promise<TProfile | undefined>
    fetchRelayList: (pubkey: string) => Promise<TRelayList>
    fetchFollowList?: (pubkey: string) => Promise<string[]>
    fetchMuteList?: (pubkey: string) => Promise<NEvent | undefined>
  }): Promise<void> {
    if (this.warmingUp) {
      logger.debug('[CacheService] Already warming up, skipping')
      return
    }

    this.warmingUp = true
    logger.info('[CacheService] Starting cache warmup', config)

    try {
      const promises: Promise<void>[] = []

      // Warm up profiles
      if (config.profilePubkeys?.length) {
        for (const pubkey of config.profilePubkeys.slice(0, 50)) { // Limit to 50
          promises.push(
            fetchFn.fetchProfile(pubkey)
              .then(() => logger.debug('[CacheService] Warmed profile', { pubkey: pubkey.substring(0, 8) }))
              .catch(err => logger.warn('[CacheService] Failed to warm profile', { pubkey: pubkey.substring(0, 8), error: err }))
          )
        }
      }

      // Warm up relay lists
      if (config.relayListPubkeys?.length) {
        for (const pubkey of config.relayListPubkeys.slice(0, 20)) { // Limit to 20
          promises.push(
            fetchFn.fetchRelayList(pubkey)
              .then(() => logger.debug('[CacheService] Warmed relay list', { pubkey: pubkey.substring(0, 8) }))
              .catch(err => logger.warn('[CacheService] Failed to warm relay list', { pubkey: pubkey.substring(0, 8), error: err }))
          )
        }
      }

      // Warm up follow lists
      if (config.warmupFollowLists && fetchFn.fetchFollowList) {
        const currentUserPubkey = config.profilePubkeys?.[0] // Assume first is current user
        if (currentUserPubkey) {
          promises.push(
            fetchFn.fetchFollowList(currentUserPubkey)
              .then(() => logger.debug('[CacheService] Warmed follow list'))
              .catch(err => logger.warn('[CacheService] Failed to warm follow list', { error: err }))
          )
        }
      }

      // Warm up mute lists
      if (config.warmupMuteLists && fetchFn.fetchMuteList) {
        const currentUserPubkey = config.profilePubkeys?.[0]
        if (currentUserPubkey) {
          promises.push(
            fetchFn.fetchMuteList(currentUserPubkey)
              .then(() => logger.debug('[CacheService] Warmed mute list'))
              .catch(err => logger.warn('[CacheService] Failed to warm mute list', { error: err }))
          )
        }
      }

      await Promise.allSettled(promises)
      logger.info('[CacheService] Cache warmup completed', { count: promises.length })
    } finally {
      this.warmingUp = false
    }
  }

  /**
   * Schedule background refresh for stale cache entries
   */
  scheduleRefresh(pubkey: string, kind: number, fetchFn: () => Promise<void>): void {
    const key = `${pubkey}:${kind}`
    if (this.refreshQueue.has(key)) {
      return // Already queued
    }

    // Check if actually stale by getting the cached timestamp
    indexedDb.getReplaceableEventCachedAt(pubkey, kind).then(cachedAt => {
      if (cachedAt === undefined) return // Not in cache
      
      // Check if stale using the actual cached timestamp
      const isStale = this.isStale(pubkey, kind, cachedAt)
      
      if (isStale) {
        this.refreshQueue.add(key)
        // Refresh in background (non-blocking)
        fetchFn()
          .then(() => {
            logger.debug('[CacheService] Refreshed cache', { pubkey: pubkey.substring(0, 8), kind })
          })
          .catch(err => {
            logger.warn('[CacheService] Failed to refresh cache', { pubkey: pubkey.substring(0, 8), kind, error: err })
          })
          .finally(() => {
            this.refreshQueue.delete(key)
          })
      }
    }).catch(() => {
      // Ignore errors
    })
  }

  /**
   * Start periodic cache refresh for stale entries
   */
  startPeriodicRefresh(refreshFn: (pubkey: string, kind: number) => Promise<void>): void {
    if (this.refreshIntervalId) {
      return // Already running
    }

    logger.info('[CacheService] Starting periodic cache refresh')
    
    this.refreshIntervalId = setInterval(async () => {
      try {
        // Check for stale profiles (limit to avoid overwhelming)
        await this.refreshStaleProfiles(refreshFn)
      } catch (error) {
        logger.warn('[CacheService] Periodic refresh error', { error })
      }
    }, 5 * 60 * 1000) // Every 5 minutes
  }

  /**
   * Stop periodic cache refresh
   */
  stopPeriodicRefresh(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId)
      this.refreshIntervalId = null
      logger.info('[CacheService] Stopped periodic cache refresh')
    }
  }

  /**
   * Refresh stale profiles (limited batch)
   */
  private async refreshStaleProfiles(_refreshFn: (pubkey: string, kind: number) => Promise<void>): Promise<void> {
    // This would iterate through cached profiles and refresh stale ones
    // For now, this is a placeholder - would need IndexedDB iteration
    logger.debug('[CacheService] Checking for stale profiles to refresh')
  }

  /**
   * Get cached profile with fallback - returns cached immediately, refreshes in background if stale
   */
  async getProfileWithRefresh(
    pubkey: string,
    fetchFn: () => Promise<TProfile | undefined>
  ): Promise<TProfile | undefined> {
    // Try cache first
    const cached = await indexedDb.getReplaceableEvent(pubkey, kinds.Metadata)
    if (cached) {
      const profile = getProfileFromEvent(cached)
      
      // Get the timestamp when this was cached
      const cachedAt = await indexedDb.getReplaceableEventCachedAt(pubkey, kinds.Metadata)
      
      // If stale, refresh in background
      if (this.isStale(pubkey, kinds.Metadata, cachedAt)) {
        this.scheduleRefresh(pubkey, kinds.Metadata, async () => {
          await fetchFn()
        })
      }
      
      return profile
    }

    // Not in cache, fetch now
    return await fetchFn()
  }

  /**
   * Get cached relay list with fallback - returns cached immediately, refreshes in background if stale
   */
  async getRelayListWithRefresh(
    pubkey: string,
    fetchFn: () => Promise<TRelayList>
  ): Promise<TRelayList> {
    // Try cache first
    const cached = await indexedDb.getReplaceableEvent(pubkey, kinds.RelayList)
    if (cached) {
      const relayList = getRelayListFromEvent(cached)
      
      // Get the timestamp when this was cached
      const cachedAt = await indexedDb.getReplaceableEventCachedAt(pubkey, kinds.RelayList)
      
      // If stale, refresh in background
      if (this.isStale(pubkey, kinds.RelayList, cachedAt)) {
        this.scheduleRefresh(pubkey, kinds.RelayList, async () => {
          await fetchFn()
        })
      }
      
      return relayList
    }

    // Not in cache, fetch now
    return await fetchFn()
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.refreshQueue.clear()
    logger.info('[CacheService] Cleared all cache refresh queues')
  }
}

export const cacheService = ClientCacheService.getInstance()
export default cacheService
