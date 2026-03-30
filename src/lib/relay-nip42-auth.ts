import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools'

function readNip42Challenge(relay: AbstractRelay): string | undefined {
  return (relay as unknown as { challenge?: string }).challenge
}

/**
 * Relays send `CLOSED` with an `auth-required` prefix when NIP-42 authentication is needed.
 * Match upstream jumble `master`: `reason.startsWith('auth-required')` — do **not** require `:`;
 * some relays omit it.
 */
export function isRelayAuthRequiredCloseReason(reason: string): boolean {
  return reason.trim().toLowerCase().startsWith('auth-required')
}

/** Publish / pool errors when the relay requires NIP-42 before accepting EVENT. */
export function isRelayAuthRequiredErrorMessage(message: string): boolean {
  return /auth-required/i.test(message)
}

/** nostr-tools default when {@link Subscription.close} runs from the client. */
export function isRelaySubscriptionClosedByCaller(reason: string): boolean {
  return reason.trim() === 'closed by caller'
}

/**
 * Some relays send `CLOSED` (auth-required) in the same tick as or slightly before the `AUTH` challenge
 * is applied; {@link AbstractRelay.auth} throws if `challenge` is still empty. Wait briefly for the frame.
 */
export async function authenticateNip42Relay(
  relay: AbstractRelay,
  signAuthEvent: (evt: EventTemplate) => Promise<VerifiedEvent>,
  options?: { challengeWaitMs?: number; pollMs?: number }
): Promise<string> {
  const challengeWaitMs = options?.challengeWaitMs ?? 4000
  const pollMs = options?.pollMs ?? 25
  const deadline = Date.now() + challengeWaitMs
  while (!readNip42Challenge(relay) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))
  }
  if (!readNip42Challenge(relay)) {
    throw new Error(
      "can't perform auth, no challenge was received (timed out waiting for relay AUTH message)"
    )
  }
  return relay.auth(signAuthEvent)
}
