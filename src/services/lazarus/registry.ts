import type { Event } from 'nostr-tools'

/**
 * Lazarus: recovery of user data from relay history.
 *
 * The kind registry below is the single source of truth for how each
 * recoverable kind is counted, ranked, and warned about. The algorithm
 * (scan / rank / delta / recover) never hardcodes kind semantics, so new
 * kinds are added here and nowhere else.
 *
 * Spec draft lives beside the Nostr Valley talk materials:
 * notes/lazarus-spec-draft.md (0.2.0-draft at the time of writing).
 */

export type LazarusRanking = 'count' | 'recency' | 'intent'

export type LazarusWarning = 'remute' | 'stale-relays' | 'affects-others'

export interface LazarusItemCount {
  /** Number of publicly visible items. */
  count: number
  /**
   * True when the event carries encrypted private items that were not
   * decrypted for this count, so the public count may understate the real
   * size of the list.
   */
  partial: boolean
}

export interface LazarusKindProfile {
  kind: number
  name: string
  tier: 1 | 2 | 3
  ranking: LazarusRanking
  /**
   * True when an empty item set is a defined state with its own meaning
   * (e.g. kind 10044 announces "no longer using NIP-4e") rather than the
   * fingerprint of a clobbering client. Empty candidates on these kinds
   * are valid options, never labeled as damage, and ranking is disabled:
   * the user must choose with intent.
   */
  meaningfulEmpty: boolean
  requiredWarnings: LazarusWarning[]
  itemCount: (event: Event) => LazarusItemCount
}

const MUTE_TAG_TYPES = ['p', 'word', 't', 'e']

function countTags(types: string[], partialOnContent = false) {
  return (event: Event): LazarusItemCount => ({
    count: event.tags.filter((tag) => types.includes(tag[0])).length,
    partial: partialOnContent && event.content.trim().length > 0
  })
}

function contentPresence(event: Event): LazarusItemCount {
  return { count: event.content.trim().length > 0 ? 1 : 0, partial: false }
}

export const LAZARUS_REGISTRY: Record<number, LazarusKindProfile> = {
  3: {
    kind: 3,
    name: 'Follow list',
    tier: 1,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: countTags(['p'], true)
  },
  10000: {
    kind: 10000,
    name: 'Mute list',
    tier: 1,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: ['remute', 'affects-others'],
    itemCount: countTags(MUTE_TAG_TYPES, true)
  },
  0: {
    kind: 0,
    name: 'Profile metadata',
    tier: 2,
    ranking: 'recency',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: contentPresence
  },
  10003: {
    kind: 10003,
    name: 'Bookmarks',
    tier: 2,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: countTags(['e', 'a'], true)
  },
  10044: {
    kind: 10044,
    name: 'Encryption key list (NIP-4e)',
    tier: 2,
    ranking: 'intent',
    meaningfulEmpty: true,
    requiredWarnings: ['affects-others'],
    itemCount: countTags(['p'])
  },
  10002: {
    kind: 10002,
    name: 'Relay list',
    tier: 3,
    ranking: 'recency',
    meaningfulEmpty: false,
    requiredWarnings: ['stale-relays'],
    itemCount: countTags(['r'])
  },
  10050: {
    kind: 10050,
    name: 'DM relay inbox',
    tier: 3,
    ranking: 'recency',
    meaningfulEmpty: false,
    requiredWarnings: ['stale-relays'],
    itemCount: countTags(['relay'])
  },
  10006: {
    kind: 10006,
    name: 'Blocked relays',
    tier: 3,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: countTags(['relay'])
  }
}

/** Registry order: tier ascending, then kind ascending. */
export function getLazarusKindProfiles(): LazarusKindProfile[] {
  return Object.values(LAZARUS_REGISTRY).sort(
    (a, b) => a.tier - b.tier || a.kind - b.kind
  )
}

export function getLazarusKindProfile(kind: number): LazarusKindProfile | undefined {
  return LAZARUS_REGISTRY[kind]
}
