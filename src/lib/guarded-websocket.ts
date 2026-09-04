/**
 * A WebSocket that closes itself when nostr-tools abandons it.
 *
 * THE BUG, upstream. `AbstractRelay.connect()` creates a socket and, when the connection
 * times out, rejects the promise and hands off to `handleHardClose()`, without ever
 * calling `close()` on the socket it just made. The `onerror` path does the same. The
 * socket is left in CONNECTING and the browser keeps the pending connection open.
 *
 * It leaks one socket per attempt and it is linear. Driven through a pool, twenty
 * queries across three unreachable relays produce sixty sockets and close none of them.
 * Reproduced on every published version through 2.25.1, and still present on master.
 *
 * WHY IT MATTERS HERE. Browsers cap WebSocket connections per renderer, and the outbox
 * model multiplies the count: a feed connects to the relays of everyone you follow, so a
 * few unresponsive ones among them leak steadily. Once the budget is gone nothing in the
 * browser can open a socket, not Jumble, and not any other tab. Observed in the wild as
 * seven connections to a single host, all status 101 with 0 bytes transferred, still
 * pending after 49 seconds, with the list growing.
 *
 * SmartPool already accepts a `websocketImplementation`, so this needs no change to
 * nostr-tools and no wait for a release. This file exists only until the upstream fix
 * lands; after that, it and the line wiring it up can both go.
 */

/** Generous on purpose: nostr-tools' own `maxWaitForConnection` defaults to 3s, so
 *  anything still CONNECTING well past that has been abandoned. Closing a socket the
 *  library still wanted would turn a slow relay into a broken one, which is the worse
 *  failure of the two. */
const CONNECT_DEADLINE_MS = 15_000

/** A ceiling as well as a deadline: the deadline bounds the leak RATE, not the total.
 *  Well under the browser's cap, so Jumble can never be the reason another tab fails
 *  to connect. */
const MAX_PENDING = 64

const pending = new Set<WebSocket>()

function reap() {
  // Insertion order, so the first entry is the longest-pending, the one to give up on.
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.values().next().value
    if (!oldest) break
    pending.delete(oldest)
    try {
      oldest.close()
    } catch {
      // already closing or closed; nothing to do
    }
  }
}

export class GuardedWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)

    reap()
    pending.add(this)

    const settle = () => {
      clearTimeout(deadline)
      pending.delete(this)
    }

    const deadline = setTimeout(() => {
      pending.delete(this)
      // Only if still CONNECTING. An open socket belongs to the library; this exists
      // solely to clean up after the connect path it abandons.
      if (this.readyState === WebSocket.CONNECTING) {
        try {
          this.close()
        } catch {
          // nothing to do
        }
      }
    }, CONNECT_DEADLINE_MS)

    this.addEventListener('open', settle)
    this.addEventListener('close', settle)
    this.addEventListener('error', settle)
  }
}

/** Exposed for tests and diagnostics. */
export function pendingSocketCount() {
  return pending.size
}
