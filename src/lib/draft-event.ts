import { EMBEDDED_EVENT_REGEX, ExtendedKind, POLL_TYPE } from '@/constants'
import client from '@/services/client.service'
import { eventService } from '@/services/client.service'
import customEmojiService from '@/services/custom-emoji.service'
import mediaUpload from '@/services/media-upload.service'
import { prefixNostrAddresses } from '@/lib/nostr-address'
import { normalizeHashtag, normalizeTopic } from '@/lib/discussion-topics'
import logger from '@/lib/logger'
import {
  TDraftEvent,
  TEmoji,
  TMailboxRelay,
  TMailboxRelayScope,
  TPollCreateData,
  TRelaySet
} from '@/types'
import { sha256 } from '@noble/hashes/sha256'
import dayjs from 'dayjs'
import { Event, kinds, nip19 } from 'nostr-tools'
import {
  getReplaceableCoordinate,
  getReplaceableCoordinateFromEvent,
  getRootETag,
  isProtectedEvent,
  isReplaceableEvent,
  resolveDeclaredThreadRootEventHex
} from './event'
import {
  canonicalizeRssArticleUrl,
  getArticleUrlFromCommentITags,
  NIP22_URL_SCOPE_KIND
} from '@/lib/rss-article'
import { cleanUrl } from '@/lib/url'
import { urlToWebBookmarkDTag } from '@/lib/web-bookmark-nip'
import { randomString } from './random'
import { generateBech32IdFromETag, tagNameEquals } from './tag'

function canonicalizeHttpUrlForITags(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url
  return canonicalizeRssArticleUrl(url)
}

const draftEventCache: Map<string, string> = new Map()

export function deleteDraftEventCache(draftEvent: TDraftEvent) {
  const key = generateDraftEventCacheKey(draftEvent)
  draftEventCache.delete(key)
}

function setDraftEventCache(baseDraft: Omit<TDraftEvent, 'created_at'>): TDraftEvent {
  const cacheKey = generateDraftEventCacheKey(baseDraft)
  const cache = draftEventCache.get(cacheKey)
  if (cache) {
    return JSON.parse(cache)
  }
  const draftEvent = { ...baseDraft, created_at: dayjs().unix() }
  draftEventCache.set(cacheKey, JSON.stringify(draftEvent))

  return draftEvent
}

function generateDraftEventCacheKey(draft: Omit<TDraftEvent, 'created_at'>) {
  const str = JSON.stringify({
    content: draft.content,
    kind: draft.kind,
    tags: draft.tags
  })

  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = sha256(data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// https://github.com/nostr-protocol/nips/blob/master/25.md
export function createReactionDraftEvent(event: Event, emoji: TEmoji | string = '+'): TDraftEvent {
  let content: string
  const tags: string[][] = []

  if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
    const rawUrl = getArticleUrlFromCommentITags(event)
    if (!rawUrl || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
      throw new Error('RSS thread root is missing a valid http(s) article URL for reactions')
    }
    const canonical = canonicalizeRssArticleUrl(rawUrl)
    tags.push(['k', NIP22_URL_SCOPE_KIND], ['i', canonical])
    if (typeof emoji === 'string') {
      content = emoji
    } else {
      content = `:${emoji.shortcode}:`
      tags.push(buildEmojiTag(emoji))
    }
    return {
      kind: ExtendedKind.EXTERNAL_REACTION,
      content,
      tags,
      created_at: dayjs().unix()
    }
  }

  tags.push(buildETag(event.id, event.pubkey))
  tags.push(buildPTag(event.pubkey))
  if (event.kind !== kinds.ShortTextNote) {
    tags.push(buildKTag(event.kind))
  }

  if (isReplaceableEvent(event.kind)) {
    tags.push(buildATag(event))
  }

  if (typeof emoji === 'string') {
    content = emoji
  } else {
    content = `:${emoji.shortcode}:`
    tags.push(buildEmojiTag(emoji))
  }

  return {
    kind: kinds.Reaction,
    content,
    tags,
    created_at: dayjs().unix()
  }
}

/**
 * NIP-18 boost / repost.
 * - Kind **6** (`kinds.Repost`): only for reposting **kind 1** (short notes).
 * - Kind **16** (`ExtendedKind.GENERIC_REPOST`): for every other kind — e.g. zaps (9735), reactions (7),
 *   comments (1111), long-form, etc. Requires a **`k`** tag with the stringified target kind.
 * So boosting a zap receipt always creates **kind 16** with `k` = `"9735"`.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/18.md
 */
export function createRepostDraftEvent(event: Event): TDraftEvent {
  const isProtected = isProtectedEvent(event)
  const tags: string[][] = [buildETag(event.id, event.pubkey), buildPTag(event.pubkey)]

  if (isReplaceableEvent(event.kind)) {
    tags.push(buildATag(event))
  }

  const useGenericRepost = event.kind !== kinds.ShortTextNote
  if (useGenericRepost) {
    tags.push(['k', String(event.kind)])
  }

  return {
    kind: useGenericRepost ? ExtendedKind.GENERIC_REPOST : kinds.Repost,
    content: isProtected ? '' : JSON.stringify(event),
    tags,
    created_at: dayjs().unix()
  }
}

export async function createShortTextNoteDraftEvent(
  content: string,
  mentions: string[],
  options: {
    parentEvent?: Event
    addClientTag?: boolean
    protectedEvent?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  } = {}
): Promise<TDraftEvent> {
  // Process content to prefix nostr addresses before other transformations
  const contentWithPrefixedAddresses = prefixNostrAddresses(content)
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(contentWithPrefixedAddresses)
  const { quoteEventHexIds, quoteReplaceableCoordinates, rootETag, parentETag } =
    await extractRelatedEventIds(transformedEmojisContent, options.parentEvent)
  const hashtags = extractHashtags(transformedEmojisContent)

  const tags = emojiTags.concat(hashtags.map((hashtag) => buildTTag(hashtag)))

  // imeta tags
  const images = extractImagesFromContent(transformedEmojisContent)
  if (images && images.length) {
    tags.push(...generateImetaTags(images))
  }

  // q tags
  tags.push(...quoteEventHexIds.map((eventId) => buildQTag(eventId)))
  tags.push(...quoteReplaceableCoordinates.map((coordinate) => buildReplaceableQTag(coordinate)))

  // e tags
  if (rootETag.length) {
    tags.push(rootETag)
  }

  if (parentETag.length) {
    tags.push(parentETag)
  }

  // p tags
  tags.push(...mentions.map((pubkey) => buildPTag(pubkey)))

  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }

  if (options.protectedEvent) {
    tags.push(buildProtectedTag())
  }

  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }

  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }

  const baseDraft = {
    kind: kinds.ShortTextNote,
    content: transformedEmojisContent,
    tags
  }
  return setDraftEventCache(baseDraft)
}

// https://github.com/nostr-protocol/nips/blob/master/51.md
export function createRelaySetDraftEvent(relaySet: Omit<TRelaySet, 'aTag'>): TDraftEvent {
  return {
    kind: kinds.Relaysets,
    content: '',
    tags: [
      buildDTag(relaySet.id),
      buildTitleTag(relaySet.name),
      ...relaySet.relayUrls.map((url) => buildRelayTag(url))
    ],
    created_at: dayjs().unix()
  }
}


export async function createCommentDraftEvent(
  content: string,
  parentEvent: Event,
  mentions: string[],
  options: {
    addClientTag?: boolean
    protectedEvent?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  } = {}
): Promise<TDraftEvent> {
  // Process content to prefix nostr addresses before other transformations
  const contentWithPrefixedAddresses = prefixNostrAddresses(content)
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(contentWithPrefixedAddresses)
  const {
    quoteEventHexIds,
    quoteReplaceableCoordinates,
    rootEventId,
    rootCoordinateTag,
    rootKind,
    rootPubkey,
    rootUrl
  } = await extractCommentMentions(transformedEmojisContent, parentEvent)
  const hashtags = extractHashtags(transformedEmojisContent)

  const tags = emojiTags
    .concat(hashtags.map((hashtag) => buildTTag(hashtag)))
    .concat(quoteEventHexIds.map((eventId) => buildQTag(eventId)))
    .concat(quoteReplaceableCoordinates.map((coordinate) => buildReplaceableQTag(coordinate)))

  const images = extractImagesFromContent(transformedEmojisContent)
  if (images && images.length) {
    tags.push(...generateImetaTags(images))
  }

  tags.push(
    ...mentions.filter((pubkey) => pubkey !== parentEvent.pubkey).map((pubkey) => buildPTag(pubkey))
  )

  const isRssArticleThreadRoot = parentEvent.kind === ExtendedKind.RSS_THREAD_ROOT
  const rssArticleUrl = isRssArticleThreadRoot
    ? rootUrl || parentEvent.tags.find((t) => t[0] === 'i' || t[0] === 'I')?.[1]
    : undefined

  if (isRssArticleThreadRoot) {
    if (rssArticleUrl) {
      const u = canonicalizeHttpUrlForITags(rssArticleUrl)
      tags.push(buildITag(u, true), buildITag(u, false))
      const scopeKind = rootKind ?? NIP22_URL_SCOPE_KIND
      tags.push(buildKTag(scopeKind, true), buildKTag(scopeKind))
    }
  } else {
    if (rootCoordinateTag) {
      tags.push(rootCoordinateTag)
    } else if (rootEventId) {
      tags.push(buildETag(rootEventId, rootPubkey, '', true))
    }
    if (rootPubkey) {
      tags.push(buildPTag(rootPubkey, true))
    }
    if (rootKind) {
      tags.push(buildKTag(rootKind, true))
    }
    if (rootUrl) {
      const u = canonicalizeHttpUrlForITags(rootUrl)
      tags.push(buildITag(u, true), buildITag(u, false))
    }
    tags.push(
      ...[
        isReplaceableEvent(parentEvent.kind)
          ? buildATag(parentEvent)
          : buildETag(parentEvent.id, parentEvent.pubkey),
        buildKTag(parentEvent.kind),
        buildPTag(parentEvent.pubkey)
      ]
    )
  }

  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }

  if (options.protectedEvent) {
    tags.push(buildProtectedTag())
  }

  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }

  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }

  const baseDraft = {
    kind: ExtendedKind.COMMENT,
    content: transformedEmojisContent,
    tags
  }

  return setDraftEventCache(baseDraft)
}

export async function createPublicMessageReplyDraftEvent(
  content: string,
  parentEvent: Event,
  mentions: string[],
  options: {
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
    mediaImetaTags?: string[][] // Allow media imeta tags for audio/video
  } = {}
): Promise<TDraftEvent> {
  // Process content to prefix nostr addresses before other transformations
  const contentWithPrefixedAddresses = prefixNostrAddresses(content)
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(contentWithPrefixedAddresses)
  const {
    quoteEventHexIds,
    quoteReplaceableCoordinates
  } = await extractCommentMentions(transformedEmojisContent, parentEvent)
  const hashtags = extractHashtags(transformedEmojisContent)

  const tags = emojiTags
    .concat(hashtags.map((hashtag) => buildTTag(hashtag)))
    .concat(quoteEventHexIds.map((eventId) => buildQTag(eventId)))
    .concat(quoteReplaceableCoordinates.map((coordinate) => buildReplaceableQTag(coordinate)))

  // Add media imeta tags if provided (for audio/video)
  if (options.mediaImetaTags && options.mediaImetaTags.length > 0) {
    tags.push(...options.mediaImetaTags)
  }

  const images = extractImagesFromContent(transformedEmojisContent)
  if (images && images.length) {
    tags.push(...generateImetaTags(images))
  }

  // For kind 24 replies, we use 'q' tag for the parent event (as per NIP-A4)
  tags.push(buildQTag(parentEvent.id))

  // Add 'p' tags for recipients (original sender and any mentions)
  const recipients = new Set([parentEvent.pubkey])
  mentions.forEach(pubkey => recipients.add(pubkey))
  
  // console.log('🔧 Creating public message reply draft:', {
  //   parentEventId: parentEvent.id,
  //   parentEventPubkey: parentEvent.pubkey,
  //   mentions,
  //   recipients: Array.from(recipients),
  //   finalTags: tags.length
  // })
  
  tags.push(
    ...Array.from(recipients).map((pubkey) => buildPTag(pubkey))
  )

  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }

  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }

  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }

  // console.log('📝 Final public message reply draft tags:', {
  //   pTags: tags.filter(tag => tag[0] === 'p'),
  //   qTags: tags.filter(tag => tag[0] === 'q'),
  //   allTags: tags
  // })

  const baseDraft = {
    kind: ExtendedKind.PUBLIC_MESSAGE,
    content: transformedEmojisContent,
    tags
  }

  return setDraftEventCache(baseDraft)
}

export async function createPublicMessageDraftEvent(
  content: string,
  recipients: string[],
  options: {
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
    mediaImetaTags?: string[][] // Allow media imeta tags for audio/video
  } = {}
): Promise<TDraftEvent> {
  // Process content to prefix nostr addresses before other transformations
  const contentWithPrefixedAddresses = prefixNostrAddresses(content)
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(contentWithPrefixedAddresses)
  const hashtags = extractHashtags(transformedEmojisContent)

  const tags = emojiTags
    .concat(hashtags.map((hashtag) => buildTTag(hashtag)))

  // Add media imeta tags if provided (for audio/video)
  if (options.mediaImetaTags && options.mediaImetaTags.length > 0) {
    tags.push(...options.mediaImetaTags)
  }

  const images = extractImagesFromContent(transformedEmojisContent)
  if (images && images.length) {
    tags.push(...generateImetaTags(images))
  }

  // Add 'p' tags for recipients
  tags.push(
    ...recipients.map((pubkey) => buildPTag(pubkey))
  )

  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }

  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }

  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }

  const baseDraft = {
    kind: ExtendedKind.PUBLIC_MESSAGE,
    content: transformedEmojisContent,
    tags
  }

  return setDraftEventCache(baseDraft)
}

const SECONDS_PER_DAY = 86400

/**
 * NIP-52 time-based calendar event (kind 31923) for scheduled video calls.
 * Tags: d, title, summary, image, start, end, D, location/r, p, t (topics).
 * Content = description (optional).
 */
export function createCalendarEventDraftEvent(params: {
  d: string
  title: string
  start: number
  end?: number
  locationUrl: string
  summary?: string
  image?: string
  topics?: string[]
  content?: string
  participants: string[]
}): TDraftEvent {
  const dayStart = Math.floor(params.start / SECONDS_PER_DAY)
  const dayEnd =
    params.end != null ? Math.floor(params.end / SECONDS_PER_DAY) : dayStart
  const dTags: string[][] = []
  for (let day = dayStart; day <= dayEnd; day++) {
    dTags.push(['D', String(day)])
  }
  const tags: string[][] = [
    ['d', params.d],
    ['title', params.title],
    ...(params.summary?.trim() ? [['summary', params.summary.trim()]] : []),
    ...(params.image?.trim() ? [['image', params.image.trim()]] : []),
    ['start', String(params.start)],
    ...(params.end != null ? [['end', String(params.end)]] : []),
    ...dTags,
    ['r', params.locationUrl],
    ...(params.topics ?? []).filter(Boolean).map((topic) => ['t', topic.trim()]),
    ...params.participants.map((pubkey) => ['p', pubkey])
  ]
  return {
    kind: ExtendedKind.CALENDAR_EVENT_TIME,
    content: params.content?.trim() ?? '',
    tags,
    created_at: dayjs().unix()
  }
}

/**
 * NIP-52 date-based calendar event (kind 31922) for in-person all-day / multi-day.
 * Tags: d, title, summary, image, start (YYYY-MM-DD), end (YYYY-MM-DD), location, r, p, t.
 * Content = description (optional).
 */
export function createInPersonDateBasedCalendarEventDraftEvent(params: {
  d: string
  title: string
  start: string
  end?: string
  location?: string
  link?: string
  summary?: string
  image?: string
  topics?: string[]
  content?: string
  participants: string[]
}): TDraftEvent {
  const tags: string[][] = [
    ['d', params.d],
    ['title', params.title],
    ...(params.summary?.trim() ? [['summary', params.summary.trim()]] : []),
    ...(params.image?.trim() ? [['image', params.image.trim()]] : []),
    ['start', params.start],
    ...(params.end?.trim() ? [['end', params.end]] : []),
    ...(params.location?.trim() ? [['location', params.location.trim()]] : []),
    ...(params.link?.trim() ? [['r', params.link.trim()]] : []),
    ...(params.topics ?? []).filter(Boolean).map((topic) => ['t', topic.trim()]),
    ...params.participants.map((pubkey) => ['p', pubkey])
  ]
  return {
    kind: ExtendedKind.CALENDAR_EVENT_DATE,
    content: params.content?.trim() ?? '',
    tags,
    created_at: dayjs().unix()
  }
}

/**
 * NIP-52 time-based calendar event (kind 31923) for in-person meetings.
 * Tags: d, title, summary, image, start, end, D, optional location, optional r, p, t (topics).
 * Content = description (optional).
 */
export function createInPersonCalendarEventDraftEvent(params: {
  d: string
  title: string
  start: number
  end?: number
  location?: string
  link?: string
  summary?: string
  image?: string
  topics?: string[]
  content?: string
  participants: string[]
}): TDraftEvent {
  const dayStart = Math.floor(params.start / SECONDS_PER_DAY)
  const dayEnd =
    params.end != null ? Math.floor(params.end / SECONDS_PER_DAY) : dayStart
  const dTags: string[][] = []
  for (let day = dayStart; day <= dayEnd; day++) {
    dTags.push(['D', String(day)])
  }
  const tags: string[][] = [
    ['d', params.d],
    ['title', params.title],
    ...(params.summary?.trim() ? [['summary', params.summary.trim()]] : []),
    ...(params.image?.trim() ? [['image', params.image.trim()]] : []),
    ['start', String(params.start)],
    ...(params.end != null ? [['end', String(params.end)]] : []),
    ...dTags,
    ...(params.location?.trim() ? [['location', params.location.trim()]] : []),
    ...(params.link?.trim() ? [['r', params.link.trim()]] : []),
    ...(params.topics ?? []).filter(Boolean).map((topic) => ['t', topic.trim()]),
    ...params.participants.map((pubkey) => ['p', pubkey])
  ]
  return {
    kind: ExtendedKind.CALENDAR_EVENT_TIME,
    content: params.content?.trim() ?? '',
    tags,
    created_at: dayjs().unix()
  }
}

/**
 * NIP-52 calendar event RSVP (kind 31925).
 * Tags: a (required), e (optional), d (required), status (required), p (optional), fb (optional).
 */
export function createCalendarRsvpDraftEvent(
  calendarEvent: Event,
  status: 'accepted' | 'tentative' | 'declined',
  options: { content?: string; fb?: 'free' | 'busy' } = {}
): TDraftEvent {
  const coordinate = getReplaceableCoordinateFromEvent(calendarEvent)
  const hint = client.getEventHint(calendarEvent.id)
  const tags: string[][] = [
    ['a', coordinate, hint ?? ''],
    ['e', calendarEvent.id, hint ?? ''],
    ['d', randomString(12)],
    ['status', status],
    ['p', calendarEvent.pubkey]
  ]
  if (options.fb && status !== 'declined') {
    tags.push(['fb', options.fb])
  }
  return {
    kind: ExtendedKind.CALENDAR_EVENT_RSVP,
    content: options.content ?? '',
    tags,
    created_at: dayjs().unix()
  }
}

export function createRelayListDraftEvent(mailboxRelays: TMailboxRelay[]): TDraftEvent {
  return {
    kind: kinds.RelayList,
    content: '',
    tags: mailboxRelays.map(({ url, scope }) => buildRTag(url, scope)),
    created_at: dayjs().unix()
  }
}

/** Kind 10243 — empty `tags` is a valid “cleared” list (publish to replace). */
export function createHttpRelayListDraftEvent(mailboxRelays: TMailboxRelay[]): TDraftEvent {
  return {
    kind: ExtendedKind.HTTP_RELAY_LIST,
    content: '',
    tags: mailboxRelays.map(({ url, scope }) => buildRTag(url, scope)),
    created_at: dayjs().unix()
  }
}

/** NIP-A7 spell (kind 777) draft params from Create Spell form. */
export type TSpellDraftParams = {
  cmd: 'REQ' | 'COUNT'
  content: string
  name?: string
  alt?: string
  kinds: string[] // e.g. ['1', '6']
  authors: string[]
  ids: string[]
  tagFilters: { letter: string; values: string[] }[] // e.g. { letter: 't', values: ['bitcoin'] }
  limit: string
  since: string
  until: string
  search: string
  relays: string[]
  topics: string[] // t tags for spell categorization
  closeOnEose: boolean
}

export function createSpellDraftEvent(params: TSpellDraftParams): TDraftEvent {
  const tags: string[][] = [['cmd', params.cmd]]
  if (params.name?.trim()) tags.push(['name', params.name.trim()])
  if (params.alt?.trim()) tags.push(['alt', params.alt.trim()])
  params.kinds
    .map((k) => k.trim())
    .filter(Boolean)
    .forEach((k) => tags.push(['k', k]))
  const authors = params.authors.map((a) => a.trim()).filter(Boolean)
  if (authors.length) tags.push(['authors', ...authors])
  const ids = params.ids.map((id) => id.trim()).filter(Boolean)
  if (ids.length) tags.push(['ids', ...ids])
  params.tagFilters.forEach(({ letter, values }) => {
    if (letter?.trim() && values.some((v) => v?.trim())) {
      tags.push(['tag', letter.trim(), ...values.map((v) => v.trim()).filter(Boolean)])
    }
  })
  if (params.limit.trim()) {
    const n = parseInt(params.limit, 10)
    if (!Number.isNaN(n)) tags.push(['limit', String(n)])
  }
  if (params.since.trim()) tags.push(['since', params.since.trim()])
  if (params.until.trim()) tags.push(['until', params.until.trim()])
  if (params.search.trim()) tags.push(['search', params.search.trim()])
  const relays = params.relays.map((r) => r.trim()).filter(Boolean)
  if (relays.length) tags.push(['relays', ...relays])
  params.topics
    .map((t) => t.trim())
    .filter(Boolean)
    .forEach((t) => tags.push(['t', t]))
  // Live vs one-shot subscription only applies to REQ, not COUNT
  if (params.cmd === 'REQ' && params.closeOnEose) tags.push(['close-on-eose'])
  return {
    kind: ExtendedKind.SPELL,
    content: params.content?.trim() ?? '',
    tags,
    created_at: dayjs().unix()
  }
}

/** Rehydrate the spell form from a stored/published kind 777 event (edit flow). */
export function spellEventToDraftParams(event: Event): TSpellDraftParams {
  if (event.kind !== ExtendedKind.SPELL) {
    return {
      cmd: 'REQ',
      content: '',
      name: '',
      alt: '',
      kinds: ['1'],
      authors: ['$me', '$contacts'],
      ids: [],
      tagFilters: [],
      limit: '50',
      since: '7d',
      until: '',
      search: '',
      relays: [],
      topics: [],
      closeOnEose: false
    }
  }
  const gt = (name: string) => event.tags.find((t) => t[0] === name)
  const all = (name: string) => event.tags.filter((t) => t[0] === name)
  const cmdRaw = gt('cmd')?.[1]
  const cmd: 'REQ' | 'COUNT' = cmdRaw === 'COUNT' ? 'COUNT' : 'REQ'
  const kinds = all('k')
    .map((t) => t[1])
    .filter((x): x is string => !!x?.trim())
  const authorsTag = gt('authors')
  const authors =
    authorsTag && authorsTag.length > 1 ? authorsTag.slice(1).filter((x): x is string => !!x) : []
  const idsTag = gt('ids')
  const ids = idsTag && idsTag.length > 1 ? idsTag.slice(1).filter((x): x is string => !!x) : []
  const relaysTag = gt('relays')
  const relays =
    relaysTag && relaysTag.length > 1 ? relaysTag.slice(1).filter((x): x is string => !!x) : []
  const tagTagRows = all('tag').filter((t) => t.length >= 2)
  const tagFilters = tagTagRows.map((t) => ({
    letter: t[1] ?? '',
    values: t.slice(2).filter((x): x is string => !!x)
  }))

  return {
    cmd,
    content: event.content ?? '',
    name: gt('name')?.[1] ?? '',
    alt: gt('alt')?.[1] ?? '',
    kinds: kinds.length ? kinds : ['1'],
    authors: authors.length ? authors : ['$me', '$contacts'],
    ids,
    tagFilters,
    limit: gt('limit')?.[1] ?? '50',
    since: gt('since')?.[1] ?? '7d',
    until: gt('until')?.[1] ?? '',
    search: gt('search')?.[1] ?? '',
    relays,
    topics: all('t')
      .map((t) => t[1])
      .filter((x): x is string => !!x?.trim()),
    closeOnEose: cmd === 'REQ' && event.tags.some((t) => t[0] === 'close-on-eose')
  }
}

export function createRssFeedListDraftEvent(feedUrls: string[]): TDraftEvent {
  // Validate and sanitize feed URLs
  const validUrls = feedUrls
    .map(url => typeof url === 'string' ? url.trim() : '')
    .filter(url => url.length > 0)
  
  // Create tags with "u" prefix for each feed URL
  const tags = validUrls.map(url => ['u', url] as [string, string])
  
  return {
    kind: ExtendedKind.RSS_FEED_LIST,
    content: '', // Empty content, URLs are in tags
    tags,
    created_at: dayjs().unix()
  }
}

export function createCacheRelaysDraftEvent(mailboxRelays: TMailboxRelay[]): TDraftEvent {
  return {
    kind: ExtendedKind.CACHE_RELAYS,
    content: '',
    tags: mailboxRelays.map(({ url, scope }) => buildRTag(url, scope)),
    created_at: dayjs().unix()
  }
}

export function createFollowListDraftEvent(tags: string[][], content?: string): TDraftEvent {
  return {
    kind: kinds.Contacts,
    content: content ?? '',
    created_at: dayjs().unix(),
    tags
  }
}

export function createMuteListDraftEvent(tags: string[][], content?: string): TDraftEvent {
  return {
    kind: kinds.Mutelist,
    content: content ?? '',
    created_at: dayjs().unix(),
    tags
  }
}

/** NIP-51 follow set (kind 30000, addressable). Tags must include `d`; use {@link buildFollowSetTags}. */
export function createFollowSetDraftEvent(tags: string[][], content = '', created_at?: number): TDraftEvent {
  return {
    kind: ExtendedKind.FOLLOW_SET,
    content,
    created_at: created_at ?? dayjs().unix(),
    tags
  }
}

export function createProfileDraftEvent(content: string, tags: string[][] = []): TDraftEvent {
  return {
    kind: kinds.Metadata,
    content,
    tags,
    created_at: dayjs().unix()
  }
}

/** NIP-A3 payment info (kind 10133). */
export function createPaymentInfoDraftEvent(content: string, tags: string[][] = []): TDraftEvent {
  return {
    kind: ExtendedKind.PAYMENT_INFO,
    content,
    tags,
    created_at: dayjs().unix()
  }
}

export function createFavoriteRelaysDraftEvent(
  favoriteRelays: string[],
  relaySetEventsOrATags: Event[] | string[][]
): TDraftEvent {
  const tags: string[][] = []
  favoriteRelays.forEach((url) => {
    tags.push(buildRelayTag(url))
  })
  relaySetEventsOrATags.forEach((eventOrATag) => {
    if (Array.isArray(eventOrATag)) {
      tags.push(eventOrATag)
    } else {
      tags.push(buildATag(eventOrATag))
    }
  })
  return {
    kind: ExtendedKind.FAVORITE_RELAYS,
    content: '',
    tags,
    created_at: dayjs().unix()
  }
}

export function createBlockedRelaysDraftEvent(blockedRelays: string[]): TDraftEvent {
  const tags: string[][] = []
  blockedRelays.forEach((url) => {
    tags.push(buildRelayTag(url))
  })
  return {
    kind: ExtendedKind.BLOCKED_RELAYS,
    content: '',
    tags,
    created_at: dayjs().unix()
  }
}

export function createBookmarkDraftEvent(tags: string[][], content = ''): TDraftEvent {
  return {
    kind: kinds.BookmarkList,
    content,
    tags,
    created_at: dayjs().unix()
  }
}

/** NIP-B0 (kind 39701): parameterized web bookmark; `d` = URL without scheme, `i`/`I` = canonical http(s) URL. */
export function createWebBookmarkDraftEvent(options: {
  url: string
  title?: string
  note?: string
  /** Preserve first publication time when editing (unix seconds string). */
  publishedAtUnix?: string
  topicTags?: string[]
}): TDraftEvent {
  const raw = options.url.trim()
  if (!raw) throw new Error('Web bookmark URL is required')
  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const canonical = canonicalizeHttpUrlForITags(canonicalizeRssArticleUrl(href))
  const d = urlToWebBookmarkDTag(canonical)
  if (!d) throw new Error('Invalid web bookmark URL')

  const tags: string[][] = [
    ['d', d],
    ['I', canonical],
    ['i', canonical]
  ]
  const title = options.title?.trim()
  if (title) tags.push(['title', title])

  const now = dayjs().unix()
  tags.push(['published_at', options.publishedAtUnix ?? String(now)])

  for (const topic of options.topicTags ?? []) {
    const n = normalizeTopic(topic)
    if (n) tags.push(['t', n])
  }

  return {
    kind: ExtendedKind.WEB_BOOKMARK,
    content: options.note?.trim() ?? '',
    tags,
    created_at: now
  }
}

export function createInterestListDraftEvent(topics: string[], content = ''): TDraftEvent {
  return {
    kind: 10015,
    content,
    tags: topics.map(topic => ['t', topic]),
    created_at: dayjs().unix()
  }
}

export function createBlossomServerListDraftEvent(servers: string[]): TDraftEvent {
  return {
    kind: ExtendedKind.BLOSSOM_SERVER_LIST,
    content: '',
    tags: servers.map((server) => buildServerTag(server)),
    created_at: dayjs().unix()
  }
}

export async function createPollDraftEvent(
  author: string,
  question: string,
  mentions: string[],
  { isMultipleChoice, relays, options, endsAt }: TPollCreateData,
  {
    isNsfw,
    addExpirationTag,
    expirationMonths,
    addQuietTag,
    quietDays
  }: {
    addClientTag?: boolean // accepted for API compat; client tag is added in publish()
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  } = {}
): Promise<TDraftEvent> {
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(question)
  const { quoteEventHexIds, quoteReplaceableCoordinates } =
    await extractRelatedEventIds(transformedEmojisContent)
  const hashtags = extractHashtags(transformedEmojisContent)

  const tags = emojiTags.concat(hashtags.map((hashtag) => buildTTag(hashtag)))

  // imeta tags
  const images = extractImagesFromContent(transformedEmojisContent)
  if (images && images.length) {
    tags.push(...generateImetaTags(images))
  }

  // q tags
  tags.push(...quoteEventHexIds.map((eventId) => buildQTag(eventId)))
  tags.push(...quoteReplaceableCoordinates.map((coordinate) => buildReplaceableQTag(coordinate)))

  // p tags
  tags.push(...mentions.map((pubkey) => buildPTag(pubkey)))

  const validOptions = options.filter((opt) => opt.trim())
  tags.push(...validOptions.map((option) => ['option', randomString(9), option.trim()]))
  tags.push(['polltype', isMultipleChoice ? POLL_TYPE.MULTIPLE_CHOICE : POLL_TYPE.SINGLE_CHOICE])

  if (endsAt) {
    tags.push(['endsAt', endsAt.toString()])
  }

  if (relays.length) {
    relays.forEach((relay) => tags.push(buildRelayTag(relay)))
  } else {
    const relayList = await client.fetchRelayList(author)
    const readHints = [
      ...(relayList.httpRead || []).slice(0, 4),
      ...(relayList.read || []).slice(0, 4)
    ].slice(0, 4)
    readHints.forEach((relay) => {
      tags.push(buildRelayTag(relay))
    })
  }

  if (isNsfw) {
    tags.push(buildNsfwTag())
  }

  if (addExpirationTag && expirationMonths) {
    tags.push(buildExpirationTag(expirationMonths))
  }

  if (addQuietTag && quietDays) {
    tags.push(buildQuietTag(quietDays))
  }

  const baseDraft = {
    content: transformedEmojisContent.trim(),
    kind: ExtendedKind.POLL,
    tags
  }
  return setDraftEventCache(baseDraft)
}

export function createPollResponseDraftEvent(
  pollEvent: Event,
  selectedOptionIds: string[]
): TDraftEvent {
  return {
    content: '',
    kind: ExtendedKind.POLL_RESPONSE,
    tags: [
      buildETag(pollEvent.id, pollEvent.pubkey),
      buildPTag(pollEvent.pubkey),
      ...selectedOptionIds.map((optionId) => buildResponseTag(optionId))
    ],
    created_at: dayjs().unix()
  }
}

export function createDeletionRequestDraftEvent(event: Event): TDraftEvent {
  const tags: string[][] = [buildKTag(event.kind)]
  if (isReplaceableEvent(event.kind)) {
    tags.push(['a', getReplaceableCoordinateFromEvent(event)])
  } else {
    tags.push(['e', event.id])
  }

  return {
    kind: kinds.EventDeletion,
    content: 'Request for deletion of the event.',
    tags,
    created_at: dayjs().unix()
  }
}

export function createReportDraftEvent(event: Event, reason: string): TDraftEvent {
  const tags: string[][] = []
  if (event.kind === kinds.Metadata) {
    tags.push(['p', event.pubkey, reason])
  } else {
    tags.push(['p', event.pubkey])
    tags.push(['e', event.id, reason])
    if (isReplaceableEvent(event.kind)) {
      tags.push(['a', getReplaceableCoordinateFromEvent(event), reason])
    }
  }

  return {
    kind: kinds.Report,
    content: '',
    tags,
    created_at: dayjs().unix()
  }
}

export function createRelayReviewDraftEvent(
  relay: string,
  review: string,
  stars: number
): TDraftEvent {
  return {
    kind: ExtendedKind.RELAY_REVIEW,
    content: review,
    tags: [
      ['d', relay],
      ['rating', (stars / 5).toString()]
    ],
    created_at: dayjs().unix()
  }
}

function generateImetaTags(imageUrls: string[]) {
  return imageUrls
    .map((imageUrl) => {
      const tag = mediaUpload.getImetaTagByUrl(imageUrl)
      return tag ?? null
    })
    .filter(Boolean) as string[][]
}

async function extractRelatedEventIds(content: string, parentEvent?: Event) {
  const quoteEventHexIds: string[] = []
  const quoteReplaceableCoordinates: string[] = []
  let rootETag: string[] = []
  let parentETag: string[] = []
  const matches = content.match(EMBEDDED_EVENT_REGEX)

  const addToSet = (arr: string[], item: string) => {
    if (!arr.includes(item)) arr.push(item)
  }

  for (const m of matches || []) {
    try {
      const id = m.split(':')[1]
      const { type, data } = nip19.decode(id)
      if (type === 'nevent') {
        addToSet(quoteEventHexIds, data.id)
      } else if (type === 'note') {
        addToSet(quoteEventHexIds, data)
      } else if (type === 'naddr') {
        addToSet(
          quoteReplaceableCoordinates,
          getReplaceableCoordinate(data.kind, data.pubkey, data.identifier)
        )
      }
    } catch (e) {
      logger.error('Failed to decode quoted nostr reference', { error: e, reference: m })
    }
  }

  if (parentEvent) {
    const _rootETag = getRootETag(parentEvent)
    if (_rootETag) {
      parentETag = buildETagWithMarker(parentEvent.id, parentEvent.pubkey, '', 'reply')

      const [, rootEventHexId, hint, , rootEventPubkeyFromTag] = _rootETag
      const canonicalRootHex = resolveDeclaredThreadRootEventHex(rootEventHexId)

      let rootEvent = client.peekSessionCachedEvent(canonicalRootHex)
      if (!rootEvent) {
        rootEvent = await eventService.fetchEvent(canonicalRootHex)
      }
      if (!rootEvent) {
        const rootEventId = generateBech32IdFromETag(_rootETag)
        rootEvent = rootEventId ? await eventService.fetchEvent(rootEventId) : undefined
      }
      if (rootEvent) {
        rootETag = buildETagWithMarker(rootEvent.id, rootEvent.pubkey, hint, 'root')
      } else {
        rootETag = buildETagWithMarker(
          canonicalRootHex,
          rootEventPubkeyFromTag ?? '',
          hint,
          'root'
        )
      }
    } else {
      // reply to root event
      rootETag = buildETagWithMarker(parentEvent.id, parentEvent.pubkey, '', 'root')
    }
  }

  return {
    quoteEventHexIds,
    quoteReplaceableCoordinates,
    rootETag,
    parentETag
  }
}

async function extractCommentMentions(content: string, parentEvent: Event) {
  const quoteEventHexIds: string[] = []
  const quoteReplaceableCoordinates: string[] = []

  const addToSet = (arr: string[], item: string) => {
    if (!arr.includes(item)) arr.push(item)
  }

  const matches = content.match(EMBEDDED_EVENT_REGEX)
  for (const m of matches || []) {
    try {
      const id = m.split(':')[1]
      const { type, data } = nip19.decode(id)
      if (type === 'nevent') {
        addToSet(quoteEventHexIds, data.id)
      } else if (type === 'note') {
        addToSet(quoteEventHexIds, data)
      } else if (type === 'naddr') {
        addToSet(
          quoteReplaceableCoordinates,
          getReplaceableCoordinate(data.kind, data.pubkey, data.identifier)
        )
      }
    } catch (e) {
      logger.error('Failed to decode quoted nostr reference', { error: e, reference: m })
    }
  }

  if (parentEvent.kind === ExtendedKind.RSS_THREAD_ROOT) {
    const url = parentEvent.tags.find((t) => t[0] === 'i' || t[0] === 'I')?.[1]
    return {
      quoteEventHexIds,
      quoteReplaceableCoordinates,
      rootEventId: undefined,
      rootCoordinateTag: undefined,
      rootKind: url ? NIP22_URL_SCOPE_KIND : undefined,
      rootPubkey: undefined,
      rootUrl: url
    }
  }

  const isComment = [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT].includes(parentEvent.kind)
  const rootCoordinateTag = isComment
    ? parentEvent.tags.find(tagNameEquals('A'))
    : isReplaceableEvent(parentEvent.kind)
      ? buildATag(parentEvent, true)
      : undefined
  const rootEventId = isComment ? parentEvent.tags.find(tagNameEquals('E'))?.[1] : parentEvent.id
  let rootKind = isComment ? parentEvent.tags.find(tagNameEquals('K'))?.[1] : parentEvent.kind
  const rootPubkey = isComment ? parentEvent.tags.find(tagNameEquals('P'))?.[1] : parentEvent.pubkey
  const rootUrl = isComment
    ? parentEvent.tags.find((t) => t[0] === 'I' || t[0] === 'i')?.[1]
    : undefined

  if (
    isComment &&
    rootUrl &&
    (rootKind === undefined || rootKind === '') &&
    (rootUrl.startsWith('http://') || rootUrl.startsWith('https://'))
  ) {
    rootKind = NIP22_URL_SCOPE_KIND
  }

  return {
    quoteEventHexIds,
    quoteReplaceableCoordinates,
    rootEventId,
    rootCoordinateTag,
    rootKind,
    rootPubkey,
    rootUrl
  }
}

function extractHashtags(content: string) {
  const hashtags: string[] = []
  // Match hashtags including hyphens, underscores, and unicode characters
  // But stop at whitespace or common punctuation
  const matches = content.match(/#[\p{L}\p{N}\p{M}_-]+/gu)
  matches?.forEach((m) => {
    const hashtag = m.slice(1)
    // Use shared normalization function (without space replacement for content hashtags)
    const normalized = normalizeHashtag(hashtag, false)
    
    // Only add if not empty (normalizeHashtag already filters out pure numbers)
    if (normalized) {
      hashtags.push(normalized)
    }
  })
  return hashtags
}

function extractImagesFromContent(content: string) {
  return content.match(/https?:\/\/[^\s"']+\.(jpg|jpeg|png|gif|webp|heic)/gi)
}

export function transformCustomEmojisInContent(content: string) {
  const emojiTags: string[][] = []
  let processedContent = content
  const matches = content.match(/:[a-zA-Z0-9]+:/g)

  const emojiIdSet = new Set<string>()
  matches?.forEach((m) => {
    if (emojiIdSet.has(m)) return
    emojiIdSet.add(m)

    const emoji = customEmojiService.getEmojiById(m.slice(1, -1))
    if (emoji) {
      emojiTags.push(buildEmojiTag(emoji))
      processedContent = processedContent.replace(new RegExp(m, 'g'), `:${emoji.shortcode}:`)
    }
  })

  return {
    emojiTags,
    content: processedContent
  }
}

export function buildATag(event: Event, upperCase: boolean = false) {
  const coordinate = getReplaceableCoordinateFromEvent(event)
  const hint = client.getEventHint(event.id)
  return trimTagEnd([upperCase ? 'A' : 'a', coordinate, hint])
}

function buildDTag(identifier: string) {
  return ['d', identifier]
}

export function buildETag(
  eventHexId: string,
  pubkey: string = '',
  hint: string = '',
  upperCase: boolean = false
) {
  if (!hint) {
    hint = client.getEventHint(eventHexId)
  }
  return trimTagEnd([upperCase ? 'E' : 'e', eventHexId, hint, pubkey])
}

function buildETagWithMarker(
  eventHexId: string,
  pubkey: string = '',
  hint: string = '',
  marker: 'root' | 'reply' | '' = ''
) {
  if (!hint) {
    hint = client.getEventHint(eventHexId)
  }
  return trimTagEnd(['e', eventHexId, hint, marker, pubkey])
}

function buildITag(url: string, upperCase: boolean = false) {
  return [upperCase ? 'I' : 'i', url]
}

function buildKTag(kind: number | string, upperCase: boolean = false) {
  return [upperCase ? 'K' : 'k', kind.toString()]
}

function buildPTag(pubkey: string, upperCase: boolean = false) {
  return [upperCase ? 'P' : 'p', pubkey]
}

function buildQTag(eventHexId: string) {
  return trimTagEnd(['q', eventHexId, client.getEventHint(eventHexId)]) // TODO: pubkey
}

function buildReplaceableQTag(coordinate: string) {
  return trimTagEnd(['q', coordinate])
}

function buildRTag(url: string, scope: TMailboxRelayScope) {
  return scope !== 'both' ? ['r', url, scope] : ['r', url]
}

function buildTTag(hashtag: string) {
  return ['t', hashtag]
}

function buildEmojiTag(emoji: TEmoji) {
  return ['emoji', emoji.shortcode, emoji.url]
}

function buildTitleTag(title: string) {
  return ['title', title]
}

function buildRelayTag(url: string) {
  return ['relay', url]
}

function buildServerTag(url: string) {
  return ['server', url]
}

function buildResponseTag(value: string) {
  return ['response', value]
}

export function buildClientTag(handlerPubkey?: string, handlerIdentifier?: string, relay?: string) {
  // Use NIP-89 format if handler information is provided
  if (handlerPubkey && handlerIdentifier) {
    const aTag = `31990:${handlerPubkey}:${handlerIdentifier}`
    const tag = ['client', 'Imwald', aTag]
    if (relay) {
      tag.push(relay)
    }
    return tag
  }
  
  // Fallback to simple format for backward compatibility
  return ['client', 'imwald']
}

/** Canonical `alt` we attach for Imwald / jumble.imwald.eu publishing attribution (NIP-31). */
export const IMWALD_ATTRIBUTION_ALT_TEXT = 'This event was published by https://jumble.imwald.eu.'

export function buildAltTag(): string[] {
  return ['alt', IMWALD_ATTRIBUTION_ALT_TEXT]
}

/**
 * True for `alt` tags that are *our* app attribution (current or legacy Jumble/Imwald wording).
 * Does not match arbitrary user `alt` text unless it clearly points at this app.
 */
export function isImwaldAppAttributionAltTag(tag: string[]): boolean {
  if (!Array.isArray(tag) || tag[0] !== 'alt' || tag.length < 2) return false
  const raw = tag[1]
  if (typeof raw !== 'string') return false
  const v = raw.trim()
  if (v === IMWALD_ATTRIBUTION_ALT_TEXT) return true
  const l = v.toLowerCase()
  if (l.includes('jumble.imwald.eu')) return true
  if (
    /^this event was published\b/i.test(v) &&
    (l.includes('imwald') || l.includes('jumble'))
  ) {
    return true
  }
  return false
}

/** Removes every `client` tag and any Jumble/Imwald attribution `alt` (see {@link isImwaldAppAttributionAltTag}). */
export function stripImwaldAttributionTags(tags: string[][]): string[][] {
  return tags.filter(
    (tag) =>
      Array.isArray(tag) &&
      tag[0] !== 'client' &&
      !isImwaldAppAttributionAltTag(tag)
  )
}

/**
 * Before sign/publish: strip all `client` tags and Imwald/Jumble attribution `alt` tags, then
 * append exactly one {@link buildClientTag} + {@link buildAltTag} when `addClientTag !== false`.
 */
export function applyImwaldAttributionTags(
  draftEvent: TDraftEvent,
  options?: { addClientTag?: boolean }
): TDraftEvent {
  const draft = JSON.parse(JSON.stringify(draftEvent)) as TDraftEvent
  const existingTags = Array.isArray(draft.tags) ? draft.tags : []
  const sanitizedTags = stripImwaldAttributionTags(existingTags)
  const shouldAdd = options?.addClientTag !== false
  if (shouldAdd) {
    draft.tags = [...sanitizedTags, buildClientTag(), buildAltTag()]
  } else {
    draft.tags = [...sanitizedTags]
  }
  return draft
}

function buildNsfwTag() {
  return ['content-warning', 'NSFW']
}

function buildProtectedTag() {
  return ['-']
}

function buildExpirationTag(months: number): string[] {
  const expirationTime = dayjs().add(months, 'month').unix()
  return ['expiration', expirationTime.toString()]
}

function buildQuietTag(days: number): string[] {
  const quietEndTime = dayjs().add(days, 'day').unix()
  return ['quiet', quietEndTime.toString()]
}

function trimTagEnd(tag: string[]) {
  let endIndex = tag.length - 1
  while (endIndex >= 0 && tag[endIndex] === '') {
    endIndex--
  }

  return tag.slice(0, endIndex + 1)
}

/**
 * Create a highlight draft event (NIP-84 kind 9802)
 * @param highlightedText - The highlighted text (goes in .content)
 * @param sourceType - Type of source ('nostr' or 'url')
 * @param sourceValue - The source identifier (hex ID, naddr) or URL
 * @param description - Optional comment/description
 * @param options - Additional options (client tag, nsfw)
 */
export async function createHighlightDraftEvent(
  highlightedText: string,
  sourceType: 'nostr' | 'url',
  sourceValue: string,
  context?: string, // The full text/quote that the highlight is from
  description?: string,
  options?: {
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  }
): Promise<TDraftEvent> {
  const tags: string[][] = []

  // Add source tag (e or a tag for nostr, r tag for URL)
  if (sourceType === 'nostr') {
    // Check if it's an naddr (addressable event)
    if (sourceValue.startsWith('naddr')) {
      try {
        const decoded = nip19.decode(sourceValue)
        if (decoded.type === 'naddr') {
          const { kind, pubkey, identifier } = decoded.data
          const relays = decoded.data.relays && decoded.data.relays.length > 0 
            ? decoded.data.relays[0] 
            : ''
          // Build a-tag: ["a", "<kind>:<pubkey>:<d-identifier>", <relay-url>]
          // Format: kind:pubkey:d-tag-value
          const aTagValue = `${kind}:${pubkey}:${identifier}`
          if (relays) {
            tags.push(['a', aTagValue, relays])
          } else {
            tags.push(['a', aTagValue])
          }
        }
      } catch (err) {
        logger.error('Failed to decode naddr', { error: err, reference: sourceValue })
      }
    } else if (sourceValue.startsWith('nevent')) {
      // Handle nevent
      try {
        const decoded = nip19.decode(sourceValue)
        if (decoded.type === 'nevent') {
          const eventId = decoded.data.id
          const relays = decoded.data.relays && decoded.data.relays.length > 0 
            ? decoded.data.relays[0] 
            : client.getEventHint(eventId)
          const author = decoded.data.author
          // Build e-tag: ["e", <event-id>, <relay-url>, <author-pubkey>]
          if (author) {
            tags.push(trimTagEnd(['e', eventId, relays, author]))
          } else if (relays) {
            tags.push(['e', eventId, relays])
          } else {
            tags.push(['e', eventId])
          }
        }
      } catch (err) {
        logger.error('Failed to decode nevent', { error: err, reference: sourceValue })
      }
    } else if (sourceValue.startsWith('note')) {
      // Handle note1... (bech32 encoded event ID)
      try {
        const decoded = nip19.decode(sourceValue)
        if (decoded.type === 'note') {
          const eventId = decoded.data
          const relay = client.getEventHint(eventId)
          // Build e-tag: ["e", <event-id>, <relay-url>]
          if (relay) {
            tags.push(['e', eventId, relay])
          } else {
            tags.push(['e', eventId])
          }
        }
      } catch (err) {
        logger.error('Failed to decode note', { error: err, reference: sourceValue })
      }
    } else {
      // Regular hex event ID
      const relay = client.getEventHint(sourceValue)
      if (relay) {
        tags.push(['e', sourceValue, relay])
      } else {
        tags.push(['e', sourceValue])
      }
    }
  } else if (sourceType === 'url') {
    const trimmed = sourceValue.trim()
    tags.push(['r', cleanUrl(trimmed) || trimmed, 'source'])
  }

  // Add context tag if provided (the full text/quote that the highlight is from)
  if (context && context.length) {
    tags.push(['context', context])
  }

  // Add description tag if provided (user's explanation/comment)
  if (description && description.trim()) {
    tags.push(['description', description.trim()])
  }

  // Add p-tag for the author of the source material (if we can determine it)
  if (sourceType === 'nostr') {
    if (sourceValue.startsWith('naddr')) {
      try {
        const decoded = nip19.decode(sourceValue)
        if (decoded.type === 'naddr') {
          const { pubkey } = decoded.data
          tags.push(['p', pubkey])
        }
      } catch {
        // Already logged above
      }
    } else if (sourceValue.startsWith('nevent')) {
      try {
        const decoded = nip19.decode(sourceValue)
        if (decoded.type === 'nevent' && decoded.data.author) {
          tags.push(['p', decoded.data.author])
        }
      } catch {
        // Already logged above
      }
    }
    // Note: For regular event IDs, we don't have the author pubkey readily available
  }

  // Add optional tags
  if (options?.isNsfw) {
    tags.push(buildNsfwTag())
  }

  if (options?.addExpirationTag && options?.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }

  if (options?.addQuietTag && options?.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }

  return setDraftEventCache({
    kind: 9802, // NIP-84 highlight kind
    tags,
    content: highlightedText
  })
}

// Media note draft event functions

export async function createVoiceDraftEvent(
  content: string,
  mediaUrl: string,
  imetaTags: string[][],
  mentions: string[],
  options: {
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  } = {}
): Promise<TDraftEvent> {
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(content)
  const hashtags = extractHashtags(transformedEmojisContent)
  
  const tags: string[][] = []
  tags.push(...emojiTags)
  tags.push(...hashtags.map((hashtag) => buildTTag(hashtag)))
  tags.push(...imetaTags)
  tags.push(...mentions.map((pubkey) => buildPTag(pubkey)))
  
  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }
  
  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }
  
  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }
  
  return setDraftEventCache({
    kind: ExtendedKind.VOICE,
    content: transformedEmojisContent || mediaUrl, // Content is optional text, fallback to URL
    tags
  })
}

export async function createVoiceCommentDraftEvent(
  content: string,
  parentEvent: Event,
  mediaUrl: string,
  imetaTags: string[][],
  mentions: string[],
  options: {
    addClientTag?: boolean
    protectedEvent?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  } = {}
): Promise<TDraftEvent> {
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(content)
  const {
    quoteEventHexIds,
    quoteReplaceableCoordinates,
    rootEventId,
    rootCoordinateTag,
    rootKind,
    rootPubkey,
    rootUrl
  } = await extractCommentMentions(transformedEmojisContent, parentEvent)
  const hashtags = extractHashtags(transformedEmojisContent)
  
  const tags: string[][] = []
  tags.push(...emojiTags)
  tags.push(...hashtags.map((hashtag) => buildTTag(hashtag)))
  tags.push(...imetaTags)
  tags.push(...quoteEventHexIds.map((eventId) => buildQTag(eventId)))
  tags.push(...quoteReplaceableCoordinates.map((coordinate) => buildReplaceableQTag(coordinate)))
  
  tags.push(
    ...mentions.filter((pubkey) => pubkey !== parentEvent.pubkey).map((pubkey) => buildPTag(pubkey))
  )

  const isRssArticleThreadRootVoice = parentEvent.kind === ExtendedKind.RSS_THREAD_ROOT
  const rssArticleUrlVoice = isRssArticleThreadRootVoice
    ? rootUrl || parentEvent.tags.find((t) => t[0] === 'i' || t[0] === 'I')?.[1]
    : undefined

  if (isRssArticleThreadRootVoice) {
    if (rssArticleUrlVoice) {
      const u = canonicalizeHttpUrlForITags(rssArticleUrlVoice)
      tags.push(buildITag(u, true), buildITag(u, false))
      const scopeKind = rootKind ?? NIP22_URL_SCOPE_KIND
      tags.push(buildKTag(scopeKind, true), buildKTag(scopeKind))
    }
  } else {
    if (rootCoordinateTag) {
      tags.push(rootCoordinateTag)
    } else if (rootEventId) {
      tags.push(buildETag(rootEventId, rootPubkey, '', true))
    }
    if (rootPubkey) {
      tags.push(buildPTag(rootPubkey, true))
    }
    if (rootKind) {
      tags.push(buildKTag(rootKind, true))
    }
    if (rootUrl) {
      const u = canonicalizeHttpUrlForITags(rootUrl)
      tags.push(buildITag(u, true), buildITag(u, false))
    }
    tags.push(
      ...[
        isReplaceableEvent(parentEvent.kind)
          ? buildATag(parentEvent)
          : buildETag(parentEvent.id, parentEvent.pubkey),
        buildKTag(parentEvent.kind),
        buildPTag(parentEvent.pubkey)
      ]
    )
  }
  
  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }
  
  if (options.protectedEvent) {
    tags.push(buildProtectedTag())
  }
  
  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }
  
  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }
  
  return setDraftEventCache({
    kind: ExtendedKind.VOICE_COMMENT,
    content: transformedEmojisContent || mediaUrl, // Content is optional text, fallback to URL
    tags
  })
}

export async function createPictureDraftEvent(
  content: string,
  imetaTags: string[][],
  mentions: string[],
  options: {
    title?: string
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  } = {}
): Promise<TDraftEvent> {
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(content)
  const hashtags = extractHashtags(transformedEmojisContent)
  
  const tags: string[][] = []
  if (options.title) {
    tags.push(buildTitleTag(options.title))
  }
  tags.push(...emojiTags)
  tags.push(...hashtags.map((hashtag) => buildTTag(hashtag)))
  tags.push(...imetaTags)
  tags.push(...mentions.map((pubkey) => buildPTag(pubkey)))
  
  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }
  
  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }
  
  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }
  
  return setDraftEventCache({
    kind: ExtendedKind.PICTURE,
    content: transformedEmojisContent,
    tags
  })
}

export async function createVideoDraftEvent(
  content: string,
  imetaTags: string[][],
  mentions: string[],
  videoKind: number, // 21 or 22
  options: {
    title?: string
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  } = {}
): Promise<TDraftEvent> {
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(content)
  const hashtags = extractHashtags(transformedEmojisContent)
  
  const tags: string[][] = []
  if (options.title) {
    tags.push(buildTitleTag(options.title))
  }
  tags.push(...emojiTags)
  tags.push(...hashtags.map((hashtag) => buildTTag(hashtag)))
  tags.push(...imetaTags)
  tags.push(...mentions.map((pubkey) => buildPTag(pubkey)))
  
  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }
  
  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }
  
  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }
  
  return setDraftEventCache({
    kind: videoKind, // ExtendedKind.VIDEO or ExtendedKind.SHORT_VIDEO
    content: transformedEmojisContent,
    tags
  })
}

// Article draft event functions

export async function createLongFormArticleDraftEvent(
  content: string,
  mentions: string[],
  options: {
    title?: string
    summary?: string
    image?: string
    publishedAt?: number
    dTag?: string
    topics?: string[]
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  } = {}
): Promise<TDraftEvent> {
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(content)
  const hashtags = extractHashtags(transformedEmojisContent)
  
  const tags: string[][] = []
  if (options.dTag) {
    tags.push(buildDTag(options.dTag))
  }
  if (options.title) {
    tags.push(buildTitleTag(options.title))
  }
  if (options.summary) {
    tags.push(['summary', options.summary])
  }
  if (options.image) {
    tags.push(['image', options.image])
  }
  if (options.publishedAt) {
    tags.push(['published_at', options.publishedAt.toString()])
  }
  tags.push(...emojiTags)
  tags.push(...hashtags.map((hashtag) => buildTTag(hashtag)))
  // Add topics as t-tags directly
  if (options.topics && options.topics.length > 0) {
    const normalizedTopics = options.topics
      .map(topic => normalizeTopic(topic.trim()))
      .filter(topic => topic.length > 0)
    tags.push(...normalizedTopics.map((topic) => buildTTag(topic)))
  }
  tags.push(...mentions.map((pubkey) => buildPTag(pubkey)))
  
  // imeta tags for images in content
  const images = extractImagesFromContent(transformedEmojisContent)
  if (images && images.length) {
    tags.push(...generateImetaTags(images))
  }
  
  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }
  
  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }
  
  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }
  
  return setDraftEventCache({
    kind: kinds.LongFormArticle,
    content: transformedEmojisContent,
    tags
  })
}

function normalizeDTag(identifier: string): string {
  // Convert to lowercase and replace non-letter characters with '-'
  return identifier
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function createWikiArticleDraftEvent(
  content: string,
  mentions: string[],
  options: {
    dTag: string
    title?: string
    summary?: string
    image?: string
    topics?: string[]
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  }
): Promise<TDraftEvent> {
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(content)
  const hashtags = extractHashtags(transformedEmojisContent)
  
  const tags: string[][] = []
  tags.push(buildDTag(normalizeDTag(options.dTag)))
  if (options.title) {
    tags.push(buildTitleTag(options.title))
  }
  if (options.summary) {
    tags.push(['summary', options.summary])
  }
  if (options.image) {
    tags.push(['image', options.image])
  }
  tags.push(...emojiTags)
  tags.push(...hashtags.map((hashtag) => buildTTag(hashtag)))
  // Add topics as t-tags directly
  if (options.topics && options.topics.length > 0) {
    const normalizedTopics = options.topics
      .map(topic => normalizeTopic(topic.trim()))
      .filter(topic => topic.length > 0)
    tags.push(...normalizedTopics.map((topic) => buildTTag(topic)))
  }
  tags.push(...mentions.map((pubkey) => buildPTag(pubkey)))
  
  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }
  
  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }
  
  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }
  
  return setDraftEventCache({
    kind: ExtendedKind.WIKI_ARTICLE,
    content: transformedEmojisContent,
    tags
  })
}

export async function createWikiArticleMarkdownDraftEvent(
  content: string,
  mentions: string[],
  options: {
    dTag: string
    title?: string
    summary?: string
    image?: string
    topics?: string[]
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  }
): Promise<TDraftEvent> {
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(content)
  const hashtags = extractHashtags(transformedEmojisContent)
  
  const tags: string[][] = []
  tags.push(buildDTag(normalizeDTag(options.dTag)))
  if (options.title) {
    tags.push(buildTitleTag(options.title))
  }
  if (options.summary) {
    tags.push(['summary', options.summary])
  }
  if (options.image) {
    tags.push(['image', options.image])
  }
  tags.push(...emojiTags)
  tags.push(...hashtags.map((hashtag) => buildTTag(hashtag)))
  // Add topics as t-tags directly
  if (options.topics && options.topics.length > 0) {
    const normalizedTopics = options.topics
      .map(topic => normalizeTopic(topic.trim()))
      .filter(topic => topic.length > 0)
    tags.push(...normalizedTopics.map((topic) => buildTTag(topic)))
  }
  tags.push(...mentions.map((pubkey) => buildPTag(pubkey)))
  
  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }
  
  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }
  
  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }
  
  return setDraftEventCache({
    kind: ExtendedKind.WIKI_ARTICLE_MARKDOWN,
    content: transformedEmojisContent,
    tags
  })
}

export async function createPublicationContentDraftEvent(
  content: string,
  mentions: string[],
  options: {
    dTag: string
    title?: string
    summary?: string
    image?: string
    topics?: string[]
    addClientTag?: boolean
    isNsfw?: boolean
    addExpirationTag?: boolean
    expirationMonths?: number
    addQuietTag?: boolean
    quietDays?: number
  }
): Promise<TDraftEvent> {
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(content)
  const hashtags = extractHashtags(transformedEmojisContent)
  
  const tags: string[][] = []
  tags.push(buildDTag(options.dTag))
  if (options.title) {
    tags.push(buildTitleTag(options.title))
  }
  if (options.summary) {
    tags.push(['summary', options.summary])
  }
  if (options.image) {
    tags.push(['image', options.image])
  }
  tags.push(...emojiTags)
  tags.push(...hashtags.map((hashtag) => buildTTag(hashtag)))
  // Add topics as t-tags directly
  if (options.topics && options.topics.length > 0) {
    const normalizedTopics = options.topics
      .map(topic => normalizeTopic(topic.trim()))
      .filter(topic => topic.length > 0)
    tags.push(...normalizedTopics.map((topic) => buildTTag(topic)))
  }
  tags.push(...mentions.map((pubkey) => buildPTag(pubkey)))
  
  if (options.isNsfw) {
    tags.push(buildNsfwTag())
  }
  
  if (options.addExpirationTag && options.expirationMonths) {
    tags.push(buildExpirationTag(options.expirationMonths))
  }
  
  if (options.addQuietTag && options.quietDays) {
    tags.push(buildQuietTag(options.quietDays))
  }
  
  return setDraftEventCache({
    kind: ExtendedKind.PUBLICATION_CONTENT,
    content: transformedEmojisContent,
    tags
  })
}

// Citation draft event functions

export function createCitationInternalDraftEvent(
  content: string,
  options: {
    cTag: string // kind:pubkey:hex format
    publishedOn?: string // ISO 8601 format
    title?: string
    author?: string
    accessedOn?: string // ISO 8601 format
    location?: string
    geohash?: string
    summary?: string
    relayHint?: string
  }
): TDraftEvent {
  const tags: string[][] = []
  tags.push(['c', options.cTag, options.relayHint || ''])
  if (options.publishedOn) {
    tags.push(['published_on', options.publishedOn])
  }
  if (options.title) {
    tags.push(buildTitleTag(options.title))
  }
  if (options.author) {
    tags.push(['author', options.author])
  }
  if (options.accessedOn) {
    tags.push(['accessed_on', options.accessedOn])
  }
  if (options.location) {
    tags.push(['location', options.location])
  }
  if (options.geohash) {
    tags.push(['g', options.geohash])
  }
  if (options.summary) {
    tags.push(['summary', options.summary])
  }
  
  return {
    kind: ExtendedKind.CITATION_INTERNAL,
    content,
    tags,
    created_at: dayjs().unix()
  }
}

export function createCitationExternalDraftEvent(
  content: string,
  options: {
    url: string
    accessedOn: string // ISO 8601 format
    title?: string
    author?: string
    publishedOn?: string // ISO 8601 format
    publishedBy?: string
    version?: string
    location?: string
    geohash?: string
    openTimestamp?: string // e tag of kind 1040 event
    summary?: string
  }
): TDraftEvent {
  const tags: string[][] = []
  tags.push(['u', options.url])
  tags.push(['accessed_on', options.accessedOn])
  if (options.title) {
    tags.push(buildTitleTag(options.title))
  }
  if (options.author) {
    tags.push(['author', options.author])
  }
  if (options.publishedOn) {
    tags.push(['published_on', options.publishedOn])
  }
  if (options.publishedBy) {
    tags.push(['published_by', options.publishedBy])
  }
  if (options.version) {
    tags.push(['version', options.version])
  }
  if (options.location) {
    tags.push(['location', options.location])
  }
  if (options.geohash) {
    tags.push(['g', options.geohash])
  }
  if (options.openTimestamp) {
    tags.push(['open_timestamp', options.openTimestamp])
  }
  if (options.summary) {
    tags.push(['summary', options.summary])
  }
  
  return {
    kind: ExtendedKind.CITATION_EXTERNAL,
    content,
    tags,
    created_at: dayjs().unix()
  }
}

export function createCitationHardcopyDraftEvent(
  content: string,
  options: {
    accessedOn: string // ISO 8601 format
    title?: string
    author?: string
    pageRange?: string
    chapterTitle?: string
    editor?: string
    publishedOn?: string // ISO 8601 format
    publishedBy?: string
    publishedIn?: string // journal name
    volume?: string
    doi?: string
    version?: string
    location?: string
    geohash?: string
    summary?: string
  }
): TDraftEvent {
  const tags: string[][] = []
  tags.push(['accessed_on', options.accessedOn])
  if (options.title) {
    tags.push(buildTitleTag(options.title))
  }
  if (options.author) {
    tags.push(['author', options.author])
  }
  if (options.pageRange) {
    tags.push(['page_range', options.pageRange])
  }
  if (options.chapterTitle) {
    tags.push(['chapter_title', options.chapterTitle])
  }
  if (options.editor) {
    tags.push(['editor', options.editor])
  }
  if (options.publishedOn) {
    tags.push(['published_on', options.publishedOn])
  }
  if (options.publishedBy) {
    tags.push(['published_by', options.publishedBy])
  }
  if (options.publishedIn) {
    tags.push(['published_in', options.publishedIn, options.volume || ''])
  }
  if (options.doi) {
    tags.push(['doi', options.doi])
  }
  if (options.version) {
    tags.push(['version', options.version])
  }
  if (options.location) {
    tags.push(['location', options.location])
  }
  if (options.geohash) {
    tags.push(['g', options.geohash])
  }
  if (options.summary) {
    tags.push(['summary', options.summary])
  }
  
  return {
    kind: ExtendedKind.CITATION_HARDCOPY,
    content,
    tags,
    created_at: dayjs().unix()
  }
}

export function createCitationPromptDraftEvent(
  content: string,
  options: {
    llm: string // language model name
    accessedOn: string // ISO 8601 format
    version?: string
    summary?: string // prompt conversation script
    url?: string // website llm was accessed from
  }
): TDraftEvent {
  const tags: string[][] = []
  tags.push(['llm', options.llm])
  tags.push(['accessed_on', options.accessedOn])
  if (options.version) {
    tags.push(['version', options.version])
  }
  if (options.summary) {
    tags.push(['summary', options.summary])
  }
  if (options.url) {
    tags.push(['u', options.url])
  }
  
  return {
    kind: ExtendedKind.CITATION_PROMPT,
    content,
    tags,
    created_at: dayjs().unix()
  }
}

/** Git Republic release (kind 1642); mirrors `releases-service` tag layout. */
export function createGitReleaseDraftEvent(
  content: string,
  options: {
    repoOwnerPubkey: string
    repoId: string
    tagName: string
    tagHash: string
    title?: string
    downloadUrl?: string
    isDraft?: boolean
    isPrerelease?: boolean
  }
): TDraftEvent {
  const repoAddress = `${ExtendedKind.GIT_REPO_ANNOUNCEMENT}:${options.repoOwnerPubkey}:${options.repoId}`
  const tags: string[][] = [
    ['a', repoAddress],
    ['p', options.repoOwnerPubkey],
    ['tag', options.tagName],
    ['r', options.tagHash, '', 'tag']
  ]
  if (options.title) {
    tags.push(['title', options.title])
  }
  if (options.downloadUrl) {
    tags.push(['r', options.downloadUrl, '', 'download'])
  }
  if (options.isDraft) {
    tags.push(['draft', 'true'])
  }
  if (options.isPrerelease) {
    tags.push(['prerelease', 'true'])
  }
  return {
    kind: ExtendedKind.GIT_RELEASE,
    content,
    tags,
    created_at: dayjs().unix()
  }
}
