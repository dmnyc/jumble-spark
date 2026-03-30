import logger from '@/lib/logger'
import { notifyRelayNip42Accepted, notifyRelayNip42Rejected } from '@/lib/relay-auth-feedback'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools'

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

const patchedConstructors = new WeakSet<Function>()

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
 * `nostr-tools` main `SimplePool` bundle embeds its own `AbstractRelay` class; it is **not** the same
 * object as `nostr-tools/abstract-relay`. Patching only the latter never affected pool connections, so
 * NIP-42 toast/feedback never ran. Call this once per relay **class** using the first instance from
 * `pool.ensureRelay` (same constructor for all pool relays).
 */
export function patchPoolRelayAuthRaceAndFeedback(relay: object): void {
  const ctor = (relay as { constructor: Function }).constructor
  if (patchedConstructors.has(ctor)) return
  patchedConstructors.add(ctor)

  const proto = ctor.prototype as AbstractRelay
  const origSend = proto.send
  const origAuth = proto.auth

  proto.send = function (this: AbstractRelay, message: string) {
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

  proto.auth = function (
    this: AbstractRelay,
    signAuthEvent: (evt: EventTemplate) => Promise<VerifiedEvent>
  ) {
    const r = asRelayInternals(this)
    const url = r.url
    return (origAuth.call(this, signAuthEvent) as Promise<string>)
      .then((okReason) => {
        notifyRelayNip42Accepted(url, typeof okReason === 'string' ? okReason : undefined)
        return okReason
      })
      .catch((err: Error) => {
        const msg = err?.message ?? ''
        const benignRace =
          err?.name === 'SendingOnClosedConnection' ||
          msg.includes('relay connection closed before AUTH') ||
          /relay connection closed/i.test(msg)
        if (benignRace) {
          logger.warn('[RelayOp] Relay AUTH aborted (benign race)', { url: r.url, detail: msg })
          r.authPromise = undefined
          return ''
        }
        notifyRelayNip42Rejected(url, msg)
        throw err
      })
  }
}
