import { ExtendedKind } from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { queryService, replaceableEventService } from '@/services/client.service'
import { hexPubkeysEqual } from '@/lib/pubkey'
import { Event, Filter, kinds } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  profileAccordionGetCachedInteractions,
  profileAccordionGetCachedRelayUrls,
  profileAccordionRelayUrlsKey,
  profileAccordionSetInteractions
} from '@/lib/profile-accordion-session-cache'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { buildProfileRelayUrls } from '@/lib/profile-relay-urls'

export type TProfileZap = {
  pr: string
  pubkey: string
  amount: number
  created_at: number
  comment?: string
}

const NOTE_IDS_FOR_COMMENTS = 50

/** Fetches zaps, reactions (likes on the kind-0 profile metadata event only), and comments (on the user's notes + profile). */
/** Uses profile owner's outboxes + PROFILE_FETCH_RELAY_URLS. Pass relayUrls to share with other profile fetches. */
export function useProfileInteractions(pubkey: string | undefined, relayUrls?: string[]) {
  const { blockedRelays } = useFavoriteRelays()
  const blockedRelaysRef = useRef(blockedRelays)
  blockedRelaysRef.current = blockedRelays
  const relayUrlsRef = useRef(relayUrls)
  relayUrlsRef.current = relayUrls
  const blockedRelaysKey = profileAccordionRelayUrlsKey(blockedRelays)
  const relayUrlsKey = profileAccordionRelayUrlsKey(relayUrls ?? [])

  const [zaps, setZaps] = useState<TProfileZap[]>([])
  const [reactions, setReactions] = useState<Event[]>([])
  const [comments, setComments] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const fetchIdRef = useRef(0)

  const fetchAll = useCallback(async (force = false) => {
    const myFetchId = (fetchIdRef.current += 1)

    if (!pubkey) {
      if (myFetchId === fetchIdRef.current) {
        setZaps([])
        setReactions([])
        setComments([])
        setLoading(false)
      }
      return
    }

    const relayUrlsLatest = relayUrlsRef.current
    let urls =
      relayUrlsLatest && relayUrlsLatest.length > 0
        ? relayUrlsLatest
        : profileAccordionGetCachedRelayUrls(pubkey) ?? []

    if (force || urls.length === 0) {
      urls = await buildProfileRelayUrls(pubkey, blockedRelaysRef.current)
    }
    const relayKey = profileAccordionRelayUrlsKey(urls)

    if (!force) {
      const cached = profileAccordionGetCachedInteractions(pubkey, relayKey)
      if (cached) {
        if (myFetchId !== fetchIdRef.current) return
        setZaps([...cached.zaps].sort((a, b) => b.amount - a.amount))
        setReactions([...cached.reactions].sort((a, b) => b.created_at - a.created_at))
        setComments([...cached.comments].sort((a, b) => b.created_at - a.created_at))
        setLoading(false)
        return
      }
    }

    const seed = profileAccordionGetCachedInteractions(pubkey, relayKey)

    if (seed && myFetchId === fetchIdRef.current) {
      setZaps([...seed.zaps].sort((a, b) => b.amount - a.amount))
      setReactions([...seed.reactions].sort((a, b) => b.created_at - a.created_at))
      setComments([...seed.comments].sort((a, b) => b.created_at - a.created_at))
    }

    if (myFetchId !== fetchIdRef.current) return

    const hasVisibleSeed =
      !!seed &&
      (seed.zaps.length > 0 || seed.reactions.length > 0 || seed.comments.length > 0)
    if (!hasVisibleSeed) {
      setLoading(true)
    }

    try {
      const profileMetaPromise = replaceableEventService.fetchReplaceableEvent(
        pubkey,
        kinds.Metadata,
        undefined,
        urls
      )

      const collectedZaps: TProfileZap[] = seed ? [...seed.zaps] : []
      const reactionsByPubkey = new Map<string, Event>() // one reaction per npub, newest kept (profile event only)
      if (seed) {
        for (const e of seed.reactions) {
          reactionsByPubkey.set(e.pubkey, e)
        }
      }
      const collectedComments: Event[] = seed ? [...seed.comments] : []
      const seenZaps = new Set(collectedZaps.map((z) => z.pr))
      const seenProfileReactionEventIds = new Set<string>()
      if (seed) {
        for (const e of seed.reactions) seenProfileReactionEventIds.add(e.id)
      }
      const seenCommentIds = new Set(collectedComments.map((c) => c.id))
      let noteIds: string[] = []

      // Phase 1: zaps + profile's recent notes (for comments on those notes)
      const phase1Filters: Filter[] = [
        { '#p': [pubkey], kinds: [kinds.Zap], limit: 100 },
        { authors: [pubkey], kinds: [kinds.ShortTextNote], limit: NOTE_IDS_FOR_COMMENTS }
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

      noteIds = [...new Set(noteIds)].slice(0, NOTE_IDS_FOR_COMMENTS)
      if (myFetchId !== fetchIdRef.current) return

      const profileMetaEvent = await profileMetaPromise
      if (myFetchId !== fetchIdRef.current) return

      const profileReactionATags = new Set([`0:${pubkey}:`, `0:${pubkey}:profile`])
      const reactionTargetsKind0Profile = (evt: Event): boolean => {
        if (evt.kind !== kinds.Reaction) return false
        const aHit = evt.tags.some((t) => t[0] === 'a' && t[1] && profileReactionATags.has(t[1]))
        if (aHit) return true
        const pid = profileMetaEvent?.id
        if (!pid) return false
        return evt.tags.some(
          (t) => t[0] === 'e' && t[1] && hexPubkeysEqual(t[1], pid)
        )
      }

      const flushReactions = () => {
        if (myFetchId !== fetchIdRef.current) return
        setReactions(Array.from(reactionsByPubkey.values()).sort((a, b) => b.created_at - a.created_at))
      }
      const flushComments = () => {
        if (myFetchId !== fetchIdRef.current) return
        setComments([...collectedComments].sort((a, b) => b.created_at - a.created_at))
      }
      const ingestProfileReaction = (evt: Event) => {
        if (!reactionTargetsKind0Profile(evt)) return
        if (hexPubkeysEqual(evt.pubkey, pubkey)) return
        if (seenProfileReactionEventIds.has(evt.id)) return
        seenProfileReactionEventIds.add(evt.id)
        const existing = reactionsByPubkey.get(evt.pubkey)
        if (!existing || evt.created_at > existing.created_at) {
          reactionsByPubkey.set(evt.pubkey, evt)
        }
        flushReactions()
      }
      const ingestComment = (evt: Event) => {
        if (hexPubkeysEqual(evt.pubkey, pubkey)) return
        if (seenCommentIds.has(evt.id)) return
        seenCommentIds.add(evt.id)
        collectedComments.push(evt)
        flushComments()
      }

      const phase2CommentOpts = {
        eoseTimeout: 2000,
        globalTimeout: 15000,
        firstRelayResultGraceMs: false as const,
        onevent: (evt: Event) => {
          if (evt.kind === ExtendedKind.COMMENT) {
            ingestComment(evt)
          }
        }
      }

      // Phase 2a: comments on profile's notes (#e) only
      if (noteIds.length > 0) {
        await queryService.fetchEvents(urls, [{
          '#e': noteIds,
          kinds: [ExtendedKind.COMMENT],
          limit: 50
        }], phase2CommentOpts)
      }

      // Phase 2b: comments ON the profile itself (kind 0) - use #a (required), p is optional
      const profileAddrs = [`0:${pubkey}:`, `0:${pubkey}:profile`]
      await queryService.fetchEvents(urls, [{
        '#a': profileAddrs,
        kinds: [ExtendedKind.COMMENT],
        limit: 50
      }], phase2CommentOpts)

      // Phase 2c: reactions (likes) on the kind-0 profile metadata event only (#e + event id, and/or #a coordinates)
      const profileReactionFilters: Filter[] = []
      if (profileMetaEvent?.id) {
        profileReactionFilters.push({ '#e': [profileMetaEvent.id], kinds: [kinds.Reaction], limit: 80 })
      }
      profileReactionFilters.push({ '#a': [...profileReactionATags], kinds: [kinds.Reaction], limit: 80 })
      await queryService.fetchEvents(urls, profileReactionFilters, {
        eoseTimeout: 2000,
        globalTimeout: 15000,
        firstRelayResultGraceMs: false,
        onevent: (evt: Event) => {
          if (evt.kind === kinds.Reaction) {
            ingestProfileReaction(evt)
          }
        }
      })

      if (myFetchId !== fetchIdRef.current) return
      collectedZaps.sort((a, b) => b.amount - a.amount)
      const collectedReactions = Array.from(reactionsByPubkey.values()).sort((a, b) => b.created_at - a.created_at)
      collectedComments.sort((a, b) => b.created_at - a.created_at)
      setZaps(collectedZaps)
      setReactions(collectedReactions)
      setComments(collectedComments)
      profileAccordionSetInteractions(pubkey, relayKey, {
        zaps: collectedZaps,
        reactions: collectedReactions,
        comments: collectedComments
      })
    } catch {
      if (myFetchId !== fetchIdRef.current) return
    } finally {
      if (myFetchId === fetchIdRef.current) setLoading(false)
    }
  }, [pubkey, blockedRelaysKey, relayUrlsKey])

  const refresh = useCallback(() => {
    /** Keep session cache so refresh merges new relays/events onto what is already shown */
    void fetchAll(true)
  }, [pubkey, fetchAll])

  useEffect(() => {
    void fetchAll(false)
  }, [fetchAll])

  return { zaps, reactions, comments, loading, refresh }
}

/** @deprecated Use useProfileInteractions instead. Returns zaps only for compatibility. */
export function useProfileZaps(pubkey: string | undefined) {
  const result = useProfileInteractions(pubkey)
  return { zaps: result.zaps, loading: result.loading, refresh: result.refresh }
}
