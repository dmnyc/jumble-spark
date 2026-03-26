import { ExtendedKind, FAST_READ_RELAY_URLS, PROFILE_FETCH_RELAY_URLS } from '@/constants'
import { normalizeUrl, isWebsocketUrl } from '@/lib/url'
import { queryService } from '@/services/client.service'
import type { Event } from 'nostr-tools'

const BADGE_AWARD_KIND = 8

function addRelayUrl(out: Set<string>, raw: string | undefined, blocked: Set<string>) {
  if (!raw?.trim()) return
  const n = normalizeUrl(raw.trim()) || raw.trim()
  if (!n || !isWebsocketUrl(n) || blocked.has(n)) return
  out.add(n)
}

/**
 * Relay pool for NIP-58 definition + award fetches: profile mirrors, optional `e`-tag hint from kind 30008,
 * then app profile/fast-read fallbacks. Issuer definitions often live off default “fast read” relays only.
 */
export function mergeNip58BadgeRelayPool(
  profileRelayUrls: string[],
  awardRelayHint: string | undefined,
  blockedRelays: string[]
): string[] {
  const blocked = new Set(blockedRelays.map((u) => normalizeUrl(u) || u).filter(Boolean))
  const out = new Set<string>()
  for (const u of profileRelayUrls) addRelayUrl(out, u, blocked)
  addRelayUrl(out, awardRelayHint, blocked)
  for (const u of PROFILE_FETCH_RELAY_URLS) addRelayUrl(out, u, blocked)
  for (const u of FAST_READ_RELAY_URLS) addRelayUrl(out, u, blocked)
  return [...out]
}

export async function fetchNip58BadgeDefinition(
  issuerPubkey: string,
  dTag: string,
  relayUrls: string[]
): Promise<Event | undefined> {
  if (!relayUrls.length) return undefined
  const hexPk = issuerPubkey.toLowerCase()
  const events = await queryService.fetchEvents(
    relayUrls,
    {
      authors: [hexPk],
      kinds: [ExtendedKind.BADGE_DEFINITION],
      '#d': [dTag]
    },
    {
      replaceableRace: true,
      eoseTimeout: 4000,
      globalTimeout: 22_000,
      firstRelayResultGraceMs: false
    }
  )
  const match = events.filter((e) => {
    if (e.pubkey.toLowerCase() !== hexPk) return false
    const d = e.tags.find((t) => t[0] === 'd')?.[1]
    return d === dTag
  })
  return match.sort((a, b) => b.created_at - a.created_at)[0]
}

export async function fetchNip58BadgeAward(awardId: string, relayUrls: string[]): Promise<Event | undefined> {
  if (!relayUrls.length || !/^[a-f0-9]{64}$/i.test(awardId)) return undefined
  const events = await queryService.fetchEvents(
    relayUrls,
    { ids: [awardId.toLowerCase()], kinds: [BADGE_AWARD_KIND] },
    {
      immediateReturn: true,
      eoseTimeout: 4000,
      globalTimeout: 18_000,
      firstRelayResultGraceMs: false
    }
  )
  return events.find((e) => e.id.toLowerCase() === awardId.toLowerCase())
}
