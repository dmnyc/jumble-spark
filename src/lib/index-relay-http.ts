/**
 * HTTP JSON API for index-style relays (e.g. gc_index_relay: POST /api/events/filter, POST /api/events).
 * @see gc_index_relay lib/gc_index_relay_web/router.ex
 *
 * **Local dev:** loopback bases (`http://localhost:*` / `http://127.0.0.1:*`) are automatically fetched via
 * the Vite same-origin proxy `/dev-index-relay` → `VITE_DEV_INDEX_RELAY_TARGET` (default in `vite.config.ts`).
 * Production and remote HTTPS relays are unchanged; those need CORS on the relay or a real reverse proxy.
 */
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import logger from '@/lib/logger'
import { devProxyLoopbackHttpRelayBase, normalizeHttpRelayUrl } from '@/lib/url'
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

const INDEX_RELAY_HTTP_WARN_COOLDOWN_MS = 5000
const lastIndexRelayHttpWarnAtByEndpoint = new Map<string, number>()

const DEV_INDEX_RELAY_TRANSPORT_HINT_MS = 60_000
let lastDevIndexRelayTransportHintAt = 0

function warnIndexRelayHttpThrottled(endpoint: string, message: string, meta: Record<string, unknown>) {
  const now = Date.now()
  const prev = lastIndexRelayHttpWarnAtByEndpoint.get(endpoint) ?? 0
  if (now - prev < INDEX_RELAY_HTTP_WARN_COOLDOWN_MS) return
  lastIndexRelayHttpWarnAtByEndpoint.set(endpoint, now)
  logger.warn(message, meta)
}

/** True when the relay cannot be reached (down, DNS, browser blocked, etc.). Not HTTP 4xx/5xx from a live server. */
export function isIndexRelayTransportFailure(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  const e = err as Error & { name?: string; cause?: unknown }
  if (e.name === 'AbortError') return false
  if (e instanceof TypeError) {
    const m = e.message || ''
    if (/failed to fetch|load failed|networkerror when attempting to fetch resource/i.test(m)) return true
  }
  const msg = String((e as Error).message || err)
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ERR_CONNECTION|network request failed|fetch failed/i.test(msg)) return true
  if (e.cause != null && isIndexRelayTransportFailure(e.cause)) return true
  return false
}

export class IndexRelayTransportError extends Error {
  constructor(cause?: unknown) {
    super('Index relay unreachable')
    this.name = 'IndexRelayTransportError'
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause
  }
}

function isDevViteIndexRelayProxyPath(endpoint: string): boolean {
  return import.meta.env.DEV && endpoint.includes('/dev-index-relay')
}

function maybeLogDevIndexRelayUnreachableHint(): void {
  if (import.meta.env.PROD || typeof window === 'undefined') return
  const now = Date.now()
  if (now - lastDevIndexRelayTransportHintAt < DEV_INDEX_RELAY_TRANSPORT_HINT_MS) return
  lastDevIndexRelayTransportHintAt = now
  logger.info(
    'HTTP index relay is unreachable in dev. Start the relay, or set VITE_DEV_INDEX_RELAY_TARGET if it is not on the default URL.'
  )
}

function handleFilterTransportFailure(endpoint: string, err?: unknown): void {
  if (import.meta.env.DEV && isDevViteIndexRelayProxyPath(endpoint)) {
    logger.debug('[IndexRelayHttp] filter unreachable', { endpoint })
    maybeLogDevIndexRelayUnreachableHint()
    return
  }
  warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] filter request error', {
    endpoint,
    error: err ?? 'unreachable'
  })
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
 * When every filter attempt fails (HTTP error or network) and no events are returned,
 * {@link options.onHardFailure} runs once (used for session strike parity with WebSocket relays).
 */
export async function queryIndexRelay(
  baseUrl: string,
  filter: Filter | Filter[],
  options?: { signal?: AbortSignal; onHardFailure?: () => void }
): Promise<NEvent[]> {
  const base = devProxyLoopbackHttpRelayBase(normalizeHttpRelayUrl(baseUrl) || baseUrl)
  const endpoint = indexRelayFilterUrl(base)
  const filters = Array.isArray(filter) ? filter : [filter]
  const out: NEvent[] = []
  const seen = new Set<string>()
  let sawHardFailure = false
  for (const f of filters) {
    const body = nostrFilterToIndexRelayBody(filterForIndexRelay(f))
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: options?.signal,
        timeoutMs: 25_000
      })
      if (!res.ok) {
        sawHardFailure = true
        if (isDevViteIndexRelayProxyPath(endpoint) && res.status === 500) {
          handleFilterTransportFailure(endpoint, `HTTP ${res.status}`)
        } else {
          warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] filter request failed', {
            endpoint,
            status: res.status
          })
        }
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
      sawHardFailure = true
      if (isIndexRelayTransportFailure(e)) {
        handleFilterTransportFailure(endpoint, e)
      } else {
        warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] filter request error', { endpoint, error: e })
      }
    }
  }
  if (sawHardFailure && out.length === 0 && filters.length > 0) {
    options?.onHardFailure?.()
  }
  return out
}

function filterForIndexRelay(f: Filter): Filter {
  const { search: _s, ...rest } = f
  return rest as Filter
}

export async function publishEventToHttpRelay(
  baseUrl: string,
  event: NEvent,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const base = devProxyLoopbackHttpRelayBase(normalizeHttpRelayUrl(baseUrl) || baseUrl)
  const endpoint = indexRelayPublishUrl(base)
  try {
    const res = await fetchWithTimeout(endpoint, {
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
      signal: options?.signal,
      timeoutMs: 25_000
    })
    if (!res.ok) {
      if (isDevViteIndexRelayProxyPath(endpoint) && res.status === 500) {
        throw new IndexRelayTransportError()
      }
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
  } catch (e) {
    if (e instanceof IndexRelayTransportError) throw e
    if ((e as Error).name === 'AbortError') throw e
    if (isIndexRelayTransportFailure(e)) {
      throw new IndexRelayTransportError(e)
    }
    throw e
  }
}
