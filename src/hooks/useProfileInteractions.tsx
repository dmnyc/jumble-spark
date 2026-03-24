import { E_TAG_FILTER_BLOCKED_RELAY_URLS, ExtendedKind } from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { queryService } from '@/services/client.service'
import { Event, Filter, kinds } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'

export type TProfileZap = {
  pr: string
  pubkey: string
  amount: number
  created_at: number
  comment?: string
}

/** Fetches zaps, reactions (likes), and comments for a profile. */
export function useProfileInteractions(pubkey: string | undefined, profileEvent: Event | undefined) {
  const { pubkey: accountPubkey } = useNostr()
  const { blockedRelays } = useFavoriteRelays()
  const [zaps, setZaps] = useState<TProfileZap[]>([])
  const [reactions, setReactions] = useState<Event[]>([])
  const [comments, setComments] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const fetchIdRef = useRef(0)

  const fetchAll = useCallback(async () => {
    if (!pubkey) {
      setZaps([])
      setReactions([])
      setComments([])
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

      const filters: Filter[] = [{ '#p': [pubkey], kinds: [kinds.Zap], limit: 100 }]
      if (profileEvent) {
        filters.push({
          '#e': [profileEvent.id],
          kinds: [kinds.Reaction, ExtendedKind.COMMENT],
          limit: 50
        })
      }

      const collectedZaps: TProfileZap[] = []
      const collectedReactions: Event[] = []
      const collectedComments: Event[] = []
      const seenZaps = new Set<string>()
      const seenReactions = new Set<string>()

      await queryService.fetchEvents(relayUrls, filters, {
        onevent: (evt) => {
          if (evt.kind === kinds.Zap) {
            const info = getZapInfoFromEvent(evt)
            if (!info || info.recipientPubkey !== pubkey || !info.amount || info.amount <= 0) return
            if (seenZaps.has(evt.id)) return
            seenZaps.add(evt.id)
            collectedZaps.push({
              pr: evt.id,
              pubkey: info.senderPubkey ?? evt.pubkey,
              amount: info.amount,
              created_at: evt.created_at,
              comment: info.comment
            })
          } else if (evt.kind === kinds.Reaction || evt.kind === ExtendedKind.COMMENT) {
            if (seenReactions.has(evt.id)) return
            seenReactions.add(evt.id)
            if (evt.kind === kinds.Reaction) {
              collectedReactions.push(evt)
            } else {
              collectedComments.push(evt)
            }
          }
        }
      })

      if (myFetchId !== fetchIdRef.current) return
      collectedZaps.sort((a, b) => b.amount - a.amount)
      collectedReactions.sort((a, b) => b.created_at - a.created_at)
      collectedComments.sort((a, b) => b.created_at - a.created_at)
      setZaps(collectedZaps)
      setReactions(collectedReactions)
      setComments(collectedComments)
    } catch {
      if (myFetchId !== fetchIdRef.current) return
    } finally {
      if (myFetchId === fetchIdRef.current) setLoading(false)
    }
  }, [pubkey, profileEvent?.id, accountPubkey, blockedRelays])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  return { zaps, reactions, comments, loading, refresh: fetchAll }
}

/** @deprecated Use useProfileInteractions instead. Returns zaps only for compatibility. */
export function useProfileZaps(pubkey: string | undefined) {
  const result = useProfileInteractions(pubkey, undefined)
  return { zaps: result.zaps, loading: result.loading, refresh: result.refresh }
}
