import { kinds, type Event, type Filter } from 'nostr-tools'
import client from '@/services/client.service'
import { fitsNip46Request } from '@/lib/nip46'
import { getDefaultRelayUrls } from '@/lib/relay'
import { normalizeUrl } from '@/lib/url'
import { countItemTags, getContentEncryption } from './private-items'
import {
  getLazarusKindProfile,
  type LazarusItemCount,
  type LazarusKindProfile
} from './registry'

/**
 * Lazarus core: scan, rank, delta, recover-draft.
 *
 * Invariants (see https://github.com/dmnyc/lazarus/blob/main/SPEC.md):
 *  1. This module never publishes. Recovery happens only when the UI asks
 *     the signer for exactly one event on an explicit click.
 *  2. Every candidate found is returned, including empty ones.
 *  3. Empty candidates are never recommended (except kinds flagged
 *     meaningfulEmpty, where nothing is recommended at all).
 *  4. The only signing surface is the draft builder; the caller owns the
 *     signer and the click.
 */

const SCAN_TIMEOUT_MS = 6000
/** Versions requested per relay. A relay that fills a page can be paged further back. */
const SCAN_LIMIT = 50
/**
 * A clobber drops a large share of a list at once, while curation moves a few
 * items at a time. A step between two versions counts as a sudden drop when
 * the later one is missing at least this share of the earlier one's items,
 * and at least this many.
 */
const CLOBBER_MIN_LOSS_RATIO = 0.2
const CLOBBER_MIN_LOSS_ITEMS = 5
/** Drops within this long of each other are one clobber episode. */
const CLOBBER_EPISODE_SECONDS = 24 * 60 * 60
/**
 * A clobber the list has since been edited on this many times, over at least
 * this long, is settled: the current version is the user's choice.
 */
const SETTLED_MIN_EDITS = 5
const SETTLED_MIN_SECONDS = 7 * 24 * 60 * 60

/** An event together with the relay it was observed on. */
export interface LazarusTaggedEvent {
  event: Event
  relayUrl: string
}

export interface LazarusCandidate {
  event: Event
  /** Relay URLs where this exact event id was observed. */
  foundOn: string[]
  itemCount: ReturnType<LazarusKindProfile['itemCount']>
  /** True for the most recent candidate (what the scan saw as current). */
  isCurrent: boolean
  isRecommended: boolean
}

export interface LazarusScanResult {
  kind: number
  /** Ranked candidates. Meaningful-empty kinds: recency order, nothing recommended. */
  candidates: LazarusCandidate[]
  current: LazarusCandidate | undefined
  recommended: LazarusCandidate | undefined
  /** True for meaningful-empty kinds: the user must choose with intent. */
  requiresIntentConfirmation: boolean
  queriedRelays: string[]
  respondingRelays: string[]
  /**
   * Relays that may hold versions older than the scan returned, keyed to the
   * created_at to page back from. Empty when the scan saw everything.
   */
  olderCursors?: Record<string, number>
}

/** Decrypted private items (NIP-51), keyed by event id. */
export type LazarusPrivateTags = ReadonlyMap<string, string[][]>

/**
 * A candidate's total item count as a range: exact once its private items
 * are decrypted (or when it has none), estimated from the encrypted size
 * otherwise.
 */
export function getLazarusItemRange(itemCount: LazarusItemCount): { min: number; max: number } {
  const { count, privateCount, privateEstimate } = itemCount
  if (privateCount !== undefined) return { min: count + privateCount, max: count + privateCount }
  if (privateEstimate) {
    return { min: count + privateEstimate.min, max: count + privateEstimate.max }
  }
  return { min: count, max: count }
}

/** False when encrypted private items could be neither decrypted nor sized. */
export function isLazarusSizeKnown(itemCount: LazarusItemCount): boolean {
  return !itemCount.partial || !!itemCount.privateEstimate
}

function countItems(
  profile: LazarusKindProfile,
  event: Event,
  privateTags: string[][] | undefined
): LazarusItemCount {
  const itemCount = profile.itemCount(event)
  if (!privateTags || !profile.privateItemTypes) return itemCount
  return {
    count: itemCount.count,
    partial: false,
    privateCount: countItemTags(privateTags, profile.privateItemTypes)
  }
}

export interface LazarusRelaySource {
  /**
   * Fetch versions from the scan relays. With cursors, fetch the next older
   * page from just those relays instead.
   */
  fetchVersions(
    kind: number,
    pubkey: string,
    cursors?: Record<string, number>
  ): Promise<{
    tagged: LazarusTaggedEvent[]
    queriedRelays: string[]
    respondingRelays: string[]
    /** Relays whose answer filled the page, keyed to the cursor for the next one. */
    olderCursors?: Record<string, number>
  }>
}

/**
 * One relay's answer to a filter. The subscription is closed as soon as the
 * relay finishes or times out, so a slow relay doesn't stay subscribed after
 * the scan moves on; a timeout counts as no answer.
 */
function fetchFromRelay(
  url: string,
  filter: Filter,
  timeoutMs: number = SCAN_TIMEOUT_MS
): Promise<Event[]> {
  return new Promise((resolve, reject) => {
    const events: Event[] = []
    let done = false
    const finish = (error?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      sub.close()
      if (error) reject(error)
      else resolve(events)
    }
    const timer = setTimeout(() => finish(new Error('relay timeout')), timeoutMs)
    const sub = client.subscribe([url], filter, {
      onevent: (event) => {
        events.push(event)
      },
      oneose: (eosed) => {
        if (eosed) finish()
      },
      onAllClose: () => finish()
    })
  })
}

function uniqueRelayUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.map((url) => normalizeUrl(url)).filter(Boolean)))
}

async function getWriteRelays(pubkey: string): Promise<string[]> {
  try {
    return uniqueRelayUrls((await client.fetchRelayList(pubkey)).write)
  } catch {
    return uniqueRelayUrls(getDefaultRelayUrls())
  }
}

/**
 * A user's own relays usually keep only the latest version of a replaceable
 * event, so a scan limited to them misses most of the history. These relays
 * have been seen holding older versions: relay.ditto.pub keeps every version,
 * hist.nostr.land keeps recent history, and the rest are large relays that
 * often still have versions the user's own relays already replaced. Only
 * relays that actually showed history are listed, since each is a socket.
 */
export const LAZARUS_ARCHIVAL_RELAYS = [
  'wss://relay.ditto.pub',
  'wss://hist.nostr.land',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://purplepag.es',
  'wss://nostr.bitcoiner.social'
]

/**
 * Relays to scan: every relay in the user's relay list (read and write, not
 * just the first few outbox relays), the app's default relays, and the
 * archival set.
 */
export async function getLazarusScanRelays(pubkey: string): Promise<string[]> {
  let userRelays: string[] = []
  try {
    const relayList = await client.fetchRelayList(pubkey)
    userRelays = [...relayList.write, ...relayList.read]
  } catch {
    // Without the user's relay list, still scan the default and archival sets
  }
  return uniqueRelayUrls([...userRelays, ...getDefaultRelayUrls(), ...LAZARUS_ARCHIVAL_RELAYS])
}

/**
 * Relays to publish a recovery to. Success is judged on the user's write
 * relays. The other relays that answered the scan hold older copies of the
 * list, so the restored version goes there too, as a best effort, to replace
 * the clobbered copy they would otherwise keep serving.
 */
export async function getLazarusPublishRelays(
  pubkey: string,
  respondingRelays: string[]
): Promise<{ write: string[]; extra: string[] }> {
  const write = await getWriteRelays(pubkey)
  const extra = uniqueRelayUrls(respondingRelays).filter((url) => !write.includes(url))
  return { write, extra }
}

/**
 * The newest version on the user's write relays right now, to catch edits
 * made after a scan (from another column, device or client) before a restore
 * overwrites them.
 */
export async function fetchLatestLazarusVersion(
  kind: number,
  pubkey: string
): Promise<Event | undefined> {
  const write = await getWriteRelays(pubkey)
  const results = await Promise.allSettled(
    write.map((url) => fetchFromRelay(url, { kinds: [kind], authors: [pubkey], limit: 1 }, 4000))
  )
  let newest: Event | undefined
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const event of result.value) {
      if (event.pubkey === pubkey && (!newest || event.created_at > newest.created_at)) {
        newest = event
      }
    }
  }
  return newest
}

/**
 * Per-relay scanning so each candidate keeps an accurate found-on list and
 * the result can report which relays actually answered. A relay that fails
 * or times out never counts as "nothing found".
 */
export const defaultLazarusRelaySource: LazarusRelaySource = {
  async fetchVersions(kind, pubkey, cursors) {
    const urls = cursors ? Object.keys(cursors) : await getLazarusScanRelays(pubkey)

    const results = await Promise.allSettled(
      urls.map((url) => {
        const filter = { kinds: [kind], authors: [pubkey], limit: SCAN_LIMIT }
        const page = cursors ? { ...filter, until: cursors[url] } : filter
        return fetchFromRelay(url, page)
      })
    )

    const tagged: LazarusTaggedEvent[] = []
    const respondingRelays: string[] = []
    const olderCursors: Record<string, number> = {}
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return
      const url = urls[index]
      const relayEvents = result.value
      if (relayEvents.length > 0) respondingRelays.push(url)
      for (const event of relayEvents) {
        tagged.push({ event, relayUrl: url })
      }
      // A full page means the relay may hold older versions. `until` is
      // inclusive, so the next page repeats the oldest event; a cursor that
      // didn't move means the relay has nothing older to give.
      if (relayEvents.length >= SCAN_LIMIT) {
        const oldest = Math.min(...relayEvents.map((event) => event.created_at))
        if (!cursors || oldest < cursors[url]) olderCursors[url] = oldest
      }
    })

    return { tagged, queriedRelays: urls, respondingRelays, olderCursors }
  }
}

export function scanLazarusKind(
  kind: number,
  pubkey: string,
  source: LazarusRelaySource = defaultLazarusRelaySource
): Promise<LazarusScanResult> {
  const profile = getLazarusKindProfile(kind)
  if (!profile) {
    return Promise.reject(new Error(`kind ${kind} is not in the Lazarus registry`))
  }
  return source
    .fetchVersions(kind, pubkey)
    .then(({ tagged, queriedRelays, respondingRelays, olderCursors }) => ({
      ...rankLazarusCandidates(profile, tagged, queriedRelays, respondingRelays),
      olderCursors: olderCursors ?? {}
    }))
}

/**
 * Fetch the next page of older versions from relays whose last answer filled
 * the scan limit, and re-rank with them merged in.
 */
export async function loadOlderLazarusVersions(
  profile: LazarusKindProfile,
  scan: LazarusScanResult,
  pubkey: string,
  privateTags: LazarusPrivateTags = new Map(),
  source: LazarusRelaySource = defaultLazarusRelaySource
): Promise<LazarusScanResult> {
  const cursors = scan.olderCursors ?? {}
  if (Object.keys(cursors).length === 0) return scan
  const older = await source.fetchVersions(profile.kind, pubkey, cursors)
  return {
    ...rankLazarusCandidates(
      profile,
      [...scanToTagged(scan), ...older.tagged],
      scan.queriedRelays,
      Array.from(new Set([...scan.respondingRelays, ...older.respondingRelays])),
      privateTags
    ),
    olderCursors: older.olderCursors ?? {}
  }
}

function scanToTagged(scan: LazarusScanResult): LazarusTaggedEvent[] {
  return scan.candidates.flatMap((candidate) =>
    candidate.foundOn.map((relayUrl) => ({ event: candidate.event, relayUrl }))
  )
}

/** Whether a list of `laterMax` items looks clobbered next to an earlier one of `earlierMin`. */
function looksClobbered(laterMax: number, earlierMin: number): boolean {
  if (earlierMin <= 0) return false
  if (laterMax <= 0) return true
  const loss = earlierMin - laterMax
  return loss >= CLOBBER_MIN_LOSS_ITEMS && loss >= earlierMin * CLOBBER_MIN_LOSS_RATIO
}

/** Versions with a known size, oldest first. */
function knownTimeline(candidates: LazarusCandidate[]): LazarusCandidate[] {
  return candidates
    .filter((c) => isLazarusSizeKnown(c.itemCount))
    .sort((a, b) => a.event.created_at - b.event.created_at || (a.event.id < b.event.id ? 1 : -1))
}

interface ClobberEpisode {
  /** Index of each version that dropped suddenly from the one before it */
  drops: number[]
  /** Indexes of the episode's ends: just before its first drop, just after its last */
  first: number
  last: number
}

/**
 * Sudden drops in a timeline, newest episode first. Drops back to back or
 * within a day of each other are one episode, however the list bounced.
 */
function findClobberEpisodes(timeline: LazarusCandidate[]): ClobberEpisode[] {
  const range = (i: number) => getLazarusItemRange(timeline[i].itemCount)
  const episodes: ClobberEpisode[] = []
  for (let i = 1; i < timeline.length; i++) {
    if (!looksClobbered(range(i).max, range(i - 1).min)) continue
    const open = episodes[episodes.length - 1]
    if (
      open &&
      (i - 1 === open.last ||
        timeline[i].event.created_at - timeline[open.last].event.created_at <=
          CLOBBER_EPISODE_SECONDS)
    ) {
      open.drops.push(i)
      open.last = i
    } else {
      episodes.push({ drops: [i], first: i - 1, last: i })
    }
  }
  return episodes.reverse()
}

/**
 * The version to recommend: the fullest version from just before a drop in
 * the most recent clobber episode the current version still hasn't recovered
 * from. Curation moves a few items at a time and never registers as a drop,
 * so a list that shrank slowly keeps its current version, however far it
 * shrank. A clobber the list has since been edited on several times over at
 * least a week is settled, so the current version is the user's choice.
 * Restore points are never empty (invariant 3), and estimated sizes are
 * compared conservatively.
 */
function findRestorePoint(
  candidates: LazarusCandidate[],
  current: LazarusCandidate
): LazarusCandidate | undefined {
  const timeline = knownTimeline(candidates)
  const minOf = (c: LazarusCandidate) => getLazarusItemRange(c.itemCount).min
  const currentMax = getLazarusItemRange(current.itemCount).max

  for (const episode of findClobberEpisodes(timeline)) {
    const restorePoint = episode.drops
      .map((i) => timeline[i - 1])
      .reduce((fullest, c) => (minOf(c) >= minOf(fullest) ? c : fullest))
    if (!looksClobbered(currentMax, minOf(restorePoint))) continue
    const edits = timeline.length - 1 - episode.last
    const settledFor = current.event.created_at - timeline[episode.last].event.created_at
    if (edits >= SETTLED_MIN_EDITS && settledFor >= SETTLED_MIN_SECONDS) return undefined
    return restorePoint
  }
  return undefined
}

export function rankLazarusCandidates(
  profile: LazarusKindProfile,
  taggedEvents: LazarusTaggedEvent[],
  queriedRelays: string[] = [],
  respondingRelays: string[] = [],
  privateTags: LazarusPrivateTags = new Map()
): LazarusScanResult {
  const byId = new Map<string, LazarusCandidate>()
  for (const { event, relayUrl } of taggedEvents) {
    const existing = byId.get(event.id)
    if (existing) {
      if (!existing.foundOn.includes(relayUrl)) {
        existing.foundOn.push(relayUrl)
      }
      continue
    }
    byId.set(event.id, {
      event,
      foundOn: [relayUrl],
      itemCount: countItems(profile, event, privateTags.get(event.id)),
      isCurrent: false,
      isRecommended: false
    })
  }

  const candidates = Array.from(byId.values())
  const newestFirst = [...candidates].sort(
    (a, b) => b.event.created_at - a.event.created_at || (a.event.id < b.event.id ? -1 : 1)
  )
  const current = newestFirst[0]
  if (current) current.isCurrent = true

  let ordered: LazarusCandidate[]
  let recommended: LazarusCandidate | undefined
  const requiresIntentConfirmation = profile.ranking === 'intent'

  if (profile.ranking === 'count') {
    // Private items count too: a private-only mute list has no public tags,
    // so ranking on tags alone would score an emptied list like a full one.
    const size = (c: LazarusCandidate) => {
      const range = getLazarusItemRange(c.itemCount)
      return range.min + range.max
    }
    ordered = [...candidates].sort(
      (a, b) => size(b) - size(a) || b.event.created_at - a.event.created_at
    )
    // Nothing is recommended while the current size is unknown
    if (current && isLazarusSizeKnown(current.itemCount)) {
      recommended = findRestorePoint(candidates, current)
    }
  } else {
    // 'recency' and 'intent' kinds: recency order, no recommendation. For
    // meaningful-empty kinds ranking is forbidden by spec: the user chooses
    // with intent.
    ordered = newestFirst
  }

  if (recommended) recommended.isRecommended = true

  return {
    kind: profile.kind,
    candidates: ordered,
    current,
    recommended,
    requiresIntentConfirmation,
    queriedRelays,
    respondingRelays
  }
}

/**
 * Re-rank a scan once private items have been decrypted. Candidates missing
 * from the map keep their size-based estimate.
 */
export function applyLazarusPrivateTags(
  profile: LazarusKindProfile,
  scan: LazarusScanResult,
  privateTags: LazarusPrivateTags
): LazarusScanResult {
  return {
    ...rankLazarusCandidates(
      profile,
      scanToTagged(scan),
      scan.queriedRelays,
      scan.respondingRelays,
      privateTags
    ),
    olderCursors: scan.olderCursors
  }
}

export type LazarusSortOrder = 'date' | 'size'

/** Candidates for display: newest first, or largest first with newer versions first on ties. */
export function sortLazarusCandidates(
  candidates: LazarusCandidate[],
  order: LazarusSortOrder
): LazarusCandidate[] {
  const byDate = (a: LazarusCandidate, b: LazarusCandidate) =>
    b.event.created_at - a.event.created_at || (a.event.id < b.event.id ? -1 : 1)
  if (order === 'date') return [...candidates].sort(byDate)
  const size = (c: LazarusCandidate) => {
    const range = getLazarusItemRange(c.itemCount)
    return range.min + range.max
  }
  return [...candidates].sort((a, b) => size(b) - size(a) || byDate(a, b))
}

/**
 * Whether a version is an empty one from the past: evidence of a clobber
 * rather than a state anyone wants back, so a list can hide it until asked.
 * Never the current version, and never on meaningful-empty kinds, where an
 * empty version is a valid option.
 */
export function isPastEmptyVersion(
  candidate: LazarusCandidate,
  profile: LazarusKindProfile
): boolean {
  return (
    !candidate.isCurrent &&
    !profile.meaningfulEmpty &&
    isLazarusSizeKnown(candidate.itemCount) &&
    getLazarusItemRange(candidate.itemCount).max === 0
  )
}

export type LazarusListItem =
  | { type: 'version'; candidate: LazarusCandidate }
  | { type: 'group'; candidates: LazarusCandidate[]; clobbered: boolean }

/**
 * Candidates newest first, folded into groups so a long history stays
 * readable: runs of small edits, and clobber episodes, flagged so the sudden
 * drops stand out. The current version keeps its own row, as do empty
 * versions when shown. Only countable list kinds are grouped, where most
 * versions are small edits of the same list; every version stays reachable
 * by expanding its group. Past empty versions can be left out, for lists
 * that show them on request.
 */
export function groupLazarusCandidates(
  scan: LazarusScanResult,
  profile: LazarusKindProfile,
  { hidePastEmpty = false }: { hidePastEmpty?: boolean } = {}
): LazarusListItem[] {
  const newestFirst = sortLazarusCandidates(scan.candidates, 'date')
  const visible = hidePastEmpty
    ? newestFirst.filter((candidate) => !isPastEmptyVersion(candidate, profile))
    : newestFirst
  if (profile.ranking !== 'count') {
    return visible.map((candidate): LazarusListItem => ({ type: 'version', candidate }))
  }

  const timeline = knownTimeline(scan.candidates)
  const episodeOf = new Map<string, number>()
  findClobberEpisodes(timeline).forEach((episode, n) => {
    for (let i = episode.first; i <= episode.last; i++) episodeOf.set(timeline[i].event.id, n)
  })

  const items: LazarusListItem[] = []
  let run: LazarusCandidate[] = []
  let runEpisode: number | undefined
  const flush = () => {
    if (run.length === 1) items.push({ type: 'version', candidate: run[0] })
    if (run.length > 1) {
      items.push({ type: 'group', candidates: run, clobbered: runEpisode !== undefined })
    }
    run = []
  }
  for (const candidate of visible) {
    const empty =
      isLazarusSizeKnown(candidate.itemCount) && getLazarusItemRange(candidate.itemCount).max === 0
    if (candidate.isCurrent || empty) {
      flush()
      items.push({ type: 'version', candidate })
      continue
    }
    const episode = episodeOf.get(candidate.event.id)
    if (run.length > 0 && episode !== runEpisode) flush()
    runEpisode = episode
    run.push(candidate)
  }
  flush()
  return items
}

export interface LazarusDelta {
  added: string[][]
  removed: string[][]
  addedCount: number
  removedCount: number
  /** True when recovery would grow the list. */
  grows: boolean
  /** True when recovery would shrink the list below current. */
  shrinks: boolean
  /**
   * True when either version has encrypted private items that weren't
   * decrypted, so the changes above cover public tags only.
   */
  privateUnknown: boolean
}

/**
 * What makes two tags the same item: their type and value. A relay hint or
 * petname a client rewrote doesn't change who is followed or muted. On relay
 * lists the read/write marker counts too, since it changes what the relay is
 * for.
 */
function tagIdentity(tag: string[], kind: number): string {
  return JSON.stringify(tag.slice(0, kind === kinds.RelayList ? 3 : 2))
}

export function computeLazarusDelta(
  chosen: Event,
  current: Event | undefined,
  privateTags: LazarusPrivateTags = new Map()
): LazarusDelta {
  // Decrypted private items are compared together with the public tags, so
  // an item that only moved between public and private isn't a change
  const itemsOf = (event: Event | undefined) => {
    if (!event) return { tags: [] as string[][], unknown: false }
    const decrypted = privateTags.get(event.id)
    return {
      tags: [...event.tags, ...(decrypted ?? [])],
      unknown: !decrypted && !!getContentEncryption(event.content)
    }
  }
  const identity = (tag: string[]) => tagIdentity(tag, chosen.kind)
  const unique = (tags: string[][]) =>
    Array.from(new Map(tags.map((t) => [identity(t), t])).values())
  const chosenTags = unique(itemsOf(chosen).tags)
  const currentTags = unique(itemsOf(current).tags)
  const chosenIds = new Set(chosenTags.map(identity))
  const currentIds = new Set(currentTags.map(identity))
  const added = chosenTags.filter((tag) => !currentIds.has(identity(tag)))
  const removed = currentTags.filter((tag) => !chosenIds.has(identity(tag)))
  return {
    added,
    removed,
    addedCount: added.length,
    removedCount: removed.length,
    grows: added.length > 0 && added.length >= removed.length,
    shrinks: removed.length > added.length,
    privateUnknown: itemsOf(chosen).unknown || itemsOf(current).unknown
  }
}

/** Profile fields a restore can change, in the order they're shown. */
const PROFILE_FIELDS = [
  'name',
  'display_name',
  'about',
  'picture',
  'banner',
  'nip05',
  'lud16',
  'lud06',
  'website'
]

export interface LazarusProfileChange {
  field: string
  from?: string
  to?: string
}

/** The profile (kind 0) fields a restore would change: its data lives in content, not tags. */
export function computeLazarusProfileChanges(
  chosen: Event,
  current: Event | undefined
): LazarusProfileChange[] {
  const fieldsOf = (event: Event | undefined): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(event?.content || '{}')
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)
  const to = fieldsOf(chosen)
  const from = fieldsOf(current)
  return PROFILE_FIELDS.flatMap((field) => {
    const change = { field, from: text(from[field]), to: text(to[field]) }
    return change.from === change.to ? [] : [change]
  })
}

export interface LazarusRecoveryDraft {
  kind: number
  content: string
  tags: string[][]
  created_at: number
}

/**
 * Build the recovery event. The chosen candidate's item set is copied
 * verbatim, including encrypted private content (it stays encrypted to the
 * user's own key). It's dated after the version it replaces even when a
 * clobbering client's clock ran ahead, or relays and caches would keep the
 * clobbered one. The caller signs and publishes this exactly once, on an
 * explicit user click.
 */
export function buildLazarusRecoveryDraft(
  chosen: Event,
  { current, now = Math.floor(Date.now() / 1000) }: { current?: Event; now?: number } = {}
): LazarusRecoveryDraft {
  return {
    kind: chosen.kind,
    content: chosen.content,
    tags: chosen.tags.map((tag) => [...tag]),
    created_at: Math.max(now, (current?.created_at ?? 0) + 1)
  }
}

/**
 * Whether restoring this version fits in one NIP-46 request. Remote signers
 * receive every request NIP-44 encrypted, which caps it at 65,535 bytes, so a
 * big follow list can't be restored through one.
 */
export function fitsLazarusRemoteRestore(chosen: Event, pubkey: string): boolean {
  return fitsNip46Request('sign_event', [
    JSON.stringify({ ...buildLazarusRecoveryDraft(chosen), pubkey })
  ])
}
