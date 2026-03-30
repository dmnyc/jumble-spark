import { generateBech32IdFromATag, generateBech32IdFromETag } from '@/lib/tag'
import type { Event } from 'nostr-tools'

function pushBech32FromTag(tag: string[], out: string[]) {
  const [name, v] = tag
  if (name === 'e' && v && /^[0-9a-f]{64}$/i.test(v)) {
    const n = generateBech32IdFromETag(tag)
    if (n) out.push(n)
  } else if (name === 'a' && v?.trim()) {
    const n = generateBech32IdFromATag(tag)
    if (n) out.push(n)
  }
}

function dedupePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  return next
}

/** NIP-51 kind 10003 bookmark list: `e` / `a` → nevent/naddr, newest-first (matches home bookmarks feed). */
export function bookmarkBech32IdsFromListEvent(ev: Event | null): string[] {
  if (!ev?.tags?.length) return []
  const raw: string[] = []
  for (const t of ev.tags) pushBech32FromTag(t, raw)
  return dedupePreserveOrder(raw).reverse()
}

/** Kind 10001 pin list: `e` reversed then `a`, same ordering as profile pins. */
export function pinBech32IdsFromListEvent(ev: Event | null): string[] {
  if (!ev?.tags?.length) return []
  const tags = ev.tags
  const eTags = tags.filter((t) => t[0] === 'e')
  const aTags = tags.filter((t) => t[0] === 'a')
  const raw: string[] = []
  for (const t of [...eTags].reverse()) pushBech32FromTag(t, raw)
  for (const t of aTags) pushBech32FromTag(t, raw)
  return dedupePreserveOrder(raw)
}
