import { FAST_READ_RELAY_URLS, POLL_TYPE } from '@/constants'
import { TEmoji, TMailboxRelay, TPollType, TRelayList, TRelaySet, TPaymentInfo, TProfile } from '@/types'
import { Event, kinds } from 'nostr-tools'
import { buildATag } from './draft-event'
import { getReplaceableEventIdentifier } from './event'
import { getAmountFromInvoice, getLightningAddressFromProfile } from './lightning'
import { formatPubkey, pubkeyToNpub } from './pubkey'
import { generateBech32IdFromATag, generateBech32IdFromETag, tagNameEquals } from './tag'
import { isHttpRelayUrl, isWebsocketUrl, normalizeHttpRelayUrl, normalizeHttpUrl, normalizeUrl } from './url'
import { isTorBrowser } from './utils'
import logger from '@/lib/logger'

const emptyHttpRelayListFields = {
  httpRead: [] as string[],
  httpWrite: [] as string[],
  httpOriginalRelays: [] as TMailboxRelay[]
}

export function getRelayListFromEvent(event?: Event | null, blockedRelays?: string[]) {
  if (!event) {
    return {
      write: FAST_READ_RELAY_URLS,
      read: FAST_READ_RELAY_URLS,
      originalRelays: [],
      ...emptyHttpRelayListFields
    }
  }

  const torBrowserDetected = isTorBrowser()
  const relayList = { write: [], read: [], originalRelays: [] } as Pick<TRelayList, 'write' | 'read' | 'originalRelays'>
  
  // Normalize blocked relays for comparison
  const normalizedBlockedRelays = (blockedRelays || []).map(url => normalizeUrl(url) || url)
  
  event.tags.filter(tagNameEquals('r')).forEach(([, url, type]) => {
    // Filter out empty, invalid, or malformed URLs
    if (!url || typeof url !== 'string' || url.trim() === '' || url === 'ws://' || url === 'wss://') return
    if (!isWebsocketUrl(url)) return

    const normalizedUrl = normalizeUrl(url)
    if (!normalizedUrl) return
    
    // Filter out blocked relays
    if (normalizedBlockedRelays.includes(normalizedUrl)) return

    const scope = type === 'read' ? 'read' : type === 'write' ? 'write' : 'both'
    relayList.originalRelays.push({ url: normalizedUrl, scope })

    // Filter out .onion URLs if not using Tor browser
    if (normalizedUrl.endsWith('.onion/') && !torBrowserDetected) return

    if (type === 'write') {
      relayList.write.push(normalizedUrl)
    } else if (type === 'read') {
      relayList.read.push(normalizedUrl)
    } else {
      relayList.write.push(normalizedUrl)
      relayList.read.push(normalizedUrl)
    }
  })

  // If there are too many relays, use the default FAST_READ_RELAY_URLS
  // Because they don't know anything about relays, their settings cannot be trusted
  return {
    write: relayList.write.length && relayList.write.length <= 8 ? relayList.write : FAST_READ_RELAY_URLS,
    read: relayList.read.length && relayList.write.length <= 8 ? relayList.read : FAST_READ_RELAY_URLS,
    originalRelays: relayList.originalRelays,
    ...emptyHttpRelayListFields
  }
}

/** Kind 10243: `r` tags with http(s) URLs only; same read/write/both semantics as NIP-65. */
export function getHttpRelayListFromEvent(event?: Event | null, blockedRelays?: string[]) {
  const out = {
    httpRead: [] as string[],
    httpWrite: [] as string[],
    httpOriginalRelays: [] as TMailboxRelay[]
  }
  if (!event) return out

  const torBrowserDetected = isTorBrowser()
  const normalizedBlockedRelays = (blockedRelays || []).map((url) => normalizeUrl(url) || url)

  event.tags.filter(tagNameEquals('r')).forEach(([, url, type]) => {
    if (!url || typeof url !== 'string' || url.trim() === '') return
    if (!isHttpRelayUrl(url)) return

    const normalizedUrl = normalizeHttpRelayUrl(url)
    if (!normalizedUrl) return

    const asWs = normalizeUrl(url)
    if (asWs && normalizedBlockedRelays.includes(asWs)) return
    if (normalizedBlockedRelays.includes(normalizedUrl)) return

    const scope = type === 'read' ? 'read' : type === 'write' ? 'write' : 'both'
    out.httpOriginalRelays.push({ url: normalizedUrl, scope })

    if ((normalizedUrl.includes('.onion') || normalizedUrl.endsWith('.onion/')) && !torBrowserDetected) return

    if (type === 'write') {
      out.httpWrite.push(normalizedUrl)
    } else if (type === 'read') {
      out.httpRead.push(normalizedUrl)
    } else {
      out.httpWrite.push(normalizedUrl)
      out.httpRead.push(normalizedUrl)
    }
  })

  return {
    httpRead: Array.from(new Set(out.httpRead)),
    httpWrite: Array.from(new Set(out.httpWrite)),
    httpOriginalRelays: out.httpOriginalRelays
  }
}

/** Kind 0 JSON `nip05` may be a string or string[]; tags are always strings. */
function firstNip05StringFromJson(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t || undefined
  }
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'string') {
        const t = x.trim()
        if (t) return t
      }
    }
  }
  return undefined
}

function nip05ListFromJson(raw: unknown): string[] | undefined {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (s: string) => {
    const t = s.trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  if (typeof raw === 'string') add(raw)
  else if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'string') add(x)
    }
  }
  return out.length > 0 ? out : undefined
}

export function getProfileFromEvent(event: Event) {
  // Parse JSON content as fallback
  let profileObj: any = {}
  try {
    profileObj = JSON.parse(event.content || '{}')
  } catch (err) {
    logger.error('Failed to parse event metadata JSON', { error: err, content: event.content })
  }

  // Extract values from tags (preferred over JSON content)
  const nip05Tags = event.tags.filter(tag => tag[0] === 'nip05' && tag[1]).map(tag => tag[1])
  const websiteTags = event.tags.filter(tag => tag[0] === 'website' && tag[1]).map(tag => tag[1])
  const lud06Tags = event.tags.filter(tag => tag[0] === 'lud06' && tag[1]).map(tag => tag[1])
  const lud16Tags = event.tags.filter(tag => tag[0] === 'lud16' && tag[1]).map(tag => tag[1])
  
  // Use first tag entry for single values, or fallback to JSON
  const nip05 =
    nip05Tags.length > 0 ? nip05Tags[0] : firstNip05StringFromJson(profileObj.nip05)
  const nip05List =
    nip05Tags.length > 0 ? nip05Tags : nip05ListFromJson(profileObj.nip05)
  
  const website = websiteTags.length > 0 
    ? normalizeHttpUrl(websiteTags[0]) 
    : (profileObj.website ? normalizeHttpUrl(profileObj.website) : undefined)
  const websiteList = websiteTags.length > 0 
    ? websiteTags.map(w => normalizeHttpUrl(w))
    : (profileObj.website ? [normalizeHttpUrl(profileObj.website)] : undefined)
  
  // Use FIRST lightning tag from kind 0 only (for zap button - do not use subsequent tags or kind 10133)
  const lud06 = lud06Tags.length > 0 ? lud06Tags[0] : profileObj.lud06
  const lud16 = lud16Tags.length > 0 ? lud16Tags[0] : profileObj.lud16
  
  // Build lightning address from FIRST tag or JSON (prefer first tag, fallback to JSON)
  // This is used by the zap button and should only come from kind 0, not kind 10133 payto
  const lightningAddressFromTags = lud16 || lud06
  const lightningAddressFromJson = getLightningAddressFromProfile({ lud06: profileObj.lud06, lud16: profileObj.lud16 } as TProfile)
  const lightningAddress = lightningAddressFromTags || lightningAddressFromJson
  
  // Build list of all lightning addresses (from tags first, then JSON)
  const lightningAddressList = [...new Set([
    ...(lud16Tags.length > 0 ? lud16Tags : []),
    ...(lud06Tags.length > 0 ? lud06Tags : []),
    ...(profileObj.lud16 ? [profileObj.lud16] : []),
    ...(profileObj.lud06 ? [profileObj.lud06] : []),
    ...(lightningAddressFromJson && !lightningAddressFromTags ? [lightningAddressFromJson] : [])
  ])].filter(Boolean)
  
  const username =
    profileObj.display_name?.trim() ||
    profileObj.name?.trim() ||
    nip05?.split('@')[0]?.trim()
  
  return {
    pubkey: event.pubkey,
    npub: pubkeyToNpub(event.pubkey) ?? '',
    banner: profileObj.banner,
    avatar: profileObj.picture,
    username: username || formatPubkey(event.pubkey),
    original_username: username,
    nip05,
    nip05List: nip05List && nip05List.length > 0 ? nip05List : undefined,
    about: profileObj.about,
    website,
    websiteList: websiteList && websiteList.length > 0 ? websiteList : undefined,
    lud06,
    lud16,
    lightningAddress,
    lightningAddressList: lightningAddressList.length > 0 ? lightningAddressList : undefined,
    created_at: event.created_at
  }
}

export function getPaymentInfoFromEvent(event: Event): TPaymentInfo | null {
  if (event.kind !== 10133) return null
  
  // Parse JSON content as fallback
  let paymentInfo: any = {}
  try {
    if (event.content) {
      paymentInfo = JSON.parse(event.content)
    }
  } catch (err) {
    logger.error('Failed to parse payment info JSON', { error: err, content: event.content })
  }

  // Extract payment methods from tags (preferred over JSON content)
  // NIP-A3 format: ["payto", "<type>", "<authority>", "<optional_extra_1>", ...]
  // tag[0] = "payto", tag[1] = type, tag[2] = authority
  const paytoTags = event.tags.filter(tag => tag[0] === 'payto' && tag[1] && tag[2])
  
  // Build methods array from tags
  const methods: TPaymentInfo['methods'] = []
  
  // Parse each payto tag according to NIP-A3 spec
  paytoTags.forEach((tag) => {
    const type = tag[1]?.toLowerCase() || 'lightning' // Normalize to lowercase per spec
    const authority = tag[2] || ''
    const extra = tag.slice(3) // Optional extra fields
    
    // Build payto URI: payto://<type>/<authority>
    const paytoUri = `payto://${type}/${authority}`
    
    const method: any = {
      type,
      authority,
      payto: paytoUri,
      // Map common types to display names
      displayType: type === 'lightning' ? 'Lightning Network' : 
                   type === 'bitcoin' ? 'Bitcoin' :
                   type === 'ethereum' ? 'Ethereum' :
                   type === 'monero' ? 'Monero' :
                   type === 'nano' ? 'Nano' :
                   type === 'cashme' ? 'Cash App' :
                   type === 'revolut' ? 'Revolut' :
                   type === 'venmo' ? 'Venmo' :
                   type.charAt(0).toUpperCase() + type.slice(1),
      ...(extra.length > 0 && { extra })
    }
    methods.push(method)
  })
  
  // If we have methods in JSON but no tags, use JSON methods
  if (methods.length === 0 && paymentInfo.methods && Array.isArray(paymentInfo.methods)) {
    methods.push(...paymentInfo.methods.map((m: any) => ({
      ...m,
      payto: m.payto || (m.type && m.authority ? `payto://${m.type}/${m.authority}` : undefined)
    })))
  }
  
  // If we have payto at root level in JSON but no methods array
  if (methods.length === 0 && paymentInfo.payto) {
    methods.push({
      payto: paymentInfo.payto,
      type: paymentInfo.type || 'lightning',
      authority: paymentInfo.authority,
      displayType: paymentInfo.type === 'lightning' ? 'Lightning Network' : paymentInfo.type || 'Payment'
    })
  }
  
  // Build result
  const result: TPaymentInfo = {
    ...paymentInfo,
    methods: methods.length > 0 ? methods : undefined
  }
  
  logger.debug('Parsed payment info', { 
    hasMethods: !!result.methods, 
    methodsCount: result.methods?.length || 0,
    paytoTagsCount: paytoTags.length,
    content: event.content?.substring(0, 200)
  })
  
  return result
}

export function getRelaySetFromEvent(event: Event, blockedRelays?: string[]): TRelaySet {
  const id = getReplaceableEventIdentifier(event)
  
  // Normalize blocked relays for comparison
  const normalizedBlockedRelays = (blockedRelays || []).map(url => normalizeUrl(url) || url)
  
  const relayUrls = event.tags
    .filter(tagNameEquals('relay'))
    .map((tag) => tag[1])
    .filter((url) => url && isWebsocketUrl(url))
    .map((url) => normalizeUrl(url))
    .filter((url) => !normalizedBlockedRelays.includes(url)) // Filter out blocked relays

  let name = event.tags.find(tagNameEquals('title'))?.[1]
  if (!name) {
    name = id
  }

  return { id, name, relayUrls, aTag: buildATag(event) }
}

export function getZapInfoFromEvent(receiptEvent: Event) {
  if (receiptEvent.kind !== kinds.Zap) return null

  let senderPubkey: string | undefined
  let recipientPubkey: string | undefined
  let originalEventId: string | undefined
  let eventId: string | undefined
  let invoice: string | undefined
  let amount: number | undefined
  let comment: string | undefined
  let description: string | undefined
  let preimage: string | undefined
  try {
    receiptEvent.tags.forEach((tag) => {
      const [tagName, tagValue] = tag
      switch (tagName) {
        case 'P':
          senderPubkey = tagValue
          break
        case 'p':
          recipientPubkey = tagValue
          break
        case 'e':
        case 'E':
          originalEventId = tag[1]
          eventId = generateBech32IdFromETag(tag)
          break
        case 'a':
          originalEventId = tag[1]
          eventId = generateBech32IdFromATag(tag)
          break
        case 'bolt11':
          invoice = tagValue
          break
        case 'description':
          description = tagValue
          break
        case 'preimage':
          preimage = tagValue
          break
      }
    })
    if (!recipientPubkey || !invoice) return null
    
    // Try to parse amount from invoice, fallback to description if invoice is invalid
    try {
      amount = getAmountFromInvoice(invoice)
    } catch {
      amount = 0
    }
    
    if (description) {
      try {
        const zapRequest = JSON.parse(description)
        comment = zapRequest.content
        if (!senderPubkey) {
          senderPubkey = zapRequest.pubkey
        }
        // Extract recipient from zap request
        // Priority: e tag (event) -> a tag (addressable event) -> p tag (profile)
        if (zapRequest.tags) {
          const eTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'e')
          const aTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'a')
          const pTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'p')
          
          if (eTag && eTag[1]) {
            // Event zap - recipient is the author of the zapped event
            // We'll need to fetch this event to get the author's pubkey
            // For now, fall back to p tag
            if (pTag && pTag[1]) {
              recipientPubkey = pTag[1]
            }
          } else if (aTag && aTag[1]) {
            // Addressable event zap - recipient is the author of the zapped event
            // We'll need to fetch this event to get the author's pubkey
            // For now, fall back to p tag
            if (pTag && pTag[1]) {
              recipientPubkey = pTag[1]
            }
          } else if (pTag && pTag[1]) {
            // Profile zap - recipient is directly specified
            recipientPubkey = pTag[1]
          }
        }
        // If invoice parsing failed, try to get amount from zap request tags
        if (amount === 0 && zapRequest.tags) {
          const amountTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'amount')
          if (amountTag && amountTag[1]) {
            const millisats = parseInt(amountTag[1])
            amount = millisats / 1000 // Convert millisats to sats
          }
        }
      } catch {
        // ignore
      }
    }

    return {
      senderPubkey,
      recipientPubkey,
      eventId,
      originalEventId,
      invoice,
      amount,
      comment,
      preimage
    }
  } catch {
    return null
  }
}

/**
 * Kind 9735: include in timelines and reply lists only when amount (sats) is known and at least `thresholdSats`.
 * Matches {@link NoteList} zap filtering.
 */
export function shouldIncludeZapReceiptAtReplyThreshold(receipt: Event, thresholdSats: number): boolean {
  if (receipt.kind !== kinds.Zap) return true
  const zapInfo = getZapInfoFromEvent(receipt)
  if (!zapInfo || zapInfo.amount === undefined || zapInfo.amount === 0 || zapInfo.amount < thresholdSats) {
    return false
  }
  return true
}

// Helper function to convert d-tag to title case
export function dTagToTitleCase(dTag: string): string {
  return dTag
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function getLongFormArticleMetadataFromEvent(event: Event) {
  let title: string | undefined
  let summary: string | undefined
  let image: string | undefined
  const tags = new Set<string>()

  event.tags.forEach(([tagName, tagValue]) => {
    if (tagName === 'title') {
      title = tagValue
    } else if (tagName === 'summary') {
      summary = tagValue
    } else if (tagName === 'image') {
      image = tagValue
    } else if (tagName === 't' && tagValue && tags.size < 6) {
      tags.add(tagValue.toLowerCase())
    }
  })

  if (!title) {
    const dTag = event.tags.find(tagNameEquals('d'))?.[1]
    if (dTag) {
      title = dTagToTitleCase(dTag)
    }
  }

  return { title, summary, image, tags: Array.from(tags) }
}

export function getLiveEventMetadataFromEvent(event: Event) {
  let title: string | undefined
  let summary: string | undefined
  let image: string | undefined
  let status: string | undefined
  const tags = new Set<string>()

  event.tags.forEach(([tagName, tagValue]) => {
    if (tagName === 'title') {
      title = tagValue
    } else if (tagName === 'summary') {
      summary = tagValue
    } else if (tagName === 'image') {
      image = tagValue
    } else if (tagName === 'status') {
      status = tagValue
    } else if (tagName === 't' && tagValue && tags.size < 6) {
      tags.add(tagValue.toLowerCase())
    }
  })

  if (!title) {
    const dTag = event.tags.find(tagNameEquals('d'))?.[1]
    if (dTag) {
      title = dTagToTitleCase(dTag)
    } else {
      title = 'no title'
    }
  }

  return { title, summary, image, status, tags: Array.from(tags) }
}

export function getGroupMetadataFromEvent(event: Event) {
  let d: string | undefined
  let name: string | undefined
  let about: string | undefined
  let picture: string | undefined
  const tags = new Set<string>()

  event.tags.forEach(([tagName, tagValue]) => {
    if (tagName === 'name') {
      name = tagValue
    } else if (tagName === 'about') {
      about = tagValue
    } else if (tagName === 'picture') {
      picture = tagValue
    } else if (tagName === 't' && tagValue) {
      tags.add(tagValue.toLowerCase())
    } else if (tagName === 'd') {
      d = tagValue
    }
  })

  if (!name) {
    name = d ?? 'no name'
  }

  return { d, name, about, picture, tags: Array.from(tags) }
}

export function getCommunityDefinitionFromEvent(event: Event) {
  let name: string | undefined
  let description: string | undefined
  let image: string | undefined

  event.tags.forEach(([tagName, tagValue]) => {
    if (tagName === 'name') {
      name = tagValue
    } else if (tagName === 'description') {
      description = tagValue
    } else if (tagName === 'image') {
      image = tagValue
    }
  })

  if (!name) {
    name = event.tags.find(tagNameEquals('d'))?.[1] ?? 'no name'
  }

  return { name, description, image }
}

export function getPollMetadataFromEvent(event: Event) {
  const options: { id: string; label: string }[] = []
  const relayUrls: string[] = []
  let pollType: TPollType = POLL_TYPE.SINGLE_CHOICE
  let endsAt: number | undefined

  for (const [tagName, ...tagValues] of event.tags) {
    if (tagName === 'option' && tagValues.length >= 2) {
      const [optionId, label] = tagValues
      if (optionId && label) {
        options.push({ id: optionId, label })
      }
    } else if (tagName === 'relay' && tagValues[0]) {
      const normalizedUrl = normalizeUrl(tagValues[0])
      if (normalizedUrl) relayUrls.push(tagValues[0])
    } else if (tagName === 'polltype' && tagValues[0]) {
      if (tagValues[0] === POLL_TYPE.MULTIPLE_CHOICE) {
        pollType = POLL_TYPE.MULTIPLE_CHOICE
      }
    } else if (tagName === 'endsAt' && tagValues[0]) {
      const timestamp = parseInt(tagValues[0])
      if (!isNaN(timestamp)) {
        endsAt = timestamp
      }
    }
  }

  if (options.length === 0) {
    return null
  }

  return {
    options,
    pollType,
    relayUrls,
    endsAt
  }
}

export function getPollResponseFromEvent(
  event: Event,
  optionIds: string[],
  isMultipleChoice: boolean
) {
  const selectedOptionIds: string[] = []

  for (const [tagName, ...tagValues] of event.tags) {
    if (tagName === 'response' && tagValues[0]) {
      if (optionIds && !optionIds.includes(tagValues[0])) {
        continue // Skip if the response is not in the provided optionIds
      }
      selectedOptionIds.push(tagValues[0])
    }
  }

  // If no valid responses are found, return null
  if (selectedOptionIds.length === 0) {
    return null
  }

  // If multiple responses are selected but the poll is not multiple choice, return null
  if (selectedOptionIds.length > 1 && !isMultipleChoice) {
    return null
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    selectedOptionIds,
    created_at: event.created_at
  }
}

export function getEmojisAndEmojiSetsFromEvent(event: Event) {
  const emojis: TEmoji[] = []
  const emojiSetPointers: string[] = []

  event.tags.forEach(([tagName, ...tagValues]) => {
    if (tagName === 'emoji' && tagValues.length >= 2) {
      emojis.push({
        shortcode: tagValues[0],
        url: tagValues[1]
      })
    } else if (tagName === 'a' && tagValues[0]) {
      emojiSetPointers.push(tagValues[0])
    }
  })

  return { emojis, emojiSetPointers }
}

export function getEmojisFromEvent(event: Event): TEmoji[] {
  const emojis: TEmoji[] = []

  event.tags.forEach(([tagName, ...tagValues]) => {
    if (tagName === 'emoji' && tagValues.length >= 2) {
      emojis.push({
        shortcode: tagValues[0],
        url: tagValues[1]
      })
    }
  })

  return emojis
}

export function getStarsFromRelayReviewEvent(event: Event): number {
  const ratingTag = event.tags.find((t) => t[0] === 'rating')
  if (!ratingTag?.[1]?.trim()) return 0
  const raw = parseFloat(ratingTag[1])
  if (Number.isNaN(raw) || raw <= 0) return 0
  // This app publishes `rating` as stars/5 (e.g. 5★ → "1"); scale back to 1–5.
  if (raw <= 1) {
    const scaled = raw * 5
    if (scaled > 0 && scaled <= 5) return scaled
    return 0
  }
  // Many clients use a plain 1–5 value in the tag.
  if (raw >= 1 && raw <= 5) return raw
  return 0
}

/** Relay URL from the `d` tag (NIP for relay reviews). */
export function getRelayUrlFromRelayReviewEvent(event: Event): string | undefined {
  const d = event.tags.find((t) => t[0] === 'd')?.[1]?.trim()
  if (!d) return undefined
  return normalizeUrl(d) || d
}
