import { tagNameEquals } from '@/lib/tag'
import type { Event } from 'nostr-tools'

export const FOLLOW_SET_SPELL_PREFIX = 'followset:' as const

export function isFollowSetSpellId(s: string): boolean {
  return s.startsWith(FOLLOW_SET_SPELL_PREFIX)
}

export function encodeFollowSetSpellId(dTag: string): string {
  return `${FOLLOW_SET_SPELL_PREFIX}${encodeURIComponent(dTag)}`
}

export function decodeFollowSetSpellId(spellId: string): string | null {
  if (!isFollowSetSpellId(spellId)) return null
  try {
    const d = decodeURIComponent(spellId.slice(FOLLOW_SET_SPELL_PREFIX.length))
    return d.length > 0 ? d : null
  } catch {
    return null
  }
}

export function getFollowSetDTag(event: Event): string | undefined {
  return event.tags.find(tagNameEquals('d'))?.[1]
}

export function labelFollowSetEvent(event: Event): string {
  const title = event.tags.find(tagNameEquals('title'))?.[1]?.trim()
  if (title) return title
  const d = getFollowSetDTag(event)
  return d ?? 'follow set'
}

/** Hex pubkeys from `p` tags (NIP-51 follow sets). */
export function pubkeysFromFollowSetEvent(event: Event): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of event.tags) {
    if (t[0] !== 'p' || !t[1]) continue
    const pk = t[1].trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) continue
    if (seen.has(pk)) continue
    seen.add(pk)
    out.push(pk)
  }
  return out
}

/**
 * Latest event per `d` tag. Skips deprecated NIP-51 kind 30000 + `d`=mute (use kind 10000 mute list).
 */
/** Build NIP-51 kind 30000 tags (`d` required; optional metadata; then `p` in order). */
export function buildFollowSetTags(params: {
  d: string
  title?: string
  description?: string
  image?: string
  pubkeys: string[]
}): string[][] {
  const d = params.d.trim()
  if (!d || d === 'mute') throw new Error('Invalid list id')
  const tags: string[][] = [['d', d]]
  const title = params.title?.trim()
  if (title) tags.push(['title', title])
  const description = params.description?.trim()
  if (description) tags.push(['description', description])
  const image = params.image?.trim()
  if (image) tags.push(['image', image])
  for (const pk of params.pubkeys) {
    const hex = pk.trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(hex)) tags.push(['p', hex])
  }
  return tags
}

export function extractFollowSetEditorFields(event: Event): {
  d: string
  title: string
  description: string
  image: string
  pubkeys: string[]
} {
  return {
    d: getFollowSetDTag(event) ?? '',
    title: event.tags.find(tagNameEquals('title'))?.[1] ?? '',
    description: event.tags.find(tagNameEquals('description'))?.[1] ?? '',
    image: event.tags.find(tagNameEquals('image'))?.[1] ?? '',
    pubkeys: pubkeysFromFollowSetEvent(event)
  }
}

export function dedupeFollowSetEventsByD(events: Event[]): Event[] {
  const byD = new Map<string, Event>()
  for (const e of [...events].sort((a, b) => b.created_at - a.created_at)) {
    const d = getFollowSetDTag(e)
    if (!d || d === 'mute') continue
    if (!byD.has(d)) byD.set(d, e)
  }
  return [...byD.values()].sort((a, b) =>
    labelFollowSetEvent(a).localeCompare(labelFollowSetEvent(b), undefined, { sensitivity: 'base' })
  )
}
