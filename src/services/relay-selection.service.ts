import { Event, kinds } from 'nostr-tools'
import { ExtendedKind } from '@/constants'
import { FAST_WRITE_RELAY_URLS } from '@/constants'
import client from '@/services/client.service'
import { normalizeUrl, isLocalNetworkUrl } from '@/lib/url'
import { TRelaySet, TRelayList } from '@/types'
import logger from '@/lib/logger'
import indexedDb from '@/services/indexed-db.service'
import { getRelayListFromEvent } from '@/lib/event-metadata'

export interface RelaySelectionContext {
  // User's own relays
  userWriteRelays: string[]
  userReadRelays: string[]
  favoriteRelays: string[]
  blockedRelays: string[]
  relaySets: TRelaySet[]
  
  // Post context
  parentEvent?: Event
  isPublicMessage?: boolean
  content?: string
  mentions?: string[] // Pre-extracted mentions (for PMs)
  userPubkey?: string
  openFrom?: string[]
}

export interface RelaySelectionResult {
  selectableRelays: string[]
  selectedRelays: string[]
  description: string
}

class RelaySelectionService {
  /**
   * Filter out local network relays from other users' relay lists
   * We should only use our own local relays, not other users' local relays
   */
  private filterLocalRelaysFromOthers(relays: string[], isOwnRelays: boolean = false): string[] {
    if (isOwnRelays) {
      // For our own relays, keep all of them including local ones
      return relays
    }
    
    // For other users' relays, filter out local network relays
    return relays.filter(relay => !isLocalNetworkUrl(relay))
  }

  /**
   * Main entry point for relay selection logic
   */
  async selectRelays(context: RelaySelectionContext): Promise<RelaySelectionResult> {
    // Step 1: Build the list of selectable relays
    const selectableRelays = await this.buildSelectableRelays(context)
    
    // Step 2: Determine which relays should be selected (checked)
    const selectedRelays = await this.determineSelectedRelays(context)
    
    // Step 3: Generate description
    const description = this.generateDescription(selectedRelays)

    return {
      selectableRelays,
      selectedRelays,
      description
    }
  }

  /**
   * Build the list of all relays that can be selected
   * Always includes: user's write relays (or fast write fallback) + favorite relays + relay sets
   * Plus contextual relays for replies and public messages
   */
  private async buildSelectableRelays(context: RelaySelectionContext): Promise<string[]> {
    const {
      userWriteRelays,
      favoriteRelays,
      relaySets,
      parentEvent,
      isPublicMessage,
      openFrom
    } = context

    const selectableRelays = new Set<string>()

    // Helper function to safely add normalized URLs
    const addRelay = (url: string) => {
      if (!url) return
      const normalized = normalizeUrl(url)
      if (normalized) {
        selectableRelays.add(normalized)
      } else {
        // If normalization fails or returns empty (invalid URL), skip it
        logger.warn('Skipping invalid relay URL', { url })
      }
    }

    // Always include user's write relays (or fallback to fast write relays)
    const userRelays = userWriteRelays.length > 0 ? userWriteRelays : FAST_WRITE_RELAY_URLS
    userRelays.forEach(addRelay)

    // Explicitly ensure cache relays (local network URLs) are included in selectable relays
    // This ensures they show up even if there's a timing issue with relay list updates
    const cacheRelays = userWriteRelays.filter(url => isLocalNetworkUrl(url))
    cacheRelays.forEach(addRelay)

    // Always include favorite relays
    favoriteRelays.forEach(addRelay)

    // Always include relays from relay sets
    relaySets.forEach(set => {
      set.relayUrls.forEach(addRelay)
    })

    // Add contextual relays for replies and public messages
    if (parentEvent || isPublicMessage) {
      const contextualRelays = await this.getContextualRelays(context)
      contextualRelays.forEach(addRelay)
    }

    // If called with specific relay URLs (e.g., from openFrom), include those
    if (openFrom && openFrom.length > 0) {
      openFrom.forEach(addRelay)
    }

    // Filter out blocked relays and return deduplicated list
    const deduplicatedRelays = Array.from(selectableRelays).filter(Boolean)
    return this.filterBlockedRelays(deduplicatedRelays, context.blockedRelays)
  }

  /**
   * Validate that a URL is a valid, non-empty relay URL
   */
  private isValidRelayUrl(url: string | undefined | null): url is string {
    return !!(url && typeof url === 'string' && url.trim() !== '' && url !== 'ws://' && url !== 'wss://')
  }

  /**
   * Get relay list from IndexedDB cache (kind 10002 and 10432 merged)
   * If not in cache, fetch from relays before returning empty
   * This avoids fetching from relays every time, but ensures we have data when needed
   */
  private async getCachedRelayList(pubkey: string): Promise<TRelayList | null> {
    try {
      // Get both kind 10002 (relay list) and kind 10432 (cache relays) from IndexedDB
      const [relayListEvent, cacheRelayListEvent] = await Promise.all([
        indexedDb.getReplaceableEvent(pubkey, kinds.RelayList),
        indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)
      ])

      let relayList: TRelayList
      
      // If no cached relay list event, fetch from relays (which will also cache it)
      if (!relayListEvent) {
        try {
          relayList = await client.fetchRelayList(pubkey)
        } catch (error) {
          logger.warn('Failed to fetch relay list from relays', { error, pubkey })
          relayList = {
            write: [],
            read: [],
            originalRelays: []
          }
        }
      } else {
        relayList = getRelayListFromEvent(relayListEvent)
      }

      // Merge cache relays (kind 10432) into the relay list
      if (cacheRelayListEvent) {
        const cacheRelayList = getRelayListFromEvent(cacheRelayListEvent)
        
        // Filter out invalid/empty URLs before merging
        const validCacheRead = cacheRelayList.read.filter(this.isValidRelayUrl)
        const validCacheWrite = cacheRelayList.write.filter(this.isValidRelayUrl)
        const validRelayRead = relayList.read.filter(this.isValidRelayUrl)
        const validRelayWrite = relayList.write.filter(this.isValidRelayUrl)
        
        // Merge read relays - cache relays first, then others
        const mergedRead = [...validCacheRead, ...validRelayRead]
        const mergedWrite = [...validCacheWrite, ...validRelayWrite]
        const mergedOriginalRelays = new Map<string, { url: string; scope: 'read' | 'write' | 'both' }>()
        
        // Add cache relay original relays first (prioritized)
        cacheRelayList.originalRelays.forEach(relay => {
          mergedOriginalRelays.set(relay.url, relay)
        })
        // Then add regular relay original relays
        relayList.originalRelays.forEach(relay => {
          if (!mergedOriginalRelays.has(relay.url)) {
            mergedOriginalRelays.set(relay.url, relay)
          }
        })
        
        // Deduplicate while preserving order (cache relays first)
        return {
          write: Array.from(new Set(mergedWrite)),
          read: Array.from(new Set(mergedRead)),
          originalRelays: Array.from(mergedOriginalRelays.values())
        }
      }

      return relayList
    } catch (error) {
      logger.warn('Failed to get cached relay list from IndexedDB', { error, pubkey })
      return null
    }
  }

  /**
   * Get contextual relays based on the type of post
   */
  private async getContextualRelays(context: RelaySelectionContext): Promise<string[]> {
    const { parentEvent, isPublicMessage, content, userPubkey } = context
    const contextualRelays = new Set<string>()


    try {
      // For replies (any kind) and public messages
      if (parentEvent || isPublicMessage) {
        // Get the replied-to author's read relays (filter out their local relays)
        // Use cached version from IndexedDB instead of fetching from relays
        if (parentEvent) {
          const authorRelayList = await this.getCachedRelayList(parentEvent.pubkey)
          if (authorRelayList?.read) {
            const filteredRelays = this.filterLocalRelaysFromOthers(authorRelayList.read)
            filteredRelays.slice(0, 4).forEach(url => contextualRelays.add(url))
          }
        }

        // Get relay hint from where the event was discovered
        if (parentEvent) {
          const eventHints = client.getEventHints(parentEvent.id)
          eventHints.forEach(url => contextualRelays.add(url))
        }

        // For replies and public messages, get mentioned users' relays
        if (userPubkey) {
          let mentions: string[] = []
          
          // Always include parent event author for replies
          if (parentEvent) {
            mentions.push(parentEvent.pubkey)
          }
          
          // Extract additional mentions from content if available
          if (content) {
            const contentMentions = await this.extractMentions(content, parentEvent)
            mentions = [...new Set([...mentions, ...contentMentions])] // deduplicate
          }
          
          const mentionedPubkeys = mentions.filter(p => p !== userPubkey)
          
          
          if (mentionedPubkeys.length > 0) {
            const mentionRelayLists = await Promise.all(
              mentionedPubkeys.map(async (pubkey) => {
                try {
                  // Use cached version from IndexedDB instead of fetching from relays
                  const relayList = await this.getCachedRelayList(pubkey)
                  if (!relayList) return []
                  // Use write relays for replies, read relays for public messages
                  const relayType = isPublicMessage ? 'read' : 'write'
                  const userRelays = relayList[relayType] || []
                  // Filter out local relays from other users
                  return this.filterLocalRelaysFromOthers(userRelays)
                } catch (error) {
                  logger.warn('Failed to get cached relay list', { pubkey, error })
                  return []
                }
              })
            )
            mentionRelayLists.flat().forEach(url => contextualRelays.add(url))
          }
        }
      }
    } catch (error) {
      logger.error('Failed to get contextual relays', { error })
    }

    return Array.from(contextualRelays)
  }

  /**
   * Determine which relays should be selected (checked) based on the context
   */
  private async determineSelectedRelays(
    context: RelaySelectionContext
  ): Promise<string[]> {
    const {
      userWriteRelays,
      parentEvent,
      isPublicMessage,
      openFrom,
      content,
      userPubkey
    } = context

    let selectedRelays: string[] = []

    // If called with specific relay URLs, use those
    if (openFrom && openFrom.length > 0) {
      selectedRelays = openFrom.map(url => normalizeUrl(url) || url).filter(Boolean)
      // Deduplicate the selected relays
      selectedRelays = Array.from(new Set(selectedRelays))
    }
    // For discussion replies, use relay hint from the kind 11 at the top of the thread
    else if (parentEvent && (parentEvent.kind === ExtendedKind.DISCUSSION || parentEvent.kind === ExtendedKind.COMMENT)) {
      const discussionRelay = this.getDiscussionRelayHint(parentEvent)
      if (discussionRelay) {
        selectedRelays = [discussionRelay]
      }
    }
    // For public messages, use sender outboxes + receiver inboxes
    else if (isPublicMessage || (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE)) {
      selectedRelays = await this.getPublicMessageRelays(context)
    }
    // For regular replies, use user's write relays + mention relays
    else if (parentEvent && this.isRegularReply(parentEvent)) {
      // Get user's write relays
      const userRelays = userWriteRelays.length > 0 ? userWriteRelays : FAST_WRITE_RELAY_URLS
      selectedRelays = userRelays.map(url => normalizeUrl(url) || url).filter(Boolean)
      // Deduplicate the selected relays
      selectedRelays = Array.from(new Set(selectedRelays))
      
      // Add mention relays
      if (userPubkey) {
        let mentions: string[] = []
        
        // Always include parent event author for replies
        if (parentEvent) {
          mentions.push(parentEvent.pubkey)
        }
        
        // Extract additional mentions from content if available
        if (content) {
          const contentMentions = await this.extractMentions(content, parentEvent)
          mentions = [...new Set([...mentions, ...contentMentions])] // deduplicate
        }
        
        const mentionedPubkeys = mentions.filter(p => p !== userPubkey)
        
        if (mentionedPubkeys.length > 0) {
          const mentionRelayLists = await Promise.all(
            mentionedPubkeys.map(async (pubkey) => {
              try {
                // Use cached version from IndexedDB instead of fetching from relays
                const relayList = await this.getCachedRelayList(pubkey)
                if (!relayList) return []
                const userRelays = relayList.write || []
                // Filter out local relays from other users
                return this.filterLocalRelaysFromOthers(userRelays)
              } catch (error) {
                logger.warn('Failed to get cached relay list', { pubkey, error })
                return []
              }
            })
          )
          const mentionRelays = mentionRelayLists.flat().map(url => normalizeUrl(url) || url).filter(Boolean)
          selectedRelays = [...selectedRelays, ...mentionRelays]
          // Deduplicate after adding mention relays
          selectedRelays = Array.from(new Set(selectedRelays))
        }
      }
    }
    // Default: user's write relays (or fallback to fast write relays if no user relays)
    else {
      const defaultRelays = userWriteRelays.length > 0 ? userWriteRelays : FAST_WRITE_RELAY_URLS
      selectedRelays = defaultRelays.map(url => normalizeUrl(url) || url).filter(Boolean)
      // Deduplicate the selected relays
      selectedRelays = Array.from(new Set(selectedRelays))
    }

    // ALWAYS include cache relays (local network relays) in selected relays
    // Cache relays are important for offline functionality
    const cacheRelays = userWriteRelays.filter(url => isLocalNetworkUrl(url))
    if (cacheRelays.length > 0) {
      selectedRelays = [...selectedRelays, ...cacheRelays]
      // Deduplicate after adding cache relays
      selectedRelays = Array.from(new Set(selectedRelays))
    }

    // Filter out blocked relays
    return this.filterBlockedRelays(selectedRelays, context.blockedRelays)
  }

  /**
   * Get relays for public messages: sender outboxes + receiver inboxes
   * Only includes outboxes from sender and inboxes from all recipients
   * Normalized and deduplicated. If more than 10, limits to one per member,
   * preferring relays that multiple people have.
   */
  private async getPublicMessageRelays(context: RelaySelectionContext): Promise<string[]> {
    const { userWriteRelays, parentEvent, isPublicMessage, content, mentions, userPubkey } = context
    
    // Map to track which relays belong to which members
    const relayToMembers = new Map<string, Set<string>>()
    const allMembers = new Set<string>()

    try {
      // Get sender's outboxes (write relays)
      if (userPubkey) {
        allMembers.add(userPubkey)
        let senderRelays = userWriteRelays
        
        // If userWriteRelays is empty, try to fetch the user's relay list
        if (senderRelays.length === 0) {
          try {
            const userRelayList = await this.getCachedRelayList(userPubkey)
            if (userRelayList?.write && userRelayList.write.length > 0) {
              senderRelays = userRelayList.write
            } else {
              // Only fall back to fast write relays if we truly have no user relays
              senderRelays = FAST_WRITE_RELAY_URLS
            }
          } catch (error) {
            logger.warn('Failed to fetch user relay list for PM', { error, userPubkey })
            // Fall back to fast write relays if fetch fails
            senderRelays = FAST_WRITE_RELAY_URLS
          }
        }
        
        senderRelays.forEach(url => {
          const normalized = normalizeUrl(url)
          if (normalized) {
            if (!relayToMembers.has(normalized)) {
              relayToMembers.set(normalized, new Set())
            }
            relayToMembers.get(normalized)!.add(userPubkey)
          }
        })
      }

      // Get recipients and their inboxes (read relays)
      let recipientPubkeys: string[] = []
      
      if (isPublicMessage && userPubkey) {
        // For new public messages, use provided mentions or extract from content
        if (mentions && mentions.length > 0) {
          recipientPubkeys = mentions.filter(p => p !== userPubkey)
        } else if (content) {
          // Fallback to extracting from content if mentions not provided
          const extractedMentions = await this.extractMentions(content, parentEvent)
          recipientPubkeys = extractedMentions.filter(p => p !== userPubkey)
        }
      } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
        // For public message replies, get all recipients from parent event
        // Include original sender and all p tags
        recipientPubkeys = [parentEvent.pubkey]
        parentEvent.tags.forEach(([tagName, tagValue]) => {
          if (tagName === 'p' && tagValue && tagValue !== userPubkey) {
            recipientPubkeys.push(tagValue)
          }
        })
        // Deduplicate
        recipientPubkeys = Array.from(new Set(recipientPubkeys))
      }

      // Fetch read relays (inboxes) for all recipients
      if (recipientPubkeys.length > 0) {
        const recipientRelayLists = await Promise.all(
          recipientPubkeys.map(async (pubkey) => {
            try {
              allMembers.add(pubkey)
              // Use cached version from IndexedDB
              const relayList = await this.getCachedRelayList(pubkey)
              if (!relayList) return []
              const userRelays = relayList.read || []
              // Filter out local relays from other users
              return this.filterLocalRelaysFromOthers(userRelays)
            } catch (error) {
              logger.warn('Failed to fetch relay list', { pubkey, error })
              return []
            }
          })
        )

        // Track which relays belong to which recipients
        recipientRelayLists.forEach((relays, index) => {
          const pubkey = recipientPubkeys[index]
          relays.forEach(url => {
            const normalized = normalizeUrl(url)
            if (normalized) {
              if (!relayToMembers.has(normalized)) {
                relayToMembers.set(normalized, new Set())
              }
              relayToMembers.get(normalized)!.add(pubkey)
            }
          })
        })
      }

      // Build final relay list
      const relays: string[] = []
      
      // If we have 10 or fewer relays, use all of them
      if (relayToMembers.size <= 10) {
        relays.push(...Array.from(relayToMembers.keys()))
      } else {
        // More than 10 relays - need to limit to one per member
        // Prefer relays that multiple people have
        
        // Sort relays by number of members (descending), then by URL for stability
        const sortedRelays = Array.from(relayToMembers.entries())
          .sort((a, b) => {
            const aCount = a[1].size
            const bCount = b[1].size
            if (aCount !== bCount) {
              return bCount - aCount // Prefer relays with more members
            }
            return a[0].localeCompare(b[0]) // Stable sort by URL
          })

        // Track which members already have a relay selected
        const selectedForMember = new Map<string, string>()
        
        // First pass: assign relays that multiple people have
        for (const [relayUrl, members] of sortedRelays) {
          if (members.size > 1) {
            // This relay is used by multiple people - add it
            relays.push(relayUrl)
            // Mark all members as having a relay
            members.forEach(member => {
              selectedForMember.set(member, relayUrl)
            })
          }
        }
        
        // Second pass: ensure each member has at least one relay
        for (const [relayUrl, members] of sortedRelays) {
          if (relays.length >= 10) break
          
          // Check if any member still needs a relay
          const needsRelay = Array.from(members).some(member => !selectedForMember.has(member))
          if (needsRelay) {
            relays.push(relayUrl)
            members.forEach(member => {
              if (!selectedForMember.has(member)) {
                selectedForMember.set(member, relayUrl)
              }
            })
          }
        }
      }

      // Normalize and deduplicate final list
      const normalizedRelays = relays
        .map(url => normalizeUrl(url))
        .filter((url): url is string => !!url)
      
      return Array.from(new Set(normalizedRelays))
    } catch (error) {
      logger.error('Failed to get public message relays', { error, parentEvent: context.parentEvent?.id })
      // Fallback to sender's write relays
      const senderRelays = userWriteRelays.length > 0 ? userWriteRelays : FAST_WRITE_RELAY_URLS
      return senderRelays.map(url => normalizeUrl(url) || url).filter(Boolean)
    }
  }


  /**
   * Check if this is a regular reply (Kind 1 or Kind 1111, not to Kind 11)
   */
  private isRegularReply(parentEvent: Event): boolean {
    return (parentEvent.kind === kinds.ShortTextNote || parentEvent.kind === ExtendedKind.COMMENT) &&
           parentEvent.kind !== ExtendedKind.DISCUSSION
  }

  /**
   * Get relay hint from discussion events
   */
  private getDiscussionRelayHint(parentEvent: Event): string | null {
    // For kind 1111 (COMMENT): look for 'E' tag which points to the root event
    if (parentEvent.kind === ExtendedKind.COMMENT) {
      const ETag = parentEvent.tags.find(tag => tag[0] === 'E')
      if (ETag && ETag[2]) {
        return normalizeUrl(ETag[2]) || ETag[2]
      }
      
      // If no 'E' tag, check lowercase 'e' tag for parent event
      const eTag = parentEvent.tags.find(tag => tag[0] === 'e')
      if (eTag && eTag[2]) {
        return normalizeUrl(eTag[2]) || eTag[2]
      }
    } else if (parentEvent.kind === ExtendedKind.DISCUSSION) {
      // For kind 11 (DISCUSSION): get relay hint from where it was found
      const eventHints = client.getEventHints(parentEvent.id)
      if (eventHints.length > 0) {
        return normalizeUrl(eventHints[0]) || eventHints[0]
      }
    }

    return null
  }

  /**
   * Extract mentions from content (simplified version of the existing extractMentions)
   */
  private async extractMentions(content: string, parentEvent?: Event): Promise<string[]> {
    const pubkeys: string[] = []
    
    // Always include parent event author if there's a parent event
    if (parentEvent) {
      pubkeys.push(parentEvent.pubkey)
    }
    
    // Extract nostr addresses from content
    const matches = content.match(
      /nostr:(npub1[a-z0-9]{58}|nprofile1[a-z0-9]+|note1[a-z0-9]{58}|nevent1[a-z0-9]+)/g
    )


    if (matches) {
      for (const match of matches) {
        try {
          const { nip19 } = await import('nostr-tools')
          const id = match.split(':')[1]
          const { type, data } = nip19.decode(id)
          if (type === 'nprofile') {
            if (!pubkeys.includes(data.pubkey)) {
              pubkeys.push(data.pubkey)
            }
          } else if (type === 'npub') {
            if (!pubkeys.includes(data)) {
              pubkeys.push(data)
            }
          } else if (['nevent', 'note'].includes(type)) {
            const event = await client.fetchEvent(id)
            if (event && !pubkeys.includes(event.pubkey)) {
              pubkeys.push(event.pubkey)
            }
          }
        } catch (error) {
          logger.error('Failed to decode nostr address', { error, match })
        }
      }
    }

    // Add related pubkeys from parent event tags
    if (parentEvent) {
      parentEvent.tags.forEach(([tagName, tagValue]) => {
        if (['p', 'P'].includes(tagName) && tagValue && !pubkeys.includes(tagValue)) {
          pubkeys.push(tagValue)
        }
      })
    }

    return pubkeys
  }

  /**
   * Generate description for the selected relays
   */
  private generateDescription(selectedRelays: string[]): string {
    if (selectedRelays.length === 0) {
      return 'No relays selected'
    }
    if (selectedRelays.length === 1) {
      return this.simplifyUrl(selectedRelays[0])
    }
    return `${selectedRelays.length} relays`
  }

  /**
   * Simplify URL for display
   */
  private simplifyUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname
    } catch {
      return url
    }
  }

  /**
   * Filter out blocked relays from a list
   */
  private filterBlockedRelays(relays: string[], blockedRelays: string[]): string[] {
    if (!blockedRelays || blockedRelays.length === 0) {
      return relays
    }

    // Helper function to safely normalize URLs
    const safeNormalize = (url: string): string => {
      const normalized = normalizeUrl(url)
      return normalized || url
    }

    const normalizedBlocked = blockedRelays.map(safeNormalize)
    return relays.filter(relay => {
      const normalizedRelay = safeNormalize(relay)
      return !normalizedBlocked.includes(normalizedRelay)
    })
  }
}

const relaySelectionService = new RelaySelectionService()
export default relaySelectionService
