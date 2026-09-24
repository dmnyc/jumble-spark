import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagedRelay } from './managed-relay'

const RELAY_URL = 'wss://relay.example.com'

type PhysicalHandlers = Parameters<AbstractRelay['subscribe']>[1]

class FakePhysicalRelay {
  connected = false
  ongoingOperations = 0
  publishTimeout = 10_000
  onclose: (() => void) | null = null
  readonly subscriptions: {
    filters: Parameters<AbstractRelay['subscribe']>[0]
    handlers: PhysicalHandlers
    closed: boolean
  }[] = []
  closeCalls = 0
  publishError?: Error

  constructor(private readonly connectError?: Error) {}

  async connect() {
    if (this.connectError) throw this.connectError
    this.connected = true
  }

  async publish() {
    if (this.publishError) throw this.publishError
    return 'accepted'
  }

  async auth() {
    return 'authenticated'
  }

  subscribe(
    filters: Parameters<AbstractRelay['subscribe']>[0],
    handlers: PhysicalHandlers
  ) {
    const subscription = { filters, handlers, closed: false }
    this.subscriptions.push(subscription)
    return {
      close: (reason = 'closed by caller') => {
        if (subscription.closed) return
        subscription.closed = true
        handlers.onclose?.(reason)
      }
    }
  }

  close() {
    this.closeCalls++
    this.connected = false
    this.closeSubscriptions('relay connection closed by us')
    this.onclose?.()
  }

  drop() {
    this.connected = false
    this.onclose?.()
    this.closeSubscriptions('relay connection closed')
  }

  emitEose(index = 0) {
    this.subscriptions[index]?.handlers.oneose?.()
  }

  private closeSubscriptions(reason: string) {
    for (const subscription of this.subscriptions) {
      if (subscription.closed) continue
      subscription.closed = true
      subscription.handlers.onclose?.(reason)
    }
  }
}

describe('ManagedRelay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores active logical REQs after a dropped connection without repeating EOSE', async () => {
    const { relay, instances } = createRelay()
    const oneose = vi.fn()
    const filters = [{ kinds: [1], since: 100 }]
    const sub = relay.subscribe(filters, { oneose })
    await flushPromises()

    instances[0].emitEose()
    instances[0].drop()
    await vi.advanceTimersByTimeAsync(0)
    await waitForSubscription(instances[1])
    instances[1].emitEose()

    expect(instances).toHaveLength(2)
    expect(instances[1].subscriptions[0].filters).toEqual(filters)
    expect(oneose).toHaveBeenCalledOnce()
    sub.close()
  })

  it('keeps a connection while REQs exist and releases it after the last REQ closes', async () => {
    const onIdle = vi.fn()
    const { relay, instances } = createRelay({ onIdle })
    const first = relay.subscribe([{ kinds: [1] }], {})
    const second = relay.subscribe([{ kinds: [2] }], {})
    await flushPromises()

    first.close()
    expect(relay.connected).toBe(true)
    expect(instances[0].closeCalls).toBe(0)

    second.close()
    expect(relay.connected).toBe(false)
    expect(instances[0].closeCalls).toBe(1)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('stops after three failed connection attempts and reports the failure to every REQ', async () => {
    const { relay, instances } = createRelay({ connectionFailures: 3 })
    const firstEose = vi.fn()
    const secondEose = vi.fn()
    const firstClose = vi.fn()
    const secondClose = vi.fn()
    relay.subscribe([{ kinds: [1] }], { oneose: firstEose, onclose: firstClose })
    relay.subscribe([{ kinds: [2] }], { oneose: secondEose, onclose: secondClose })

    await flushPromises()
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await flushPromises()

    expect(instances).toHaveLength(3)
    expect(firstEose).toHaveBeenCalledOnce()
    expect(secondEose).toHaveBeenCalledOnce()
    expect(firstClose).toHaveBeenCalledWith(
      'relay connection unavailable after 3 attempts: connection failed'
    )
    expect(secondClose).toHaveBeenCalledWith(
      'relay connection unavailable after 3 attempts: connection failed'
    )

    await vi.advanceTimersByTimeAsync(60_000)
    expect(instances).toHaveLength(3)
  })

  it('pauses connection attempts while offline and reconnects active REQs after resume', async () => {
    const { relay, instances } = createRelay()
    relay.setNetworkOnline(false)
    const sub = relay.subscribe([{ kinds: [1] }], {})
    await vi.advanceTimersByTimeAsync(60_000)

    expect(instances).toHaveLength(0)

    relay.setNetworkOnline(true)
    await relay.checkHealth()

    expect(instances).toHaveLength(1)
    expect(instances[0].subscriptions).toHaveLength(1)
    sub.close()
  })

  it('actively reconnects after an established connection is dropped', async () => {
    const { relay, instances } = createRelay()
    const sub = relay.subscribe([{ kinds: [1059], '#p': ['recipient'] }], {})
    await flushPromises()

    instances[0].drop()
    await vi.advanceTimersByTimeAsync(0)
    await waitForSubscription(instances[1])

    expect(instances).toHaveLength(2)
    expect(instances[1].subscriptions[0].filters).toEqual([
      { kinds: [1059], '#p': ['recipient'] }
    ])
    sub.close()
  })

  it('recycles a broken publish connection and restores active REQs', async () => {
    const { relay, instances } = createRelay()
    const sub = relay.subscribe([{ kinds: [1] }], {})
    await flushPromises()
    instances[0].publishError = new Error('publish timed out')

    await expect(relay.publish({ id: 'event-id' } as never)).rejects.toThrow('publish timed out')
    await waitForSubscription(instances[1])

    expect(instances).toHaveLength(2)
    expect(instances[1].subscriptions[0].filters).toEqual([{ kinds: [1] }])
    sub.close()
  })
})

function createRelay({
  connectionFailures = 0,
  onIdle
}: { connectionFailures?: number; onIdle?: () => void } = {}) {
  const instances: FakePhysicalRelay[] = []
  let failuresRemaining = connectionFailures
  const relay = new ManagedRelay(
    RELAY_URL,
    () => {
      const connectError = failuresRemaining > 0 ? new Error('connection failed') : undefined
      if (failuresRemaining > 0) failuresRemaining--
      const physical = new FakePhysicalRelay(connectError)
      instances.push(physical)
      return physical as unknown as AbstractRelay
    },
    () => undefined,
    onIdle
  )
  return { relay, instances }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function waitForSubscription(instance: FakePhysicalRelay) {
  for (let index = 0; index < 10 && instance.subscriptions.length === 0; index++) {
    await Promise.resolve()
  }
  expect(instance.subscriptions).toHaveLength(1)
}
