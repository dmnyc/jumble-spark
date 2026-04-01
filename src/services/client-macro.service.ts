import { ExtendedKind } from '@/constants'
import logger from '@/lib/logger'
import type { Event as NEvent } from 'nostr-tools'
import indexedDb, { StoreNames } from './indexed-db.service'
import type { QueryService } from './client-query.service'

export interface MacroFilters {
  type?: string
  book?: string
  chapter?: number
  verse?: string
  version?: string
}

export class MacroService {
  private macroType: 'bookstr' | 'wikistr' | 'other' = 'bookstr'

  constructor(_queryService: QueryService, macroType: 'bookstr' | 'wikistr' | 'other' = 'bookstr') {
    this.macroType = macroType
  }

  /**
   * Fetch macro events (Bookstr, Wikistr, etc.)
   */
  async fetchMacroEvents(filters: MacroFilters): Promise<NEvent[]> {
    logger.info(`fetchMacroEvents[${this.macroType}]: Called`, { filters })
    try {
      // Step 1: Check cache FIRST before any network requests
      const cachedEvents = await this.getCachedMacroEvents(filters)
      if (cachedEvents.length > 0) {
        logger.info(`fetchMacroEvents[${this.macroType}]: Found cached events`, {
          count: cachedEvents.length,
          filters
        })
        // Still fetch in background to get updates, but return cached immediately
        this.fetchMacroEventsFromRelays(filters).catch(err => {
          logger.warn(`fetchMacroEvents[${this.macroType}]: Background fetch failed`, { error: err })
        })
        return cachedEvents
      }
      
      // Step 2: If verse is specified and contains a range, expand it
      if (filters.verse) {
        const verseNumbers = this.expandVerseRange(filters.verse)
        
        if (verseNumbers.length > 1) {
          logger.info(`fetchMacroEvents[${this.macroType}]: Expanding verse range`, {
            originalVerse: filters.verse,
            expandedVerses: verseNumbers
          })
          
          const allEvents: NEvent[] = []
          const seenEventIds = new Set<string>()
          
          for (const verseNum of verseNumbers) {
            const verseFilter = { ...filters, verse: verseNum.toString() }
            
            const verseCachedEvents = await this.getCachedMacroEvents(verseFilter)
            if (verseCachedEvents.length > 0) {
              for (const event of verseCachedEvents) {
                if (!seenEventIds.has(event.id)) {
                  seenEventIds.add(event.id)
                  allEvents.push(event)
                }
              }
              this.fetchMacroEventsFromRelays(verseFilter).catch(err => {
                logger.warn(`fetchMacroEvents[${this.macroType}]: Background fetch failed for verse`, { verse: verseNum, error: err })
              })
            } else {
              const verseEvents = await this.fetchMacroEvents(verseFilter)
              for (const event of verseEvents) {
                if (!seenEventIds.has(event.id)) {
                  seenEventIds.add(event.id)
                  allEvents.push(event)
                }
              }
            }
          }
          
          return allEvents
        }
      }
      
      // Step 3: Fetch from relays
      const events = await this.fetchMacroEventsFromRelays(filters)
      
      // Step 4: Save events to cache
      if (events.length > 0) {
        try {
          await Promise.allSettled(events.map((event) => this.persistMacroEvent(event)))

          logger.info(`fetchMacroEvents[${this.macroType}]: Saved events to cache`, {
            count: events.length,
            filters
          })
        } catch (cacheError) {
          logger.warn(`fetchMacroEvents[${this.macroType}]: Error saving to cache`, {
            error: cacheError,
            filters
          })
        }
      }
      
      return events
    } catch (error) {
      logger.warn(`Error querying ${this.macroType} events`, { error, filters })
      return []
    }
  }

  /**
   * Get cached macro events from IndexedDB
   */
  async getCachedMacroEvents(filters: MacroFilters): Promise<NEvent[]> {
    try {
      const allCached = await indexedDb.getStoreItems(StoreNames.PUBLICATION_EVENTS)
      const dedupedByCoordinate = new Map<string, NEvent>()
      
      for (const item of allCached) {
        const event = item.value as NEvent | undefined
        if (!event) continue
        
        if (!this.eventMatchesMacroFilters(event, filters)) {
          continue
        }
        const key = this.getMacroEventDedupKey(event)
        const existing = dedupedByCoordinate.get(key)
        if (!existing || event.created_at > existing.created_at) {
          dedupedByCoordinate.set(key, event)
        }
      }
      const cachedEvents = Array.from(dedupedByCoordinate.values())
      
      logger.debug(`getCachedMacroEvents[${this.macroType}]: Found cached events`, {
        count: cachedEvents.length,
        filters
      })
      
      return cachedEvents
    } catch (error) {
      logger.warn(`getCachedMacroEvents[${this.macroType}]: Error reading cache`, { error, filters })
      return []
    }
  }

  /**
   * Fetch macro events from relays
   */
  private async fetchMacroEventsFromRelays(filters: MacroFilters): Promise<NEvent[]> {
    // This would be implemented based on the specific macro type
    // For Bookstr, it would use the publication pubkey and filters
    // For now, return empty array as placeholder
    logger.debug(`fetchMacroEventsFromRelays[${this.macroType}]: Fetching from relays`, { filters })
    return []
  }

  /**
   * Expand verse range (e.g., "1-5" -> [1,2,3,4,5])
   */
  private expandVerseRange(verse: string): number[] {
    const parts = verse.split('-')
    if (parts.length === 1) {
      const num = parseInt(parts[0]!, 10)
      return isNaN(num) ? [] : [num]
    }
    
    const start = parseInt(parts[0]!, 10)
    const end = parseInt(parts[1]!, 10)
    if (isNaN(start) || isNaN(end) || start > end) {
      return []
    }
    
    const result: number[] = []
    for (let i = start; i <= end; i++) {
      result.push(i)
    }
    return result
  }

  /**
   * Check if event matches macro filters
   */
  private eventMatchesMacroFilters(event: NEvent, filters: MacroFilters): boolean {
    if (event.kind !== ExtendedKind.PUBLICATION && event.kind !== ExtendedKind.PUBLICATION_CONTENT) {
      return false
    }

    const metadata = this.extractMacroMetadataFromEvent(event)

    if (filters.type && metadata.type?.toLowerCase() !== filters.type.toLowerCase()) {
      return false
    }

    if (filters.book) {
      const normalizedBook = filters.book.toLowerCase().replace(/\s+/g, '-')
      const eventBookTags = event.tags
        .filter(tag => tag[0] === 'T' && tag[1])
        .map(tag => tag[1]!.toLowerCase().replace(/\s+/g, '-'))
        .filter((book): book is string => Boolean(book))
      
      if (!eventBookTags.some(book => this.bookNamesMatch(book, normalizedBook))) {
        return false
      }
    }

    if (filters.chapter !== undefined) {
      const eventChapters = event.tags
        .filter(tag => tag[0] === 'c')
        .map(tag => parseInt(tag[1] || '0', 10))
        .filter(num => !isNaN(num))
      
      if (!eventChapters.includes(filters.chapter)) {
        return false
      }
    }

    if (filters.verse) {
      const verseNum = parseInt(filters.verse, 10)
      if (!isNaN(verseNum)) {
        const eventVerses = event.tags
          .filter(tag => tag[0] === 's')
          .map(tag => parseInt(tag[1] || '0', 10))
          .filter(num => !isNaN(num))
        
        if (!eventVerses.includes(verseNum)) {
          return false
        }
      }
    }

    if (filters.version) {
      const normalizedVersion = filters.version.toLowerCase()
      const eventVersions = event.tags
        .filter(tag => tag[0] === 'v')
        .map(tag => tag[1]?.toLowerCase())
      
      if (!eventVersions.includes(normalizedVersion)) {
        return false
      }
    }

    return true
  }

  private async persistMacroEvent(event: NEvent): Promise<void> {
    if (event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT) {
      await indexedDb.putReplaceableEvent(event)
      return
    }
    await indexedDb.putNonReplaceableEventWithMaster(event, `${ExtendedKind.PUBLICATION}:${event.pubkey}:`)
  }

  private getMacroEventDedupKey(event: NEvent): string {
    const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
    if (d) {
      return `${event.kind}:${event.pubkey}:${d}`
    }
    return event.id
  }

  /**
   * Extract macro metadata from event tags
   */
  private extractMacroMetadataFromEvent(event: NEvent): {
    type?: string
    book?: string
    chapter?: string
    verse?: string
    version?: string
  } {
    const metadata: any = {}
    for (const [tag, value] of event.tags) {
      switch (tag) {
        case 'C':
          metadata.type = value
          break
        case 'T':
          metadata.book = value
          break
        case 'c':
          metadata.chapter = value
          break
        case 's':
          if (!metadata.verse) {
            metadata.verse = value
          }
          break
        case 'v':
          metadata.version = value
          break
      }
    }
    return metadata
  }

  /**
   * Check if book names match (handles variations)
   */
  private bookNamesMatch(book1: string | undefined, book2: string): boolean {
    if (!book1) return false
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
    return normalize(book1) === normalize(book2)
  }
}

/**
 * Create Bookstr service instance
 */
export function createBookstrService(queryService: QueryService): MacroService {
  return new MacroService(queryService, 'bookstr')
}

/**
 * Create Wikistr service instance
 */
export function createWikistrService(queryService: QueryService): MacroService {
  return new MacroService(queryService, 'wikistr')
}
