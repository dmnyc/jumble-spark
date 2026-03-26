import { ExtendedKind } from '@/constants'
import { extractBadgeDefinitionMedia } from '@/lib/badge-definition-media'
import {
  fetchNip58BadgeAward,
  fetchNip58BadgeDefinition,
  mergeNip58BadgeRelayPool
} from '@/lib/fetch-badge-nip58'
import {
  profileAccordionGetCachedBadges,
  profileAccordionInvalidate,
  profileAccordionRelayUrlsKey,
  profileAccordionSetBadges
} from '@/lib/profile-accordion-session-cache'
import { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { useCallback, useEffect, useRef, useState } from 'react'
import { tagNameEquals } from '@/lib/tag'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { buildProfileRelayUrls } from '@/lib/profile-relay-urls'

export type TProfileBadge = {
  /** Badge definition coordinate (e.g. "30009:alice:bravery") */
  a: string
  /** Badge award event id */
  awardId: string
  /** Human-readable name from definition */
  name?: string
  /** High-res image URL */
  image?: string
  /** Thumbnail URL (prefer thumb over image for grid display) */
  thumb?: string
  /** From badge definition (NIP-58) */
  description?: string
  /** Kind 8 award `created_at` when loaded */
  awardCreatedAt?: number
}

/** Parse a-tag "30009:pubkey:d" into { kind, pubkey, d } */
function parseATag(aTag: string): { kind: number; pubkey: string; d: string } | null {
  const parts = aTag.split(':')
  if (parts.length < 3) return null
  const kind = parseInt(parts[0], 10)
  if (isNaN(kind)) return null
  const pk = parts[1]
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) return null
  const d = parts.slice(2).join(':')
  if (!d) return null
  return { kind, pubkey: pk.toLowerCase(), d }
}

/** True when we should re-resolve the badge definition (missing media but coordinate looks like kind 30009). */
function badgeNeedsDefinitionMedia(b: TProfileBadge): boolean {
  if (b.thumb || b.image) return false
  const parsed = parseATag(b.a)
  return !!(parsed && parsed.kind === ExtendedKind.BADGE_DEFINITION)
}

async function enrichBadgesFromIndexedDb(badges: TProfileBadge[]): Promise<TProfileBadge[]> {
  return Promise.all(
    badges.map(async (b) => {
      if (b.thumb || b.image) return b
      const parsed = parseATag(b.a)
      if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) return b
      try {
        const def = await indexedDb.getReplaceableEvent(parsed.pubkey, parsed.kind, parsed.d)
        if (!def) return b
        const name = def.tags.find(tagNameEquals('name'))?.[1]
        const description = def.tags.find(tagNameEquals('description'))?.[1]
        const media = extractBadgeDefinitionMedia(def)
        return {
          ...b,
          name: name ?? b.name ?? parsed.d,
          image: media.image,
          thumb: media.thumb ?? media.image,
          description: description ?? b.description
        }
      } catch {
        return b
      }
    })
  )
}

/** NIP-58: Fetches profile badges (kind 30008) and resolves badge definitions (kind 30009). */
/** Pass relayUrls to share with other profile fetches. */
export function useProfileBadges(pubkey: string | undefined, relayUrls?: string[]) {
  const { blockedRelays } = useFavoriteRelays()
  const [badges, setBadges] = useState<TProfileBadge[]>([])
  const [loading, setLoading] = useState(false)
  const fetchIdRef = useRef(0)

  const fetchBadges = useCallback(async (force = false) => {
    const myFetchId = (fetchIdRef.current += 1)

    if (!pubkey) {
      if (myFetchId === fetchIdRef.current) {
        setBadges([])
        setLoading(false)
      }
      return
    }

    const urls =
      force || !(relayUrls && relayUrls.length > 0)
        ? await buildProfileRelayUrls(pubkey, blockedRelays)
        : relayUrls
    const relayKey = profileAccordionRelayUrlsKey(urls)

    if (!force) {
      const cached = profileAccordionGetCachedBadges(pubkey, relayKey)
      if (cached?.length) {
        if (cached.some(badgeNeedsDefinitionMedia)) {
          const enriched = await enrichBadgesFromIndexedDb(cached)
          if (!enriched.some(badgeNeedsDefinitionMedia)) {
            if (myFetchId !== fetchIdRef.current) return
            setBadges(enriched)
            profileAccordionSetBadges(pubkey, relayKey, enriched)
            setLoading(false)
            return
          }
          // Session cache was incomplete and IndexedDB has no definitions — fetch from network below.
        } else {
          if (myFetchId !== fetchIdRef.current) return
          setBadges(cached)
          setLoading(false)
          return
        }
      }
    }

    if (myFetchId !== fetchIdRef.current) return
    setLoading(true)

    try {
      const events = await queryService.fetchEvents(
        urls,
        { authors: [pubkey], kinds: [ExtendedKind.PROFILE_BADGES], '#d': ['profile_badges'] },
        { eoseTimeout: 2000, globalTimeout: 15000, firstRelayResultGraceMs: false }
      )
      const profileBadgesEvent = events.sort((a, b) => b.created_at - a.created_at)[0]

      if (!profileBadgesEvent || myFetchId !== fetchIdRef.current) {
        if (myFetchId === fetchIdRef.current) setBadges([])
        return
      }

      const tags = profileBadgesEvent.tags
      const pairs: { a: string; e: string; eRelayHint?: string }[] = []
      for (let i = 0; i < tags.length - 1; i++) {
        const ta = tags[i]
        const te = tags[i + 1]
        if (
          ta[0] === 'a' &&
          te[0] === 'e' &&
          ta[1] &&
          te[1] &&
          /^[a-f0-9]{64}$/i.test(te[1])
        ) {
          pairs.push({ a: ta[1], e: te[1], eRelayHint: te[2] })
        }
      }

      if (pairs.length === 0) {
        setBadges([])
        return
      }

      const result: TProfileBadge[] = await Promise.all(
        pairs.map(async ({ a, e, eRelayHint }) => {
          const parsed = parseATag(a)
          if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) {
            return { a, awardId: e }
          }

          const relayPool = mergeNip58BadgeRelayPool(urls, eRelayHint, blockedRelays)
          const [defEvent, awardEvent] = await Promise.all([
            fetchNip58BadgeDefinition(parsed.pubkey, parsed.d, relayPool),
            fetchNip58BadgeAward(e, relayPool)
          ])

          const awardATag = awardEvent?.tags.find(tagNameEquals('a'))?.[1]
          const awardMatchesDefinition = !awardEvent || awardATag === a
          const awardCreatedAt =
            awardMatchesDefinition && awardEvent ? awardEvent.created_at : undefined

          if (defEvent) {
            try {
              await indexedDb.putReplaceableEvent(defEvent)
            } catch {
              // ignore ingest failures (tombstone / validation)
            }
          }

          if (!defEvent) {
            return { a, awardId: e, awardCreatedAt }
          }

          const name = defEvent.tags.find(tagNameEquals('name'))?.[1]
          const description = defEvent.tags.find(tagNameEquals('description'))?.[1]
          const media = extractBadgeDefinitionMedia(defEvent)

          return {
            a,
            awardId: e,
            name: name ?? parsed.d,
            image: media.image,
            thumb: media.thumb ?? media.image,
            description,
            awardCreatedAt
          }
        })
      )

      if (myFetchId !== fetchIdRef.current) return
      setBadges(result)
      profileAccordionSetBadges(pubkey, relayKey, result)
    } catch {
      if (myFetchId !== fetchIdRef.current) return
      setBadges([])
    } finally {
      if (myFetchId === fetchIdRef.current) setLoading(false)
    }
  }, [pubkey, blockedRelays, relayUrls])

  const refresh = useCallback(() => {
    if (pubkey) profileAccordionInvalidate(pubkey, 'badges')
    void fetchBadges(true)
  }, [pubkey, fetchBadges])

  useEffect(() => {
    void fetchBadges(false)
  }, [fetchBadges])

  return { badges, loading, refresh }
}
