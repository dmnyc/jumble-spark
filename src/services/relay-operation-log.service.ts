import logger from '@/lib/logger'
import { normalizeUrl } from '@/lib/url'
import type { Filter } from 'nostr-tools'

let batchSeq = 0

function relayHostForPublishLog(url: string): string {
  const n = normalizeUrl(url) || url
  try {
    const u = new URL(n.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:'))
    const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : ''
    return path ? `${u.host}${path}` : u.host
  } catch {
    return n
  }
}

function nextBatchId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++batchSeq).toString(36)}`
}

/** Compact filter for logs (avoid huge author/id arrays). */
export function compactFilterForRelayLog(f: Filter): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (f.kinds != null) out.kinds = f.kinds
  if (f.limit != null) out.limit = f.limit
  if (f.since != null) out.since = f.since
  if (f.until != null) out.until = f.until
  if (f.ids?.length) out.idCount = f.ids.length
  if (f.authors?.length) out.authorCount = f.authors.length
  if (f['#p']?.length) out.pTagCount = f['#p'].length
  if (f['#e']?.length) out.eTagCount = f['#e'].length
  if (f['#t']?.length) out.tTagCount = f['#t'].length
  if (f.search) out.search = true
  return out
}

export type RelayOpTerminalOutcome = 'eose' | 'closed' | 'timeout'

export interface RelayOpTerminalRow {
  cmdIndex: number
  relayUrl: string
  outcome: RelayOpTerminalOutcome
  /** Error / close / NOTICE reason */
  detail?: string
  msFromBatchStart: number
}

type GroupedRelayRow = { url: string; filters: Filter[] }

/** Short host label for subscribe REQ logs (same as publish). */
function relayHostForSubscribeLog(url: string): string {
  return relayHostForPublishLog(url)
}

function humanizeSubscribeTerminalDetail(outcome: RelayOpTerminalOutcome, detail?: string): string {
  const d = (detail ?? '').trim()
  if (!d) {
    if (outcome === 'eose') return 'end of stored events'
    return outcome
  }
  if (
    d === 'subscribe_close' ||
    d === 'subscription_closed' ||
    d === 'no_report_before_req_closed' ||
    d === 'batch_finalize_closed'
  ) {
    return 'REQ ended before this relay reported EOSE (often normal)'
  }
  if (d === 'batch_finalize_timeout') return 'batch closed on timeout before relay reported'
  return d.length > 100 ? `${d.slice(0, 97)}…` : d
}

/**
 * One block of text for the console (like NIP-65 retry logs), instead of expanding `terminals` / `byOutcome`.
 */
export function buildSubscribeBatchReadableSummary(rows: RelayOpTerminalRow[]): string {
  if (rows.length === 0) return '(no relay slots)'

  type Group = { outcome: RelayOpTerminalOutcome; label: string; rows: RelayOpTerminalRow[] }
  const groups: Group[] = []
  for (const r of rows) {
    const label = humanizeSubscribeTerminalDetail(r.outcome, r.detail)
    let g = groups.find((x) => x.outcome === r.outcome && x.label === label)
    if (!g) {
      g = { outcome: r.outcome, label, rows: [] }
      groups.push(g)
    }
    g.rows.push(r)
  }

  groups.sort((a, b) => {
    const o = a.outcome.localeCompare(b.outcome)
    if (o !== 0) return o
    return a.label.localeCompare(b.label)
  })

  const parts: string[] = []
  for (const { outcome, label, rows: list } of groups) {
    const hosts = list.map((r) => relayHostForSubscribeLog(r.relayUrl))
    const uniq = [...new Set(hosts)]
    const head =
      outcome === 'eose'
        ? `EOSE (${list.length})`
        : outcome === 'timeout'
          ? `Timeout (${list.length})`
          : `Closed (${list.length})`
    parts.push(`${head} — ${label}`)
    if (uniq.length <= 12) {
      parts.push(...uniq.map((h) => `  • ${h}`))
    } else {
      parts.push(`  • ${uniq.slice(0, 8).join(', ')} … +${uniq.length - 8} more`)
    }
  }
  return parts.join('\n')
}

function groupTerminalsByOutcome(rows: RelayOpTerminalRow[]): Record<string, { count: number; relays: string[]; cmdIndices: number[] }> {
  const map = new Map<string, { relays: string[]; cmdIndices: number[] }>()
  for (const r of rows) {
    const key = `${r.outcome}${r.detail ? `:${r.detail.slice(0, 120)}` : ''}`
    const cur = map.get(key) ?? { relays: [], cmdIndices: [] }
    cur.relays.push(r.relayUrl)
    cur.cmdIndices.push(r.cmdIndex)
    map.set(key, cur)
  }
  const out: Record<string, { count: number; relays: string[]; cmdIndices: number[] }> = {}
  for (const [k, v] of map) {
    out[k] = { count: v.relays.length, relays: v.relays, cmdIndices: v.cmdIndices }
  }
  return out
}

/**
 * Tracks one logical subscribe/query wave: one `batch_begin` and one `batch_end` with per-relay outcomes.
 */
export type RelaySubscribeOpBatchOptions = {
  /** `debug` hides high-volume query REQs unless jumble-debug / VITE_DEBUG is on. */
  logLevel?: 'info' | 'debug'
}

export class RelaySubscribeOpBatch {
  readonly batchId: string
  private readonly t0: number
  private readonly source: string
  private readonly grouped: GroupedRelayRow[]
  private readonly logLevel: 'info' | 'debug'
  private readonly terminal = new Map<number, RelayOpTerminalRow>()
  private endLogged = false

  constructor(source: string, grouped: GroupedRelayRow[], options?: RelaySubscribeOpBatchOptions) {
    this.batchId = nextBatchId('sub')
    this.t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.source = source
    this.grouped = grouped
    this.logLevel = options?.logLevel ?? 'info'
  }

  private logLine(message: string, payload: Record<string, unknown>): void {
    if (this.logLevel === 'debug') {
      logger.debug(message, payload)
    } else {
      logger.info(message, payload)
    }
  }

  logBegin(): void {
    const uniqueRelays = [...new Set(this.grouped.map((g) => g.url))]
    this.logLine('[RelayOp] batch_begin', {
      batchId: this.batchId,
      source: this.source,
      relaySlotCount: this.grouped.length,
      uniqueRelayCount: uniqueRelays.length,
      uniqueRelays,
      commands: this.grouped.map((g, cmdIndex) => ({
        cmdIndex,
        relay: g.url,
        filters: g.filters.map(compactFilterForRelayLog)
      }))
    })
  }

  /** Last write wins per relay index (e.g. eose then closed overwrites). */
  setTerminal(cmdIndex: number, outcome: RelayOpTerminalOutcome, detail?: string): void {
    if (cmdIndex < 0 || cmdIndex >= this.grouped.length) return
    const msFromBatchStart = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    this.terminal.set(cmdIndex, {
      cmdIndex,
      relayUrl: this.grouped[cmdIndex]!.url,
      outcome,
      detail,
      msFromBatchStart
    })
    if (this.terminal.size >= this.grouped.length) {
      this.logEnd('complete')
    }
  }

  /**
   * When the subscription is torn down before every relay reported (or for shutdown), fill gaps and log once.
   */
  finalize(status: 'closed' | 'timeout', detail?: string): void {
    if (this.endLogged) return
    const msFromBatchStart = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    for (let i = 0; i < this.grouped.length; i++) {
      if (!this.terminal.has(i)) {
        this.terminal.set(i, {
          cmdIndex: i,
          relayUrl: this.grouped[i]!.url,
          outcome: status === 'timeout' ? 'timeout' : 'closed',
          detail:
            status === 'timeout'
              ? (detail ?? 'batch_finalize_timeout')
              : (detail ?? 'no_report_before_req_closed'),
          msFromBatchStart
        })
      }
    }
    this.logEnd(status)
  }

  private logEnd(status: string): void {
    if (this.endLogged) return
    this.endLogged = true
    const rows = [...this.terminal.values()].sort((a, b) => a.cmdIndex - b.cmdIndex)
    const elapsedMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    const readableSummary = buildSubscribeBatchReadableSummary(rows)
    const nEose = rows.filter((r) => r.outcome === 'eose').length
    const nTimeout = rows.filter((r) => r.outcome === 'timeout').length
    const nClosed = rows.filter((r) => r.outcome === 'closed').length
    const headline = `${rows.length} relay(s), ${elapsedMs}ms — EOSE ${nEose}, closed ${nClosed}, timeout ${nTimeout}`

    const compact: Record<string, unknown> = {
      batchId: this.batchId,
      source: this.source,
      status,
      elapsedMs,
      terminalCount: rows.length,
      eoseCount: nEose,
      closedCount: nClosed,
      timeoutCount: nTimeout
    }

    if (this.logLevel === 'debug') {
      this.logLine('[RelayOp] batch_end', {
        ...compact,
        readableSummary,
        byOutcome: groupTerminalsByOutcome(rows),
        terminals: rows
      })
    } else {
      logger.info(`[RelayOp] batch_end — ${headline}\n${readableSummary}`, compact)
    }
  }
}

export type PublishOpResultRow = {
  cmdIndex: number
  relayUrl: string
  ok: boolean
  msFromBatchStart: number
  error?: string
}

/**
 * One publish wave to many relays: single begin/end log.
 */
export class RelayPublishOpBatch {
  readonly batchId: string
  private readonly t0: number
  private readonly source: string
  private readonly eventId: string
  private readonly relays: string[]
  private readonly results: PublishOpResultRow[] = []
  private endLogged = false

  constructor(source: string, eventId: string, relays: string[]) {
    this.batchId = nextBatchId('pub')
    this.t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.source = source
    this.eventId = eventId
    this.relays = relays
  }

  logBegin(): void {
    logger.info('[RelayOp] publish_batch_begin', {
      batchId: this.batchId,
      source: this.source,
      eventId: this.eventId,
      relayCount: this.relays.length,
      relays: this.relays,
      commands: this.relays.map((relay, cmdIndex) => ({ cmdIndex, relay, eventId: this.eventId }))
    })
  }

  record(cmdIndex: number, relayUrl: string, ok: boolean, error?: string): void {
    const msFromBatchStart = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    this.results.push({ cmdIndex, relayUrl, ok, msFromBatchStart, error })
  }

  logEnd(status: string): void {
    if (this.endLogged) return
    this.endLogged = true
    const elapsedMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.t0
    )
    const ok = this.results.filter((r) => r.ok)
    const fail = this.results.filter((r) => !r.ok)
    const sorted = this.results.sort((a, b) => a.cmdIndex - b.cmdIndex)
    const readableSummary =
      this.relays.length === 0
        ? 'No relays targeted (empty list or skipped by session rules).'
        : fail.length === 0
          ? `All ${ok.length} relay(s) accepted the publish.`
          : [
            `${fail.length} relay(s) failed:`,
            ...fail.map(
              (r) =>
                `  • ${relayHostForPublishLog(r.relayUrl)} — ${(r.error && String(r.error).trim()) || 'rejected or error'}`
            ),
            ok.length > 0 ? `${ok.length} relay(s) OK: ${ok.map((r) => relayHostForPublishLog(r.relayUrl)).join(', ')}` : ''
          ]
            .filter(Boolean)
            .join('\n')
    logger.info('[RelayOp] publish_batch_end', {
      batchId: this.batchId,
      source: this.source,
      eventId: this.eventId,
      status,
      elapsedMs,
      okCount: ok.length,
      failCount: fail.length,
      readableSummary,
      byState: {
        ok: {
          count: ok.length,
          relays: ok.map((r) => r.relayUrl),
          hosts: ok.map((r) => relayHostForPublishLog(r.relayUrl)),
          cmdIndices: ok.map((r) => r.cmdIndex)
        },
        fail: {
          count: fail.length,
          relays: fail.map((r) => r.relayUrl),
          hosts: fail.map((r) => relayHostForPublishLog(r.relayUrl)),
          cmdIndices: fail.map((r) => r.cmdIndex),
          errors: fail.map((r) => r.error ?? '')
        }
      },
      results: sorted
    })
  }
}
