/**
 * Orchestrated fetch for the profile interactions accordion: phase 1 (zaps, notes, follow packs,
 * profile_badges list), then separate batches for comments on notes, comments on profile (#a), and
 * profile reactions (#e + #a); badge NIP-58 resolution and reports run after. `onPartial` fires as
 * relays return events (coalesced per microtask). Session cache writes stay at completion only.
 * Ordering matches {@link useProfileInteractions}.
 */

import { ExtendedKind } from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { buildProfileReportRelayUrls } from '@/lib/profile-report-relay-urls'
import {
  profileAccordionGetCachedBadges,
  profileAccordionGetCachedFollowPacks,
  profileAccordionGetCachedInteractions,
  profileAccordionGetCachedReports,
  profileAccordionRelayUrlsKey,
  profileAccordionSetBadges,
  profileAccordionSetFollowPacks,
  profileAccordionSetInteractions,
  profileAccordionSetReports
} from '@/lib/profile-accordion-session-cache'
import type { TProfileBadge } from '@/hooks/useProfileBadges'
import { enrichBadgesFromIndexedDb, resolveProfileBadgeList } from '@/hooks/useProfileBadges'
import type { TProfileFollowPack } from '@/hooks/useProfileFollowPacks'
import type { TProfileZap } from '@/hooks/useProfileInteractions'
import { replaceableEventDedupeKey } from '@/lib/event'
import { hexPubkeysEqual } from '@/lib/pubkey'
import { queryService, replaceableEventService } from '@/services/client.service'
import { Event, Filter, kinds } from 'nostr-tools'

const NOTE_IDS_FOR_COMMENTS = 50
const REPORT_LIMIT = 50

const QUERY_OPTS = {
  eoseTimeout: 2500,
  globalTimeout: 18_000,
  firstRelayResultGraceMs: false
} as const

export type ProfileAccordionBundle = {
  zaps: TProfileZap[]
  reactions: Event[]
  comments: Event[]
  badges: TProfileBadge[]
  followPacks: TProfileFollowPack[]
  reports: Event[]
}

function getPackTitle(event: Event): string {
  const titleTag = event.tags.find((tag) => tag[0] === 'title' || tag[0] === 'name')
  return titleTag?.[1] || 'Follow Pack'
}

function isProfileBadgesListEvent(pubkey: string, e: Event): boolean {
  if (e.kind !== ExtendedKind.PROFILE_BADGES) return false
  if (!hexPubkeysEqual(e.pubkey, pubkey)) return false
  return e.tags.some((t) => t[0] === 'd' && t[1] === 'profile_badges')
}

function cacheHydrated(
  pubkey: string,
  relayKey: string,
  viewerPubkey: string | null | undefined
): ProfileAccordionBundle | null {
  const zi = profileAccordionGetCachedInteractions(pubkey, relayKey)
  const zb = profileAccordionGetCachedBadges(pubkey, relayKey)
  const zf = profileAccordionGetCachedFollowPacks(pubkey, relayKey)
  const viewer = viewerPubkey?.trim()
  const reportsReady = !viewer || profileAccordionGetCachedReports(pubkey, viewer) !== undefined
  if (!zi || zb === undefined || zf === undefined || !reportsReady) return null
  const reports =
    viewer ? profileAccordionGetCachedReports(pubkey, viewer) ?? [] : []
  return {
    zaps: zi.zaps,
    reactions: zi.reactions,
    comments: zi.comments,
    badges: zb,
    followPacks: zf,
    reports
  }
}

function bundleSnapshot(args: {
  collectedZaps: TProfileZap[]
  reactionsByPubkey: Map<string, Event>
  collectedComments: Event[]
  packByDedupeKey: Map<string, TProfileFollowPack>
  badgesForUi: TProfileBadge[]
  reports: Event[]
}): ProfileAccordionBundle {
  const zaps = [...args.collectedZaps].sort((a, b) => b.amount - a.amount)
  const reactions = Array.from(args.reactionsByPubkey.values()).sort(
    (a, b) => b.created_at - a.created_at
  )
  const comments = [...args.collectedComments].sort((a, b) => b.created_at - a.created_at)
  const followPacks = [...args.packByDedupeKey.values()].sort(
    (a, b) => b.event.created_at - a.event.created_at
  )
  return {
    zaps,
    reactions,
    comments,
    badges: args.badgesForUi,
    followPacks,
    reports: args.reports
  }
}

export async function fetchProfileAccordionBundle(args: {
  pubkey: string
  urls: string[]
  viewerPubkey: string | null | undefined
  favoriteRelays: string[]
  blockedRelays: string[]
  force: boolean
  /** Called as relays return events so the UI can render incrementally (not only after full EOSE). */
  onPartial?: (bundle: ProfileAccordionBundle) => void
}): Promise<ProfileAccordionBundle> {
  const { pubkey, urls, viewerPubkey, favoriteRelays, blockedRelays, force, onPartial } = args
  const relayKey = profileAccordionRelayUrlsKey(urls)
  const viewer = viewerPubkey?.trim()

  if (!force) {
    const hit = cacheHydrated(pubkey, relayKey, viewer)
    if (hit) return hit
  }

  const profileReactionATags = new Set([`0:${pubkey}:`, `0:${pubkey}:profile`])
  const profileAddrs = [`0:${pubkey}:`, `0:${pubkey}:profile`]

  const seedBadges = force ? undefined : profileAccordionGetCachedBadges(pubkey, relayKey)
  let resolvedBadges: TProfileBadge[] | null = null
  let reportsSoFar: Event[] = []

  const collectedZaps: TProfileZap[] = []
  const seenZaps = new Set<string>()
  const noteIdSet = new Set<string>()
  const packByDedupeKey = new Map<string, TProfileFollowPack>()
  const reactionsByPubkey = new Map<string, Event>()
  const seenProfileReactionEventIds = new Set<string>()
  const collectedComments: Event[] = []
  const seenCommentIds = new Set<string>()
  let profileBadgesEvent: Event | undefined
  let profileMetaEvent: Event | undefined

  const emit = () => {
    if (!onPartial) return
    const badgesForUi = resolvedBadges ?? seedBadges ?? []
    onPartial(
      bundleSnapshot({
        collectedZaps,
        reactionsByPubkey,
        collectedComments,
        packByDedupeKey,
        badgesForUi,
        reports: reportsSoFar
      })
    )
  }

  let emitCoalesce = false
  const scheduleEmit = () => {
    if (!onPartial || emitCoalesce) return
    emitCoalesce = true
    queueMicrotask(() => {
      emitCoalesce = false
      emit()
    })
  }

  const reactionTargetsKind0Profile = (evt: Event): boolean => {
    if (evt.kind !== kinds.Reaction) return false
    const aHit = evt.tags.some((t) => t[0] === 'a' && t[1] && profileReactionATags.has(t[1]))
    if (aHit) return true
    const pid = profileMetaEvent?.id
    if (!pid) return false
    return evt.tags.some((t) => t[0] === 'e' && t[1] && hexPubkeysEqual(t[1], pid))
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
  }

  const ingestComment = (evt: Event) => {
    if (evt.kind !== ExtendedKind.COMMENT) return
    if (hexPubkeysEqual(evt.pubkey, pubkey)) return
    if (seenCommentIds.has(evt.id)) return
    seenCommentIds.add(evt.id)
    collectedComments.push(evt)
  }

  const ingestPhase1Event = (evt: Event) => {
    if (evt.kind === kinds.Zap) {
      const info = getZapInfoFromEvent(evt)
      if (!info || !hexPubkeysEqual(info.recipientPubkey ?? '', pubkey) || !info.amount || info.amount <= 0)
        return
      const sender = info.senderPubkey ?? evt.pubkey
      if (hexPubkeysEqual(sender, pubkey)) return
      if (seenZaps.has(evt.id)) return
      seenZaps.add(evt.id)
      collectedZaps.push({
        pr: evt.id,
        pubkey: sender,
        amount: info.amount,
        created_at: evt.created_at,
        comment: info.comment
      })
    } else if (evt.kind === kinds.ShortTextNote) {
      noteIdSet.add(evt.id)
    } else if (evt.kind === ExtendedKind.FOLLOW_PACK) {
      const key = replaceableEventDedupeKey(evt)
      const next: TProfileFollowPack = { event: evt, title: getPackTitle(evt) }
      const prev = packByDedupeKey.get(key)
      if (!prev || evt.created_at > prev.event.created_at) {
        packByDedupeKey.set(key, next)
      }
    } else if (isProfileBadgesListEvent(pubkey, evt)) {
      if (!profileBadgesEvent || evt.created_at > profileBadgesEvent.created_at) {
        profileBadgesEvent = evt
      }
    }
  }

  // Keep phase 1 free of #a reaction/comment: many relays handle those poorly when batched with
  // zaps/notes/badges. Match {@link useProfileInteractions} — dedicated REQ(s) for profile comments
  // and reactions after we have note ids + kind-0 id.
  const phase1Filters: Filter[] = [
    { '#p': [pubkey], kinds: [kinds.Zap], limit: 100 },
    { authors: [pubkey], kinds: [kinds.ShortTextNote], limit: NOTE_IDS_FOR_COMMENTS },
    { '#p': [pubkey], kinds: [ExtendedKind.FOLLOW_PACK], limit: 50 },
    {
      authors: [pubkey],
      kinds: [ExtendedKind.PROFILE_BADGES],
      '#d': ['profile_badges'],
      limit: 5
    }
  ]

  const phase1Opts = {
    ...QUERY_OPTS,
    onevent: (evt: Event) => {
      ingestPhase1Event(evt)
      scheduleEmit()
    }
  }

  const [metaEv, _phase1Events] = await Promise.all([
    replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Metadata, undefined, urls),
    queryService.fetchEvents(urls, phase1Filters, phase1Opts)
  ])
  profileMetaEvent = metaEv
  emit()

  const noteIds = [...noteIdSet].slice(0, NOTE_IDS_FOR_COMMENTS)

  if (noteIds.length > 0) {
    await queryService.fetchEvents(
      urls,
      [{ '#e': noteIds, kinds: [ExtendedKind.COMMENT], limit: 50 }],
      {
        ...QUERY_OPTS,
        onevent: (evt: Event) => {
          if (evt.kind === ExtendedKind.COMMENT) ingestComment(evt)
          scheduleEmit()
        }
      }
    )
  }

  await queryService.fetchEvents(
    urls,
    [{ '#a': profileAddrs, kinds: [ExtendedKind.COMMENT], limit: 120 }],
    {
      ...QUERY_OPTS,
      onevent: (evt: Event) => {
        if (evt.kind === ExtendedKind.COMMENT) ingestComment(evt)
        scheduleEmit()
      }
    }
  )

  const reactionFilters: Filter[] = []
  if (profileMetaEvent?.id) {
    reactionFilters.push({ '#e': [profileMetaEvent.id], kinds: [kinds.Reaction], limit: 80 })
  }
  reactionFilters.push({
    '#a': [...profileReactionATags],
    kinds: [kinds.Reaction],
    limit: 80
  })
  await queryService.fetchEvents(urls, reactionFilters, {
    ...QUERY_OPTS,
    onevent: (evt: Event) => {
      if (evt.kind === kinds.Reaction) ingestProfileReaction(evt)
      scheduleEmit()
    }
  })

  collectedZaps.sort((a, b) => b.amount - a.amount)
  const reactions = Array.from(reactionsByPubkey.values()).sort((a, b) => b.created_at - a.created_at)
  collectedComments.sort((a, b) => b.created_at - a.created_at)
  const followPacks = [...packByDedupeKey.values()].sort((a, b) => b.event.created_at - a.event.created_at)

  let badges = await resolveProfileBadgeList(profileBadgesEvent, urls, blockedRelays, seedBadges)
  badges = await enrichBadgesFromIndexedDb(badges)
  resolvedBadges = badges
  emit()

  let reports: Event[] = []
  if (viewer) {
    const reportUrls = await buildProfileReportRelayUrls({
      viewerPubkey: viewer,
      favoriteRelays,
      blockedRelays
    })
    if (reportUrls.length > 0) {
      const seenReportIds = new Set<string>()
      reports = await queryService.fetchEvents(
        reportUrls,
        [{ '#p': [pubkey], kinds: [ExtendedKind.REPORT], limit: REPORT_LIMIT }],
        {
          ...QUERY_OPTS,
          onevent: (evt: Event) => {
            if (evt.kind !== ExtendedKind.REPORT || seenReportIds.has(evt.id)) return
            seenReportIds.add(evt.id)
            reportsSoFar.push(evt)
            reportsSoFar.sort((a, b) => b.created_at - a.created_at)
            scheduleEmit()
          }
        }
      )
    }
    profileAccordionSetReports(pubkey, viewer, reports)
  }
  reportsSoFar = reports

  profileAccordionSetInteractions(pubkey, relayKey, {
    zaps: collectedZaps,
    reactions,
    comments: collectedComments
  })
  profileAccordionSetBadges(pubkey, relayKey, badges)
  profileAccordionSetFollowPacks(pubkey, relayKey, followPacks)

  emit()

  return {
    zaps: collectedZaps,
    reactions,
    comments: collectedComments,
    badges,
    followPacks,
    reports
  }
}

export function profileAccordionBundleCacheKey(urls: string[]): string {
  return profileAccordionRelayUrlsKey(urls)
}
