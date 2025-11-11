import { ApplicationDataKey, EMBEDDED_EVENT_REGEX, ExtendedKind, POLL_TYPE } from '@/constants'
import client from '@/services/client.service'
import customEmojiService from '@/services/custom-emoji.service'
import mediaUpload from '@/services/media-upload.service'
import { prefixNostrAddresses } from '@/lib/nostr-address'
import { normalizeHashtag } from '@/lib/discussion-topics'
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
  isReplaceableEvent
} from './event'
import { randomString } from './random'
import { generateBech32IdFromETag, tagNameEquals } from './tag'

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
  const tags: string[][] = []
  tags.push(buildETag(event.id, event.pubkey))
  tags.push(buildPTag(event.pubkey))
  if (event.kind !== kinds.ShortTextNote) {
    tags.push(buildKTag(event.kind))
  }

  if (isReplaceableEvent(event.kind)) {
    tags.push(buildATag(event))
  }

  let content: string
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

// https://github.com/nostr-protocol/nips/blob/master/18.md
export function createRepostDraftEvent(event: Event): TDraftEvent {
  const isProtected = isProtectedEvent(event)
  const tags = [buildETag(event.id, event.pubkey), buildPTag(event.pubkey)]

  if (isReplaceableEvent(event.kind)) {
    tags.push(buildATag(event))
  }

  return {
    kind: kinds.Repost,
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

  if (options.addClientTag) {
    tags.push(buildClientTag())
    tags.push(buildAltTag())
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
    tags.push(buildITag(rootUrl, true))
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

  if (options.addClientTag) {
    tags.push(buildClientTag())
    tags.push(buildAltTag())
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

  if (options.addClientTag) {
    tags.push(buildClientTag())
    tags.push(buildAltTag())
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
  } = {}
): Promise<TDraftEvent> {
  // Process content to prefix nostr addresses before other transformations
  const contentWithPrefixedAddresses = prefixNostrAddresses(content)
  const { content: transformedEmojisContent, emojiTags } = transformCustomEmojisInContent(contentWithPrefixedAddresses)
  const hashtags = extractHashtags(transformedEmojisContent)

  const tags = emojiTags
    .concat(hashtags.map((hashtag) => buildTTag(hashtag)))

  const images = extractImagesFromContent(transformedEmojisContent)
  if (images && images.length) {
    tags.push(...generateImetaTags(images))
  }

  // Add 'p' tags for recipients
  tags.push(
    ...recipients.map((pubkey) => buildPTag(pubkey))
  )

  if (options.addClientTag) {
    tags.push(buildClientTag())
    tags.push(buildAltTag())
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

  const baseDraft = {
    kind: ExtendedKind.PUBLIC_MESSAGE,
    content: transformedEmojisContent,
    tags
  }

  return setDraftEventCache(baseDraft)
}

export function createRelayListDraftEvent(mailboxRelays: TMailboxRelay[]): TDraftEvent {
  return {
    kind: kinds.RelayList,
    content: '',
    tags: mailboxRelays.map(({ url, scope }) => buildRTag(url, scope)),
    created_at: dayjs().unix()
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

export function createProfileDraftEvent(content: string, tags: string[][] = []): TDraftEvent {
  return {
    kind: kinds.Metadata,
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

export function createSeenNotificationsAtDraftEvent(): TDraftEvent {
  return {
    kind: kinds.Application,
    content: 'Records read time to sync notification status across devices.',
    tags: [buildDTag(ApplicationDataKey.NOTIFICATIONS_SEEN_AT)],
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
    addClientTag,
    isNsfw,
    addExpirationTag,
    expirationMonths,
    addQuietTag,
    quietDays
  }: {
    addClientTag?: boolean
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
    relayList.read.slice(0, 4).forEach((relay) => {
      tags.push(buildRelayTag(relay))
    })
  }

  if (addClientTag) {
    tags.push(buildClientTag())
    tags.push(buildAltTag())
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

      const [, rootEventHexId, hint, , rootEventPubkey] = _rootETag
      if (rootEventPubkey) {
        rootETag = buildETagWithMarker(rootEventHexId, rootEventPubkey, hint, 'root')
      } else {
        const rootEventId = generateBech32IdFromETag(_rootETag)
        const rootEvent = rootEventId ? await client.fetchEvent(rootEventId) : undefined
        rootETag = rootEvent
          ? buildETagWithMarker(rootEvent.id, rootEvent.pubkey, hint, 'root')
          : buildETagWithMarker(rootEventHexId, rootEventPubkey, hint, 'root')
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
  const isComment = [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT].includes(parentEvent.kind)
  const rootCoordinateTag = isComment
    ? parentEvent.tags.find(tagNameEquals('A'))
    : isReplaceableEvent(parentEvent.kind)
      ? buildATag(parentEvent, true)
      : undefined
  const rootEventId = isComment ? parentEvent.tags.find(tagNameEquals('E'))?.[1] : parentEvent.id
  const rootKind = isComment ? parentEvent.tags.find(tagNameEquals('K'))?.[1] : parentEvent.kind
  const rootPubkey = isComment ? parentEvent.tags.find(tagNameEquals('P'))?.[1] : parentEvent.pubkey
  const rootUrl = isComment ? parentEvent.tags.find(tagNameEquals('I'))?.[1] : undefined

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

  return {
    quoteEventHexIds,
    quoteReplaceableCoordinates,
    rootEventId,
    rootCoordinateTag,
    rootKind,
    rootPubkey,
    rootUrl,
    parentEvent
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

function buildClientTag(handlerPubkey?: string, handlerIdentifier?: string, relay?: string) {
  // Use NIP-89 format if handler information is provided
  if (handlerPubkey && handlerIdentifier) {
    const aTag = `31990:${handlerPubkey}:${handlerIdentifier}`
    const tag = ['client', 'Jumble ImWald', aTag]
    if (relay) {
      tag.push(relay)
    }
    return tag
  }
  
  // Fallback to simple format for backward compatibility
  return ['client', 'jumble']
}

function buildAltTag() {
  return ['alt', 'This event was published by https://jumble.imwald.eu.']
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
    // Add r-tag with 'source' attribute
    tags.push(['r', sourceValue, 'source'])
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
  if (options?.addClientTag) {
    tags.push(buildClientTag())
    tags.push(buildAltTag())
  }

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
