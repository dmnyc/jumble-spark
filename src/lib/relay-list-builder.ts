/**
 * Comprehensive relay list builder utility
 * Handles all relay selection requirements:
 * - Filters blocked relays
 * - Includes local relays from kind 10432
 * - Handles author's outboxes/inboxes
 * - Handles user's outboxes/inboxes
 * - Includes relay hints
 * - Includes seen relays
 */

import { FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS, PROFILE_FETCH_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { getCacheRelayUrls } from './private-relays'
import client from '@/services/client.service'
import logger from '@/lib/logger'

export interface RelayListBuilderOptions {
  /** Author's pubkey - will include their outboxes (write relays) */
  authorPubkey?: string
  /** Logged-in user's pubkey - will include their inboxes (read relays) and outboxes (write relays) */
  userPubkey?: string
  /** Explicit relay hints (from bech32 IDs or event tags) */
  relayHints?: string[]
  /** Relays where an event was seen */
  seenRelays?: string[]
  /** Relays where a containing event was found (for embedded events) */
  containingEventRelays?: string[]
  /** Whether to include user's own relays (read/write/local) - for profiles/metadata */
  includeUserOwnRelays?: boolean
  /** Whether to include PROFILE_FETCH_RELAY_URLS - for profiles/metadata */
  includeProfileFetchRelays?: boolean
  /** Whether to include FAST_READ_RELAY_URLS as fallback */
  includeFastReadRelays?: boolean
  /** Whether to include FAST_WRITE_RELAY_URLS as fallback */
  includeFastWriteRelays?: boolean
  /** Whether to include SEARCHABLE_RELAY_URLS - for search */
  includeSearchableRelays?: boolean
  /** Blocked relays to filter out */
  blockedRelays?: string[]
  /** Whether to include local relays from kind 10432 */
  includeLocalRelays?: boolean
}

/**
 * Build comprehensive relay list according to requirements
 */
export async function buildComprehensiveRelayList(options: RelayListBuilderOptions = {}): Promise<string[]> {
  const {
    authorPubkey,
    userPubkey,
    relayHints = [],
    seenRelays = [],
    containingEventRelays = [],
    includeUserOwnRelays = false,
    includeProfileFetchRelays = false,
    includeFastReadRelays = true,
    includeFastWriteRelays = false,
    includeSearchableRelays = false,
    blockedRelays = [],
    includeLocalRelays = true
  } = options

  const relayUrls = new Set<string>()
  const normalizedBlocked = new Set(
    (blockedRelays || []).map(url => {
      const normalized = normalizeUrl(url) || url
      return normalized.toLowerCase()
    }).filter((url): url is string => !!url)
  )

  const addRelay = (url: string | undefined) => {
    if (!url) return
    const normalized = normalizeUrl(url)
    if (!normalized) return
    // Filter blocked (case-insensitive comparison)
    if (normalizedBlocked.has(normalized.toLowerCase())) return
    relayUrls.add(normalized)
  }

  // 1. Relay hints (highest priority - explicit hints)
  relayHints.forEach(addRelay)

  // 2. Relays where event was seen
  seenRelays.forEach(addRelay)

  // 3. Relays where containing event was found (for embedded events)
  containingEventRelays.forEach(addRelay)

  // 4. Author's outboxes (write relays) - where they publish
  if (authorPubkey) {
    try {
      // Add timeout to prevent hanging - 2 seconds max
      const relayListPromise = client.fetchRelayList(authorPubkey)
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => {
          logger.debug('[RelayListBuilder] fetchRelayList timeout for author', {
            author: authorPubkey.substring(0, 8)
          })
          resolve(null)
        }, 2000)
      })
      const authorRelayList = await Promise.race([relayListPromise, timeoutPromise])
      
      if (authorRelayList) {
        const authorOutboxes = (authorRelayList.write || []).slice(0, 10)
        authorOutboxes.forEach(addRelay)
        
        // Also include author's read relays (inboxes) for better discovery
        const authorInboxes = (authorRelayList.read || []).slice(0, 10)
        authorInboxes.forEach(addRelay)
        
        logger.debug('[RelayListBuilder] Added author relays', {
          author: authorPubkey.substring(0, 8),
          outboxes: authorOutboxes.length,
          inboxes: authorInboxes.length
        })
      }
    } catch (error) {
      logger.debug('[RelayListBuilder] Failed to fetch author relay list', { error })
    }
  }

  // 5. User's own relays (for profiles/metadata)
  if (includeUserOwnRelays && userPubkey) {
    try {
      // Add timeout to prevent hanging - 2 seconds max
      const relayListPromise = client.fetchRelayList(userPubkey)
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => {
          logger.debug('[RelayListBuilder] fetchRelayList timeout for user', {
            user: userPubkey.substring(0, 8)
          })
          resolve(null)
        }, 2000)
      })
      const userRelayList = await Promise.race([relayListPromise, timeoutPromise])
      
      if (userRelayList) {
        // Include both read and write
        const userRead = (userRelayList.read || []).slice(0, 10)
        const userWrite = (userRelayList.write || []).slice(0, 10)
        userRead.forEach(addRelay)
        userWrite.forEach(addRelay)
      }
      
      // Include local relays from kind 10432
      if (includeLocalRelays) {
        const localRelays = await getCacheRelayUrls(userPubkey)
        localRelays.forEach(addRelay)
      }
      
      logger.debug('[RelayListBuilder] Added user own relays', {
        read: userRelayList ? (userRelayList.read || []).length : 0,
        write: userRelayList ? (userRelayList.write || []).length : 0,
        local: includeLocalRelays ? (await getCacheRelayUrls(userPubkey)).length : 0
      })
    } catch (error) {
      logger.debug('[RelayListBuilder] Failed to fetch user relay list', { error })
    }
  } else if (userPubkey) {
    // Even if not including user's own relays, still include user's inboxes for reading
    try {
      // Add timeout to prevent hanging - 2 seconds max
      const relayListPromise = client.fetchRelayList(userPubkey)
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => {
          logger.debug('[RelayListBuilder] fetchRelayList timeout for user inboxes', {
            user: userPubkey.substring(0, 8)
          })
          resolve(null)
        }, 2000)
      })
      const userRelayList = await Promise.race([relayListPromise, timeoutPromise])
      
      if (userRelayList) {
        const userInboxes = (userRelayList.read || []).slice(0, 10)
        userInboxes.forEach(addRelay)
      }
      
      // Include local relays from kind 10432 if enabled
      if (includeLocalRelays) {
        const localRelays = await getCacheRelayUrls(userPubkey)
        localRelays.forEach(addRelay)
      }
    } catch (error) {
      logger.debug('[RelayListBuilder] Failed to fetch user inboxes', { error })
    }
  }

  // 6. Profile fetch relays (for profiles/metadata)
  if (includeProfileFetchRelays) {
    PROFILE_FETCH_RELAY_URLS.forEach(addRelay)
  }

  // 7. Fast read relays (fallback)
  if (includeFastReadRelays) {
    FAST_READ_RELAY_URLS.forEach(addRelay)
  }

  // 8. Fast write relays (for writing)
  if (includeFastWriteRelays) {
    FAST_WRITE_RELAY_URLS.forEach(addRelay)
  }

  // 9. Searchable relays (for search)
  if (includeSearchableRelays) {
    SEARCHABLE_RELAY_URLS.forEach(addRelay)
  }

  return Array.from(relayUrls)
}

/**
 * Build relay list for reading replies/comments
 * READ from: FAST_READ_RELAY_URLS + user's inboxes + local relays + OP author's outboxes
 */
export async function buildReplyReadRelayList(
  opAuthorPubkey: string | undefined,
  userPubkey: string | undefined,
  blockedRelays: string[] = []
): Promise<string[]> {
  return buildComprehensiveRelayList({
    authorPubkey: opAuthorPubkey,
    userPubkey,
    includeFastReadRelays: true,
    includeLocalRelays: true,
    blockedRelays
  })
}

/**
 * Build relay list for writing replies/comments
 * WRITE to: OP author's outboxes + OP author's inboxes + reply-to author's inboxes + user's outboxes + local relay
 */
export async function buildReplyWriteRelayList(
  opAuthorPubkey: string | undefined,
  replyToAuthorPubkey: string | undefined,
  userPubkey: string | undefined,
  blockedRelays: string[] = []
): Promise<string[]> {
  const relayUrls = new Set<string>()
  const normalizedBlocked = new Set(
    (blockedRelays || []).map(url => {
      const normalized = normalizeUrl(url) || url
      return normalized.toLowerCase()
    }).filter((url): url is string => !!url)
  )

  const addRelay = (url: string | undefined) => {
    if (!url) return
    const normalized = normalizeUrl(url)
    if (!normalized) return
    // Filter blocked (case-insensitive comparison)
    if (normalizedBlocked.has(normalized.toLowerCase())) return
    relayUrls.add(normalized)
  }

  // OP author's outboxes
  if (opAuthorPubkey) {
    try {
      // Add timeout to prevent hanging - 2 seconds max
      const relayListPromise = client.fetchRelayList(opAuthorPubkey)
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 2000)
      })
      const opRelayList = await Promise.race([relayListPromise, timeoutPromise])
      
      if (opRelayList) {
        const opOutboxes = (opRelayList.write || []).slice(0, 10)
        opOutboxes.forEach(addRelay)
        
        // OP author's inboxes
        const opInboxes = (opRelayList.read || []).slice(0, 10)
        opInboxes.forEach(addRelay)
      }
    } catch (error) {
      logger.debug('[RelayListBuilder] Failed to fetch OP author relay list', { error })
    }
  }

  // Reply-to author's inboxes
  if (replyToAuthorPubkey && replyToAuthorPubkey !== opAuthorPubkey) {
    try {
      // Add timeout to prevent hanging - 2 seconds max
      const relayListPromise = client.fetchRelayList(replyToAuthorPubkey)
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 2000)
      })
      const replyToRelayList = await Promise.race([relayListPromise, timeoutPromise])
      
      if (replyToRelayList) {
        const replyToInboxes = (replyToRelayList.read || []).slice(0, 10)
        replyToInboxes.forEach(addRelay)
      }
    } catch (error) {
      logger.debug('[RelayListBuilder] Failed to fetch reply-to author relay list', { error })
    }
  }

  // User's outboxes
  if (userPubkey) {
    try {
      // Add timeout to prevent hanging - 2 seconds max
      const relayListPromise = client.fetchRelayList(userPubkey)
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 2000)
      })
      const userRelayList = await Promise.race([relayListPromise, timeoutPromise])
      
      if (userRelayList) {
        const userOutboxes = (userRelayList.write || []).slice(0, 10)
        userOutboxes.forEach(addRelay)
      }
      
      // User's local relay (kind 10432)
      const localRelays = await getCacheRelayUrls(userPubkey)
      localRelays.forEach(addRelay)
    } catch (error) {
      logger.debug('[RelayListBuilder] Failed to fetch user relay list', { error })
    }
  }

  // Fast write relays as fallback
  FAST_WRITE_RELAY_URLS.forEach(addRelay)

  return Array.from(relayUrls)
}
