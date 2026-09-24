import type { Filter } from 'nostr-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRelay, IRelayPool, TSubHandlers } from '@/types/relay-pool'
import { RELAY_SUBSCRIPTION_EOSE_TIMEOUT, subscribeRelays } from './relay-subscription'

class FakeRelay implements IRelay {
  publishTimeout = 10_000
  handlers?: TSubHandlers
  subscribeCount = 0

  constructor(readonly url: string) {}

  async publish() {}
  async auth() {}

  subscribe(_filters: Filter[], handlers: TSubHandlers) {
    this.handlers = handlers
    this.subscribeCount++
    return { close: () => {} }
  }

  emitEose() {
    this.handlers?.oneose?.()
  }

  emitClose(reason: string) {
    this.handlers?.onclose?.(reason)
  }
}

class FakePool implements IRelayPool {
  trackRelays = true
  relays = new Map<string, FakeRelay>()

  async ensureRelay(url: string): Promise<IRelay> {
    let relay = this.relays.get(url)
    if (!relay) {
      relay = new FakeRelay(url)
      this.relays.set(url, relay)
    }
    return relay
  }

  close() {}
  setAllowInsecure() {}
  setTrustedInsecureRelayUrls() {}
  getSeenRelays() {
    return []
  }
  trackEventSeen() {}
}

describe('subscribeRelays', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('settles when some relays EOSE and another relay closes', async () => {
    const pool = new FakePool()
    const oneose = vi.fn()
    subscribeRelays(pool, ['wss://one.example', 'wss://two.example'], [{}], { oneose })
    await flushPromises()

    pool.relays.get('wss://one.example')!.emitEose()
    pool.relays.get('wss://two.example')!.emitClose('rate-limited')

    expect(oneose).toHaveBeenNthCalledWith(1, false)
    expect(oneose).toHaveBeenNthCalledWith(2, true)
  })

  it('uses an absolute EOSE deadline that includes connection time', async () => {
    const pool = new FakePool()
    pool.ensureRelay = async () => await new Promise<IRelay>(() => {})
    const oneose = vi.fn()
    subscribeRelays(pool, ['wss://silent.example'], [{}], { oneose })

    await vi.advanceTimersByTimeAsync(RELAY_SUBSCRIPTION_EOSE_TIMEOUT)

    expect(oneose).toHaveBeenCalledOnce()
    expect(oneose).toHaveBeenCalledWith(true)
  })

  it('settles an auth-required relay when authentication fails', async () => {
    const pool = new FakePool()
    const oneose = vi.fn()
    const onclose = vi.fn()
    const authenticate = vi.fn(async () => {
      throw new Error('auth failed')
    })
    subscribeRelays(pool, ['wss://auth.example'], [{}], {
      oneose,
      onclose,
      getAuthenticator: () => authenticate
    })
    await flushPromises()

    pool.relays.get('wss://auth.example')!.emitClose('auth-required: restricted')
    await flushPromises()

    expect(authenticate).toHaveBeenCalledOnce()
    expect(oneose).toHaveBeenCalledWith(true)
    expect(onclose).toHaveBeenCalledWith('wss://auth.example', 'auth-required: restricted')
  })

  it('resubscribes after successful authentication while the caller remains active', async () => {
    const pool = new FakePool()
    const authenticate = vi.fn(async () => undefined)
    subscribeRelays(pool, ['wss://auth.example'], [{}], {
      getAuthenticator: () => authenticate
    })
    await flushPromises()

    const relay = pool.relays.get('wss://auth.example')!
    relay.emitClose('auth-required: restricted')
    await flushPromises()

    expect(relay.subscribeCount).toBe(2)
  })

  it('settles an empty relay list asynchronously', async () => {
    const oneose = vi.fn()
    subscribeRelays(new FakePool(), [], [{}], { oneose })
    expect(oneose).not.toHaveBeenCalled()

    await flushPromises()

    expect(oneose).toHaveBeenCalledWith(true)
  })
})

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
