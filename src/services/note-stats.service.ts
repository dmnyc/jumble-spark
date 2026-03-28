import {
  E_TAG_FILTER_BLOCKED_RELAY_URLS,
  ExtendedKind,
  FAST_READ_RELAY_URLS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import {
  getParentEventHexId,
  getReplaceableCoordinateFromEvent,
  isNip18RepostKind,
  isReplaceableEvent
} from '@/lib/event'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import {
  canonicalizeRssArticleUrl,
  expandArticleUrlThreadQueryValues,
  getArticleUrlFromCommentITags,
  getHighlightSourceHttpUrl,
  getReactionPageUrlFromRTags,
  getWebBookmarkArticleUrl,
  getWebExternalReactionTargetUrl,
  rssArticleStableEventId
} from '@/lib/rss-article'
import { getEmojiInfosFromEmojiTags, getFirstHexEventIdFromETags, tagNameEquals } from '@/lib/tag'
import { normalizeUrl } from '@/lib/url'
import client, { eventService } from '@/services/client.service'
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
  /** Pubkeys whose NIP-51 bookmark list includes this note id (`e` tag). */
  bookmarkPubkeySet?: Set<string>
  updatedAt?: number
}

class NoteStatsService {
  static instance: NoteStatsService
  private noteStatsMap: Map<string, Partial<TNoteStats>> = new Map()
  private noteStatsSubscribers = new Map<string, Set<() => void>>()
  private processingCache = new Set<string>()

  // Batch processing
  private pendingEvents = new Set<string>()
  /** Favorite relays passed from the last fetchNoteStats call per note (used in processSingleEvent). */
  private pendingFetchFavoriteRelays = new Map<string, string[] | null | undefined>()
  /** Merged favorite URLs requested while this note was already in {@link processingCache}. */
  private inFlightDeferredFavoriteRelays = new Map<string, string[]>()
  private batchTimeout: NodeJS.Timeout | null = null
  /** Prevents overlapping processBatch runs (reentrant calls corrupted pendingEvents). */
  private processBatchRunning = false
  private readonly BATCH_DELAY = 200
  private readonly MAX_BATCH_SIZE = 24
  /** Client-only RSS/Web thread roots are not on relays; use the event passed into {@link fetchNoteStats}. */
  private pendingSyntheticRootById = new Map<string, Event>()

  constructor() {
    if (!NoteStatsService.instance) {
      NoteStatsService.instance = this
    }
    return NoteStatsService.instance
  }

  /** Merge extra relay URLs into the pending fetch context for this note (deduped). */
  private mergeFavoriteRelaysIntoPending(eventId: string, extra: string[] | null | undefined) {
    if (!extra?.length) return
    const cur = this.pendingFetchFavoriteRelays.get(eventId)
    const merged = new Set<string>([...(cur ?? []), ...extra])
    this.pendingFetchFavoriteRelays.set(eventId, [...merged])
  }

  private mergeFavoriteRelaysIntoDeferred(eventId: string, extra: string[] | null | undefined) {
    if (!extra?.length) return
    const cur = this.inFlightDeferredFavoriteRelays.get(eventId)
    const merged = new Set<string>([...(cur ?? []), ...extra])
    this.inFlightDeferredFavoriteRelays.set(eventId, [...merged])
  }

  private armStatsBatchTimer() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
    }
    this.batchTimeout = setTimeout(() => {
      this.batchTimeout = null
      void this.processBatch()
    }, this.BATCH_DELAY)
  }

  async fetchNoteStats(event: Event, _pubkey?: string | null, favoriteRelays?: string[] | null) {
    const eventId = event.id

    if (this.pendingEvents.has(eventId)) {
      this.mergeFavoriteRelaysIntoPending(eventId, favoriteRelays)
      return
    }

    if (this.processingCache.has(eventId)) {
      this.mergeFavoriteRelaysIntoDeferred(eventId, favoriteRelays)
      return
    }

    this.pendingFetchFavoriteRelays.set(eventId, favoriteRelays ?? null)
    this.pendingEvents.add(eventId)
    if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
      this.pendingSyntheticRootById.set(eventId, event)
    }

    this.armStatsBatchTimer()
    if (this.pendingEvents.size >= this.MAX_BATCH_SIZE && !this.processBatchRunning) {
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout)
        this.batchTimeout = null
      }
      void this.processBatch()
    }
  }

  private async processBatch() {
    if (this.processBatchRunning) {
      return
    }
    if (this.pendingEvents.size === 0) {
      return
    }

    this.processBatchRunning = true
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }

    try {
      while (this.pendingEvents.size > 0) {
        const eventsToProcess = Array.from(this.pendingEvents).slice(0, this.MAX_BATCH_SIZE)
        for (const id of eventsToProcess) {
          this.pendingEvents.delete(id)
        }
        await Promise.all(eventsToProcess.map((eventId) => this.processSingleEvent(eventId)))
      }
    } finally {
      this.processBatchRunning = false
      if (this.pendingEvents.size > 0) {
        this.armStatsBatchTimer()
      }
    }
  }

  private async processSingleEvent(eventId: string) {
    if (this.processingCache.has(eventId)) {
      logger.debug('[NoteStats] Skipping concurrent fetch for event', eventId.substring(0, 8))
      return
    }
    
    this.processingCache.add(eventId)

    const favoriteRelays = this.pendingFetchFavoriteRelays.get(eventId)
    this.pendingFetchFavoriteRelays.delete(eventId)

    try {
      // Synthetic RSS/Web thread parents are not published; use the instance from fetchNoteStats.
      const synthetic = this.pendingSyntheticRootById.get(eventId)
      this.pendingSyntheticRootById.delete(eventId)
      const event = synthetic ?? (await eventService.fetchEvent(eventId))
      if (!event) {
        logger.debug('[NoteStats] Event not found:', eventId.substring(0, 8))
        return
      }

      const finalRelayUrls = await this.buildNoteStatsRelayList(event, favoriteRelays)
      
      const replaceableCoordinate = isReplaceableEvent(event.kind)
        ? getReplaceableCoordinateFromEvent(event)
        : undefined

      const { nonSocial, social } = this.buildFilterGroups(event, replaceableCoordinate)
      const fetchOpts = {
        eoseTimeout: 10_000,
        globalTimeout: 28_000,
        firstRelayResultGraceMs: false as const
      }

      const events: Event[] = []
      logger.debug('[NoteStats] Fetching stats for event', event.id.substring(0, 8), 'from', finalRelayUrls.length, 'relays')

      const { queryService } = await import('@/services/client.service')
      const onStatsEvent = (evt: Event) => {
        this.updateNoteStatsByEvents([evt], event.pubkey)
        events.push(evt)
      }
      if (nonSocial.length > 0) {
        await queryService.fetchEvents(finalRelayUrls, nonSocial, {
          ...fetchOpts,
          onevent: onStatsEvent
        })
      }
      if (social.length > 0) {
        await queryService.fetchEvents(finalRelayUrls, social, {
          ...fetchOpts,
          onevent: onStatsEvent
        })
      }
      
      logger.debug('[NoteStats] Fetched', events.length, 'events for stats')

      this.noteStatsMap.set(event.id, {
        ...(this.noteStatsMap.get(event.id) ?? {}),
        updatedAt: dayjs().unix()
      })
      // Always notify: when relays return 0 rows, no updateNoteStatsByEvents ran — subscribers would never re-render.
      this.notifyNoteStats(event.id)
    } finally {
      this.processingCache.delete(eventId)
      if (this.inFlightDeferredFavoriteRelays.has(eventId)) {
        const deferred = this.inFlightDeferredFavoriteRelays.get(eventId)!
        this.inFlightDeferredFavoriteRelays.delete(eventId)
        if (deferred.length > 0) {
          if (this.pendingEvents.has(eventId)) {
            this.mergeFavoriteRelaysIntoPending(eventId, deferred)
          } else {
            this.pendingFetchFavoriteRelays.set(eventId, deferred)
            this.pendingEvents.add(eventId)
          }
        }
      }
    }
  }

  /**
   * Build relay list for note stats: SEARCHABLE + FAST_READ + optional user favorites + seen relays + author NIP-65 read (slice 10).
   * Excludes E_TAG_FILTER_BLOCKED_RELAY_URLS (stats use #e filters).
   */
  private async buildNoteStatsRelayList(event: Event, favoriteRelays?: string[] | null): Promise<string[]> {
    const blocked = new Set(
      E_TAG_FILTER_BLOCKED_RELAY_URLS.map((u) => (normalizeUrl(u) || u).toLowerCase()).filter(Boolean)
    )
    const seen = new Set<string>()

    const add = (url: string | undefined) => {
      if (!url) return
      const n = normalizeUrl(url)
      if (!n || blocked.has(n.toLowerCase()) || seen.has(n)) return
      seen.add(n)
    }

    // 1. Broad search index / aggregator relays
    SEARCHABLE_RELAY_URLS.forEach(add)

    // 2. Default fast read set (includes e.g. theforest — not in SEARCHABLE)
    FAST_READ_RELAY_URLS.forEach(add)

    // 3. User's favorite relays (spell feed / sidebar) — was previously ignored
    favoriteRelays?.forEach(add)

    // 4. Relay(s) where the event was seen
    client.getSeenEventRelayUrls(event.id).forEach(add)

    // 5. Author's inboxes (read relays from kind 10002)
    try {
      const relayList = await Promise.race([
        client.fetchRelayList(event.pubkey),
        new Promise<{ read?: string[] }>((r) => setTimeout(() => r({}), 2000))
      ])
      ;(relayList?.read ?? []).slice(0, 10).forEach(add)
    } catch {
      // ignore
    }

    return Array.from(seen)
  }

  /**
   * Split REQ batches so “social” kinds (1 / 11 / 1111) do not strip aggregator relays from the
   * same subscription as reactions and zaps ({@link relayFilterIncludesSocialKindBlockedKind}).
   * RSS URL threads also need `#r` + kind 7 for NIP-73 page-targeted likes.
   */
  private buildFilterGroups(
    event: Event,
    replaceableCoordinate?: string
  ): { nonSocial: Filter[]; social: Filter[] } {
    const reactionLimit = 300
    const interactionLimit = 80
    const nip18RepostKinds = [kinds.Repost, ExtendedKind.GENERIC_REPOST]

    /** Synthetic RSS/Web parents are not on relays; `#e` on the fake id returns nothing. Use only URL-scoped filters. */
    if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
      const url = getArticleUrlFromCommentITags(event)
      if (!url) {
        return { nonSocial: [], social: [] }
      }
      const canonical = canonicalizeRssArticleUrl(url)
      const tagVals = expandArticleUrlThreadQueryValues(canonical)
      const iVals = tagVals.length > 0 ? tagVals : [canonical]
      const nonSocial: Filter[] = [
        { '#i': iVals, kinds: [ExtendedKind.EXTERNAL_REACTION], limit: reactionLimit },
        { '#I': iVals, kinds: [ExtendedKind.EXTERNAL_REACTION], limit: reactionLimit },
        { '#i': iVals, kinds: [ExtendedKind.WEB_BOOKMARK], limit: 200 },
        { '#I': iVals, kinds: [ExtendedKind.WEB_BOOKMARK], limit: 200 }
      ]
      if (tagVals.length > 0) {
        nonSocial.push(
          { '#r': tagVals, kinds: [kinds.Highlights], limit: interactionLimit },
          { '#r': tagVals, kinds: [kinds.Reaction], limit: reactionLimit }
        )
      }
      const social: Filter[] = [
        { '#i': iVals, kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT], limit: interactionLimit },
        { '#I': iVals, kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT], limit: interactionLimit }
      ]
      return { nonSocial, social }
    }

    const nonSocial: Filter[] = [
      { '#e': [event.id], kinds: [kinds.Reaction], limit: reactionLimit },
      { '#e': [event.id], kinds: [kinds.Zap], limit: 100 }
    ]

    const social: Filter[] = [
      {
        '#e': [event.id],
        kinds: [
          ...nip18RepostKinds,
          kinds.ShortTextNote,
          ExtendedKind.COMMENT,
          ExtendedKind.VOICE_COMMENT,
          kinds.Highlights
        ],
        limit: interactionLimit
      },
      {
        '#q': [event.id],
        kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
        limit: 50
      }
    ]

    if (replaceableCoordinate) {
      nonSocial.push(
        { '#a': [replaceableCoordinate], kinds: [kinds.Reaction], limit: reactionLimit },
        { '#a': [replaceableCoordinate], kinds: [kinds.Zap], limit: 100 }
      )
      social.push(
        {
          '#a': [replaceableCoordinate],
          kinds: [
            ...nip18RepostKinds,
            kinds.ShortTextNote,
            ExtendedKind.COMMENT,
            ExtendedKind.VOICE_COMMENT,
            kinds.Highlights
          ],
          limit: interactionLimit
        },
        {
          '#q': [replaceableCoordinate],
          kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
          limit: 50
        }
      )
    }

    return { nonSocial, social }
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
    } else if (evt.kind === ExtendedKind.EXTERNAL_REACTION) {
      updatedEventId = this.addLikeByExternalWebReactionEvent(
        evt,
        originalEventAuthor,
        mergeOpts?.interactionTargetNoteId
      )
    } else if (isNip18RepostKind(evt.kind)) {
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
    } else if (evt.kind === ExtendedKind.WEB_BOOKMARK) {
      updatedEventId = this.addWebBookmarkByArticleUrlEvent(evt)
    } else if (evt.kind === kinds.BookmarkList) {
      this.addBookmarkListRefsByEvent(evt)
    }
    
    return updatedEventId
  }

  private reactionEmojiFromEvent(evt: Event): TEmoji | string {
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
        const customCodes = emojiInfos.map((e) => e.shortcode)
        const normalized = replaceStandardEmojiShortcodesInContent(emoji, customCodes)
        if (normalized !== emoji) {
          emoji = normalized
        }
        // else keep `:custom:` string; UI resolves via reactor profile (ReactionEmojiDisplay)
      }
    }

    return emoji
  }

  private addLikeByEvent(evt: Event, originalEventAuthor?: string, forcedTargetEventId?: string) {
    let targetEventId = forcedTargetEventId ?? getFirstHexEventIdFromETags(evt.tags)
    if (!targetEventId && evt.kind === kinds.Reaction) {
      const pageUrl = getReactionPageUrlFromRTags(evt)
      if (pageUrl) {
        targetEventId = rssArticleStableEventId(canonicalizeRssArticleUrl(pageUrl))
      }
    }
    if (!targetEventId) return

    const old = this.noteStatsMap.get(targetEventId) || {}
    const likeIdSet = old.likeIdSet || new Set()
    const likes = old.likes || []
    if (likeIdSet.has(evt.id)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    const emoji = this.reactionEmojiFromEvent(evt)

    likeIdSet.add(evt.id)
    likes.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, emoji })
    this.noteStatsMap.set(targetEventId, { ...old, likeIdSet, likes })
    return targetEventId
  }

  /** NIP-25 kind 17 reactions to http(s) URLs; stats key matches synthetic RSS thread root id. */
  private addLikeByExternalWebReactionEvent(
    evt: Event,
    originalEventAuthor?: string,
    forcedTargetEventId?: string
  ) {
    const url = getWebExternalReactionTargetUrl(evt)
    if (!url) return

    const targetEventId =
      forcedTargetEventId ?? rssArticleStableEventId(canonicalizeRssArticleUrl(url))

    const old = this.noteStatsMap.get(targetEventId) || {}
    const likeIdSet = old.likeIdSet || new Set()
    const likes = old.likes || []
    if (likeIdSet.has(evt.id)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    const emoji = this.reactionEmojiFromEvent(evt)

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

  private repostStatsTargetId(evt: Event, forcedTargetEventId?: string): string | undefined {
    const forced = forcedTargetEventId?.trim()
    if (forced) return forced
    const hex = getFirstHexEventIdFromETags(evt.tags)
    if (hex) return hex.toLowerCase()
    if (evt.kind === ExtendedKind.GENERIC_REPOST) {
      const aTag = evt.tags.find(tagNameEquals('a')) ?? evt.tags.find(tagNameEquals('A'))
      const coord = aTag?.[1]?.trim()
      if (coord) return coord
      const raw = evt.content?.trim()
      if (raw) {
        try {
          const embedded = JSON.parse(raw) as { id?: string }
          if (embedded.id && /^[0-9a-f]{64}$/i.test(embedded.id)) {
            return embedded.id.toLowerCase()
          }
        } catch {
          /* ignore */
        }
      }
    }
    return undefined
  }

  private addRepostByEvent(evt: Event, originalEventAuthor?: string, forcedTargetEventId?: string) {
    const eventId = this.repostStatsTargetId(evt, forcedTargetEventId)
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
    if (!amount || amount <= 0) return // Suppress 0 sat zaps (spam)

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
        if (!originalEventId) {
          const scopeUrl = getArticleUrlFromCommentITags(evt)
          if (scopeUrl) {
            originalEventId = rssArticleStableEventId(canonicalizeRssArticleUrl(scopeUrl))
          }
        }
      } else if (evt.kind === kinds.ShortTextNote) {
        // Prefer NIP-10 reply parent (matches getParentETag), not the first of reply|root in tag order.
        const parentHex = getParentEventHexId(evt)
        if (parentHex && /^[0-9a-f]{64}$/i.test(parentHex)) {
          originalEventId = parentHex.toLowerCase()
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
    let highlightedEventId = evt.tags.find((tag) => tag[0] === 'e')?.[1]
    if (!highlightedEventId) {
      const pageUrl = getHighlightSourceHttpUrl(evt)
      if (pageUrl) {
        highlightedEventId = rssArticleStableEventId(canonicalizeRssArticleUrl(pageUrl))
      }
    }
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

  /** Kind 39701: count one bookmark per pubkey for this article URL (synthetic thread id). */
  private addWebBookmarkByArticleUrlEvent(evt: Event): string | undefined {
    const url = getWebBookmarkArticleUrl(evt)
    if (!url) return
    const targetId = rssArticleStableEventId(canonicalizeRssArticleUrl(url))
    const old = this.noteStatsMap.get(targetId) || {}
    const bookmarkPubkeySet = old.bookmarkPubkeySet ?? new Set<string>()
    if (bookmarkPubkeySet.has(evt.pubkey)) return targetId
    bookmarkPubkeySet.add(evt.pubkey)
    this.noteStatsMap.set(targetId, { ...old, bookmarkPubkeySet })
    this.notifyNoteStats(targetId)
    return targetId
  }

  /** Each bookmark list author counts once per target `e` id in that list. */
  private addBookmarkListRefsByEvent(evt: Event) {
    for (const tag of evt.tags) {
      if (tag[0] !== 'e' || !tag[1]) continue
      const targetId = tag[1]
      const old = this.noteStatsMap.get(targetId) || {}
      const bookmarkPubkeySet = old.bookmarkPubkeySet ?? new Set<string>()
      if (bookmarkPubkeySet.has(evt.pubkey)) continue
      bookmarkPubkeySet.add(evt.pubkey)
      this.noteStatsMap.set(targetId, { ...old, bookmarkPubkeySet })
      this.notifyNoteStats(targetId)
    }
  }
}

const instance = new NoteStatsService()

export default instance
