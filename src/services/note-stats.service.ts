import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { getEmojiInfosFromEmojiTags, getFirstHexEventIdFromETags, tagNameEquals } from '@/lib/tag'
import { normalizeUrl } from '@/lib/url'
import { eventService } from '@/services/client.service'
import { TEmoji } from '@/types'
import dayjs from 'dayjs'
import { Event, Filter, kinds } from 'nostr-tools'

export type TNoteStats = {
  likeIdSet: Set<string>
  likes: { id: string; pubkey: string; created_at: number; emoji: TEmoji | string }[]
  repostPubkeySet: Set<string>
  reposts: { id: string; pubkey: string; created_at: number }[]
  zapPrSet: Set<string>
  zaps: { pr: string; pubkey: string; amount: number; created_at: number; comment?: string }[]
  replyIdSet: Set<string>
  replies: { id: string; pubkey: string; created_at: number }[]
  quoteIdSet: Set<string>
  quotes: { id: string; pubkey: string; created_at: number }[]
  highlightIdSet: Set<string>
  highlights: { id: string; pubkey: string; created_at: number }[]
  updatedAt?: number
}

class NoteStatsService {
  static instance: NoteStatsService
  private noteStatsMap: Map<string, Partial<TNoteStats>> = new Map()
  private noteStatsSubscribers = new Map<string, Set<() => void>>()
  private processingCache = new Set<string>()
  private lastProcessedTime = new Map<string, number>()
  
  // Batch processing
  private pendingEvents = new Set<string>()
  private batchTimeout: NodeJS.Timeout | null = null
  private readonly BATCH_DELAY = 1000 // 1 second batch delay
  private readonly MAX_BATCH_SIZE = 10 // Process up to 10 events at once

  constructor() {
    if (!NoteStatsService.instance) {
      NoteStatsService.instance = this
    }
    return NoteStatsService.instance
  }

  async fetchNoteStats(event: Event, _pubkey?: string | null, _favoriteRelays?: string[]) {
    const eventId = event.id
    
    // Rate limiting: Don't process the same event more than once per 10 seconds
    const now = Date.now()
    const lastProcessed = this.lastProcessedTime.get(eventId)
    if (lastProcessed && now - lastProcessed < 10000) {
      logger.debug('[NoteStats] Skipping duplicate fetch for event', eventId.substring(0, 8), 'too soon')
      return
    }
    
    // Add to batch processing queue
    this.pendingEvents.add(eventId)
    this.lastProcessedTime.set(eventId, now)
    
    // Clear existing timeout and set new one
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
    }
    
    this.batchTimeout = setTimeout(() => {
      this.processBatch()
    }, this.BATCH_DELAY)
    
    // If we have enough events or this is urgent, process immediately
    if (this.pendingEvents.size >= this.MAX_BATCH_SIZE) {
      this.processBatch()
    }
  }

  private async processBatch() {
    if (this.pendingEvents.size === 0) return
    
    const eventsToProcess = Array.from(this.pendingEvents).slice(0, this.MAX_BATCH_SIZE)
    this.pendingEvents.clear()
    
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }
    
    
    // Process all events in the batch
    await Promise.all(eventsToProcess.map(eventId => this.processSingleEvent(eventId)))
  }

  private async processSingleEvent(eventId: string) {
    if (this.processingCache.has(eventId)) {
      logger.debug('[NoteStats] Skipping concurrent fetch for event', eventId.substring(0, 8))
      return
    }
    
    this.processingCache.add(eventId)
    
    try {
      // Get the event from cache or fetch it
      const event = await eventService.fetchEvent(eventId)
      if (!event) {
        logger.debug('[NoteStats] Event not found:', eventId.substring(0, 8))
        return
      }

      const oldStats = this.noteStatsMap.get(eventId)
      let since: number | undefined
      if (oldStats?.updatedAt) {
        since = oldStats.updatedAt
      }

      // Use optimized relay selection - fewer relays, better performance
      const finalRelayUrls = this.getOptimizedRelayList()
      
      const replaceableCoordinate = isReplaceableEvent(event.kind)
        ? getReplaceableCoordinateFromEvent(event)
        : undefined

      const filters: Filter[] = this.buildFilters(event, replaceableCoordinate, since)

      const events: Event[] = []
      logger.debug('[NoteStats] Fetching stats for event', event.id.substring(0, 8), 'from', finalRelayUrls.length, 'relays')
      
      const { queryService } = await import('@/services/client.service')
      await queryService.fetchEvents(finalRelayUrls, filters, {
        onevent: (evt) => {
          this.updateNoteStatsByEvents([evt], event.pubkey)
          events.push(evt)
        }
      })
      
      logger.debug('[NoteStats] Fetched', events.length, 'events for stats')
      
      this.noteStatsMap.set(event.id, {
        ...(this.noteStatsMap.get(event.id) ?? {}),
        updatedAt: dayjs().unix()
      })
      
    } finally {
      this.processingCache.delete(eventId)
    }
  }

  private getOptimizedRelayList(): string[] {
    // Use only FAST_READ_RELAY_URLS for optimal performance
    const normalizedRelays = FAST_READ_RELAY_URLS
      .map(url => normalizeUrl(url))
      .filter((url): url is string => !!url)
      .slice(0, 2) // Limit to 2 relays for better performance and reduced load
    
    return Array.from(new Set(normalizedRelays))
  }

  private buildFilters(event: Event, replaceableCoordinate?: string, since?: number): Filter[] {
    const filters: Filter[] = [
      {
        '#e': [event.id],
        kinds: [kinds.Reaction, kinds.Repost, kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Highlights],
        limit: 50 // Reduced limit for better performance
      },
      {
        '#q': [event.id],
        kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
        limit: 50
      }
    ]

    if (replaceableCoordinate) {
      filters.push(
        {
          '#a': [replaceableCoordinate],
          kinds: [kinds.Reaction, kinds.Repost, kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Highlights],
          limit: 50
        },
        {
          '#q': [replaceableCoordinate],
          kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
          limit: 50
        }
      )
    }

    if (since) {
      filters.forEach((filter) => {
        filter.since = since
      })
    }

    return filters
  }


  subscribeNoteStats(noteId: string, callback: () => void) {
    let set = this.noteStatsSubscribers.get(noteId)
    if (!set) {
      set = new Set()
      this.noteStatsSubscribers.set(noteId, set)
    }
    set.add(callback)
    return () => {
      set?.delete(callback)
      if (set?.size === 0) this.noteStatsSubscribers.delete(noteId)
    }
  }

  private notifyNoteStats(noteId: string) {
    const set = this.noteStatsSubscribers.get(noteId)
    if (set) {
      set.forEach((cb) => cb())
    }
  }

  getNoteStats(id: string): Partial<TNoteStats> | undefined {
    return this.noteStatsMap.get(id)
  }

  addZap(
    pubkey: string,
    eventId: string,
    pr: string,
    amount: number,
    comment?: string,
    created_at: number = dayjs().unix(),
    notify: boolean = true
  ) {
    const old = this.noteStatsMap.get(eventId) || {}
    const zapPrSet = old.zapPrSet || new Set()
    const zaps = old.zaps || []
    if (zapPrSet.has(pr)) return

    zapPrSet.add(pr)
    zaps.push({ pr, pubkey, amount, comment, created_at })
    this.noteStatsMap.set(eventId, { ...old, zapPrSet, zaps })
    if (notify) {
      this.notifyNoteStats(eventId)
    }
    return eventId
  }

  /**
   * @param mergeOpts When the UI just published a single interaction, pass the note id the user acted on
   *   so stats merge even if `e` tag shape varies (extensions, multiple ancestors).
   */
  updateNoteStatsByEvents(
    events: Event[],
    originalEventAuthor?: string,
    mergeOpts?: {
      interactionTargetNoteId?: string
      replyParentNoteId?: string
    }
  ) {
    const updatedEventIdSet = new Set<string>()
    
    // Process events in batches for better performance
    const batchSize = 50
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize)
      batch.forEach((evt) => {
        const updatedEventId = this.processEvent(evt, originalEventAuthor, mergeOpts)
        if (updatedEventId) {
          updatedEventIdSet.add(updatedEventId)
        }
      })
    }
    
    updatedEventIdSet.forEach((eventId) => {
      this.notifyNoteStats(eventId)
    })
  }

  private processEvent(
    evt: Event,
    originalEventAuthor?: string,
    mergeOpts?: { interactionTargetNoteId?: string; replyParentNoteId?: string }
  ): string | undefined {
    let updatedEventId: string | undefined
    
    if (evt.kind === kinds.Reaction) {
      updatedEventId = this.addLikeByEvent(evt, originalEventAuthor, mergeOpts?.interactionTargetNoteId)
    } else if (evt.kind === kinds.Repost) {
      updatedEventId = this.addRepostByEvent(evt, originalEventAuthor, mergeOpts?.interactionTargetNoteId)
    } else if (evt.kind === kinds.Zap) {
      updatedEventId = this.addZapByEvent(evt, originalEventAuthor)
    } else if (evt.kind === kinds.ShortTextNote || evt.kind === ExtendedKind.COMMENT || evt.kind === ExtendedKind.VOICE_COMMENT) {
      const isQuote = this.isQuoteByEvent(evt)
      if (isQuote) {
        updatedEventId = this.addQuoteByEvent(evt, originalEventAuthor)
      } else if (mergeOpts?.replyParentNoteId) {
        updatedEventId = this.addReplyByEvent(evt, originalEventAuthor, mergeOpts.replyParentNoteId)
      } else {
        updatedEventId = this.addReplyByEvent(evt, originalEventAuthor)
      }
    } else if (evt.kind === kinds.Highlights) {
      updatedEventId = this.addHighlightByEvent(evt, originalEventAuthor)
    }
    
    return updatedEventId
  }

  private addLikeByEvent(evt: Event, originalEventAuthor?: string, forcedTargetEventId?: string) {
    const targetEventId = forcedTargetEventId ?? getFirstHexEventIdFromETags(evt.tags)
    if (!targetEventId) return

    const old = this.noteStatsMap.get(targetEventId) || {}
    const likeIdSet = old.likeIdSet || new Set()
    const likes = old.likes || []
    if (likeIdSet.has(evt.id)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    let emoji: TEmoji | string = evt.content.trim()
    if (!emoji) {
      const fromTags = getEmojiInfosFromEmojiTags(evt.tags)
      if (fromTags.length) {
        emoji = fromTags[0]
      } else {
        emoji = '+'
      }
    }

    if (typeof emoji === 'string' && emoji.startsWith(':') && emoji.endsWith(':')) {
      const emojiInfos = getEmojiInfosFromEmojiTags(evt.tags)
      const shortcode = emoji.split(':')[1]
      const emojiInfo = emojiInfos.find((info) => info.shortcode === shortcode)
      if (emojiInfo) {
        emoji = emojiInfo
      } else {
        emoji = '+'
      }
    }

    likeIdSet.add(evt.id)
    likes.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, emoji })
    this.noteStatsMap.set(targetEventId, { ...old, likeIdSet, likes })
    return targetEventId
  }

  removeLike(eventId: string, reactionEventId: string) {
    const old = this.noteStatsMap.get(eventId) || {}
    const likeIdSet = old.likeIdSet || new Set()
    const likes = old.likes || []
    
    if (!likeIdSet.has(reactionEventId)) return eventId

    likeIdSet.delete(reactionEventId)
    const newLikes = likes.filter(like => like.id !== reactionEventId)
    this.noteStatsMap.set(eventId, { ...old, likeIdSet, likes: newLikes })
    this.notifyNoteStats(eventId)
    return eventId
  }

  private addRepostByEvent(evt: Event, originalEventAuthor?: string, forcedTargetEventId?: string) {
    const eventId = forcedTargetEventId ?? getFirstHexEventIdFromETags(evt.tags)
    if (!eventId) return

    const old = this.noteStatsMap.get(eventId) || {}
    const repostPubkeySet = old.repostPubkeySet || new Set()
    const reposts = old.reposts || []
    if (repostPubkeySet.has(evt.pubkey)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    repostPubkeySet.add(evt.pubkey)
    reposts.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at })
    this.noteStatsMap.set(eventId, { ...old, repostPubkeySet, reposts })
    return eventId
  }

  private addZapByEvent(evt: Event, originalEventAuthor?: string) {
    const info = getZapInfoFromEvent(evt)
    if (!info) return
    const { originalEventId, senderPubkey, invoice, amount, comment } = info
    if (!originalEventId || !senderPubkey) return

    if (originalEventAuthor && originalEventAuthor === senderPubkey) {
      return
    }

    return this.addZap(
      senderPubkey,
      originalEventId,
      invoice,
      amount,
      comment,
      evt.created_at,
      false
    )
  }

  private addReplyByEvent(evt: Event, originalEventAuthor?: string, forcedOriginalEventId?: string) {
    let originalEventId: string | undefined = forcedOriginalEventId

    if (!originalEventId) {
      if (evt.kind === ExtendedKind.COMMENT || evt.kind === ExtendedKind.VOICE_COMMENT) {
        const eTag = evt.tags.find(tagNameEquals('e')) ?? evt.tags.find(tagNameEquals('E'))
        originalEventId = eTag?.[1]
      } else if (evt.kind === kinds.ShortTextNote) {
        const parentETag = evt.tags.find(([tagName, , , marker]) => {
          return tagName === 'e' && (marker === 'reply' || marker === 'root')
        })
        if (parentETag) {
          originalEventId = parentETag[1]
        } else {
          const lastETag = evt.tags.findLast(
            ([tagName, tagValue, , marker]) =>
              tagName === 'e' &&
              !!tagValue &&
              marker !== 'mention'
          )
          if (lastETag) {
            originalEventId = lastETag[1]
          }
        }

        if (!originalEventId) {
          const aTag = evt.tags.find(tagNameEquals('a'))
          if (aTag) {
            originalEventId = aTag[1]
          }
        }
      }
    }

    if (!originalEventId) return

    const old = this.noteStatsMap.get(originalEventId) || {}
    const replyIdSet = old.replyIdSet || new Set()
    const replies = old.replies || []

    if (replyIdSet.has(evt.id)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    replyIdSet.add(evt.id)
    replies.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at })
    this.noteStatsMap.set(originalEventId, { ...old, replyIdSet, replies })
    return originalEventId
  }

  private isQuoteByEvent(evt: Event): boolean {
    return evt.tags.some(tag => tag[0] === 'q' && tag[1])
  }

  private addQuoteByEvent(evt: Event, originalEventAuthor?: string) {
    const quotedEventId = evt.tags.find(tag => tag[0] === 'q')?.[1]
    if (!quotedEventId) return

    const old = this.noteStatsMap.get(quotedEventId) || {}
    const quoteIdSet = old.quoteIdSet || new Set()
    const quotes = old.quotes || []

    if (quoteIdSet.has(evt.id)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    quoteIdSet.add(evt.id)
    quotes.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at })
    this.noteStatsMap.set(quotedEventId, { ...old, quoteIdSet, quotes })
    return quotedEventId
  }

  private addHighlightByEvent(evt: Event, originalEventAuthor?: string) {
    const highlightedEventId = evt.tags.find(tag => tag[0] === 'e')?.[1]
    if (!highlightedEventId) return

    const old = this.noteStatsMap.get(highlightedEventId) || {}
    const highlightIdSet = old.highlightIdSet || new Set()
    const highlights = old.highlights || []

    if (highlightIdSet.has(evt.id)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    highlightIdSet.add(evt.id)
    highlights.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at })
    this.noteStatsMap.set(highlightedEventId, { ...old, highlightIdSet, highlights })
    return highlightedEventId
  }
}

const instance = new NoteStatsService()

export default instance
