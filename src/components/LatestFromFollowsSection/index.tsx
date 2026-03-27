import NoteCard from '@/components/NoteCard'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { buildFollowOutboxAggregateReadUrls } from '@/lib/follow-outbox-aggregate-relays'
import {
  buildSearchFollowsFeedScopeKey,
  fingerprintRelaySet,
  fingerprintSortedPubkeys,
  postsMapToRecord,
  postsRecordToMap,
  readSearchFollowsFeedCache,
  writeSearchFollowsFeedCache
} from '@/lib/search-follows-feed-cache'
import { shouldFilterEvent } from '@/lib/event-filtering'
import { toProfile } from '@/lib/link'
import { getPubkeysFromPTags } from '@/lib/tag'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/PageManager'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import { queryService, replaceableEventService } from '@/services/client.service'
import type { TRelayList } from '@/types'
import logger from '@/lib/logger'
import { ChevronRight, Star } from 'lucide-react'
import { Event, kinds, nip19, NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormattedTimestamp } from '../FormattedTimestamp'
import UserAvatar from '../UserAvatar'
import Username from '../Username'

/** Curated follow list for guests (hex from npub). */
export const RECOMMENDED_FOLLOW_CURATOR_NPUB =
  'npub1m4ny6hjqzepn4rxknuq94c2gpqzr29ufkkw7ttcxyak7v43n6vvsajc2jl' as const

const MAX_FOLLOWS = 1000
const AUTHORS_PER_BATCH = 20
const MAX_POSTS_PER_AUTHOR = 5
/** Enough headroom to often fill 5 notes per author in a batch. */
const BATCH_EVENT_LIMIT = 200
/** Chunk size for batched NIP-65 list load while building the aggregate REQ set. */
const RELAY_LIST_PRELOAD_CHUNK = 100

const FEED_KINDS = [
  kinds.ShortTextNote,
  ExtendedKind.DISCUSSION,
  kinds.LongFormArticle,
  kinds.Highlights,
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.COMMENT,
  kinds.Repost,
  ExtendedKind.GENERIC_REPOST
] as number[]

const feedKindSet = new Set(FEED_KINDS)

function mergeBatchPosts(
  prev: Map<string, NostrEvent[]>,
  incoming: NostrEvent[],
  batchAuthors: string[]
): Map<string, NostrEvent[]> {
  const next = new Map(prev)
  const authorSet = new Set(batchAuthors)
  const filtered = incoming.filter((e) => authorSet.has(e.pubkey))
  for (const pk of batchAuthors) {
    const prevList = next.get(pk) ?? []
    const newForPk = filtered.filter((e) => e.pubkey === pk)
    const byId = new Map<string, NostrEvent>()
    for (const e of prevList) byId.set(e.id, e)
    for (const e of newForPk) {
      const ex = byId.get(e.id)
      if (!ex || e.created_at >= ex.created_at) byId.set(e.id, e)
    }
    const sorted = [...byId.values()]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, MAX_POSTS_PER_AUTHOR)
    next.set(pk, sorted)
  }
  return next
}

function recommendedCuratorHexPubkey(): string | null {
  try {
    const dec = nip19.decode(RECOMMENDED_FOLLOW_CURATOR_NPUB)
    if (dec.type !== 'npub') return null
    return dec.data
  } catch {
    return null
  }
}

export default function LatestFromFollowsSection({
  refreshKey = 0,
  variant = 'embedded'
}: {
  /** Bump to re-run batched relay fetches (e.g. titlebar / page refresh). */
  refreshKey?: number
  /** `page`: full-width list on the follows-latest primary page; `embedded`: tighter vertical spacing. */
  variant?: 'page' | 'embedded'
} = {}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { pubkey, followListEvent, isInitialized, isAccountSessionHydrating } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { mutePubkeySet } = useMuteList()
  const { isEventDeleted } = useDeletedEvent()
  const { hideUntrustedNotes, isUserTrusted } = useUserTrust()

  const loggedInFollowPubkeys = useMemo(() => {
    if (!pubkey || !isInitialized) return null
    return getPubkeysFromPTags(followListEvent?.tags ?? []).slice(0, MAX_FOLLOWS)
  }, [pubkey, isInitialized, followListEvent])

  const [guestFollowPubkeys, setGuestFollowPubkeys] = useState<string[]>([])
  const [guestListReady, setGuestListReady] = useState(false)

  const [postsByPubkey, setPostsByPubkey] = useState<Map<string, NostrEvent[]>>(() => new Map())
  const [batchBusy, setBatchBusy] = useState(false)
  const abortedRef = useRef(false)

  const followPubkeys = pubkey ? (loggedInFollowPubkeys ?? []) : guestFollowPubkeys
  const followsLabel: 'self' | 'recommended' = pubkey ? 'self' : 'recommended'
  const [followListGraceExpired, setFollowListGraceExpired] = useState(false)
  useEffect(() => {
    if (!pubkey || followListEvent) {
      setFollowListGraceExpired(false)
      return
    }
    const t = setTimeout(() => setFollowListGraceExpired(true), 4000)
    return () => clearTimeout(t)
  }, [pubkey, followListEvent])

  const loadingFollowList =
    (!pubkey && isInitialized && !guestListReady) ||
    (!!pubkey && !followListEvent && (isAccountSessionHydrating || !followListGraceExpired))

  const [aggregateRelayUrls, setAggregateRelayUrls] = useState<string[]>([])
  const [aggregateRelaysReady, setAggregateRelaysReady] = useState(false)

  const followListFingerprint = useMemo(
    () => fingerprintSortedPubkeys(followPubkeys),
    [followPubkeys]
  )
  const aggregateRelayFingerprint = useMemo(
    () => fingerprintRelaySet(aggregateRelayUrls),
    [aggregateRelayUrls]
  )
  const followsFeedScopeKey = useMemo(
    () =>
      buildSearchFollowsFeedScopeKey({
        mode: followsLabel,
        viewerPubkey: pubkey?.toLowerCase() ?? null,
        followListFingerprint,
        aggregateRelayFingerprint
      }),
    [followsLabel, pubkey, followListFingerprint, aggregateRelayFingerprint]
  )

  const acceptEvent = useCallback(
    (e: Event) => {
      if (!feedKindSet.has(e.kind)) return false
      if (isEventDeleted(e)) return false
      if (shouldFilterEvent(e)) return false
      if (mutePubkeySet.has(e.pubkey)) return false
      if (hideUntrustedNotes && !isUserTrusted(e.pubkey)) return false
      return true
    },
    [hideUntrustedNotes, isEventDeleted, isUserTrusted, mutePubkeySet]
  )

  // Guest: load curated follow list from npub; logged-in list comes from useMemo above.
  useEffect(() => {
    if (!isInitialized) return
    if (pubkey) {
      setGuestFollowPubkeys([])
      setGuestListReady(false)
      return
    }

    let cancelled = false
    setGuestListReady(false)
    setGuestFollowPubkeys([])

    ;(async () => {
      const hex = recommendedCuratorHexPubkey()
      if (!hex) {
        if (!cancelled) {
          setGuestFollowPubkeys([])
          setGuestListReady(true)
        }
        return
      }
      try {
        const evt = await replaceableEventService.fetchReplaceableEvent(hex, kinds.Contacts)
        if (cancelled) return
        const list = evt ? getPubkeysFromPTags(evt.tags).slice(0, MAX_FOLLOWS) : []
        setGuestFollowPubkeys(list)
      } catch (err) {
        logger.warn('[LatestFromFollows] Failed to load recommended follow list', err)
        if (!cancelled) setGuestFollowPubkeys([])
      } finally {
        if (!cancelled) setGuestListReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isInitialized, pubkey])

  // Load each follow's NIP-65 list (IndexedDB + network), then aggregate first outboxes + READ_ONLY relays.
  useEffect(() => {
    if (!isInitialized || loadingFollowList) {
      return
    }
    if (followPubkeys.length === 0) {
      setAggregateRelayUrls([])
      setAggregateRelaysReady(true)
      return
    }

    let cancelled = false
    setAggregateRelaysReady(false)
    setAggregateRelayUrls([])

    ;(async () => {
      try {
        // Dynamic import avoids a static cycle: client.service → replaceable-events → client.service
        // (would break React context / HMR when this module loads early).
        const { default: nostrClient } = await import('@/services/client.service')
        const allLists: TRelayList[] = []
        for (let i = 0; i < followPubkeys.length; i += RELAY_LIST_PRELOAD_CHUNK) {
          if (cancelled) return
          const chunk = followPubkeys.slice(i, i + RELAY_LIST_PRELOAD_CHUNK)
          const lists = await nostrClient.fetchRelayLists(chunk)
          allLists.push(...lists)
        }
        if (cancelled) return
        const urls = buildFollowOutboxAggregateReadUrls(
          allLists,
          blockedRelays,
          favoriteRelays
        )
        setAggregateRelayUrls(urls)
      } catch (err) {
        logger.warn('[LatestFromFollows] Failed to build follow outbox aggregate relays', err)
        if (!cancelled) {
          setAggregateRelayUrls(
            buildFollowOutboxAggregateReadUrls([], blockedRelays, favoriteRelays)
          )
        }
      } finally {
        if (!cancelled) setAggregateRelaysReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [followPubkeys, favoriteRelays, blockedRelays, isInitialized, loadingFollowList])

  // Batch-fetch posts per slice of authors against the aggregate relay set.
  useEffect(() => {
    if (!isInitialized || loadingFollowList) return
    if (followPubkeys.length === 0) return
    if (!aggregateRelaysReady) return

    abortedRef.current = false
    let cancelled = false

    const run = async () => {
      setBatchBusy(true)
      const seed = readSearchFollowsFeedCache(followsFeedScopeKey)
      let working = seed ? postsRecordToMap(seed.posts) : new Map<string, NostrEvent[]>()
      setPostsByPubkey(new Map(working))

      const persist = () => {
        writeSearchFollowsFeedCache({
          v: 1,
          scopeKey: followsFeedScopeKey,
          posts: postsMapToRecord(working),
          savedAtMs: Date.now()
        })
      }

      for (let i = 0; i < followPubkeys.length; i += AUTHORS_PER_BATCH) {
        if (cancelled || abortedRef.current) break
        const batch = followPubkeys.slice(i, i + AUTHORS_PER_BATCH)
        try {
          const raw = await queryService.fetchEvents(
            aggregateRelayUrls,
            {
              kinds: [...FEED_KINDS],
              authors: batch,
              limit: BATCH_EVENT_LIMIT
            },
            { eoseTimeout: 2800, globalTimeout: 9000 }
          )
          if (cancelled || abortedRef.current) break
          const filtered = raw.filter((e) => acceptEvent(e))
          working = mergeBatchPosts(working, filtered, batch)
          setPostsByPubkey(new Map(working))
          persist()
        } catch (err) {
          logger.warn('[LatestFromFollows] Batch fetch failed', { err, batchSize: batch.length })
        }
      }
      if (!cancelled) {
        persist()
        setBatchBusy(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      abortedRef.current = true
      setBatchBusy(false)
    }
  }, [
    followPubkeys,
    aggregateRelayUrls,
    aggregateRelaysReady,
    loadingFollowList,
    isInitialized,
    acceptEvent,
    followsFeedScopeKey,
    refreshKey
  ])

  const sortedRowPubkeys = useMemo(() => {
    const withPosts = followPubkeys.filter((pk) => (postsByPubkey.get(pk)?.length ?? 0) > 0)
    const withoutPosts = followPubkeys.filter((pk) => (postsByPubkey.get(pk)?.length ?? 0) === 0)
    withPosts.sort((a, b) => {
      const ta = postsByPubkey.get(a)?.[0]?.created_at ?? 0
      const tb = postsByPubkey.get(b)?.[0]?.created_at ?? 0
      return tb - ta
    })
    return [...withPosts, ...withoutPosts]
  }, [followPubkeys, postsByPubkey])

  const vertical = variant === 'page' ? '' : 'mb-6'

  if (!isInitialized) {
    return null
  }

  if (loadingFollowList) {
    return (
      <div className={cn('space-y-2', vertical)} role="status" aria-busy="true" aria-live="polite">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
    )
  }

  if (followPubkeys.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border border-border/80 bg-muted/20 px-4 py-3 text-sm text-muted-foreground',
          vertical
        )}
      >
        {followsLabel === 'recommended'
          ? t('Could not load recommended follows')
          : t('Your follow list is empty')}
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-0 rounded-lg border border-border/60 overflow-hidden">
      {batchBusy && postsByPubkey.size === 0 ? (
        <div className="space-y-2 px-4 py-4" role="status" aria-busy="true" aria-live="polite">
          <Skeleton className="h-3 w-64 max-w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : null}
      {sortedRowPubkeys.map((pk) => {
        const posts = postsByPubkey.get(pk) ?? []
        const count = posts.length
        const latest = posts[0]?.created_at
        return (
          <FollowPulseRow
            key={pk}
            pubkey={pk}
            count={count}
            latestCreatedAt={latest}
            posts={posts}
            onOpenProfile={() => push(toProfile(pk))}
          />
        )
      })}
      {batchBusy && postsByPubkey.size > 0 ? (
        <div className="px-4 py-2 border-t border-border/50">
          <Skeleton className="h-3 w-28" aria-hidden />
        </div>
      ) : null}
    </div>
  )
}

function FollowRowEmptyPosts() {
  const { t } = useTranslation()
  return (
    <div className="px-4 py-3 text-sm text-muted-foreground">
      {t('No recent posts from this user in the current fetch')}
    </div>
  )
}

function FollowPulseRow({
  pubkey,
  count,
  latestCreatedAt,
  posts,
  onOpenProfile
}: {
  pubkey: string
  count: number
  latestCreatedAt?: number
  posts: NostrEvent[]
  onOpenProfile: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border/60 last:border-b-0">
      <div className="flex items-stretch gap-0">
        <CollapsibleTrigger
          className="flex size-10 shrink-0 items-center justify-center border-r border-border/50 text-muted-foreground hover:bg-muted/40"
          aria-label={open ? 'Collapse posts' : 'Expand posts'}
        >
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        </CollapsibleTrigger>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30"
          onClick={(e) => {
            e.stopPropagation()
            onOpenProfile()
          }}
        >
          <UserAvatar userId={pubkey} size="medium" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Username
                userId={pubkey}
                className="truncate text-sm font-semibold"
                skeletonClassName="h-4 w-24"
              />
              <Star className="size-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.5} aria-hidden />
            </div>
            <div className="text-xs text-muted-foreground">
              {latestCreatedAt ? (
                <FormattedTimestamp timestamp={latestCreatedAt} short />
              ) : (
                '—'
              )}
            </div>
          </div>
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary tabular-nums"
            title={String(count)}
          >
            {count}
          </div>
        </button>
      </div>
      <CollapsibleContent className="overflow-hidden border-t border-border/50 bg-muted/10">
        {posts.length === 0 ? (
          <FollowRowEmptyPosts />
        ) : (
          <div className="pb-2">
            {posts.map((ev) => (
              <NoteCard key={ev.id} className="w-full" event={ev} />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
