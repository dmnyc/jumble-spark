import logger from '@/lib/logger'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools'
import { AbstractRelay } from 'nostr-tools/abstract-relay'

type EventPubWaiter = {
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

/** Duck-type nostr-tools internals (class typings mark several fields private). */
type RelayInternals = {
  url: string
  connectionPromise?: Promise<unknown>
  openEventPublishes: Map<string, EventPubWaiter>
  authPromise?: Promise<string>
}

let patched = false

function asRelayInternals(relay: AbstractRelay): RelayInternals {
  return relay as unknown as RelayInternals
}

function abortPendingAuthForDeadSocket(relay: RelayInternals, message: string) {
  const i = message.indexOf('{')
  const j = message.lastIndexOf('}')
  if (i === -1 || j <= i) return
  let parsed: { id?: string }
  try {
    parsed = JSON.parse(message.slice(i, j + 1)) as { id?: string }
  } catch {
    return
  }
  const id = parsed.id
  if (!id) return
  const ep = relay.openEventPublishes.get(id)
  if (!ep) {
    relay.authPromise = undefined
    return
  }
  clearTimeout(ep.timeout)
  relay.openEventPublishes.delete(id)
  ep.reject(new Error('relay connection closed before AUTH could be sent'))
  relay.authPromise = undefined
}

/**
 * Mitigate races between nostr-tools NIP-42 `AUTH`, WebSocket teardown (e.g. connect timeout while NIP-07
 * queues `signEvent`), and `send()` throwing {@link SendingOnClosedConnection} without a handler.
 */
export function installNostrRelayAuthRaceMitigation(): void {
  if (patched) return
  patched = true

  const origSend = AbstractRelay.prototype.send
  const origAuth = AbstractRelay.prototype.auth

  AbstractRelay.prototype.send = function (this: AbstractRelay, message: string) {
    const r = asRelayInternals(this)
    if (!r.connectionPromise && typeof message === 'string' && message.startsWith('["AUTH"')) {
      abortPendingAuthForDeadSocket(r, message)
      logger.warn('[RelayOp] Dropped AUTH (socket already closed; connect timeout vs signing race)', {
        url: r.url
      })
      return Promise.resolve()
    }
    return origSend.call(this, message) as Promise<void>
  }

  AbstractRelay.prototype.auth = function (
    this: AbstractRelay,
    signAuthEvent: (evt: EventTemplate) => Promise<VerifiedEvent>
  ) {
    const r = asRelayInternals(this)
    return (origAuth.call(this, signAuthEvent) as Promise<string>).catch((err: Error) => {
      const msg = err?.message ?? ''
      /** Hard close while `auth()` is in flight rejects open publish/auth waiters with this reason. */
      const benignRace =
        err?.name === 'SendingOnClosedConnection' ||
        msg.includes('relay connection closed before AUTH') ||
        /relay connection closed/i.test(msg)
      if (benignRace) {
        logger.warn('[RelayOp] Relay AUTH aborted (benign race)', { url: r.url, detail: msg })
        r.authPromise = undefined
        return ''
      }
      throw err
    })
  }
}
