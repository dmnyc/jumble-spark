import logger from '@/lib/logger'
import type { Filter } from 'nostr-tools'

let batchSeq = 0

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

export type RelayOpTerminalOutcome = 'eose' | 'closed' | 'skipped' | 'timeout'

export interface RelayOpTerminalRow {
  cmdIndex: number
  relayUrl: string
  outcome: RelayOpTerminalOutcome
  /** Error / close / NOTICE reason */
  detail?: string
  msFromBatchStart: number
}

type GroupedRelayRow = { url: string; filters: Filter[] }

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
          outcome: status === 'timeout' ? 'timeout' : 'skipped',
          detail: detail ?? (status === 'timeout' ? 'batch_finalize_timeout' : 'batch_finalize_closed'),
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
    this.logLine('[RelayOp] batch_end', {
      batchId: this.batchId,
      source: this.source,
      status,
      elapsedMs,
      terminalCount: rows.length,
      byOutcome: groupTerminalsByOutcome(rows),
      terminals: rows
    })
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
    logger.info('[RelayOp] publish_batch_end', {
      batchId: this.batchId,
      source: this.source,
      eventId: this.eventId,
      status,
      elapsedMs,
      okCount: ok.length,
      failCount: fail.length,
      byState: {
        ok: { count: ok.length, relays: ok.map((r) => r.relayUrl), cmdIndices: ok.map((r) => r.cmdIndex) },
        fail: {
          count: fail.length,
          relays: fail.map((r) => r.relayUrl),
          cmdIndices: fail.map((r) => r.cmdIndex),
          errors: fail.map((r) => r.error ?? '')
        }
      },
      results: this.results.sort((a, b) => a.cmdIndex - b.cmdIndex)
    })
  }
}
