import { ExtendedKind } from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { queryService } from '@/services/client.service'
import { hexPubkeysEqual } from '@/lib/pubkey'
import { Event, Filter, kinds } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { buildProfileRelayUrls } from '@/lib/profile-relay-urls'

export type TProfileZap = {
  pr: string
  pubkey: string
  amount: number
  created_at: number
  comment?: string
}

const NOTE_IDS_FOR_REACTIONS = 50

/** Fetches zaps, reactions (likes on profile's notes), and comments (on profile's notes). */
/** Uses profile owner's outboxes + PROFILE_FETCH_RELAY_URLS. Pass relayUrls to share with other profile fetches. */
export function useProfileInteractions(pubkey: string | undefined, relayUrls?: string[]) {
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
      const urls = relayUrls ?? (await buildProfileRelayUrls(pubkey, blockedRelays))

      const collectedZaps: TProfileZap[] = []
      const reactionsByPubkey = new Map<string, Event>() // one reaction per npub, newest kept
      const collectedComments: Event[] = []
      const seenZaps = new Set<string>()
      const seenReactions = new Set<string>()
      let noteIds: string[] = []

      // Phase 1: zaps + profile's recent notes (to find reactions/comments on their content)
      const phase1Filters: Filter[] = [
        { '#p': [pubkey], kinds: [kinds.Zap], limit: 100 },
        { authors: [pubkey], kinds: [kinds.ShortTextNote], limit: NOTE_IDS_FOR_REACTIONS }
      ]

      const flushZaps = () => {
        if (myFetchId !== fetchIdRef.current) return
        const sorted = [...collectedZaps].sort((a, b) => b.amount - a.amount)
        setZaps(sorted)
      }
      await queryService.fetchEvents(urls, phase1Filters, {
        eoseTimeout: 2000,
        globalTimeout: 15000,
        firstRelayResultGraceMs: false,
        onevent: (evt) => {
          if (evt.kind === kinds.Zap) {
            const info = getZapInfoFromEvent(evt)
            if (!info || !hexPubkeysEqual(info.recipientPubkey ?? '', pubkey) || !info.amount || info.amount <= 0) return
            const sender = info.senderPubkey ?? evt.pubkey
            if (hexPubkeysEqual(sender, pubkey)) return // skip self-zaps (likely tests)
            if (seenZaps.has(evt.id)) return
            seenZaps.add(evt.id)
            collectedZaps.push({
              pr: evt.id,
              pubkey: sender,
              amount: info.amount,
              created_at: evt.created_at,
              comment: info.comment
            })
            flushZaps() // render incrementally as events arrive from slow relays
          } else if (evt.kind === kinds.ShortTextNote) {
            noteIds.push(evt.id)
          }
        }
      })

      noteIds = [...new Set(noteIds)].slice(0, NOTE_IDS_FOR_REACTIONS)
      if (myFetchId !== fetchIdRef.current) return

      const flushReactions = () => {
        if (myFetchId !== fetchIdRef.current) return
        setReactions(Array.from(reactionsByPubkey.values()).sort((a, b) => b.created_at - a.created_at))
      }
      const flushComments = () => {
        if (myFetchId !== fetchIdRef.current) return
        setComments([...collectedComments].sort((a, b) => b.created_at - a.created_at))
      }
      const handleReactionOrComment = (evt: Event) => {
        if (hexPubkeysEqual(evt.pubkey, pubkey)) return // skip self-reactions/self-comments (likely tests)
        if (seenReactions.has(evt.id)) return
        seenReactions.add(evt.id)
        if (evt.kind === kinds.Reaction) {
          const existing = reactionsByPubkey.get(evt.pubkey)
          if (!existing || evt.created_at > existing.created_at) {
            reactionsByPubkey.set(evt.pubkey, evt)
          }
          flushReactions()
        } else {
          collectedComments.push(evt)
          flushComments()
        }
      }

      const phase2Opts = {
        eoseTimeout: 2000,
        globalTimeout: 15000,
        firstRelayResultGraceMs: false as const,
        onevent: (evt: Event) => {
          if (evt.kind === kinds.Reaction || evt.kind === ExtendedKind.COMMENT) {
            handleReactionOrComment(evt)
          }
        }
      }

      // Phase 2a: reactions and comments on profile's notes (#e)
      if (noteIds.length > 0) {
        await queryService.fetchEvents(urls, [{
          '#e': noteIds,
          kinds: [kinds.Reaction, ExtendedKind.COMMENT],
          limit: 50
        }], phase2Opts)
      }

      // Phase 2b: comments ON the profile itself (kind 0) - use #a (required), p is optional
      const profileAddrs = [`0:${pubkey}:`, `0:${pubkey}:profile`]
      await queryService.fetchEvents(urls, [{
        '#a': profileAddrs,
        kinds: [ExtendedKind.COMMENT],
        limit: 50
      }], phase2Opts)

      if (myFetchId !== fetchIdRef.current) return
      collectedZaps.sort((a, b) => b.amount - a.amount)
      const collectedReactions = Array.from(reactionsByPubkey.values()).sort((a, b) => b.created_at - a.created_at)
      collectedComments.sort((a, b) => b.created_at - a.created_at)
      setZaps(collectedZaps)
      setReactions(collectedReactions)
      setComments(collectedComments)
    } catch {
      if (myFetchId !== fetchIdRef.current) return
    } finally {
      if (myFetchId === fetchIdRef.current) setLoading(false)
    }
  }, [pubkey, blockedRelays, relayUrls])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  return { zaps, reactions, comments, loading, refresh: fetchAll }
}

/** @deprecated Use useProfileInteractions instead. Returns zaps only for compatibility. */
export function useProfileZaps(pubkey: string | undefined) {
  const result = useProfileInteractions(pubkey)
  return { zaps: result.zaps, loading: result.loading, refresh: result.refresh }
}
