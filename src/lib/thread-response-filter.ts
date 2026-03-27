import { isMentioningMutedUsers } from '@/lib/event'
import { normalizeUrl } from '@/lib/url'
import type { Event } from 'nostr-tools'

/** Lowercase normalized URLs for comparing user-blocked relays (e.g. before REQ). */
export function buildNormalizedBlockedRelaySet(blockedRelays: readonly string[] | undefined): Set<string> {
  const s = new Set<string>()
  for (const u of blockedRelays ?? []) {
    const n = (normalizeUrl(u) || u).toLowerCase()
    if (n) s.add(n)
  }
  return s
}

/** Hide thread replies / backlinks: muted author or (when enabled) mentions of mutes. */
export function shouldHideThreadResponseEvent(
  evt: Event,
  mutePubkeySet: Set<string>,
  hideContentMentioningMutedUsers: boolean | undefined
): boolean {
  if (mutePubkeySet.has(evt.pubkey)) return true
  if (hideContentMentioningMutedUsers === true && isMentioningMutedUsers(evt, mutePubkeySet)) return true
  return false
}
