import { ExtendedKind } from '@/constants'
import { tagNameEquals } from '@/lib/tag'
import { TNip66RelayDiscovery, TRelayInfo } from '@/types'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import { isReplaceableEvent, getReplaceableCoordinateFromEvent } from '@/lib/event'
import logger from '@/lib/logger'

type TValue<T = any> = {
  key: string
  value: T | null
  addedAt: number
  masterPublicationKey?: string // For nested publication events, link to master publication
}

export const StoreNames = {
  PROFILE_EVENTS: 'profileEvents',
  RELAY_LIST_EVENTS: 'relayListEvents',
  FOLLOW_LIST_EVENTS: 'followListEvents',
  MUTE_LIST_EVENTS: 'muteListEvents',
  BOOKMARK_LIST_EVENTS: 'bookmarkListEvents',
  PIN_LIST_EVENTS: 'pinListEvents',
  BLOSSOM_SERVER_LIST_EVENTS: 'blossomServerListEvents',
  INTEREST_LIST_EVENTS: 'interestListEvents',
  MUTE_DECRYPTED_TAGS: 'muteDecryptedTags',
  USER_EMOJI_LIST_EVENTS: 'userEmojiListEvents',
  EMOJI_SET_EVENTS: 'emojiSetEvents',
  FAVORITE_RELAYS: 'favoriteRelays',
  BLOCKED_RELAYS_EVENTS: 'blockedRelaysEvents',
  CACHE_RELAYS_EVENTS: 'cacheRelaysEvents',
  RSS_FEED_LIST_EVENTS: 'rssFeedListEvents',
  RSS_FEED_ITEMS: 'rssFeedItems',
  RELAY_SETS: 'relaySets',
  FOLLOWING_FAVORITE_RELAYS: 'followingFavoriteRelays',
  RELAY_INFOS: 'relayInfos',
  RELAY_INFO_EVENTS: 'relayInfoEvents', // deprecated
  PUBLICATION_EVENTS: 'publicationEvents',
  /** NIP-66: cached list of public lively relay URLs (from 30166 discovery). */
  PUBLIC_LIVELY_RELAYS: 'publicLivelyRelays',
  /** NIP-66: per-relay discovery cache (key = relay URL, value = { discovery, cachedAt }). */
  NIP66_DISCOVERY: 'nip66Discovery',
  /** NIP-A3 payment targets (kind 10133). */
  PAYMENT_INFO_EVENTS: 'paymentInfoEvents',
  /** Cached GIF list (parsed from kind 1063 + 1/1111). Key: 'gifList', value: { gifs, cachedAt }. */
  GIF_CACHE: 'gifCache',
  /** App settings (replaces in-memory/localStorage for persisted settings). Key: setting key, value: string. */
  SETTINGS: 'settings',
  /** NIP-A7 spell events (kind 777). Key: event id. */
  SPELL_EVENTS: 'spellEvents',
  /** Tombstone list for deleted events (kind 5). Key: event id or replaceable coordinate. */
  TOMBSTONE_LIST: 'tombstoneList',
  /** NIP-58 badge definitions (kind 30009). Key: pubkey:d */
  BADGE_DEFINITION_EVENTS: 'badgeDefinitionEvents'
}

/** Schema version we expect. When adding stores or migrations, bump this. */
const DB_VERSION = 28

/** Max age for profile and payment info cache before we refetch (5 min). */
const PROFILE_AND_PAYMENT_CACHE_MAX_AGE_MS = 5 * 60 * 1000

/** Convert IDB request.onerror Event to a proper Error for logging and UI */
function idbEventToError(ev: Parameters<NonNullable<IDBRequest['onerror']>>[0]): Error {
  const request = ev.target as IDBRequest
  const domError = request?.error
  const message = domError?.message ?? 'IndexedDB operation failed'
  return new Error(message)
}

class IndexedDbService {
  static instance: IndexedDbService
  static getInstance(): IndexedDbService {
    if (!IndexedDbService.instance) {
      IndexedDbService.instance = new IndexedDbService()
      IndexedDbService.instance.init()
    }
    return IndexedDbService.instance
  }

  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.openDb()
    }
    return this.initPromise
  }

  private openDb(): Promise<void> {
    return new Promise<void>((resolve) => {
      const request = window.indexedDB.open('jumble', DB_VERSION)

      request.onerror = (event) => {
        const err = idbEventToError(event)
        const isHigherVersion =
          err.message.includes('higher version') || err.message.includes('version requested')
        if (isHigherVersion) {
          // Stored DB is newer than our DB_VERSION (e.g. other tab or previous deploy). We cannot
          // open with a lower version. Use the existing DB at its version so the app keeps working.
          // When we later bump DB_VERSION and ship new code, users at lower stored version will
          // open with our new version and run onupgradeneeded as usual.
          const probe = window.indexedDB.open('jumble')
          probe.onerror = () => {
            logger.warn('IndexedDB unavailable, running without local cache', err)
            this.db = null
            resolve()
          }
          probe.onsuccess = () => {
            const probeDb = probe.result
            const storedVersion = probeDb.version
            probeDb.close()
            const openWithStored = window.indexedDB.open('jumble', storedVersion)
            openWithStored.onerror = (e) => {
              logger.warn('IndexedDB unavailable, running without local cache', idbEventToError(e))
              this.db = null
              resolve()
            }
            openWithStored.onsuccess = () => {
              this.db = openWithStored.result
              setTimeout(() => this.cleanUp(), 1000 * 60)
              resolve()
            }
            openWithStored.onupgradeneeded = () => {
              // Should not fire when opening with existing version
            }
          }
          return
        }
        logger.warn('IndexedDB unavailable, running without local cache', err)
        this.db = null
        resolve()
      }

      request.onsuccess = () => {
        this.db = request.result
        setTimeout(() => this.cleanUp(), 1000 * 60)
        resolve()
      }

      request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result
          if (
            event.oldVersion < 26 &&
            db.objectStoreNames.contains('spellListSourceEvents')
          ) {
            db.deleteObjectStore('spellListSourceEvents')
          }
          if (!db.objectStoreNames.contains(StoreNames.PROFILE_EVENTS)) {
            db.createObjectStore(StoreNames.PROFILE_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELAY_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.RELAY_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FOLLOW_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.FOLLOW_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.MUTE_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.MUTE_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BOOKMARK_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.BOOKMARK_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.PIN_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.PIN_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.INTEREST_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.INTEREST_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.MUTE_DECRYPTED_TAGS)) {
            db.createObjectStore(StoreNames.MUTE_DECRYPTED_TAGS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FAVORITE_RELAYS)) {
            db.createObjectStore(StoreNames.FAVORITE_RELAYS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BLOCKED_RELAYS_EVENTS)) {
            db.createObjectStore(StoreNames.BLOCKED_RELAYS_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELAY_SETS)) {
            db.createObjectStore(StoreNames.RELAY_SETS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FOLLOWING_FAVORITE_RELAYS)) {
            db.createObjectStore(StoreNames.FOLLOWING_FAVORITE_RELAYS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BLOSSOM_SERVER_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.BLOSSOM_SERVER_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.USER_EMOJI_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.USER_EMOJI_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.EMOJI_SET_EVENTS)) {
            db.createObjectStore(StoreNames.EMOJI_SET_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELAY_INFOS)) {
            db.createObjectStore(StoreNames.RELAY_INFOS, { keyPath: 'key' })
          }
          if (db.objectStoreNames.contains(StoreNames.RELAY_INFO_EVENTS)) {
            db.deleteObjectStore(StoreNames.RELAY_INFO_EVENTS)
          }
          if (!db.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS)) {
            db.createObjectStore(StoreNames.PUBLICATION_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.PUBLIC_LIVELY_RELAYS)) {
            db.createObjectStore(StoreNames.PUBLIC_LIVELY_RELAYS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.NIP66_DISCOVERY)) {
            db.createObjectStore(StoreNames.NIP66_DISCOVERY, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.CACHE_RELAYS_EVENTS)) {
            db.createObjectStore(StoreNames.CACHE_RELAYS_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RSS_FEED_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.RSS_FEED_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RSS_FEED_ITEMS)) {
            const store = db.createObjectStore(StoreNames.RSS_FEED_ITEMS, { keyPath: 'key' })
            store.createIndex('feedUrl', 'feedUrl', { unique: false })
            store.createIndex('pubDate', 'pubDate', { unique: false })
          }
          if (!db.objectStoreNames.contains(StoreNames.PAYMENT_INFO_EVENTS)) {
            db.createObjectStore(StoreNames.PAYMENT_INFO_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.GIF_CACHE)) {
            db.createObjectStore(StoreNames.GIF_CACHE, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.SETTINGS)) {
            db.createObjectStore(StoreNames.SETTINGS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.SPELL_EVENTS)) {
            db.createObjectStore(StoreNames.SPELL_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.TOMBSTONE_LIST)) {
            db.createObjectStore(StoreNames.TOMBSTONE_LIST, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BADGE_DEFINITION_EVENTS)) {
            db.createObjectStore(StoreNames.BADGE_DEFINITION_EVENTS, { keyPath: 'key' })
          }
        }
      }
    );
  }

  /** Whether {@link putReplaceableEvent} persists this kind (profile, lists, publications, …). */
  hasReplaceableEventStoreForKind(kind: number): boolean {
    return this.getStoreNameByKind(kind) !== undefined
  }

  async putReplaceableEvent(event: Event): Promise<Event> {
    // Check if tombstoned before caching
    const tombstoneKey = isReplaceableEvent(event.kind)
      ? getReplaceableCoordinateFromEvent(event)
      : event.id
    const isTombstoned = await this.isTombstoned(tombstoneKey)
    if (isTombstoned) {
      logger.debug('[IndexedDB] Skipping tombstoned event', { tombstoneKey, eventId: event.id })
      return Promise.reject(new Error('Event is tombstoned'))
    }
    
    // Remove relayStatuses before storing (it's metadata for logging, not part of the event)
    const cleanEvent = { ...event }
    delete (cleanEvent as any).relayStatuses
    
    const storeName = this.getStoreNameByKind(cleanEvent.kind)
    if (!storeName) {
      logger.error('[IndexedDB] Store name not found for kind', { kind: cleanEvent.kind })
      return Promise.reject('store name not found')
    }
    
    logger.debug('[IndexedDB] Putting replaceable event', {
      kind: cleanEvent.kind,
      storeName,
      eventId: cleanEvent.id,
      pubkey: cleanEvent.pubkey,
      created_at: cleanEvent.created_at
    })
    
    await this.initPromise
    
    // Wait a bit for database upgrade to complete if store doesn't exist
    if (this.db && !this.db.objectStoreNames.contains(storeName)) {
      logger.warn('[IndexedDB] Store not found, waiting for database upgrade', { storeName })
      // Wait up to 2 seconds for store to be created (database upgrade)
      let retries = 20
      while (retries > 0 && this.db && !this.db.objectStoreNames.contains(storeName)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        retries--
      }
    }
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(cleanEvent)
      }
      
      // Check if the store exists before trying to access it
      if (!this.db.objectStoreNames.contains(storeName)) {
        logger.error('[IndexedDB] Store not found in database after waiting', {
          storeName,
          kind: cleanEvent.kind,
          availableStores: Array.from(this.db.objectStoreNames),
          dbVersion: this.db.version
        })
        logger.error('[IndexedDB] Store not found in database after waiting', { 
          storeName,
          kind: cleanEvent.kind,
          availableStores: Array.from(this.db.objectStoreNames) 
        })
        // Return the event anyway (don't reject) - caching is optional
        return resolve(cleanEvent)
      }
      
      logger.debug('[IndexedDB] Store exists, proceeding with save', {
        storeName,
        kind: cleanEvent.kind,
        eventId: cleanEvent.id,
        dbVersion: this.db.version,
        allStores: Array.from(this.db.objectStoreNames)
      })
      
      const transaction = this.db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)

      const key = this.getReplaceableEventKeyFromEvent(cleanEvent)
      logger.debug('[IndexedDB] Getting existing event', { storeName, key, eventId: cleanEvent.id })
      
      const getRequest = store.get(key)
      getRequest.onsuccess = () => {
        const oldValue = getRequest.result as TValue<Event> | undefined
        if (oldValue?.value) {
          logger.debug('[IndexedDB] Found existing event', { 
            storeName,
            key,
            oldEventId: oldValue.value.id,
            oldCreatedAt: oldValue.value.created_at,
            newCreatedAt: cleanEvent.created_at,
            willUpdate: cleanEvent.created_at > oldValue.value.created_at 
          })
        } else {
          logger.debug('[IndexedDB] No existing event found', { storeName, key })
        }
        
        if (oldValue?.value && oldValue.value.created_at >= cleanEvent.created_at) {
          logger.debug('[IndexedDB] Keeping existing event (newer or same timestamp)', { 
            storeName,
            key,
            existingEventId: oldValue.value.id 
          })
          transaction.commit()
          return resolve(oldValue.value)
        }
        
        logger.debug('[IndexedDB] Putting new event', { 
          storeName, 
          key, 
          eventId: cleanEvent.id,
          content: cleanEvent.content
        })
        const putRequest = store.put(this.formatValue(key, cleanEvent))
        putRequest.onsuccess = () => {
          logger.debug('[IndexedDB] Successfully put event', { 
            storeName, 
            key, 
            eventId: cleanEvent.id,
            content: cleanEvent.content
          })
          transaction.commit()
          resolve(cleanEvent)
        }

        putRequest.onerror = (event) => {
          logger.error('[IndexedDB] Error putting event!', { 
            storeName, 
            key, 
            error: event, 
            target: (event.target as any)?.error,
            errorMessage: (event.target as any)?.error?.message 
          })
          logger.error('[IndexedDB] Error putting event', { storeName, key, error: event })
          transaction.commit()
          reject(event)
        }
      }

      getRequest.onerror = (event) => {
        logger.error('[IndexedDB] Error getting existing event', { storeName, key, error: event })
        transaction.commit()
        reject(event)
      }
    })
  }

  async getReplaceableEvent(
    pubkey: string,
    kind: number,
    d?: string
  ): Promise<Event | undefined | null> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) {
      return Promise.reject('store name not found')
    }
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(undefined)
      }
      // Check if the store exists before trying to access it
      if (!this.db.objectStoreNames.contains(storeName)) {
        logger.warn(`Store ${storeName} not found in database. Returning null.`)
        return resolve(null)
      }
      const transaction = this.db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const key = this.getReplaceableEventKey(pubkey, d)
      const request = store.get(key)

      request.onsuccess = () => {
        const row = request.result as TValue<Event> | undefined
        if (!row) {
          logger.debug('[IndexedDB] getReplaceableEvent - no row found', {
            pubkey,
            kind,
            d
          })
          transaction.commit()
          return resolve(undefined)
        }
        // Invalidate profile and payment info cache when stale so they refetch regularly
        // BUT: Always return cached profiles even if stale - we'll refresh in background
        // This ensures profiles are always visible, even if slightly outdated
        const isProfileOrPayment = kind === kinds.Metadata || kind === ExtendedKind.PAYMENT_INFO
        if (isProfileOrPayment && row.addedAt && Date.now() - row.addedAt > PROFILE_AND_PAYMENT_CACHE_MAX_AGE_MS) {
          // Profile is stale, but return it anyway - refresh will happen in background
          // This prevents the "no profile" state when cache exists but is just old
          logger.debug('[IndexedDB] Profile cache is stale but returning anyway', {
            pubkey,
            age: Date.now() - row.addedAt,
            maxAge: PROFILE_AND_PAYMENT_CACHE_MAX_AGE_MS,
            eventId: row.value?.id
          })
        }
        logger.debug('[IndexedDB] getReplaceableEvent - found', {
          pubkey,
          kind,
          eventId: row.value?.id,
          addedAt: row.addedAt
        })
        transaction.commit()
        resolve(row.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Get the timestamp when a replaceable event was cached in IndexedDB
   */
  async getReplaceableEventCachedAt(
    pubkey: string,
    kind: number,
    d?: string
  ): Promise<number | undefined> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) {
      return Promise.resolve(undefined)
    }
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(undefined)
      }
      if (!this.db.objectStoreNames.contains(storeName)) {
        return resolve(undefined)
      }
      const transaction = this.db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const key = this.getReplaceableEventKey(pubkey, d)
      const request = store.get(key)

      request.onsuccess = () => {
        const row = request.result as TValue<Event> | undefined
        transaction.commit()
        resolve(row?.addedAt)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getManyReplaceableEvents(
    pubkeys: readonly string[],
    kind: number
  ): Promise<(Event | undefined | null)[]> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) {
      return Promise.reject('store name not found')
    }
    await this.initPromise
    return new Promise<(Event | undefined | null)[]>((resolve) => {
      if (!this.db) {
        return resolve(new Array(pubkeys.length).fill(undefined))
      }
      const transaction = this.db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const events: (Event | null)[] = new Array(pubkeys.length).fill(undefined)
      let count = 0
      pubkeys.forEach((pubkey, i) => {
        const request = store.get(this.getReplaceableEventKey(pubkey))

        request.onsuccess = () => {
          const event = (request.result as TValue<Event | null>)?.value
          if (event || event === null) {
            events[i] = event
          }

          if (++count === pubkeys.length) {
            transaction.commit()
            resolve(events)
          }
        }

        request.onerror = () => {
          if (++count === pubkeys.length) {
            transaction.commit()
            resolve(events)
          }
        }
      })
    })
  }

  async getMuteDecryptedTags(id: string): Promise<string[][] | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.MUTE_DECRYPTED_TAGS, 'readonly')
      const store = transaction.objectStore(StoreNames.MUTE_DECRYPTED_TAGS)
      const request = store.get(id)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<string[][]>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putMuteDecryptedTags(id: string, tags: string[][]): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.MUTE_DECRYPTED_TAGS, 'readwrite')
      const store = transaction.objectStore(StoreNames.MUTE_DECRYPTED_TAGS)

      const putRequest = store.put(this.formatValue(id, tags))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async iterateProfileEvents(callback: (event: Event) => Promise<void>): Promise<void> {
    await this.initPromise
    if (!this.db) {
      return
    }

    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.PROFILE_EVENTS, 'readwrite')
      const store = transaction.objectStore(StoreNames.PROFILE_EVENTS)
      const request = store.openCursor()
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const value = (cursor.value as TValue<Event>).value
          if (value) {
            callback(value)
          }
          cursor.continue()
        } else {
          transaction.commit()
          resolve()
        }
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putFollowingFavoriteRelays(pubkey: string, relays: [string, string[]][]): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.FOLLOWING_FAVORITE_RELAYS, 'readwrite')
      const store = transaction.objectStore(StoreNames.FOLLOWING_FAVORITE_RELAYS)

      const putRequest = store.put(this.formatValue(pubkey, relays))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getFollowingFavoriteRelays(pubkey: string): Promise<[string, string[]][] | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.FOLLOWING_FAVORITE_RELAYS, 'readonly')
      const store = transaction.objectStore(StoreNames.FOLLOWING_FAVORITE_RELAYS)
      const request = store.get(pubkey)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<[string, string[]][]>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putRelayInfo(relayInfo: TRelayInfo): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.RELAY_INFOS, 'readwrite')
      const store = transaction.objectStore(StoreNames.RELAY_INFOS)

      const putRequest = store.put(this.formatValue(relayInfo.url, relayInfo))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getRelayInfo(url: string): Promise<TRelayInfo | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.RELAY_INFOS, 'readonly')
      const store = transaction.objectStore(StoreNames.RELAY_INFOS)
      const request = store.get(url)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<TRelayInfo>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /** NIP-66: cache key for the single public lively relay list entry. */
  private static PUBLIC_LIVELY_CACHE_KEY = 'list'

  async getPublicLivelyRelayUrlsCache(): Promise<{ urls: string[]; cachedAt: number } | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.PUBLIC_LIVELY_RELAYS, 'readonly')
      const store = transaction.objectStore(StoreNames.PUBLIC_LIVELY_RELAYS)
      const request = store.get(IndexedDbService.PUBLIC_LIVELY_CACHE_KEY)
      request.onsuccess = () => {
        transaction.commit()
        const row = request.result as TValue<{ urls: string[]; cachedAt: number }> | undefined
        resolve(row?.value ?? null)
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async setPublicLivelyRelayUrlsCache(urls: string[]): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.PUBLIC_LIVELY_RELAYS, 'readwrite')
      const store = transaction.objectStore(StoreNames.PUBLIC_LIVELY_RELAYS)
      const value = this.formatValue(IndexedDbService.PUBLIC_LIVELY_CACHE_KEY, {
        urls,
        cachedAt: Date.now()
      })
      const putRequest = store.put(value)
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getNip66Discovery(relayUrl: string): Promise<{ discovery: TNip66RelayDiscovery; cachedAt: number } | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.NIP66_DISCOVERY, 'readonly')
      const store = transaction.objectStore(StoreNames.NIP66_DISCOVERY)
      const request = store.get(relayUrl)
      request.onsuccess = () => {
        transaction.commit()
        const row = request.result as TValue<{ discovery: TNip66RelayDiscovery; cachedAt: number }> | undefined
        resolve(row?.value ?? null)
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async setNip66Discovery(relayUrl: string, discovery: TNip66RelayDiscovery): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.NIP66_DISCOVERY, 'readwrite')
      const store = transaction.objectStore(StoreNames.NIP66_DISCOVERY)
      const value = this.formatValue(relayUrl, { discovery, cachedAt: Date.now() })
      const putRequest = store.put(value)
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  private getReplaceableEventKeyFromEvent(event: Event): string {
    // Events that are replaceable by pubkey only (no d-tag)
    // PAYMENT_INFO (10133), RSS_FEED_LIST (10895), etc. are in the 10000-20000 range
    if (
      [kinds.Metadata, kinds.Contacts, ExtendedKind.PAYMENT_INFO].includes(event.kind) ||
      (event.kind >= 10000 && event.kind < 20000 && event.kind !== ExtendedKind.PUBLICATION && event.kind !== ExtendedKind.PUBLICATION_CONTENT && event.kind !== ExtendedKind.WIKI_ARTICLE && event.kind !== ExtendedKind.WIKI_ARTICLE_MARKDOWN && event.kind !== kinds.LongFormArticle)
    ) {
      return this.getReplaceableEventKey(event.pubkey)
    }

    // Publications and their nested content are replaceable by pubkey + d-tag
    const [, d] = event.tags.find(tagNameEquals('d')) ?? []
    return this.getReplaceableEventKey(event.pubkey, d)
  }

  private getReplaceableEventKey(pubkey: string, d?: string): string {
    return d === undefined ? pubkey : `${pubkey}:${d}`
  }

  private getStoreNameByKind(kind: number): string | undefined {
    switch (kind) {
      case kinds.Metadata:
        return StoreNames.PROFILE_EVENTS
      case kinds.RelayList:
        return StoreNames.RELAY_LIST_EVENTS
      case kinds.Contacts:
        return StoreNames.FOLLOW_LIST_EVENTS
      case kinds.Mutelist:
        return StoreNames.MUTE_LIST_EVENTS
      case kinds.BookmarkList:
        return StoreNames.BOOKMARK_LIST_EVENTS
      case 10001: // Pin list
        return StoreNames.PIN_LIST_EVENTS
      case 10015: // Interest list
        return StoreNames.INTEREST_LIST_EVENTS
      case ExtendedKind.BLOSSOM_SERVER_LIST:
        return StoreNames.BLOSSOM_SERVER_LIST_EVENTS
      case kinds.Relaysets:
        return StoreNames.RELAY_SETS
      case ExtendedKind.FAVORITE_RELAYS:
        return StoreNames.FAVORITE_RELAYS
      case ExtendedKind.BLOCKED_RELAYS:
        return StoreNames.BLOCKED_RELAYS_EVENTS
      case ExtendedKind.CACHE_RELAYS:
        return StoreNames.CACHE_RELAYS_EVENTS
      case ExtendedKind.RSS_FEED_LIST:
        return StoreNames.RSS_FEED_LIST_EVENTS
      case kinds.UserEmojiList:
        return StoreNames.USER_EMOJI_LIST_EVENTS
      case kinds.Emojisets:
        return StoreNames.EMOJI_SET_EVENTS
      case ExtendedKind.PAYMENT_INFO:
        return StoreNames.PAYMENT_INFO_EVENTS
      case ExtendedKind.PUBLICATION:
      case ExtendedKind.PUBLICATION_CONTENT:
      case ExtendedKind.WIKI_ARTICLE:
      case kinds.LongFormArticle:
        return StoreNames.PUBLICATION_EVENTS
      case ExtendedKind.BADGE_DEFINITION:
        return StoreNames.BADGE_DEFINITION_EVENTS
      default:
        return undefined
    }
  }

  async putPublicationWithNestedEvents(masterEvent: Event, nestedEvents: Event[]): Promise<Event> {
    // Store master publication as replaceable event
    const masterKey = this.getReplaceableEventKeyFromEvent(masterEvent)
    await this.putReplaceableEvent(masterEvent)
    
    // Store nested events, linking them to the master
    for (const nestedEvent of nestedEvents) {
      // Check if this is a replaceable event kind
      if (isReplaceableEvent(nestedEvent.kind)) {
        await this.putReplaceableEventWithMaster(nestedEvent, masterKey)
      } else {
        // For non-replaceable events, store by event ID with master link
        await this.putNonReplaceableEventWithMaster(nestedEvent, masterKey)
      }
    }
    
    return masterEvent
  }

  private async putReplaceableEventWithMaster(event: Event, masterKey: string): Promise<Event> {
    // Remove relayStatuses before storing (it's metadata for logging, not part of the event)
    const cleanEvent = { ...event }
    delete (cleanEvent as any).relayStatuses
    
    const storeName = this.getStoreNameByKind(cleanEvent.kind)
    if (!storeName) {
      return Promise.reject('store name not found')
    }
    await this.initPromise
    
    // Wait a bit for database upgrade to complete if store doesn't exist
    if (this.db && !this.db.objectStoreNames.contains(storeName)) {
      let retries = 20
      while (retries > 0 && this.db && !this.db.objectStoreNames.contains(storeName)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        retries--
      }
    }
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(cleanEvent)
      }
      if (!this.db.objectStoreNames.contains(storeName)) {
        logger.warn(`Store ${storeName} not found in database. Cannot save event.`)
        return resolve(cleanEvent)
      }
      const transaction = this.db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)

      const key = this.getReplaceableEventKeyFromEvent(cleanEvent)
      const getRequest = store.get(key)
      getRequest.onsuccess = () => {
        const oldValue = getRequest.result as TValue<Event> | undefined
        if (oldValue?.value && oldValue.value.created_at >= cleanEvent.created_at) {
          // Update master key link even if event is not newer
          if (oldValue.masterPublicationKey !== masterKey) {
            const value = this.formatValue(key, oldValue.value)
            value.masterPublicationKey = masterKey
            store.put(value)
          }
          transaction.commit()
          return resolve(oldValue.value)
        }
        // Store with master key link
        const value = this.formatValue(key, cleanEvent)
        value.masterPublicationKey = masterKey
        const putRequest = store.put(value)
        putRequest.onsuccess = () => {
          transaction.commit()
          resolve(cleanEvent)
        }

        putRequest.onerror = (event) => {
          transaction.commit()
          reject(event)
        }
      }

      getRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putNonReplaceableEventWithMaster(event: Event, masterKey: string): Promise<Event> {
    // For non-replaceable events, store by event ID in publication events store
    const storeName = StoreNames.PUBLICATION_EVENTS
    await this.initPromise
    
    // Wait a bit for database upgrade to complete if store doesn't exist
    if (this.db && !this.db.objectStoreNames.contains(storeName)) {
      let retries = 20
      while (retries > 0 && this.db && !this.db.objectStoreNames.contains(storeName)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        retries--
      }
    }
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(event)
      }
      if (!this.db.objectStoreNames.contains(storeName)) {
        logger.warn(`Store ${storeName} not found in database. Cannot save event.`)
        return resolve(event)
      }
      const transaction = this.db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)

      // For non-replaceable events, use event ID as key
      const key = event.id
      // For non-replaceable events, always update with master key link
      const value = this.formatValue(key, event)
      value.masterPublicationKey = masterKey
      const putRequest = store.put(value)
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve(event)
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getPublicationEvent(coordinate: string): Promise<Event | undefined> {
    // Parse coordinate (format: kind:pubkey:d-tag)
    const coordinateParts = coordinate.split(':')
    if (coordinateParts.length >= 2) {
      const kind = parseInt(coordinateParts[0])
      if (!isNaN(kind)) {
        const pubkey = coordinateParts[1]
        const d = coordinateParts[2] || undefined
        const event = await this.getReplaceableEvent(pubkey, kind, d)
        return event || undefined
      }
    }
    return Promise.resolve(undefined)
  }

  async getEventFromPublicationStore(eventId: string): Promise<Event | undefined> {
    // Get event from PUBLICATION_EVENTS store by event ID
    // This is used for non-replaceable events stored as part of publications
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(undefined)
      }
      if (!this.db.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS)) {
        return resolve(undefined)
      }
      const transaction = this.db.transaction(StoreNames.PUBLICATION_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.PUBLICATION_EVENTS)
      const request = store.get(eventId)

      request.onsuccess = () => {
        transaction.commit()
        const result = request.result as TValue<Event> | undefined
        resolve(result?.value || undefined)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Iterate PUBLICATION_EVENTS and return events whose kind is in allowedKinds and content or tags
   * match the search query (case-insensitive). Used by nevent/naddr picker to show cached events first.
   */
  async getCachedEventsForSearch(query: string, limit: number, allowedKinds: number[]): Promise<Event[]> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS)) {
      return []
    }
    const q = query.trim().toLowerCase()
    if (!q || allowedKinds.length === 0) return []

    const kindSet = new Set(allowedKinds)

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.PUBLICATION_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.PUBLICATION_EVENTS)
      const request = store.openCursor()
      const results: Event[] = []

      request.onsuccess = () => {
        const cursor = (request as IDBRequest<IDBCursorWithValue>).result
        if (!cursor || results.length >= limit) {
          transaction.commit()
          resolve(results)
          return
        }
        const item = cursor.value as TValue<Event> | undefined
        if (item?.value) {
          const event = item.value as Event
          if (kindSet.has(event.kind)) {
            const content = (event.content ?? '').toLowerCase()
            const tagsStr = (event.tags ?? []).flat().join(' ').toLowerCase()
            if (content.includes(q) || tagsStr.includes(q)) {
              results.push(event)
            }
          }
        }
        cursor.continue()
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getPublicationStoreItems(storeName: string): Promise<Array<{ key: string; value: any; addedAt: number; nestedCount?: number }>> {
    // For publication stores, only return master events with nested counts
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return []
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.openCursor()
      
      const masterEvents = new Map<string, { key: string; value: any; addedAt: number; nestedCount: number }>()
      const nestedEvents: Array<{ key: string; masterKey?: string }> = []

      request.onsuccess = () => {
        const cursor = (request as any).result
        if (cursor) {
          const item = cursor.value as TValue<Event>
          const key = cursor.key as string
          
          if (item?.value) {
            const event = item.value as Event
            // Check if this is a master publication (kind 30040) or a nested event
            if (event.kind === ExtendedKind.PUBLICATION && !item.masterPublicationKey) {
              // This is a master publication
              masterEvents.set(key, {
                key,
                value: event,
                addedAt: item.addedAt,
                nestedCount: 0
              })
            } else if (item.masterPublicationKey) {
              // This is a nested event - track it for counting
              nestedEvents.push({
                key,
                masterKey: item.masterPublicationKey
              })
            }
          }
          cursor.continue()
        } else {
          // Count nested events for each master
          nestedEvents.forEach(nested => {
            if (nested.masterKey && masterEvents.has(nested.masterKey)) {
              const master = masterEvents.get(nested.masterKey)!
              master.nestedCount++
            }
          })
          
          transaction.commit()
          resolve(Array.from(masterEvents.values()))
        }
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async deletePublicationAndNestedEvents(pubkey: string, d?: string): Promise<{ deleted: number }> {
    const masterKey = this.getReplaceableEventKey(pubkey, d)
    const storeName = StoreNames.PUBLICATION_EVENTS
    
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return Promise.resolve({ deleted: 0 })
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.openCursor()
      
      const keysToDelete: string[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const value = cursor.value as TValue<Event>
          const key = cursor.key as string
          
          // Delete if it's the master (matches masterKey) or linked to the master (has masterPublicationKey)
          if (key === masterKey || value?.masterPublicationKey === masterKey) {
            keysToDelete.push(key)
          }
          cursor.continue()
        } else {
          // Delete all identified keys
          let deletedCount = 0
          let completedCount = 0

          if (keysToDelete.length === 0) {
            transaction.commit()
            return resolve({ deleted: 0 })
          }

          keysToDelete.forEach(key => {
            const deleteRequest = store.delete(key)
            deleteRequest.onsuccess = () => {
              deletedCount++
              completedCount++
              if (completedCount === keysToDelete.length) {
                transaction.commit()
                resolve({ deleted: deletedCount })
              }
            }
            deleteRequest.onerror = () => {
              completedCount++
              if (completedCount === keysToDelete.length) {
                transaction.commit()
                resolve({ deleted: deletedCount })
              }
            }
          })
        }
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  private formatValue<T>(key: string, value: T): TValue<T> {
    return {
      key,
      value,
      addedAt: Date.now()
    }
  }

  async clearAllCache(): Promise<void> {
    await this.initPromise
    if (!this.db) {
      return
    }

    const allStoreNames = Array.from(this.db.objectStoreNames)
    const transaction = this.db.transaction(allStoreNames, 'readwrite')
    
    await Promise.allSettled(
      allStoreNames.map(storeName => {
        return new Promise<void>((resolve, reject) => {
          const store = transaction.objectStore(storeName)
          const request = store.clear()
          request.onsuccess = () => resolve()
          request.onerror = (event) => reject(event)
        })
      })
    )
  }

  async getStoreInfo(): Promise<Record<string, number>> {
    await this.initPromise
    if (!this.db) {
      return {}
    }

    const storeInfo: Record<string, number> = {}
    const allStoreNames = Array.from(this.db.objectStoreNames)
    
    await Promise.allSettled(
      allStoreNames.map(storeName => {
        return new Promise<void>((resolve, reject) => {
          const transaction = this.db!.transaction(storeName, 'readonly')
          const store = transaction.objectStore(storeName)
          const request = store.count()
          request.onsuccess = () => {
            storeInfo[storeName] = request.result
            resolve()
          }
          request.onerror = (event) => reject(idbEventToError(event))
        })
      })
    )

    return storeInfo
  }

  async getStoreItems(storeName: string): Promise<TValue<any>[]> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return []
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.getAll()
      
      request.onsuccess = () => {
        transaction.commit()
        resolve(request.result as TValue<any>[])
      }
      
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /** Remove a replaceable event from cache so the next fetch will load from relays. */
  async invalidateReplaceableEvent(pubkey: string, kind: number, d?: string): Promise<void> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) return
    const key = this.getReplaceableEventKey(pubkey, d)
    await this.deleteStoreItem(storeName, key)
  }

  async deleteStoreItem(storeName: string, key: string): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.delete(key)
      
      request.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async clearStore(storeName: string): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.clear()
      
      request.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async cleanupDuplicateReplaceableEvents(storeName: string): Promise<{ deleted: number; kept: number }> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return { deleted: 0, kept: 0 }
    }

    // Get the kind for this store - only clean up replaceable event stores
    const kind = this.getKindByStoreName(storeName)
    if (!kind || !this.isReplaceableEventKind(kind)) {
      return Promise.reject('Not a replaceable event store')
    }

    // First pass: identify duplicates
    const allItems = await this.getStoreItems(storeName)
    const eventMap = new Map<string, { key: string; event: Event; addedAt: number }>()
    const keysToDelete: string[] = []
    let invalidItemsCount = 0

    for (const item of allItems) {
      if (!item || !item.value) {
        invalidItemsCount++
        continue
      }
      
      // Skip if event doesn't have required fields
      if (!item.value.pubkey || !item.value.kind || !item.value.created_at) {
        invalidItemsCount++
        continue
      }
      
      try {
        const replaceableKey = this.getReplaceableEventKeyFromEvent(item.value)
        const existing = eventMap.get(replaceableKey)
        
        if (!existing || 
            item.value.created_at > existing.event.created_at ||
            (item.value.created_at === existing.event.created_at && 
             item.addedAt > existing.addedAt)) {
          // This event is newer, mark the old one for deletion if it exists
          if (existing) {
            keysToDelete.push(existing.key)
          }
          eventMap.set(replaceableKey, {
            key: item.key,
            event: item.value,
            addedAt: item.addedAt
          })
        } else {
          // This event is older or same, mark it for deletion
          keysToDelete.push(item.key)
        }
      } catch (error) {
        // If we can't generate a replaceable key, skip this item
        logger.warn('Failed to get replaceable key for item', { key: item.key, error })
        invalidItemsCount++
        continue
      }
    }

    // Second pass: delete duplicates
    const totalProcessed = eventMap.size + keysToDelete.length
    const actualKept = eventMap.size
    
    if (keysToDelete.length === 0) {
      // No duplicates found, but verify counts match
      if (totalProcessed + invalidItemsCount !== allItems.length) {
        logger.warn('Count mismatch while cleaning up replaceable events', {
          totalItems: allItems.length,
          processed: totalProcessed,
          invalid: invalidItemsCount
        })
      }
      return Promise.resolve({ deleted: 0, kept: actualKept })
    }

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      
      let deletedCount = 0
      let completedCount = 0

      keysToDelete.forEach(key => {
        const deleteRequest = store.delete(key)
        deleteRequest.onsuccess = () => {
          deletedCount++
          completedCount++
          if (completedCount === keysToDelete.length) {
            transaction.commit()
            const actualKept = eventMap.size
            const totalProcessed = actualKept + deletedCount
            if (totalProcessed + invalidItemsCount !== allItems.length) {
              logger.warn('Count mismatch after deletion', {
                totalItems: allItems.length,
                kept: actualKept,
                deleted: deletedCount,
                invalid: invalidItemsCount
              })
            }
            resolve({ deleted: deletedCount, kept: actualKept })
          }
        }
        deleteRequest.onerror = () => {
          completedCount++
          if (completedCount === keysToDelete.length) {
            transaction.commit()
            const actualKept = eventMap.size
            resolve({ deleted: deletedCount, kept: actualKept })
          }
        }
      })
    })
  }

  private getKindByStoreName(storeName: string): number | undefined {
    // Reverse lookup of getStoreNameByKind
    if (storeName === StoreNames.PROFILE_EVENTS) return kinds.Metadata
    if (storeName === StoreNames.RELAY_LIST_EVENTS) return kinds.RelayList
    if (storeName === StoreNames.FOLLOW_LIST_EVENTS) return kinds.Contacts
    if (storeName === StoreNames.MUTE_LIST_EVENTS) return kinds.Mutelist
    if (storeName === StoreNames.BOOKMARK_LIST_EVENTS) return kinds.BookmarkList
    if (storeName === StoreNames.PIN_LIST_EVENTS) return 10001
    if (storeName === StoreNames.INTEREST_LIST_EVENTS) return 10015
    if (storeName === StoreNames.BLOSSOM_SERVER_LIST_EVENTS) return ExtendedKind.BLOSSOM_SERVER_LIST
    if (storeName === StoreNames.RELAY_SETS) return kinds.Relaysets
    if (storeName === StoreNames.FAVORITE_RELAYS) return ExtendedKind.FAVORITE_RELAYS
    if (storeName === StoreNames.BLOCKED_RELAYS_EVENTS) return ExtendedKind.BLOCKED_RELAYS
      if (storeName === StoreNames.CACHE_RELAYS_EVENTS) return ExtendedKind.CACHE_RELAYS
      if (storeName === StoreNames.RSS_FEED_LIST_EVENTS) return ExtendedKind.RSS_FEED_LIST
      if (storeName === StoreNames.USER_EMOJI_LIST_EVENTS) return kinds.UserEmojiList
      if (storeName === StoreNames.EMOJI_SET_EVENTS) return kinds.Emojisets
      if (storeName === StoreNames.PAYMENT_INFO_EVENTS) return ExtendedKind.PAYMENT_INFO
      if (storeName === StoreNames.BADGE_DEFINITION_EVENTS) return ExtendedKind.BADGE_DEFINITION
      // PUBLICATION_EVENTS is not replaceable, so we don't handle it here
      return undefined
  }

  private isReplaceableEventKind(kind: number): boolean {
    // Check if this is a replaceable event kind
    return (
      kind === kinds.Metadata ||
      kind === kinds.Contacts ||
      kind === kinds.RelayList ||
      kind === kinds.Mutelist ||
      kind === kinds.BookmarkList ||
      (kind >= 10000 && kind < 20000) ||
      kind === ExtendedKind.FAVORITE_RELAYS ||
      kind === ExtendedKind.BLOCKED_RELAYS ||
      kind === ExtendedKind.CACHE_RELAYS ||
      kind === ExtendedKind.BLOSSOM_SERVER_LIST ||
      kind === ExtendedKind.RSS_FEED_LIST
    )
  }

  async forceDatabaseUpgrade(): Promise<void> {
    // Close the database first
    if (this.db) {
      this.db.close()
      this.db = null
      this.initPromise = null
    }
    
    // Check current version
    const checkRequest = window.indexedDB.open('jumble')
    let currentVersion = DB_VERSION
    checkRequest.onsuccess = () => {
      const db = checkRequest.result
      currentVersion = db.version
      db.close()
    }
    checkRequest.onerror = () => {
      // If we can't check, start fresh
      currentVersion = 14
    }
    await new Promise(resolve => setTimeout(resolve, 100)) // Wait for version check
    
    const newVersion = currentVersion + 1
    
    // Open with new version to trigger upgrade
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open('jumble', newVersion)
      
      request.onerror = (event) => {
        reject(event)
      }
      
      request.onsuccess = () => {
        const db = request.result
        // Don't close - keep it open for the service to use
        this.db = db
        this.initPromise = Promise.resolve()
        resolve()
      }
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        // Create any missing stores
        Object.values(StoreNames).forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'key' })
          }
        })
      }
    })
  }

  private async cleanUp() {
    await this.initPromise
    if (!this.db) {
      return
    }

    const stores = [
      { name: StoreNames.PROFILE_EVENTS, expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 }, // 1 day
      { name: StoreNames.PAYMENT_INFO_EVENTS, expirationTimestamp: Date.now() - PROFILE_AND_PAYMENT_CACHE_MAX_AGE_MS }, // 5 min
      { name: StoreNames.RELAY_LIST_EVENTS, expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 }, // 1 day
      {
        name: StoreNames.FOLLOW_LIST_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 // 1 day
      },
      {
        name: StoreNames.BLOSSOM_SERVER_LIST_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 // 1 days
      },
      {
        name: StoreNames.RELAY_INFOS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 // 1 days
      }
    ]
    const transaction = this.db!.transaction(
      stores.map((store) => store.name),
      'readwrite'
    )
    await Promise.allSettled(
      stores.map(({ name, expirationTimestamp }) => {
        if (expirationTimestamp < 0) {
          return Promise.resolve()
        }
        return new Promise<void>((resolve, reject) => {
          const store = transaction.objectStore(name)
          const request = store.openCursor()
          request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result
            if (cursor) {
              const value: TValue = cursor.value
              if (value.addedAt < expirationTimestamp) {
                cursor.delete()
              }
              cursor.continue()
            } else {
              resolve()
            }
          }

          request.onerror = (event) => {
            reject(event)
          }
        })
      })
    )
  }

  /**
   * Store RSS feed items in IndexedDB
   */
  async putRssFeedItems(items: import('./rss-feed.service').RssFeedItem[]): Promise<void> {
    await this.initPromise
    const storeName = StoreNames.RSS_FEED_ITEMS
    
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      logger.warn('[IndexedDB] RSS feed items store not found', { storeName })
      return
    }

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      
      let completed = 0
      let errors = 0
      
      items.forEach((item) => {
        // Create a unique key from feedUrl and guid
        const key = `${item.feedUrl}:${item.guid}`
        // Store in TValue format for consistency with other stores
        const value: TValue<import('./rss-feed.service').RssFeedItem> = {
          key,
          value: item,
          addedAt: Date.now()
        }
        
        const request = store.put(value)
        request.onsuccess = () => {
          completed++
          if (completed + errors === items.length) {
            resolve()
          }
        }
        request.onerror = () => {
          errors++
          if (completed + errors === items.length) {
            resolve() // Don't reject, just log
          }
        }
      })
      
      if (items.length === 0) {
        resolve()
      }
    })
  }

  /**
   * Get all RSS feed items from IndexedDB
   */
  async getRssFeedItems(): Promise<import('./rss-feed.service').RssFeedItem[]> {
    await this.initPromise
    const storeName = StoreNames.RSS_FEED_ITEMS
    
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      logger.warn('[IndexedDB] RSS feed items store not found', { storeName })
      return []
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.getAll()
      
      request.onsuccess = () => {
        const items = request.result.map((entry: TValue<import('./rss-feed.service').RssFeedItem> | any) => {
          let item: import('./rss-feed.service').RssFeedItem | null = null
          
          // Handle new format (with value property)
          if (entry.value) {
            item = entry.value
          }
          // Fallback for old format (with item property)
          else if ((entry as any).item) {
            item = (entry as any).item as import('./rss-feed.service').RssFeedItem
          }
          
          if (!item) {
            return null
          }
          
          // Ensure pubDate is properly handled (IndexedDB may serialize Date as string)
          if (item.pubDate && typeof item.pubDate === 'string') {
            item.pubDate = new Date(item.pubDate)
          } else if (item.pubDate && typeof item.pubDate === 'number') {
            item.pubDate = new Date(item.pubDate)
          }
          
          return item
        }).filter((item): item is import('./rss-feed.service').RssFeedItem => item !== null)
        
        logger.debug('[IndexedDB] Retrieved RSS feed items', { 
          totalRetrieved: request.result.length,
          validItems: items.length 
        })
        resolve(items)
      }
      
      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  /**
   * Clear RSS feed items from IndexedDB
   */
  async clearRssFeedItems(): Promise<void> {
    await this.initPromise
    const storeName = StoreNames.RSS_FEED_ITEMS

    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.clear()

      request.onsuccess = () => {
        resolve()
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  private static readonly GIF_CACHE_KEY = 'gifList'

  /**
   * Get cached GIF list from IndexedDB. Returns null if missing or store unavailable.
   */
  async getGifCache(): Promise<{ gifs: { url: string; fallbackUrl?: string; eventId: string; pubkey: string; createdAt: number }[]; cachedAt: number } | null> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.GIF_CACHE)) {
      return null
    }
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(StoreNames.GIF_CACHE, 'readonly')
      const store = transaction.objectStore(StoreNames.GIF_CACHE)
      const request = store.get(IndexedDbService.GIF_CACHE_KEY)
      request.onsuccess = () => {
        const row = request.result as { key: string; value: { gifs: unknown[]; cachedAt: number } } | undefined
        if (row?.value?.gifs && typeof row.value.cachedAt === 'number') {
          resolve({ gifs: row.value.gifs as { url: string; fallbackUrl?: string; eventId: string; pubkey: string; createdAt: number }[], cachedAt: row.value.cachedAt })
        } else {
          resolve(null)
        }
      }
      request.onerror = () => resolve(null)
    })
  }

  /**
   * Write GIF list cache to IndexedDB.
   */
  async setGifCache(gifs: { url: string; fallbackUrl?: string; eventId: string; pubkey: string; createdAt: number }[], cachedAt: number): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.GIF_CACHE)) {
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.GIF_CACHE, 'readwrite')
      const store = transaction.objectStore(StoreNames.GIF_CACHE)
      store.put({ key: IndexedDbService.GIF_CACHE_KEY, value: { gifs, cachedAt } })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  /**
   * Get a single setting value from IndexedDB. Returns null if missing.
   */
  async getSetting(key: string): Promise<string | null> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SETTINGS)) {
      return null
    }
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(StoreNames.SETTINGS, 'readonly')
      const store = transaction.objectStore(StoreNames.SETTINGS)
      const request = store.get(key)
      request.onsuccess = () => {
        const row = request.result as { key: string; value: string } | undefined
        resolve(row?.value ?? null)
      }
      request.onerror = () => resolve(null)
    })
  }

  /**
   * Get all settings from IndexedDB as a key -> value map.
   */
  async getAllSettings(): Promise<Record<string, string>> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SETTINGS)) {
      return {}
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SETTINGS, 'readonly')
      const store = transaction.objectStore(StoreNames.SETTINGS)
      const request = store.getAll()
      request.onsuccess = () => {
        const rows = (request.result || []) as { key: string; value: string }[]
        const out: Record<string, string> = {}
        rows.forEach((r) => {
          if (r.key != null && r.value != null) out[r.key] = r.value
        })
        resolve(out)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Set a setting in IndexedDB.
   */
  async setSetting(key: string, value: string): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SETTINGS)) {
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SETTINGS, 'readwrite')
      const store = transaction.objectStore(StoreNames.SETTINGS)
      store.put({ key, value })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  /** Settings key for favorite spell event ids (JSON array of strings). */
  static readonly SPELL_FAVORITE_IDS_KEY = 'spellFavoriteIds'

  /**
   * Store a NIP-A7 spell event (kind 777) in IndexedDB by event id.
   */
  async putSpellEvent(event: Event): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SPELL_EVENTS)) {
      logger.warn('[IndexedDB] Spell events store not found')
      return
    }
    const cleanEvent = { ...event }
    delete (cleanEvent as any).relayStatuses
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SPELL_EVENTS, 'readwrite')
      const store = transaction.objectStore(StoreNames.SPELL_EVENTS)
      const key = cleanEvent.id
      const value: TValue<Event> = {
        key,
        value: cleanEvent,
        addedAt: Date.now()
      }
      store.put(value)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  /**
   * Delete a spell event from IndexedDB by event id.
   */
  async deleteSpellEvent(eventId: string): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SPELL_EVENTS)) {
      logger.warn('[IndexedDB] Spell events store not found')
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SPELL_EVENTS, 'readwrite')
      const store = transaction.objectStore(StoreNames.SPELL_EVENTS)
      store.delete(eventId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  /**
   * Get all spell events from IndexedDB.
   */
  async getSpellEvents(): Promise<Event[]> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SPELL_EVENTS)) {
      return []
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SPELL_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.SPELL_EVENTS)
      const request = store.getAll()
      request.onsuccess = () => {
        const rows = (request.result || []) as TValue<Event>[]
        const events = rows
          .filter((r) => r?.value != null)
          .map((r) => r.value as Event)
        resolve(events)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get favorite spell ids from settings (JSON array of event ids).
   */
  async getSpellFavoriteIds(): Promise<string[]> {
    const raw = await this.getSetting(IndexedDbService.SPELL_FAVORITE_IDS_KEY)
    if (!raw) return []
    try {
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  /**
   * Set favorite spell ids in settings.
   */
  async setSpellFavoriteIds(ids: string[]): Promise<void> {
    await this.setSetting(IndexedDbService.SPELL_FAVORITE_IDS_KEY, JSON.stringify(ids))
  }

  /**
   * Check if an event is tombstoned (deleted)
   */
  async isTombstoned(key: string): Promise<boolean> {
    await this.initPromise
    return new Promise((resolve) => {
      if (!this.db) {
        return resolve(false)
      }
      if (!this.db.objectStoreNames.contains(StoreNames.TOMBSTONE_LIST)) {
        return resolve(false)
      }
      const transaction = this.db.transaction(StoreNames.TOMBSTONE_LIST, 'readonly')
      const store = transaction.objectStore(StoreNames.TOMBSTONE_LIST)
      const request = store.get(key)

      request.onsuccess = () => {
        const row = request.result as TValue | undefined
        transaction.commit()
        resolve(row !== undefined && row.value !== null)
      }

      request.onerror = () => {
        transaction.commit()
        resolve(false)
      }
    })
  }

  /**
   * Add event to tombstone list (mark as deleted)
   * Key format: event ID for non-replaceable events, or "kind:pubkey" or "kind:pubkey:d" for replaceable events
   */
  async addTombstone(key: string, deletedAt: number = Date.now()): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject(new Error('Database not initialized'))
      }
      if (!this.db.objectStoreNames.contains(StoreNames.TOMBSTONE_LIST)) {
        return reject(new Error('Tombstone store not found'))
      }
      const transaction = this.db.transaction(StoreNames.TOMBSTONE_LIST, 'readwrite')
      const store = transaction.objectStore(StoreNames.TOMBSTONE_LIST)
      const value = this.formatValue(key, { deletedAt })
      const request = store.put(value)

      request.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(idbEventToError(event))
      }
    })
  }

  /**
   * Get all tombstoned keys
   */
  async getAllTombstones(): Promise<Set<string>> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(new Set())
      }
      if (!this.db.objectStoreNames.contains(StoreNames.TOMBSTONE_LIST)) {
        return resolve(new Set())
      }
      const transaction = this.db.transaction(StoreNames.TOMBSTONE_LIST, 'readonly')
      const store = transaction.objectStore(StoreNames.TOMBSTONE_LIST)
      const request = store.getAll()

      request.onsuccess = () => {
        const rows = request.result as TValue[]
        const keys = new Set<string>()
        for (const row of rows) {
          if (row.value !== null) {
            keys.add(row.key)
          }
        }
        transaction.commit()
        resolve(keys)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(idbEventToError(event))
      }
    })
  }

  /**
   * Remove tombstoned events from cache (cleanup)
   */
  async removeTombstonedFromCache(): Promise<number> {
    const tombstones = await this.getAllTombstones()
    let removed = 0

    for (const key of tombstones) {
      // Parse key format: could be event id or "kind:pubkey" or "kind:pubkey:d" (replaceable coordinate)
      // Or just event ID for non-replaceable events
      const parts = key.split(':')
      if (parts.length === 1) {
        // Event ID - remove from publication store
        try {
          await this.deleteStoreItem(StoreNames.PUBLICATION_EVENTS, key)
          removed++
        } catch {
          // Ignore errors
        }
      } else if (parts.length >= 2) {
        // Replaceable event coordinate format: "kind:pubkey" or "kind:pubkey:d"
        const kind = parseInt(parts[0]!, 10)
        const pubkey = parts[1]!
        const d = parts[2]
        if (!isNaN(kind)) {
          try {
            const storeName = this.getStoreNameByKind(kind)
            if (storeName) {
              await this.deleteStoreItem(storeName, this.getReplaceableEventKey(pubkey, d))
              removed++
            }
          } catch {
            // Ignore errors
          }
        }
      }
    }

    return removed
  }
}

const instance = IndexedDbService.getInstance()
export default instance
