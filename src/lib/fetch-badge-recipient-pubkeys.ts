import { ExtendedKind } from '@/constants'
import { queryService } from '@/services/client.service'
import { Event } from 'nostr-tools'

function profileBadgesEventReferencesA(ev: Event, badgeATag: string): boolean {
  return ev.tags.some((t) => t[0] === 'a' && t[1] === badgeATag)
}

/**
 * Pubkeys whose latest profile badge lists (kind 30008) include this badge definition `a` tag.
 * Uses the same relay set as other profile fetches (typically outbox + profile mirrors).
 */
export async function fetchBadgeRecipientPubkeys(
  relayUrls: string[],
  badgeATag: string
): Promise<string[]> {
  if (relayUrls.length === 0 || !badgeATag) return []
  const events = await queryService.fetchEvents(
    relayUrls,
    [{ kinds: [ExtendedKind.PROFILE_BADGES], '#a': [badgeATag], limit: 200 }],
    { eoseTimeout: 2500, globalTimeout: 18000, firstRelayResultGraceMs: false }
  )
  const authors = new Set<string>()
  for (const ev of events) {
    if (profileBadgesEventReferencesA(ev, badgeATag)) authors.add(ev.pubkey)
  }
  return [...authors]
}
