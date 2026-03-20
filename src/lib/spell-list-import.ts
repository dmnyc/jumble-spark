/**
 * Merge tags from any fetched Nostr event into NIP-A7 spell draft fields (best-effort).
 */

import type { TSpellDraftParams } from '@/lib/draft-event'
import { isValidPubkey } from '@/lib/pubkey'
import { isWebsocketUrl, normalizeUrl } from '@/lib/url'
import type { Event } from 'nostr-tools'
import type { Filter } from 'nostr-tools'
import { queryService } from '@/services/client.service'

const HEX64 = /^[0-9a-f]{64}$/i

/** Metadata tags on list events — not mapped to spell filters. */
const LIST_METADATA_TAGS = new Set([
  'd',
  'title',
  'image',
  'description',
  'client',
  'alt',
  'expiration',
  'relay' // handled separately below
])

/** Tags we explicitly report as unsupported for spell import. */
const KNOWN_UNSUPPORTED = new Set(['emoji', 'word', 'group'])

export function dedupeAppendIds(base: string[], add: string[]): string[] {
  const seen = new Set(
    base
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
  const out = base.map((s) => s.trim()).filter(Boolean)
  for (const raw of add) {
    const t = raw.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

function mergeTagLetter(
  rows: { letter: string; values: string[] }[],
  letter: string,
  values: string[]
): { letter: string; values: string[] }[] {
  const vset = new Set(values.map((v) => v.trim()).filter(Boolean))
  if (vset.size === 0) return rows
  const mergedVals = [...vset]
  const idx = rows.findIndex((r) => r.letter === letter)
  if (idx < 0) return [...rows, { letter, values: mergedVals }]
  const prev = rows[idx]!
  const u = new Set([...prev.values.map((x) => x.trim()).filter(Boolean), ...mergedVals])
  return rows.map((r, i) => (i === idx ? { letter, values: [...u] } : r))
}

export type TListToSpellResult = {
  draft: TSpellDraftParams
  notices: string[]
  /** `a` coordinates to resolve to event ids in the background */
  pendingATags: string[]
}

/**
 * Merge public tags from a list/set event into spell draft fields.
 * Does not resolve `a` tags — use {@link resolveSpellListATags} after.
 */
export function applyListEventToSpellDraft(
  base: TSpellDraftParams,
  listEvent: Event
): TListToSpellResult {
  const notices: string[] = []
  const pendingATags: string[] = []
  const unsupportedCounts = new Map<string, number>()

  let draft: TSpellDraftParams = {
    ...base,
    ids: [...base.ids],
    authors: [...base.authors],
    relays: [...base.relays],
    topics: [...base.topics],
    tagFilters: base.tagFilters.map((r) => ({ letter: r.letter, values: [...r.values] })),
    kinds: [...base.kinds]
  }

  if ((listEvent.content ?? '').trim().length > 0) {
    notices.push('listImportContentSkipped')
  }

  const title = listEvent.tags.find((t) => t[0] === 'title')?.[1]?.trim()
  if (title && !(draft.name ?? '').trim()) {
    draft = { ...draft, name: title }
  }

  for (const tag of listEvent.tags) {
    const name = tag[0]
    if (!name) continue
    if (LIST_METADATA_TAGS.has(name) && name !== 'relay') continue

    if (name === 't' && tag[1]) {
      const v = tag[1].trim()
      if (v) draft.tagFilters = mergeTagLetter(draft.tagFilters, 't', [v])
      continue
    }

    if (name === 'e' && tag[1] && HEX64.test(tag[1])) {
      draft.ids = dedupeAppendIds(draft.ids, [tag[1]])
      continue
    }

    if (name === 'p' && tag[1] && isValidPubkey(tag[1])) {
      draft.authors = dedupeAppendIds(draft.authors, [tag[1]])
      continue
    }

    if (name === 'relay' && tag[1]) {
      const u = normalizeUrl(tag[1]) || tag[1]
      if (isWebsocketUrl(u)) draft.relays = dedupeAppendIds(draft.relays, [u])
      continue
    }

    if (name === 'r' && tag[1]) {
      const u = normalizeUrl(tag[1]) || tag[1]
      if (isWebsocketUrl(u)) draft.relays = dedupeAppendIds(draft.relays, [u])
      continue
    }

    if (name === 'a' && tag[1]) {
      pendingATags.push(tag[1])
      continue
    }

    if (KNOWN_UNSUPPORTED.has(name)) {
      unsupportedCounts.set(name, (unsupportedCounts.get(name) ?? 0) + 1)
      continue
    }

    if (LIST_METADATA_TAGS.has(name)) continue

    unsupportedCounts.set(name, (unsupportedCounts.get(name) ?? 0) + 1)
  }

  for (const [n, c] of unsupportedCounts) {
    if (n === 'emoji') notices.push('listImportUnsupportedEmoji')
    else notices.push(`listImportUnsupportedTag:${n}:${c}`)
  }

  return { draft, notices, pendingATags: [...new Set(pendingATags)] }
}

/** Resolve NIP-33 address strings (`kind:pubkey:d…`) to latest replaceable event ids. */
export async function resolveSpellListATags(
  aTags: string[],
  relayUrls: string[]
): Promise<{ ids: string[]; notices: string[] }> {
  const ids: string[] = []
  const notices: string[] = []
  const relays = relayUrls.length ? relayUrls : []

  await Promise.all(
    aTags.map(async (at) => {
      const parts = at.split(':')
      if (parts.length < 3) {
        notices.push(`listImportBadATag:${at.slice(0, 32)}`)
        return
      }
      const kind = parseInt(parts[0]!, 10)
      const author = parts[1]!
      const d = parts.slice(2).join(':')
      if (Number.isNaN(kind) || !isValidPubkey(author) || !d) {
        notices.push(`listImportBadATag:${at.slice(0, 32)}`)
        return
      }
      const filter: Filter = { kinds: [kind], authors: [author], '#d': [d], limit: 5 }
      try {
        const events =
          relays.length > 0
            ? await queryService.fetchEvents(relays, filter, { globalTimeout: 12_000 })
            : await queryService.fetchEvents([], filter, { globalTimeout: 12_000 })
        if (!events.length) {
          notices.push(`listImportATagNotFound:${at.slice(0, 48)}`)
          return
        }
        const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0]!
        ids.push(latest.id)
      } catch {
        notices.push(`listImportATagFailed:${at.slice(0, 48)}`)
      }
    })
  )

  return { ids: [...new Set(ids)], notices }
}
