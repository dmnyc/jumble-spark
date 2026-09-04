import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * nostr-tools' AbstractRelay.connect() creates a socket and, on connect timeout or
 * error, hands off to handleHardClose() without ever calling close() on it. The socket
 * stays in CONNECTING and the browser keeps the pending connection.
 *
 * Browsers cap WebSocket connections per renderer, and the outbox model multiplies the
 * count. Once the budget is gone nothing in the browser can open a socket, not Jumble,
 * and not any other tab. Observed as seven connections to one host, all status 101 with
 * 0 bytes, still pending after 49 seconds, with the list still growing.
 */

class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3

  url: string
  readyState = 0
  closed = false

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    FakeSocket.instances.push(this)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
}

// `class GuardedWebSocket extends WebSocket` resolves WebSocket when the MODULE is
// evaluated, not when an instance is constructed, so the global has to be replaced
// before the import, and the module re-imported for each run. In a browser this is a
// non-issue: WebSocket always exists by then.
const RealWebSocket = globalThis.WebSocket
let GuardedWebSocket: typeof WebSocket
let pendingSocketCount: () => number

describe('GuardedWebSocket', () => {
  beforeEach(async () => {
    FakeSocket.instances = []
    vi.useFakeTimers()
    // @ts-expect-error, test double
    globalThis.WebSocket = FakeSocket
    vi.resetModules()
    const mod = await import('./guarded-websocket')
    GuardedWebSocket = mod.GuardedWebSocket as unknown as typeof WebSocket
    pendingSocketCount = mod.pendingSocketCount
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = RealWebSocket
  })

  it('closes a socket that is still connecting once the deadline passes', () => {
    const ws = new GuardedWebSocket('wss://never.example') as unknown as FakeSocket
    expect(ws.closed).toBe(false)

    vi.advanceTimersByTime(15_001)

    expect(ws.closed).toBe(true)
  })

  it('leaves an open socket alone', () => {
    // The guard exists to clean up the connect path. Closing a socket the library still
    // wanted would turn a slow relay into a broken one.
    const ws = new GuardedWebSocket('wss://opens.example') as unknown as FakeSocket
    ws.open()

    vi.advanceTimersByTime(60_000)

    expect(ws.closed).toBe(false)
  })

  it('stops tracking a socket once it settles', () => {
    const ws = new GuardedWebSocket('wss://opens.example') as unknown as FakeSocket
    expect(pendingSocketCount()).toBe(1)

    ws.open()

    expect(pendingSocketCount()).toBe(0)
  })

  it('bounds how many sockets can be pending at once', () => {
    // The deadline bounds the leak RATE; this bounds the total. A fast enough burst
    // would otherwise exhaust the browser before any deadline expired.
    for (let i = 0; i < 80; i++) new GuardedWebSocket(`wss://burst-${i}.example`)

    expect(pendingSocketCount()).toBeLessThanOrEqual(64)
    expect(FakeSocket.instances.some((s) => s.closed)).toBe(true)
  })

  it('reaps the longest-pending socket first', () => {
    for (let i = 0; i < 70; i++) new GuardedWebSocket(`wss://order-${i}.example`)

    const closed = FakeSocket.instances.filter((s) => s.closed).map((s) => s.url)
    expect(closed).toContain('wss://order-0.example')
    expect(closed).not.toContain('wss://order-69.example')
  })
})
