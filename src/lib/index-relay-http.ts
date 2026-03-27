/**
 * HTTP JSON API for index-style relays (e.g. gc_index_relay: POST /api/events/filter, POST /api/events).
 * @see gc_index_relay lib/gc_index_relay_web/router.ex
 */
import logger from '@/lib/logger'
import { normalizeHttpRelayUrl } from '@/lib/url'
import type { Filter, Event as NEvent } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools'

function trimSlash(base: string): string {
  return base.replace(/\/+$/, '')
}

export function indexRelayFilterUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/events/filter`
}

export function indexRelayPublishUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/events`
}

/** Map a Nostr filter to gc_index_relay POST body (requires `limit` 1–100; strips unsupported keys). */
export function nostrFilterToIndexRelayBody(f: Filter): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const lim = f.limit
  const capped = lim == null || lim < 1 ? 100 : Math.min(100, lim)
  body.limit = capped
  if (f.ids?.length) body.ids = f.ids
  if (f.authors?.length) body.authors = f.authors
  if (f.kinds?.length) body.kinds = f.kinds
  if (f.since != null) body.since = f.since
  if (f.until != null) body.until = f.until
  for (const key of Object.keys(f)) {
    if (key.startsWith('#') && key.length === 2) {
      const v = (f as Record<string, unknown>)[key]
      if (Array.isArray(v) && v.length > 0) body[key] = v
    }
  }
  return body
}

function rawToVerifiedEvent(raw: Record<string, unknown>): NEvent | null {
  try {
    const id = raw.id
    const pubkey = raw.pubkey
    const created_at = raw.created_at
    const kind = raw.kind
    const tags = raw.tags
    const content = raw.content
    const sig = raw.sig
    if (
      typeof id !== 'string' ||
      typeof pubkey !== 'string' ||
      typeof created_at !== 'number' ||
      typeof kind !== 'number' ||
      !Array.isArray(tags) ||
      typeof content !== 'string' ||
      typeof sig !== 'string'
    ) {
      return null
    }
    const ev = { id, pubkey, created_at, kind, tags, content, sig } as NEvent
    return verifyEvent(ev) ? ev : null
  } catch {
    return null
  }
}

/**
 * Query one HTTP index relay. Runs one POST per filter when given an array.
 */
export async function queryIndexRelay(
  baseUrl: string,
  filter: Filter | Filter[],
  options?: { signal?: AbortSignal }
): Promise<NEvent[]> {
  const base = normalizeHttpRelayUrl(baseUrl) || baseUrl
  const endpoint = indexRelayFilterUrl(base)
  const filters = Array.isArray(filter) ? filter : [filter]
  const out: NEvent[] = []
  const seen = new Set<string>()
  for (const f of filters) {
    const body = nostrFilterToIndexRelayBody(filterForIndexRelay(f))
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: options?.signal
      })
      if (!res.ok) {
        logger.warn('[IndexRelayHttp] filter request failed', { endpoint, status: res.status })
        continue
      }
      const json = (await res.json()) as { data?: unknown }
      const data = json.data
      if (!Array.isArray(data)) continue
      for (const item of data) {
        if (!item || typeof item !== 'object') continue
        const ev = rawToVerifiedEvent(item as Record<string, unknown>)
        if (ev && !seen.has(ev.id)) {
          seen.add(ev.id)
          out.push(ev)
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      logger.warn('[IndexRelayHttp] filter request error', { endpoint, error: e })
    }
  }
  return out
}

function filterForIndexRelay(f: Filter): Filter {
  const { search: _s, ...rest } = f
  return rest as Filter
}

export async function publishEventToIndexRelay(
  baseUrl: string,
  event: NEvent,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const base = normalizeHttpRelayUrl(baseUrl) || baseUrl
  const endpoint = indexRelayPublishUrl(base)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      event: {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
        sig: event.sig
      }
    }),
    signal: options?.signal
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
}
