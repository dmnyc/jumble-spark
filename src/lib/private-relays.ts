import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { ExtendedKind } from '@/constants'

/**
 * Check if user has private relays available (outbox relays or cache relays)
 * @param pubkey - User's public key
 * @returns Promise<boolean> - true if user has at least one private relay available
 */
export async function hasPrivateRelays(pubkey: string): Promise<boolean> {
  // Check for outbox relays (kind 10002)
  const relayList = await client.fetchRelayList(pubkey)
  if (relayList.write && relayList.write.length > 0) {
    return true
  }
  
  // Check for cache relays (kind 10432)
  const cacheRelayEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)
  if (cacheRelayEvent) {
    // Check if cache relay event has any relays
    const hasRelays = cacheRelayEvent.tags.some(tag => tag[0] === 'relay' && tag[1])
    if (hasRelays) {
      return true
    }
  }
  
  return false
}

/**
 * Get private relay URLs (outbox + cache relays)
 * @param pubkey - User's public key
 * @returns Promise<string[]> - Array of relay URLs
 */
export async function getPrivateRelayUrls(pubkey: string): Promise<string[]> {
  const relayUrls: string[] = []
  
  // Get outbox relays (kind 10002)
  const relayList = await client.fetchRelayList(pubkey)
  if (relayList.write) {
    relayUrls.push(...relayList.write)
  }
  
  // Get cache relays (kind 10432)
  const cacheRelayEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)
  if (cacheRelayEvent) {
    cacheRelayEvent.tags.forEach(tag => {
      if (tag[0] === 'relay' && tag[1]) {
        relayUrls.push(tag[1])
      }
    })
  }
  
  // Deduplicate
  return Array.from(new Set(relayUrls))
}

/**
 * Check if user has cache relays set
 * @param pubkey - User's public key
 * @returns Promise<boolean> - true if user has at least one cache relay
 */
export async function hasCacheRelays(pubkey: string): Promise<boolean> {
  const cacheRelayEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)
  if (cacheRelayEvent) {
    // Check if cache relay event has any relays
    const hasRelays = cacheRelayEvent.tags.some(tag => tag[0] === 'relay' && tag[1])
    return hasRelays
  }
  return false
}

/**
 * Get cache relay URLs only
 * @param pubkey - User's public key
 * @returns Promise<string[]> - Array of cache relay URLs
 */
export async function getCacheRelayUrls(pubkey: string): Promise<string[]> {
  const relayUrls: string[] = []
  
  // Get cache relays (kind 10432)
  const cacheRelayEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)
  if (cacheRelayEvent) {
    cacheRelayEvent.tags.forEach(tag => {
      if (tag[0] === 'relay' && tag[1]) {
        relayUrls.push(tag[1])
      }
    })
  }
  
  return Array.from(new Set(relayUrls))
}

