import { METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS, METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS } from '@/constants'
import { normalizeHexPubkey } from '@/lib/pubkey'
import { normalizeUrl } from '@/lib/url'
import { queryService } from '@/services/client.service'
import type { Event } from 'nostr-tools'

/**
 * REQ across relays with {@link replaceableRace}, then keep the newest `created_at` row for this author+kind.
 * Use before appending to pin / bookmark / follow / mute / interest lists so merges don’t drop remote state.
 */
export async function fetchLatestReplaceableListEvent(
  pubkeyHex: string,
  kind: number,
  relayUrls: string[]
): Promise<Event | undefined> {
  const pk = normalizeHexPubkey(pubkeyHex)
  const urls = [...new Set(relayUrls.map((u) => normalizeUrl(u) || u).filter(Boolean))]
  if (!urls.length) return undefined
  const rows = await queryService.fetchEvents(
    urls,
    { authors: [pk], kinds: [kind], limit: 80 },
    {
      replaceableRace: true,
      eoseTimeout: METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
      globalTimeout: METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS
    }
  )
  if (!rows.length) return undefined
  return rows.reduce((best, e) => (e.created_at > best.created_at ? e : best))
}

function orderedUniqueEHexIds(tags: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    if (t[0] === 'e' && t[1] && /^[0-9a-f]{64}$/i.test(t[1])) {
      const id = t[1].toLowerCase()
      if (!seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  return out
}

/**
 * Next pin list (kind 10001) tags: preserve non-`e`/`a` tags and `a` pins, merge `e` hex ids with dedupe.
 */
export function buildPinListTagsAfterToggle(
  latest: Event | null | undefined,
  noteHexId: string,
  shouldPin: boolean
): string[][] {
  const tags = latest?.tags ?? []
  const meta = tags.filter((t) => t[0] !== 'e' && t[0] !== 'a')
  const aKeep = tags.filter((t) => t[0] === 'a' && t[1])
  let eIds = orderedUniqueEHexIds(tags)
  const id = noteHexId.toLowerCase()
  if (shouldPin) {
    if (!eIds.includes(id)) eIds = [...eIds, id]
  } else {
    eIds = eIds.filter((x) => x !== id)
  }
  return [...meta, ...aKeep, ...eIds.map((eid) => ['e', eid] as string[])]
}

/** Dedupe `p` tags (case-insensitive hex), preserve other tags and first-seen `p` casing. */
function dedupePTags(tags: string[][]): string[][] {
  const nonP = tags.filter((t) => t[0] !== 'p')
  const seen = new Set<string>()
  const pOut: string[][] = []
  for (const t of tags) {
    if (t[0] === 'p' && t[1]) {
      const k = t[1].toLowerCase()
      if (!seen.has(k)) {
        seen.add(k)
        pOut.push(['p', t[1]])
      }
    }
  }
  return [...nonP, ...pOut]
}

/** Append `p` pubkey if missing; dedupe all `p` tags. */
export function dedupePTagsAppendPubkey(tags: string[][], pubkey: string): string[][] {
  const pk = pubkey.toLowerCase()
  const nonP = tags.filter((t) => t[0] !== 'p')
  const seen = new Set<string>()
  const pOut: string[][] = []
  for (const t of tags) {
    if (t[0] === 'p' && t[1]) {
      const k = t[1].toLowerCase()
      if (!seen.has(k)) {
        seen.add(k)
        pOut.push(['p', t[1]])
      }
    }
  }
  if (!seen.has(pk)) {
    pOut.push(['p', pubkey])
  }
  return [...nonP, ...pOut]
}

/** Remove every `p` tag matching pubkey (case-insensitive); dedupe remaining `p` tags. */
export function removePubkeyFromPTags(tags: string[][], pubkey: string): string[][] {
  const pk = pubkey.toLowerCase()
  const filtered = tags.filter((t) => !(t[0] === 'p' && t[1]?.toLowerCase() === pk))
  return dedupePTags(filtered)
}
