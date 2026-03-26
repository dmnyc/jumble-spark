/**
 * In-memory session cache for profile accordion fetches (per viewed profile pubkey).
 * Survives collapsing/reopening the accordion; cleared on full page reload.
 */

import type { TProfileZap } from '@/hooks/useProfileInteractions'
import type { TProfileBadge } from '@/hooks/useProfileBadges'
import type { TProfileFollowPack } from '@/hooks/useProfileFollowPacks'
import type { Event } from 'nostr-tools'

export type ProfileAccordionInteractionsSnapshot = {
  zaps: TProfileZap[]
  reactions: Event[]
  comments: Event[]
}

type Entry = {
  relayUrls?: string[]
  /** Fingerprint of profile relay list from {@link profileAccordionSetRelayUrls} (invalidates slices when it changes) */
  relayUrlsKey?: string
  interactions?: ProfileAccordionInteractionsSnapshot
  /** Relay key used for the last interactions fetch (per-slice; avoids races with badges / follow packs) */
  interactionsRelayKey?: string
  badges?: TProfileBadge[]
  badgesRelayKey?: string
  followPacks?: TProfileFollowPack[]
  followPacksRelayKey?: string
  /** viewer hex pubkey → reports */
  reportsByViewer?: Record<string, Event[]>
}

const store = new Map<string, Entry>()

export function profileAccordionRelayUrlsKey(urls: string[]): string {
  if (urls.length === 0) return ''
  return [...urls].sort().join('|')
}

function getEntry(pubkey: string): Entry {
  let e = store.get(pubkey)
  if (!e) {
    e = {}
    store.set(pubkey, e)
  }
  return e
}

export function profileAccordionGetCachedRelayUrls(pubkey: string): string[] | undefined {
  const urls = getEntry(pubkey).relayUrls
  return urls?.length ? urls : undefined
}

export function profileAccordionSetRelayUrls(pubkey: string, urls: string[]): void {
  const e = getEntry(pubkey)
  const key = profileAccordionRelayUrlsKey(urls)
  if (e.relayUrlsKey && e.relayUrlsKey !== key) {
    delete e.interactions
    delete e.interactionsRelayKey
    delete e.badges
    delete e.badgesRelayKey
    delete e.followPacks
    delete e.followPacksRelayKey
  }
  e.relayUrls = urls
  e.relayUrlsKey = key
}

export function profileAccordionGetCachedInteractions(
  pubkey: string,
  relayKey: string
): ProfileAccordionInteractionsSnapshot | undefined {
  const e = store.get(pubkey)
  if (!e?.interactions || e.interactionsRelayKey !== relayKey) return undefined
  return e.interactions
}

export function profileAccordionSetInteractions(
  pubkey: string,
  relayKey: string,
  data: ProfileAccordionInteractionsSnapshot
): void {
  const e = getEntry(pubkey)
  e.interactions = data
  e.interactionsRelayKey = relayKey
}

export function profileAccordionGetCachedBadges(pubkey: string, relayKey: string): TProfileBadge[] | undefined {
  const e = store.get(pubkey)
  if (!e?.badges || e.badgesRelayKey !== relayKey) return undefined
  return e.badges
}

export function profileAccordionSetBadges(pubkey: string, relayKey: string, badges: TProfileBadge[]): void {
  const e = getEntry(pubkey)
  e.badges = badges
  e.badgesRelayKey = relayKey
}

export function profileAccordionGetCachedFollowPacks(
  pubkey: string,
  relayKey: string
): TProfileFollowPack[] | undefined {
  const e = store.get(pubkey)
  if (!e?.followPacks || e.followPacksRelayKey !== relayKey) return undefined
  return e.followPacks
}

export function profileAccordionSetFollowPacks(
  pubkey: string,
  relayKey: string,
  packs: TProfileFollowPack[]
): void {
  const e = getEntry(pubkey)
  e.followPacks = packs
  e.followPacksRelayKey = relayKey
}

export function profileAccordionGetCachedReports(profilePubkey: string, viewerPubkey: string): Event[] | undefined {
  return getEntry(profilePubkey).reportsByViewer?.[viewerPubkey]
}

export function profileAccordionSetReports(
  profilePubkey: string,
  viewerPubkey: string,
  reports: Event[]
): void {
  const e = getEntry(profilePubkey)
  if (!e.reportsByViewer) e.reportsByViewer = {}
  e.reportsByViewer[viewerPubkey] = reports
}

export type ProfileAccordionCacheSlice =
  | 'relayUrls'
  | 'interactions'
  | 'badges'
  | 'followPacks'
  | 'reports'
  | 'all'

export function profileAccordionInvalidate(pubkey: string, slice: ProfileAccordionCacheSlice = 'all'): void {
  if (slice === 'all') {
    store.delete(pubkey)
    return
  }
  const e = store.get(pubkey)
  if (!e) return
  switch (slice) {
    case 'relayUrls':
      delete e.relayUrls
      delete e.relayUrlsKey
      delete e.interactions
      delete e.interactionsRelayKey
      delete e.badges
      delete e.badgesRelayKey
      delete e.followPacks
      delete e.followPacksRelayKey
      break
    case 'interactions':
      delete e.interactions
      delete e.interactionsRelayKey
      break
    case 'badges':
      delete e.badges
      delete e.badgesRelayKey
      break
    case 'followPacks':
      delete e.followPacks
      delete e.followPacksRelayKey
      break
    case 'reports':
      delete e.reportsByViewer
      break
  }
}
