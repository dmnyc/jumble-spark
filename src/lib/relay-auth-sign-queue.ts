let chain: Promise<unknown> = Promise.resolve()

/**
 * Serialize relay NIP-42 AUTH `signEvent` work. Browser extensions (NIP-07) process one request at a time;
 * parallel challenges from many relays otherwise queue past nostr-tools’ default AUTH ACK window and can race
 * closed sockets before `AUTH` is sent.
 */
export function queueRelayAuthSign<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(() => fn())
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
