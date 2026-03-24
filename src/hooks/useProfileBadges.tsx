import { E_TAG_FILTER_BLOCKED_RELAY_URLS, ExtendedKind } from '@/constants'
import { queryService, replaceableEventService } from '@/services/client.service'
import { useCallback, useEffect, useRef, useState } from 'react'
import { tagNameEquals } from '@/lib/tag'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'

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
}

/** Parse a-tag "30009:pubkey:d" into { kind, pubkey, d } */
function parseATag(aTag: string): { kind: number; pubkey: string; d: string } | null {
  const parts = aTag.split(':')
  if (parts.length < 3) return null
  const kind = parseInt(parts[0], 10)
  if (isNaN(kind)) return null
  return { kind, pubkey: parts[1], d: parts[2] }
}

/** NIP-58: Fetches profile badges (kind 30008) and resolves badge definitions (kind 30009). */
export function useProfileBadges(pubkey: string | undefined) {
  const { pubkey: accountPubkey } = useNostr()
  const { blockedRelays } = useFavoriteRelays()
  const [badges, setBadges] = useState<TProfileBadge[]>([])
  const [loading, setLoading] = useState(false)
  const fetchIdRef = useRef(0)

  const fetchBadges = useCallback(async () => {
    if (!pubkey) {
      setBadges([])
      return
    }

    const myFetchId = (fetchIdRef.current += 1)
    setLoading(true)

    try {
      const relayUrls = await buildComprehensiveRelayList({
        authorPubkey: pubkey,
        userPubkey: accountPubkey ?? undefined,
        blockedRelays: [...blockedRelays, ...E_TAG_FILTER_BLOCKED_RELAY_URLS],
        includeFastReadRelays: true,
        includeSearchableRelays: true,
        includeProfileFetchRelays: true,
        includeLocalRelays: true
      })

      const events = await queryService.fetchEvents(
        relayUrls,
        { authors: [pubkey], kinds: [ExtendedKind.PROFILE_BADGES], '#d': ['profile_badges'] },
        undefined
      )
      const profileBadgesEvent = events.sort((a, b) => b.created_at - a.created_at)[0]

      if (!profileBadgesEvent || myFetchId !== fetchIdRef.current) {
        if (myFetchId === fetchIdRef.current) setBadges([])
        return
      }

      const tags = profileBadgesEvent.tags
      const pairs: { a: string; e: string }[] = []
      for (let i = 0; i < tags.length - 1; i++) {
        const [tagNameA, aVal] = tags[i]
        const [tagNameE, eVal] = tags[i + 1]
        if (tagNameA === 'a' && tagNameE === 'e' && aVal && eVal && /^[a-f0-9]{64}$/i.test(eVal)) {
          pairs.push({ a: aVal, e: eVal })
        }
      }

      if (pairs.length === 0) {
        setBadges([])
        return
      }

      const result: TProfileBadge[] = []
      for (const { a, e } of pairs) {
        const parsed = parseATag(a)
        if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) {
          result.push({ a, awardId: e })
          continue
        }

        const defEvent = await replaceableEventService.fetchReplaceableEvent(
          parsed.pubkey,
          parsed.kind,
          parsed.d
        )

        const name = defEvent?.tags.find(tagNameEquals('name'))?.[1]
        const image = defEvent?.tags.find(tagNameEquals('image'))?.[1]
        const thumb = defEvent?.tags.find(tagNameEquals('thumb'))?.[1]

        result.push({
          a,
          awardId: e,
          name: name ?? parsed.d,
          image,
          thumb: thumb ?? image
        })
      }

      if (myFetchId !== fetchIdRef.current) return
      setBadges(result)
    } catch {
      if (myFetchId !== fetchIdRef.current) return
      setBadges([])
    } finally {
      if (myFetchId === fetchIdRef.current) setLoading(false)
    }
  }, [pubkey, accountPubkey, blockedRelays])

  useEffect(() => {
    fetchBadges()
  }, [fetchBadges])

  return { badges, loading, refresh: fetchBadges }
}
