import { ExtendedKind } from '@/constants'
import { getAmountFromInvoice } from '@/lib/lightning'
import { tagNameEquals } from '@/lib/tag'
import { normalizeUrl } from '@/lib/url'
import type { Event, EventTemplate } from 'nostr-tools'
import { kinds } from 'nostr-tools'

export type TZapPollOption = { index: number; label: string }

export type TZapPollMeta = {
  options: TZapPollOption[]
  recipients: { pubkey: string; relay: string }[]
  valueMinimum?: number
  valueMaximum?: number
  consensusThreshold?: number
  closedAt?: number
  primaryRelay: string
}

/** Parse NIP-B9 kind 6969 into structured metadata. */
export function parseZapPollEvent(event: Event): TZapPollMeta | null {
  if (event.kind !== ExtendedKind.ZAP_POLL) return null
  const pTags = event.tags.filter(tagNameEquals('p'))
  const recipients: { pubkey: string; relay: string }[] = []
  for (const t of pTags) {
    const pk = t[1]?.trim().toLowerCase()
    const relay = t[2]?.trim()
    if (!pk || !/^[0-9a-f]{64}$/.test(pk) || !relay) continue
    const n = normalizeUrl(relay) || relay
    recipients.push({ pubkey: pk, relay: n })
  }
  if (recipients.length === 0) return null

  const options: TZapPollOption[] = []
  for (const t of event.tags) {
    if (t[0] !== 'poll_option' || t[1] == null || t[2] == null) continue
    const idx = parseInt(t[1], 10)
    if (Number.isNaN(idx)) continue
    options.push({ index: idx, label: t[2] })
  }
  options.sort((a, b) => a.index - b.index)
  if (options.length < 2) return null

  const vmin = event.tags.find(tagNameEquals('value_minimum'))?.[1]
  const vmax = event.tags.find(tagNameEquals('value_maximum'))?.[1]
  const consensus = event.tags.find(tagNameEquals('consensus_threshold'))?.[1]
  const closed = event.tags.find(tagNameEquals('closed_at'))?.[1]

  const valueMinimum = vmin != null && vmin !== '' ? parseInt(vmin, 10) : undefined
  const valueMaximum = vmax != null && vmax !== '' ? parseInt(vmax, 10) : undefined
  let consensusThreshold =
    consensus != null && consensus !== '' ? parseInt(consensus, 10) : undefined
  if (consensusThreshold === 0) consensusThreshold = undefined

  let closedAt = closed != null && closed !== '' ? parseInt(closed, 10) : undefined
  if (closedAt != null && closedAt <= event.created_at) closedAt = undefined

  return {
    options,
    recipients,
    valueMinimum: Number.isFinite(valueMinimum) ? valueMinimum : undefined,
    valueMaximum: Number.isFinite(valueMaximum) ? valueMaximum : undefined,
    consensusThreshold: Number.isFinite(consensusThreshold) ? consensusThreshold : undefined,
    closedAt: Number.isFinite(closedAt) ? closedAt : undefined,
    primaryRelay: recipients[0]!.relay
  }
}

export function isZapPollPastDeadline(_poll: Event, meta: TZapPollMeta, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!meta.closedAt) return false
  return nowSec > meta.closedAt
}

export function isZapPollVoteEligible(
  poll: Event,
  meta: TZapPollMeta,
  voterPubkey: string,
  amountSats: number
): { ok: true } | { ok: false; reason: string } {
  const v = voterPubkey.trim().toLowerCase()
  if (v === poll.pubkey) return { ok: false, reason: 'Poll authors cannot vote on their own poll' }
  if (meta.closedAt && Math.floor(Date.now() / 1000) > meta.closedAt) {
    return { ok: false, reason: 'Poll is closed' }
  }
  if (meta.valueMinimum != null && amountSats < meta.valueMinimum) {
    return { ok: false, reason: `Minimum ${meta.valueMinimum} sats` }
  }
  if (meta.valueMaximum != null && amountSats > meta.valueMaximum) {
    return { ok: false, reason: `Maximum ${meta.valueMaximum} sats` }
  }
  return { ok: true }
}

/** Build kind 9734 template for a NIP-B9 vote (after validation). */
export function buildZapPollVoteRequestTemplate(params: {
  poll: Event
  meta: TZapPollMeta
  recipientPubkey: string
  optionIndex: number
  amountMillisats: number
  relays: string[]
  comment?: string
}): EventTemplate {
  const { poll, meta, recipientPubkey, optionIndex, amountMillisats, relays, comment } = params
  const relay = meta.primaryRelay
  const pk = recipientPubkey.trim().toLowerCase()
  const tags: string[][] = [
    ['p', pk, relay],
    ['e', poll.id, relay],
    ['relays', ...relays],
    ['amount', String(amountMillisats)],
    ['k', '6969'],
    ['poll_option', String(optionIndex)]
  ]
  return {
    kind: ExtendedKind.ZAP_REQUEST,
    created_at: Math.round(Date.now() / 1000),
    content: comment ?? '',
    tags
  }
}

export type TZapPollTally = {
  satsByOption: Map<number, number>
  totalSats: number
  receiptCountByOption: Map<number, number>
}

function getPollOptionFromZapRequestTags(tags: unknown): number | undefined {
  if (!Array.isArray(tags)) return undefined
  const po = (tags as string[][]).find((t) => t[0] === 'poll_option' && t[1] != null)
  if (!po) return undefined
  const n = parseInt(po[1], 10)
  return Number.isNaN(n) ? undefined : n
}

function getKindFromZapRequestTags(tags: unknown): string | undefined {
  if (!Array.isArray(tags)) return undefined
  const k = (tags as string[][]).find((t) => t[0] === 'k' && t[1] != null)
  return k?.[1]
}

/**
 * Tally NIP-B9 results from zap receipts (kind 9735) per NIP-B9 rules (sats only).
 */
export function tallyZapPollFromReceipts(poll: Event, meta: TZapPollMeta, receipts: Event[]): TZapPollTally {
  const satsByOption = new Map<number, number>()
  const receiptCountByOption = new Map<number, number>()
  const recipientSet = new Set(meta.recipients.map((r) => r.pubkey))
  const equalMinMax =
    meta.valueMinimum != null &&
    meta.valueMaximum != null &&
    meta.valueMinimum === meta.valueMaximum
  const oneVotePerOptionPerUser = equalMinMax
  const seenUserOption = new Set<string>()

  let totalSats = 0

  for (const opt of meta.options) {
    satsByOption.set(opt.index, 0)
    receiptCountByOption.set(opt.index, 0)
  }

  for (const r of receipts) {
    if (r.kind !== kinds.Zap) continue
    const desc = r.tags.find(tagNameEquals('description'))?.[1]
    if (!desc) continue
    let zapReq: { pubkey?: string; tags?: string[][] }
    try {
      zapReq = JSON.parse(desc) as { pubkey?: string; tags?: string[][] }
    } catch {
      continue
    }
    if (getKindFromZapRequestTags(zapReq.tags) !== '6969') continue
    const eTag = zapReq.tags?.find((t) => t[0] === 'e' && t[1])
    if (!eTag || eTag[1] !== poll.id) continue
    const voterPk = (zapReq.pubkey ?? '').trim().toLowerCase()
    if (!voterPk || voterPk === poll.pubkey) continue
    const pTag = zapReq.tags?.find((t) => t[0] === 'p' && t[1])
    if (!pTag || !recipientSet.has(pTag[1].trim().toLowerCase())) continue
    const optIdx = getPollOptionFromZapRequestTags(zapReq.tags)
    if (optIdx === undefined || !satsByOption.has(optIdx)) continue

    const bolt11 = r.tags.find(tagNameEquals('bolt11'))?.[1]
    if (!bolt11) continue
    let amountSats: number
    try {
      amountSats = getAmountFromInvoice(bolt11)
    } catch {
      continue
    }
    if (!Number.isFinite(amountSats) || amountSats <= 0) continue

    if (meta.valueMaximum != null && amountSats > meta.valueMaximum) continue
    if (meta.valueMinimum != null && amountSats < meta.valueMinimum) continue

    if (meta.closedAt != null) {
      if (r.created_at < poll.created_at || r.created_at > meta.closedAt) continue
    }

    if (oneVotePerOptionPerUser) {
      const key = `${voterPk}:${optIdx}`
      if (seenUserOption.has(key)) continue
      seenUserOption.add(key)
    }

    satsByOption.set(optIdx, (satsByOption.get(optIdx) ?? 0) + amountSats)
    receiptCountByOption.set(optIdx, (receiptCountByOption.get(optIdx) ?? 0) + 1)
    totalSats += amountSats
  }

  return { satsByOption, totalSats, receiptCountByOption }
}

export function userHasZappedPoll(
  pollId: string,
  userPubkey: string,
  receipts: Event[]
): boolean {
  const pk = userPubkey.trim().toLowerCase()
  for (const r of receipts) {
    if (r.kind !== kinds.Zap) continue
    const desc = r.tags.find(tagNameEquals('description'))?.[1]
    if (!desc) continue
    try {
      const zapReq = JSON.parse(desc) as { pubkey?: string; tags?: string[][] }
      const eTag = zapReq.tags?.find((t) => t[0] === 'e' && t[1])
      if (eTag?.[1] !== pollId) continue
      if ((zapReq.pubkey ?? '').trim().toLowerCase() === pk) return true
      const pSender = r.tags.find(tagNameEquals('P'))?.[1]
      if (pSender && pSender.trim().toLowerCase() === pk) return true
    } catch {
      continue
    }
  }
  return false
}

export function userZapPollVoteOption(
  pollId: string,
  userPubkey: string,
  receipts: Event[]
): number | undefined {
  const pk = userPubkey.trim().toLowerCase()
  for (const r of receipts) {
    if (r.kind !== kinds.Zap) continue
    const desc = r.tags.find(tagNameEquals('description'))?.[1]
    if (!desc) continue
    try {
      const zapReq = JSON.parse(desc) as { pubkey?: string; tags?: string[][] }
      if (getKindFromZapRequestTags(zapReq.tags) !== '6969') continue
      const eTag = zapReq.tags?.find((t) => t[0] === 'e' && t[1])
      if (eTag?.[1] !== pollId) continue
      if ((zapReq.pubkey ?? '').trim().toLowerCase() !== pk) continue
      return getPollOptionFromZapRequestTags(zapReq.tags)
    } catch {
      continue
    }
  }
  return undefined
}

/** Receipts where user is the zapper and vote targets a zap poll (for profile). */
export function filterZapPollVoteReceiptsForVoter(receipts: Event[], profilePubkey: string): Event[] {
  const pk = profilePubkey.trim().toLowerCase()
  return receipts.filter((r) => {
    if (r.kind !== kinds.Zap) return false
    const pSender = r.tags.find(tagNameEquals('P'))?.[1]?.trim().toLowerCase()
    if (pSender !== pk) return false
    const desc = r.tags.find(tagNameEquals('description'))?.[1]
    if (!desc) return false
    try {
      const zapReq = JSON.parse(desc) as { tags?: string[][] }
      return getKindFromZapRequestTags(zapReq.tags) === '6969'
    } catch {
      return false
    }
  })
}

export function getPollIdFromZapReceipt(receipt: Event): string | undefined {
  const desc = receipt.tags.find(tagNameEquals('description'))?.[1]
  if (!desc) return undefined
  try {
    const zapReq = JSON.parse(desc) as { tags?: string[][] }
    const eTag = zapReq.tags?.find((t) => t[0] === 'e' && t[1])
    return eTag?.[1]
  } catch {
    return undefined
  }
}
