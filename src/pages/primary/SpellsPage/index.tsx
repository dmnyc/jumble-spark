import HideUntrustedContentButton from '@/components/HideUntrustedContentButton'
import NoteList, { type TNoteListRef } from '@/components/NoteList'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import PrimaryPageLayout, { type TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import logger from '@/lib/logger'
import { showPublishingError } from '@/lib/publishing-feedback'
import { cn } from '@/lib/utils'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import {
  decodeFollowSetSpellId,
  dedupeFollowSetEventsByD,
  encodeFollowSetSpellId,
  getFollowSetDTag,
  isFollowSetSpellId,
  labelFollowSetEvent,
  pubkeysFromFollowSetEvent
} from '@/lib/follow-set-spell'
import client, { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import storage from '@/services/local-storage.service'
import {
  ExtendedKind,
  DEFAULT_FEED_SHOW_KINDS,
  FAUX_SPELL_ORDER,
  FIRST_RELAY_RESULT_GRACE_MS,
} from '@/constants'
import { filterEventsExcludingTombstones, isUserInEventMentions } from '@/lib/event'
import { formatPubkey } from '@/lib/pubkey'
import {
  augmentSubRequestsWithFavoritesFastReadAndInbox,
  getRelayUrlsWithFavoritesFastReadAndInbox
} from '@/lib/favorites-feed-relays'
import {
  computeKind777SpellFeedSubscriptionKey,
  computeSpellSubRequestsIdentityKey
} from '@/lib/spell-feed-request-identity'
import { TOMBSTONES_UPDATED_EVENT } from '@/lib/tombstone-events'
import { normalizeUrl } from '@/lib/url'
import {
  buildSpellCatalogAuthors,
  getRelaysForSpell,
  getRelaysForSpellCatalogSync,
  getSpellName,
  isSpellEvent,
  SPELL_CATALOG_SYNC_LIMIT,
  SPELL_CATALOG_SYNC_LIMIT_WITH_FOLLOWS,
  SPELL_CATALOG_SYNC_TIMEOUT_MS,
  spellEventToFilter
} from '@/services/spell.service'
import { TFeedSubRequest } from '@/types'
import {
  Bell,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  FileText,
  Gift,
  Hash,
  Image as ImageIcon,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  Star,
  Trash2,
  Users,
  Wand2
} from 'lucide-react'
import type { Event } from 'nostr-tools'
import { kinds as nostrKinds, verifyEvent } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateSpellDialog from './CreateSpellDialog'
import {
  appendCuratedReadOnlyRelays,
  applyFauxSpellCapsToSubRequests,
  buildBookmarksSubRequests,
  buildCalendarSpellFilter,
  buildDiscussionFilter,
  buildInterestsSubRequests,
  buildMediaSpellFilter,
  buildNotificationsSpellSubRequests,
  NOTIFICATION_SPELL_LOADING_SAFETY_MS,
  FAUX_SPELL_EVENT_LIMIT,
  MEDIA_SPELL_KINDS,
  NOTIFICATION_SPELL_KINDS
} from './fauxSpellFeeds'
import type { TPageRef } from '@/types'

/** Primary + optional subtitle (npub and/or short id). When grouped under an author header, omit npub. */
function spellPickerPrimaryAndSecondary(
  spell: Event,
  accountPubkey: string | undefined,
  labelFor: (e: Event) => string,
  options?: { omitAuthorNpub?: boolean }
) {
  const primary = labelFor(spell)
  const isOwn = !!(accountPubkey && spell.pubkey === accountPubkey)
  const shortTitle = primary.trim().length < 4
  const secondaryParts: string[] = []
  if (!isOwn && !options?.omitAuthorNpub) secondaryParts.push(formatPubkey(spell.pubkey))
  if (shortTitle) secondaryParts.push(`${spell.id.slice(0, 8)}…`)
  return {
    primary,
    secondary: secondaryParts.length > 0 ? secondaryParts.join(' · ') : null
  }
}

function groupSpellsByPubkeySorted(spells: Event[]): { pubkey: string; spells: Event[] }[] {
  const map = new Map<string, Event[]>()
  for (const s of spells) {
    const list = map.get(s.pubkey)
    if (list) list.push(s)
    else map.set(s.pubkey, [s])
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      getSpellName(a).localeCompare(getSpellName(b), undefined, { sensitivity: 'base' })
    )
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pubkey, list]) => ({ pubkey, spells: list }))
}

function SpellSheetAuthorHeader({ userId }: { userId: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
      <UserAvatar userId={userId} size="small" className="shrink-0" />
      <Username
        userId={userId}
        className="min-w-0 text-sm font-semibold"
        skeletonClassName="h-4 w-28"
      />
    </div>
  )
}

function SpellSheetOptionRow({
  spell,
  selected,
  accountPubkey,
  labelFor,
  onPick,
  groupedUnderAuthor = false
}: {
  spell: Event
  selected: boolean
  accountPubkey: string | undefined
  labelFor: (e: Event) => string
  onPick: (e: Event) => void
  /** Author shown in a header above this block — hide npub under each row */
  groupedUnderAuthor?: boolean
}) {
  const { primary, secondary } = spellPickerPrimaryAndSecondary(spell, accountPubkey, labelFor, {
    omitAuthorNpub: groupedUnderAuthor
  })
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-accent/50'
      )}
      onClick={() => onPick(spell)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {selected ? <Check className="size-4" aria-hidden /> : null}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-stretch gap-0.5">
        <span className="truncate text-left text-sm font-medium leading-tight">{primary}</span>
        {secondary ? (
          <span className="truncate text-left text-xs text-muted-foreground">{secondary}</span>
        ) : null}
      </div>
    </button>
  )
}

type FauxSpellName = (typeof FAUX_SPELL_ORDER)[number]

function isSpellsPageBuiltinFauxSpell(s: string): s is FauxSpellName {
  return (FAUX_SPELL_ORDER as readonly string[]).includes(s)
}

function isSpellsPageFauxSpellParam(s: string): boolean {
  if (isSpellsPageBuiltinFauxSpell(s)) return true
  if (!isFollowSetSpellId(s)) return false
  return decodeFollowSetSpellId(s) != null
}

function isFollowFeedFauxSpellId(s: string | null): boolean {
  return s === 'following' || (!!s && isFollowSetSpellId(s))
}

function useNoteListHideReplies() {
  const [hideReplies, setHideReplies] = useState(() => storage.getNoteListMode() === 'posts')

  useEffect(() => {
    const sync = () => setHideReplies(storage.getNoteListMode() === 'posts')
    window.addEventListener('noteListModeChanged', sync)
    return () => window.removeEventListener('noteListModeChanged', sync)
  }, [])

  return hideReplies
}

function fauxSpellLabelKey(name: FauxSpellName): string {
  switch (name) {
    case 'notifications':
      return 'Notifications'
    case 'discussions':
      return 'Discussions'
    case 'following':
      return 'Following'
    case 'followPacks':
      return 'Follow Packs'
    case 'media':
      return 'Media'
    case 'interests':
      return 'Interests'
    case 'bookmarks':
      return 'Bookmarks'
    case 'calendar':
      return 'Calendar'
    default:
      return 'Spells'
  }
}

const FAUX_SPELL_ICON: Record<FauxSpellName, typeof Bell> = {
  notifications: Bell,
  discussions: MessageSquare,
  following: Users,
  followPacks: Gift,
  media: ImageIcon,
  interests: Hash,
  bookmarks: Bookmark,
  calendar: CalendarDays
}

const SpellsPage = forwardRef<TPageRef>(function SpellsPage(
  { spell: spellProp }: { spell?: string },
  ref
) {
  const { t } = useTranslation()
  const { navigate: navigatePrimary } = usePrimaryPage()
  const { pubkey, relayList, attemptDelete, bookmarkListEvent, interestListEvent } = useNostr()
  const { hideUntrustedNotifications } = useUserTrust()
  const { isSmallScreen } = useScreenSize()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const {
    showKinds: kindFilterShowKinds,
    showKind1OPs,
    showKind1Replies,
    showKind1111
  } = useKindFilter()
  const hideRepliesFollowing = useNoteListHideReplies()
  const [spells, setSpells] = useState<Event[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [selectedSpell, setSelectedSpell] = useState<Event | null>(null)
  const [selectedFauxSpell, setSelectedFauxSpell] = useState<string | null>(null)
  const [followSetListEvents, setFollowSetListEvents] = useState<Event[]>([])
  const [followSetCatalogLoading, setFollowSetCatalogLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [spellToEdit, setSpellToEdit] = useState<Event | null>(null)
  const [spellToClone, setSpellToClone] = useState<Event | null>(null)
  const [definitionSpell, setDefinitionSpell] = useState<Event | null>(null)
  const [contacts, setContacts] = useState<string[]>([])
  /** True while fetching kind 777 authored by the user from write relays into IndexedDB */
  const [spellsCatalogSyncing, setSpellsCatalogSyncing] = useState(false)
  const spellCatalogCloserRef = useRef<(() => void) | null>(null)
  /** Bumps spell catalog relay re-sync when the user taps refresh in the titlebar. */
  const [spellCatalogManualRefreshKey, setSpellCatalogManualRefreshKey] = useState(0)
  /** Last processed {@link spellCatalogManualRefreshKey} so we only treat real bumps as “force sync”. */
  const spellCatalogLastManualKeyRef = useRef(0)
  const spellFeedListRef = useRef<TNoteListRef>(null)
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)
  const [spellPickerOpen, setSpellPickerOpen] = useState(false)

  /** Monotonic token + wall time for spell-feed latency instrumentation (picker → first rows). */
  const spellFeedInstrTokenRef = useRef(0)
  const spellFeedInstrT0Ref = useRef(0)
  const spellFeedInstrLabelRef = useRef('')
  const [spellFeedInstrumentToken, setSpellFeedInstrumentToken] = useState(0)
  const [followSetManualRefreshKey, setFollowSetManualRefreshKey] = useState(0)

  const logSpellFeedPickerSelection = useCallback((label: string, extra?: Record<string, unknown>) => {
    spellFeedInstrT0Ref.current = performance.now()
    spellFeedInstrLabelRef.current = label
    spellFeedInstrTokenRef.current += 1
    const instrumentToken = spellFeedInstrTokenRef.current
    setSpellFeedInstrumentToken(instrumentToken)
    logger.info('[SpellsPage] Spell feed — picker selection', {
      label,
      instrumentToken,
      ...extra
    })
  }, [])

  const urlFauxSpellInstrumentedRef = useRef<string | null>(null)
  /** Set when picker calls `navigatePrimary(..., { spell })` so URL effect does not log/bump token again. */
  const fauxSpellUrlSyncFromPickerRef = useRef<string | null>(null)
  useEffect(() => {
    if (spellProp && isSpellsPageFauxSpellParam(spellProp)) {
      if (fauxSpellUrlSyncFromPickerRef.current === spellProp) {
        fauxSpellUrlSyncFromPickerRef.current = null
        urlFauxSpellInstrumentedRef.current = spellProp
        setSelectedFauxSpell(spellProp)
        setSelectedSpell(null)
        return
      }
      if (urlFauxSpellInstrumentedRef.current === spellProp) return
      urlFauxSpellInstrumentedRef.current = spellProp
      logSpellFeedPickerSelection(`faux:${spellProp} (from URL)`, { fauxSpell: spellProp, fromUrl: true })
      setSelectedFauxSpell(spellProp)
      setSelectedSpell(null)
    } else {
      urlFauxSpellInstrumentedRef.current = null
      // URL / props no longer name a faux spell (e.g. bottom bar “Spells” → `/spells`) — leave the feed.
      setSelectedFauxSpell(null)
    }
  }, [spellProp, logSpellFeedPickerSelection])

  const [followingSubRequests, setFollowingSubRequests] = useState<TFeedSubRequest[]>([])
  const [followingFeedLoading, setFollowingFeedLoading] = useState(false)

  const loadSpells = useCallback(async () => {
    const [events, ids] = await Promise.all([
      indexedDb.getSpellEvents(),
      indexedDb.getSpellFavoriteIds()
    ])
    setSpells(events)
    setFavoriteIds(new Set(ids))
  }, [])

  const refreshSpellsFeedAndCatalog = useCallback(() => {
    void loadSpells()
    if (pubkey) {
      setSpellCatalogManualRefreshKey((k) => k + 1)
      setFollowSetManualRefreshKey((k) => k + 1)
    }
    spellFeedListRef.current?.refresh()
  }, [loadSpells, pubkey])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: refreshSpellsFeedAndCatalog
    }),
    [refreshSpellsFeedAndCatalog]
  )

  /**
   * Fingerprint by value — `relayList` from NostrProvider often gets a new object ref each render.
   * Using `[relayList]` in useMemo deps was invalidating every tick → new subRequests → browse-relay
   * effect → CurrentRelays churn → mass useFetchProfile cancellation (e.g. Discussions spell).
   */
  const normalizedReadSorted = relayList
    ? [...relayList.read].map((u) => normalizeUrl(u) || u).filter(Boolean).sort()
    : []
  const normalizedWriteSorted = relayList
    ? [...relayList.write].map((u) => normalizeUrl(u) || u).filter(Boolean).sort()
    : []

  /** Read+write only, order-stable. `originalRelays` churns during NIP-66 / discovery but faux spell REQ lists ignore it. */
  const relayMailboxStableKey =
    relayList == null
      ? ''
      : JSON.stringify({ r: normalizedReadSorted, w: normalizedWriteSorted })

  /** Write URLs only; mailbox key excludes discovery merges on `originalRelays`. */
  const relayListWriteKey = useMemo(() => {
    if (!relayList) return '[]'
    return JSON.stringify(normalizedWriteSorted)
  }, [relayMailboxStableKey])

  /** Order-independent favorites/blocked — array order from providers must not rebuild subs. */
  const sortedFavoriteRelaysKey = useMemo(
    () =>
      JSON.stringify(
        [...favoriteRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort((a, b) => a.localeCompare(b))
      ),
    [favoriteRelays]
  )
  const sortedBlockedRelaysKey = useMemo(
    () =>
      JSON.stringify(
        [...blockedRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort((a, b) => a.localeCompare(b))
      ),
    [blockedRelays]
  )

  useEffect(() => {
    if (!pubkey) {
      setFollowSetListEvents([])
      setFollowSetCatalogLoading(false)
      return
    }
    let cancelled = false
    setFollowSetCatalogLoading(true)
    void (async () => {
      try {
        const feedUrls = getRelayUrlsWithFavoritesFastReadAndInbox(
          favoriteRelays,
          blockedRelays,
          relayList?.read ?? [],
          { userWriteRelays: relayList?.write ?? [] }
        )
        const urls = appendCuratedReadOnlyRelays(feedUrls, blockedRelays)
        if (!urls.length) {
          if (!cancelled) setFollowSetListEvents([])
          return
        }
        const events = await queryService.fetchEvents(
          urls,
          { authors: [pubkey], kinds: [ExtendedKind.FOLLOW_SET], limit: 500 },
          { eoseTimeout: 2000, globalTimeout: 15000, firstRelayResultGraceMs: false }
        )
        const tombstones = await indexedDb.getAllTombstones()
        if (!cancelled) {
          setFollowSetListEvents(dedupeFollowSetEventsByD(filterEventsExcludingTombstones(events, tombstones)))
        }
      } catch {
        if (!cancelled) setFollowSetListEvents([])
      } finally {
        if (!cancelled) setFollowSetCatalogLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey, sortedFavoriteRelaysKey, sortedBlockedRelaysKey, relayMailboxStableKey, followSetManualRefreshKey])

  useEffect(() => {
    const onTombstones = () => setFollowSetManualRefreshKey((k) => k + 1)
    window.addEventListener(TOMBSTONES_UPDATED_EVENT, onTombstones)
    return () => window.removeEventListener(TOMBSTONES_UPDATED_EVENT, onTombstones)
  }, [])

  /**
   * Kind-777 list for the dropdown. When opening with `?spell=…` (faux name, hex id, nevent, etc.), defer
   * this IndexedDB read so the feed can subscribe and paint first; the header already reflects the URL.
   */
  useEffect(() => {
    let cancelled = false
    const run = () => {
      if (!cancelled) void loadSpells()
    }
    let idleId: number | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (spellProp?.trim()) {
      if (typeof requestIdleCallback !== 'undefined') {
        idleId = requestIdleCallback(run, { timeout: 400 })
      } else {
        timeoutId = setTimeout(run, 0)
      }
    } else {
      run()
    }

    return () => {
      cancelled = true
      if (idleId !== undefined) cancelIdleCallback(idleId)
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [loadSpells, spellProp])

  /** Stable key so we re-sync when the follow list changes (not only on array identity). */
  const contactsSyncKey = useMemo(() => [...contacts].sort().join(','), [contacts])

  /**
   * Pull kind 777 from relays only when IndexedDB has no spells yet, or when the user requests refresh.
   * Otherwise the picker uses {@link loadSpells} from cache only (no extra REQ on each visit / relay churn).
   */
  useEffect(() => {
    if (!pubkey) {
      setSpellsCatalogSyncing(false)
      return
    }
    let cancelled = false
    spellCatalogCloserRef.current = null
    let loadSpellsDebounce: ReturnType<typeof setTimeout> | null = null
    let delayId: ReturnType<typeof setTimeout> | null = null
    let syncTimeout: ReturnType<typeof setTimeout> | null = null
    let afterFirstBatchTimer: ReturnType<typeof setTimeout> | null = null
    const clearAfterFirstBatchTimer = () => {
      if (afterFirstBatchTimer != null) {
        clearTimeout(afterFirstBatchTimer)
        afterFirstBatchTimer = null
      }
    }

    const scheduleLoadSpells = () => {
      if (loadSpellsDebounce != null) clearTimeout(loadSpellsDebounce)
      loadSpellsDebounce = setTimeout(() => {
        loadSpellsDebounce = null
        if (!cancelled) void loadSpells()
      }, 120)
    }

    void (async () => {
      const manualBump = spellCatalogManualRefreshKey !== spellCatalogLastManualKeyRef.current
      if (manualBump) {
        spellCatalogLastManualKeyRef.current = spellCatalogManualRefreshKey
      }
      const cachedSpells = await indexedDb.getSpellEvents()
      if (cancelled) return

      const shouldSyncFromRelays = manualBump || cachedSpells.length === 0
      if (!shouldSyncFromRelays) {
        return
      }

      const urls = getRelaysForSpellCatalogSync(favoriteRelays, blockedRelays, relayList?.read ?? [], {
        userWriteRelays: relayList?.write ?? []
      })
      const catalogAuthors = buildSpellCatalogAuthors(pubkey, contacts)
      const authorAllowlist = new Set(catalogAuthors)
      const filter = {
        kinds: [ExtendedKind.SPELL],
        authors: catalogAuthors,
        limit: contacts.length > 0 ? SPELL_CATALOG_SYNC_LIMIT_WITH_FOLLOWS : SPELL_CATALOG_SYNC_LIMIT
      }

      syncTimeout = setTimeout(() => {
        if (cancelled) return
        logger.warn('[SpellsPage] Spell catalog sync timed out')
        spellCatalogCloserRef.current?.()
        spellCatalogCloserRef.current = null
        setSpellsCatalogSyncing(false)
      }, SPELL_CATALOG_SYNC_TIMEOUT_MS)

      let catalogSyncDone = false

      /** Catalog sync runs in parallel with the open feed; avoid an artificial delay. */
      const catalogDelayMs = 0
      if (cancelled) return
      delayId = setTimeout(() => {
        if (cancelled) return
        void (async () => {
          try {
            setSpellsCatalogSyncing(true)
            const { closer } = await client.subscribeTimeline(
              [{ urls, filter }],
              {
                onEvents: async (events, eosed) => {
                  if (cancelled) return
                  let wrote = false
                  for (const ev of events) {
                    if (cancelled) return
                    if (!verifyEvent(ev) || !isSpellEvent(ev) || !authorAllowlist.has(ev.pubkey)) continue
                    try {
                      await indexedDb.putSpellEvent(ev)
                      wrote = true
                    } catch (e) {
                      logger.warn('[SpellsPage] Failed to cache spell from relay', e)
                    }
                  }
                  if (wrote) scheduleLoadSpells()
                  if (wrote && afterFirstBatchTimer == null) {
                    afterFirstBatchTimer = setTimeout(() => {
                      afterFirstBatchTimer = null
                      if (cancelled || catalogSyncDone) return
                      catalogSyncDone = true
                      if (syncTimeout != null) clearTimeout(syncTimeout)
                      if (loadSpellsDebounce != null) {
                        clearTimeout(loadSpellsDebounce)
                        loadSpellsDebounce = null
                      }
                      void (async () => {
                        if (!cancelled) await loadSpells()
                        if (!cancelled) setSpellsCatalogSyncing(false)
                      })()
                      closer()
                      spellCatalogCloserRef.current = null
                    }, FIRST_RELAY_RESULT_GRACE_MS)
                  }
                  if (eosed) {
                    clearAfterFirstBatchTimer()
                    if (cancelled || catalogSyncDone) return
                    catalogSyncDone = true
                    if (syncTimeout != null) clearTimeout(syncTimeout)
                    if (loadSpellsDebounce != null) {
                      clearTimeout(loadSpellsDebounce)
                      loadSpellsDebounce = null
                    }
                    if (!cancelled) await loadSpells()
                    if (!cancelled) setSpellsCatalogSyncing(false)
                    closer()
                    spellCatalogCloserRef.current = null
                  }
                },
                onNew: () => {} // Not needed
              },
              {
                firstRelayResultGraceMs: FIRST_RELAY_RESULT_GRACE_MS
              }
            )
            if (cancelled) {
              closer()
              return
            }
            spellCatalogCloserRef.current = closer
          } catch (e) {
            if (syncTimeout != null) clearTimeout(syncTimeout)
            logger.warn('[SpellsPage] Spell catalog subscribe failed', e)
            if (!cancelled) setSpellsCatalogSyncing(false)
          }
        })()
      }, catalogDelayMs)
    })()

    return () => {
      cancelled = true
      clearAfterFirstBatchTimer()
      if (delayId != null) clearTimeout(delayId)
      if (syncTimeout != null) clearTimeout(syncTimeout)
      if (loadSpellsDebounce != null) clearTimeout(loadSpellsDebounce)
      spellCatalogCloserRef.current?.()
      spellCatalogCloserRef.current = null
      setSpellsCatalogSyncing(false)
    }
  }, [
    pubkey,
    sortedFavoriteRelaysKey,
    sortedBlockedRelaysKey,
    relayMailboxStableKey,
    loadSpells,
    contactsSyncKey,
    spellCatalogManualRefreshKey
  ])

  useEffect(() => {
    if (!pubkey) {
      setContacts([])
      return
    }
    client.fetchFollowings(pubkey).then(setContacts).catch(() => setContacts([]))
  }, [pubkey])

  const followSetListStableKey = useMemo(
    () =>
      followSetListEvents
        .map((e) => {
          const d = getFollowSetDTag(e) ?? ''
          return `${d}:${e.id}:${e.created_at}`
        })
        .sort()
        .join('|'),
    [followSetListEvents]
  )

  useEffect(() => {
    if (!pubkey || !isFollowFeedFauxSpellId(selectedFauxSpell)) {
      setFollowingSubRequests([])
      setFollowingFeedLoading(false)
      return
    }

    const followSetD =
      selectedFauxSpell && isFollowSetSpellId(selectedFauxSpell)
        ? decodeFollowSetSpellId(selectedFauxSpell)
        : null

    if (followSetD && followSetCatalogLoading) {
      setFollowingSubRequests([])
      setFollowingFeedLoading(true)
      return
    }

    let cancelled = false
    setFollowingFeedLoading(true)
    void (async () => {
      try {
        let authorPubkeys: string[]
        if (selectedFauxSpell === 'following') {
          const followings = await client.fetchFollowings(pubkey)
          authorPubkeys = [pubkey, ...followings]
        } else if (followSetD) {
          const ev = followSetListEvents.find((e) => getFollowSetDTag(e) === followSetD)
          if (!ev) {
            if (!cancelled) setFollowingSubRequests([])
            return
          }
          const listed = pubkeysFromFollowSetEvent(ev)
          authorPubkeys = [pubkey, ...listed]
        } else {
          if (!cancelled) setFollowingSubRequests([])
          return
        }

        const req = await client.generateSubRequestsForPubkeys(authorPubkeys, pubkey)
        const merged = augmentSubRequestsWithFavoritesFastReadAndInbox(
          req,
          favoriteRelays,
          blockedRelays,
          relayList?.read ?? [],
          { userWriteRelays: relayList?.write ?? [] }
        )
        const withReadOnly = merged.map((r) => ({
          ...r,
          urls: appendCuratedReadOnlyRelays(r.urls, blockedRelays)
        }))
        if (!cancelled) setFollowingSubRequests(withReadOnly)
      } catch {
        if (!cancelled) setFollowingSubRequests([])
      } finally {
        if (!cancelled) setFollowingFeedLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    selectedFauxSpell,
    pubkey,
    sortedFavoriteRelaysKey,
    sortedBlockedRelaysKey,
    relayMailboxStableKey,
    followSetCatalogLoading,
    followSetListStableKey
  ])

  const interestTagsStableKey = interestListEvent
    ? JSON.stringify(
        [...interestListEvent.tags].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      )
    : ''
  const bookmarkTagsStableKey = bookmarkListEvent
    ? JSON.stringify(
        [...bookmarkListEvent.tags].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      )
    : ''

  /** Content-based key so event ref churn does not rebuild faux subs every render. */
  const fauxFeedRelaysDepsKey = [
    sortedFavoriteRelaysKey,
    sortedBlockedRelaysKey,
    interestListEvent?.id ?? '',
    String(interestListEvent?.created_at ?? ''),
    interestTagsStableKey,
    bookmarkListEvent?.id ?? '',
    String(bookmarkListEvent?.created_at ?? ''),
    bookmarkTagsStableKey
  ].join('\0')

  const syncFauxSubRequests = useMemo<TFeedSubRequest[]>(() => {
    if (!selectedFauxSpell || isFollowFeedFauxSpellId(selectedFauxSpell)) return []
    /** Widen relay pool: these faux spells do not target social kinds (1 / 11 / 1111); skipping strip keeps fast-read mirrors in the stack. */
    const fauxSpellSkipSocialKindBlocked =
      selectedFauxSpell === 'calendar' ||
      selectedFauxSpell === 'followPacks' ||
      selectedFauxSpell === 'media' ||
      selectedFauxSpell === 'bookmarks' ||
      selectedFauxSpell === 'interests'
    const feedUrls = getRelayUrlsWithFavoritesFastReadAndInbox(
      favoriteRelays,
      blockedRelays,
      relayList?.read ?? [],
      {
        userWriteRelays: relayList?.write ?? [],
        applySocialKindBlockedFilter: fauxSpellSkipSocialKindBlocked ? false : undefined
      }
    )

    if (selectedFauxSpell === 'notifications') {
      if (!pubkey || !feedUrls.length) return []
      return buildNotificationsSpellSubRequests(feedUrls, pubkey)
    }
    if (selectedFauxSpell === 'discussions') {
      // Read-only prepended in appendCuratedReadOnlyRelays so FAUX_SPELL_MAX_RELAYS still includes aggr.
      const urls = appendCuratedReadOnlyRelays(feedUrls, blockedRelays)
      if (!urls.length) return []
      return [{ urls, filter: buildDiscussionFilter() }]
    }
    if (selectedFauxSpell === 'media') {
      const urls = appendCuratedReadOnlyRelays(feedUrls, blockedRelays)
      if (!urls.length) return []
      return [{ urls, filter: buildMediaSpellFilter() }]
    }
    if (selectedFauxSpell === 'calendar') {
      const urls = appendCuratedReadOnlyRelays(feedUrls, blockedRelays)
      if (!urls.length) return []
      return [{ urls, filter: buildCalendarSpellFilter() }]
    }
    if (selectedFauxSpell === 'interests') {
      if (!pubkey || !interestListEvent) return []
      const topics = interestListEvent.tags.filter((tag) => tag[0] === 't' && tag[1]).map((tag) => tag[1]!)
      const urls = appendCuratedReadOnlyRelays(feedUrls, blockedRelays)
      return buildInterestsSubRequests(urls, topics, DEFAULT_FEED_SHOW_KINDS)
    }
    if (selectedFauxSpell === 'bookmarks') {
      if (!pubkey) return []
      const urls = appendCuratedReadOnlyRelays(feedUrls, blockedRelays)
      return buildBookmarksSubRequests(bookmarkListEvent, urls)
    }
    if (selectedFauxSpell === 'followPacks') {
      const urls = appendCuratedReadOnlyRelays(feedUrls, blockedRelays)
      if (!urls.length) return []
      return [
        {
          urls,
          filter: { kinds: [ExtendedKind.FOLLOW_PACK], limit: FAUX_SPELL_EVENT_LIMIT }
        }
      ]
    }
    return []
  }, [selectedFauxSpell, pubkey, fauxFeedRelaysDepsKey, relayMailboxStableKey])

  const fauxSubRequests = useMemo<TFeedSubRequest[]>(() => {
    const base = isFollowFeedFauxSpellId(selectedFauxSpell ?? '')
      ? followingSubRequests
      : syncFauxSubRequests
    return applyFauxSpellCapsToSubRequests(base)
  }, [selectedFauxSpell, followingSubRequests, syncFauxSubRequests])

  const spellSubRequests = useMemo<TFeedSubRequest[]>(() => {
    if (!selectedSpell) return []
    const relayListWrite = relayList?.write ?? []
    const ctx = { pubkey, contacts }
    const filter = spellEventToFilter(selectedSpell, ctx)
    if (!filter) return []
    const relays = getRelaysForSpell(selectedSpell, { relayListWrite })
    if (!relays.length) return []
    return [{ urls: relays, filter }]
    // relayListWriteKey + contactsSyncKey: avoid recomputing when relayList/contacts are new refs with same contents (spell filters use Date.now via resolveRelativeTime)
  }, [selectedSpell, pubkey, contactsSyncKey, relayListWriteKey])

  const subRequests = useMemo<TFeedSubRequest[]>(() => {
    if (selectedFauxSpell) return fauxSubRequests
    return spellSubRequests
  }, [selectedFauxSpell, fauxSubRequests, spellSubRequests])

  const spellFeedSubscriptionKey = useMemo(() => {
    if (selectedFauxSpell) return computeSpellSubRequestsIdentityKey(subRequests)
    if (selectedSpell) return computeKind777SpellFeedSubscriptionKey(selectedSpell, subRequests)
    return ''
  }, [selectedFauxSpell, selectedSpell, subRequests])

  const spellBrowseRelayUrls = useMemo(() => {
    const set = new Set<string>()
    for (const req of subRequests) {
      for (const u of req.urls) {
        const n = normalizeUrl(u) || u
        if (n) set.add(n)
      }
    }
    return [...set].sort()
  }, [subRequests])

  const spellBrowseRelayUrlsKey = spellBrowseRelayUrls.join('|')

  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  useEffect(() => {
    if (!spellBrowseRelayUrlsKey) return
    const urls = spellBrowseRelayUrlsKey.split('|')
    addRelayUrls(urls)
    return () => removeRelayUrls(urls)
  }, [spellBrowseRelayUrlsKey, addRelayUrls, removeRelayUrls])

  const toggleFavorite = useCallback(async (spellId: string) => {
    const ids = await indexedDb.getSpellFavoriteIds()
    const set = new Set(ids)
    if (set.has(spellId)) set.delete(spellId)
    else set.add(spellId)
    await indexedDb.setSpellFavoriteIds([...set])
    setFavoriteIds(set)
  }, [])

  const handleDeleteSpell = useCallback(
    async (spell: Event) => {
      try {
        await attemptDelete(spell)
      } catch (e) {
        logger.error('Spell deletion publish failed', { error: e, spellId: spell.id })
        showPublishingError(e instanceof Error ? e : new Error(String(e)))
        return
      }
      try {
        await indexedDb.deleteSpellEvent(spell.id)
        const ids = await indexedDb.getSpellFavoriteIds()
        await indexedDb.setSpellFavoriteIds(ids.filter((id) => id !== spell.id))
        if (selectedSpell?.id === spell.id) setSelectedSpell(null)
        await loadSpells()
      } catch (e) {
        logger.error('Spell local cleanup after delete failed', { error: e, spellId: spell.id })
        showPublishingError(
          e instanceof Error ? e : new Error(t('Failed to remove spell from local storage'))
        )
      }
    },
    [attemptDelete, loadSpells, selectedSpell?.id, t]
  )

  const { ownSpells, followSpells, otherSpells, spellsForSelect } = useMemo(() => {
    const byName = (a: Event, b: Event) =>
      getSpellName(a).localeCompare(getSpellName(b), undefined, { sensitivity: 'base' })

    const followSet = new Set(contacts)
    const own: Event[] = []
    const follow: Event[] = []
    const other: Event[] = []

    for (const s of spells) {
      if (pubkey && s.pubkey === pubkey) own.push(s)
      else if (followSet.has(s.pubkey)) follow.push(s)
      else other.push(s)
    }

    own.sort(byName)
    follow.sort(byName)
    other.sort(byName)

    return {
      ownSpells: own,
      followSpells: follow,
      otherSpells: other,
      spellsForSelect: [...own, ...follow, ...other]
    }
  }, [spells, pubkey, contacts])

  const followSpellGroups = useMemo(() => groupSpellsByPubkeySorted(followSpells), [followSpells])
  const otherSpellGroups = useMemo(() => groupSpellsByPubkeySorted(otherSpells), [otherSpells])

  // Memoize showKinds to prevent NoteList from re-subscribing when array reference changes
  // Create stable key from 'k' tags for dependency
  const showKindsTagKey = useMemo(() => {
    if (!selectedSpell) return ''
    return selectedSpell.tags
      .filter((tag) => tag[0] === 'k')
      .map((tag) => tag[1])
      .sort()
      .join(',')
  }, [selectedSpell?.id])

  /** Avoid depending on `kindFilterShowKinds` ref for faux spells that don’t use it (e.g. Discussions). */
  const followingShowKindsKey =
    selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)
      ? JSON.stringify(kindFilterShowKinds)
      : ''

  const showKinds = useMemo(() => {
    if (selectedFauxSpell === 'notifications') {
      return [...NOTIFICATION_SPELL_KINDS]
    }
    if (selectedFauxSpell === 'discussions') {
      return [ExtendedKind.DISCUSSION]
    }
    if (selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)) {
      // Profile feed kinds omit boosts; show reposts as cards in this faux spell only.
      const k = kindFilterShowKinds
      if (k.includes(nostrKinds.Repost)) return k
      return [...k, nostrKinds.Repost].sort((a, b) => a - b)
    }
    if (selectedFauxSpell === 'followPacks') {
      return [ExtendedKind.FOLLOW_PACK]
    }
    if (selectedFauxSpell === 'media') {
      return [...MEDIA_SPELL_KINDS]
    }
    if (selectedFauxSpell === 'calendar') {
      return [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME]
    }
    if (selectedFauxSpell === 'interests') {
      return [...DEFAULT_FEED_SHOW_KINDS]
    }
    if (selectedFauxSpell === 'bookmarks') {
      return [...DEFAULT_FEED_SHOW_KINDS]
    }
    if (!selectedSpell) return [1]
    const kinds = selectedSpell.tags
      .filter((tag) => tag[0] === 'k')
      .map((tag) => parseInt(tag[1], 10))
      .filter((n) => !Number.isNaN(n))
    return kinds.length ? kinds : [1]
  }, [selectedFauxSpell, selectedSpell?.id, showKindsTagKey, followingShowKindsKey])

  const spellMenuLabel = useCallback(
    (spell: Event) => (favoriteIds.has(spell.id) ? `★ ${getSpellName(spell)}` : getSpellName(spell)),
    [favoriteIds]
  )

  const selectedFauxSpellDisplayLabel = useMemo(() => {
    if (!selectedFauxSpell) return ''
    if (isFollowSetSpellId(selectedFauxSpell)) {
      const d = decodeFollowSetSpellId(selectedFauxSpell)
      if (!d) return t('Follow set')
      const ev = followSetListEvents.find((e) => getFollowSetDTag(e) === d)
      return ev ? labelFollowSetEvent(ev) : d
    }
    if (isSpellsPageBuiltinFauxSpell(selectedFauxSpell)) {
      return t(fauxSpellLabelKey(selectedFauxSpell))
    }
    return selectedFauxSpell
  }, [selectedFauxSpell, followSetListEvents, t])

  const spellsTitlebarTitle = useMemo(() => {
    if (selectedFauxSpell) return selectedFauxSpellDisplayLabel
    if (selectedSpell) return spellMenuLabel(selectedSpell)
    return t('Spells')
  }, [selectedFauxSpell, selectedSpell, selectedFauxSpellDisplayLabel, spellMenuLabel, t])

  const pickSpell = useCallback(
    (spell: Event | null) => {
      setSpellPickerOpen(false)
      if (spell && selectedSpell?.id === spell.id && !selectedFauxSpell) {
        return
      }
      if (spell) {
        logSpellFeedPickerSelection(`kind777:${getSpellName(spell)}`, {
          spellId: spell.id,
          spellAuthorPubkey: spell.pubkey,
          kind777: true
        })
      }
      setSelectedSpell(spell)
      setSelectedFauxSpell(null)
      navigatePrimary('spells')
    },
    [logSpellFeedPickerSelection, navigatePrimary, selectedSpell?.id, selectedFauxSpell]
  )

  const clearSpellSelection = useCallback(() => {
    logSpellFeedPickerSelection('(cleared)', { cleared: true })
    setSelectedSpell(null)
    setSelectedFauxSpell(null)
    setSpellPickerOpen(false)
    navigatePrimary('spells')
  }, [logSpellFeedPickerSelection, navigatePrimary])

  const pickFauxSpell = useCallback(
    (name: string | null) => {
      setSpellPickerOpen(false)
      if (name) {
        if (!isSpellsPageFauxSpellParam(name)) return
        // Re-selecting the same built-in feed from the picker should not clear + resubscribe (toggle used to call
        // pickFauxSpell(null) and wipe the timeline when the row was already selected).
        if (selectedFauxSpell === name && selectedSpell === null) {
          return
        }
        logSpellFeedPickerSelection(`faux:${name}`, { fauxSpell: name })
        fauxSpellUrlSyncFromPickerRef.current = name
        setSelectedFauxSpell(name)
        setSelectedSpell(null)
        navigatePrimary('spells', { spell: name })
      } else {
        logSpellFeedPickerSelection('(cleared faux)', { clearedFaux: true })
        fauxSpellUrlSyncFromPickerRef.current = null
        setSelectedFauxSpell(null)
        setSelectedSpell(null)
        navigatePrimary('spells')
      }
    },
    [logSpellFeedPickerSelection, navigatePrimary, selectedFauxSpell, selectedSpell]
  )

  const selectedSpellIsOwn = !!(pubkey && selectedSpell && selectedSpell.pubkey === pubkey)

  const handleSpellFeedFirstPaint = useCallback(
    (detail: { eventCount: number; firstEventId: string }) => {
      const elapsedMsSincePickerMs = Math.round(performance.now() - spellFeedInstrT0Ref.current)
      logger.info('[SpellsPage] Spell feed — first events rendered (list has rows)', {
        ...detail,
        eventCountMeaning: 'filtered visible rows (slice), not full relay buffer',
        elapsedMsSincePickerMs,
        selectionLabel: spellFeedInstrLabelRef.current,
        instrumentToken: spellFeedInstrTokenRef.current
      })
    },
    []
  )

  const fauxNoteListUseFilterAsIs = useMemo(() => {
    if (!selectedFauxSpell) return true
    if (selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)) return false
    return selectedFauxSpell !== 'bookmarks'
  }, [selectedFauxSpell])

  const notificationsMentionExtraHide = useCallback(
    (evt: Event) => (pubkey ? !isUserInEventMentions(evt, pubkey) : false),
    [pubkey]
  )

  const fauxFeedEmptyMessage = useMemo(() => {
    if (!selectedFauxSpell || fauxSubRequests.length > 0) return null
    if (selectedFauxSpell === 'interests') return t('No subscribed interests yet.')
    if (selectedFauxSpell === 'bookmarks') return t('No bookmarked notes with id tags yet.')
    if (selectedFauxSpell === 'following') return t('No follows or relays to load yet.')
    if (isFollowSetSpellId(selectedFauxSpell)) return t('Follow set feed empty')
    return t('Nothing to load for this feed.')
  }, [selectedFauxSpell, fauxSubRequests.length, t])

  const showFollowFeedLoading = !!(
    pubkey &&
    selectedFauxSpell &&
    isFollowFeedFauxSpellId(selectedFauxSpell) &&
    (followingFeedLoading ||
      (isFollowSetSpellId(selectedFauxSpell) && followSetCatalogLoading))
  )

  const spellPickerList = (
    <>
      {FAUX_SPELL_ORDER.flatMap((name) => {
        if (
          (name === 'notifications' ||
            name === 'following' ||
            name === 'bookmarks' ||
            name === 'interests') &&
          !pubkey
        ) {
          return []
        }
        const Icon = FAUX_SPELL_ICON[name]
        const selected = selectedFauxSpell === name
        const builtinRow = (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={selected}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
              'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'bg-accent/50'
            )}
            onClick={() => pickFauxSpell(name)}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {selected ? <Check className="size-4" aria-hidden /> : null}
            </span>
            <Icon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {t(fauxSpellLabelKey(name))}
            </span>
          </button>
        )
        if (name !== 'following' || !pubkey || followSetListEvents.length === 0) {
          return [builtinRow]
        }
        const setRows = followSetListEvents.flatMap((ev) => {
          const d = getFollowSetDTag(ev)
          if (!d) return []
          const spellId = encodeFollowSetSpellId(d)
          const setSelected = selectedFauxSpell === spellId
          return [
            <button
              key={spellId}
              type="button"
              role="option"
              aria-selected={setSelected}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 pl-8 text-left text-sm transition-colors',
                'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                setSelected && 'bg-accent/50'
              )}
              onClick={() => pickFauxSpell(spellId)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {setSelected ? <Check className="size-4" aria-hidden /> : null}
              </span>
              <Users className="size-4 shrink-0 opacity-80" />
              <span className="min-w-0 flex-1 truncate text-left font-medium">
                {labelFollowSetEvent(ev)}
              </span>
            </button>
          ]
        })
        return [builtinRow, ...setRows]
      })}
      <button
        type="button"
        role="option"
        aria-selected={!selectedSpell && !selectedFauxSpell}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !selectedSpell && !selectedFauxSpell && 'bg-accent/50'
        )}
        onClick={clearSpellSelection}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {!selectedSpell && !selectedFauxSpell ? <Check className="size-4" aria-hidden /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-left font-normal text-muted-foreground">
          {t('Select a spell…')}
        </span>
      </button>

      {ownSpells.length > 0 ? (
        <>
          <Separator className="my-2" />
          <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('spellPickerSectionYours')}
          </p>
          {ownSpells.map((spell) => (
            <SpellSheetOptionRow
              key={spell.id}
              spell={spell}
              selected={selectedSpell?.id === spell.id}
              accountPubkey={pubkey ?? undefined}
              labelFor={spellMenuLabel}
              onPick={pickSpell}
            />
          ))}
        </>
      ) : null}

      {followSpells.length > 0 ? (
        <>
          <Separator className="my-2" />
          <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('Spells from follows', { count: followSpells.length })}
          </p>
          {followSpellGroups.map(({ pubkey: authorPk, spells: groupSpells }) => (
            <div key={authorPk} className="mt-2 overflow-hidden rounded-lg border border-border/60">
              <SpellSheetAuthorHeader userId={authorPk} />
              <div className="px-0.5 py-0.5">
                {groupSpells.map((spell) => (
                  <SpellSheetOptionRow
                    key={spell.id}
                    spell={spell}
                    selected={selectedSpell?.id === spell.id}
                    accountPubkey={pubkey ?? undefined}
                    labelFor={spellMenuLabel}
                    onPick={pickSpell}
                    groupedUnderAuthor
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {otherSpells.length > 0 ? (
        <>
          <Separator className="my-2" />
          <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('Other spells', { count: otherSpells.length })}
          </p>
          {otherSpellGroups.map(({ pubkey: authorPk, spells: groupSpells }) => (
            <div key={authorPk} className="mt-2 overflow-hidden rounded-lg border border-border/60">
              <SpellSheetAuthorHeader userId={authorPk} />
              <div className="px-0.5 py-0.5">
                {groupSpells.map((spell) => (
                  <SpellSheetOptionRow
                    key={spell.id}
                    spell={spell}
                    selected={selectedSpell?.id === spell.id}
                    accountPubkey={pubkey ?? undefined}
                    labelFor={spellMenuLabel}
                    onPick={pickSpell}
                    groupedUnderAuthor
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}
    </>
  )

  const spellPickerTriggerButton = (
    <Button
      type="button"
      variant="outline"
      className="min-w-0 flex-1 justify-between font-normal sm:max-w-md"
      title={
        selectedFauxSpell
          ? selectedFauxSpellDisplayLabel
          : selectedSpell
            ? spellMenuLabel(selectedSpell)
            : undefined
      }
      aria-expanded={spellPickerOpen}
    >
      <span className="truncate">
        {selectedFauxSpell
          ? selectedFauxSpellDisplayLabel
          : selectedSpell
            ? spellMenuLabel(selectedSpell)
            : t('Select a spell…')}
      </span>
      <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
    </Button>
  )

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="spells"
      titlebar={
        <div className="flex h-full w-full items-center justify-between gap-2 pr-1">
          <div
            className="min-w-0 flex-1 truncate pl-3 text-lg font-semibold"
            title={spellsTitlebarTitle}
          >
            {spellsTitlebarTitle}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <RefreshButton onClick={refreshSpellsFeedAndCatalog} />
            <Button
              variant="ghost"
              size="titlebar-icon"
              onClick={() => {
                setSpellToEdit(null)
                setSpellToClone(null)
                setCreateOpen(true)
              }}
              title={t('Create a Spell')}
            >
              <Plus className="size-5" />
            </Button>
          </div>
        </div>
      }
      displayScrollToTopButton
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        {selectedFauxSpell ? (
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 -ml-2 h-9 text-muted-foreground hover:text-foreground"
              onClick={clearSpellSelection}
            >
              <ChevronLeft className="size-4 shrink-0" aria-hidden />
              <span>{t('Spells')}</span>
            </Button>
          </div>
        ) : (
          <>
            {/* Spell picker + actions above the feed */}
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <>
                {isSmallScreen ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-w-0 flex-1 justify-between font-normal sm:max-w-md"
                      title={selectedSpell ? spellMenuLabel(selectedSpell) : undefined}
                      aria-haspopup="dialog"
                      aria-expanded={spellPickerOpen}
                      onClick={() => setSpellPickerOpen(true)}
                    >
                      <span className="truncate">
                        {selectedSpell ? spellMenuLabel(selectedSpell) : t('Select a spell…')}
                      </span>
                      <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
                    </Button>
                    <Drawer open={spellPickerOpen} onOpenChange={setSpellPickerOpen}>
                      <DrawerContent className="flex max-h-[min(92dvh,40rem)] flex-col gap-0 p-0 sm:max-h-[75vh]">
                        <DrawerHeader className="shrink-0 space-y-0 border-b px-4 py-3 text-left">
                          <DrawerTitle className="text-base">{t('Select a spell…')}</DrawerTitle>
                        </DrawerHeader>
                        <div
                          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
                          role="listbox"
                          aria-label={t('Select a spell…')}
                        >
                          {spellPickerList}
                        </div>
                      </DrawerContent>
                    </Drawer>
                  </>
                ) : (
                  <DropdownMenu open={spellPickerOpen} onOpenChange={setSpellPickerOpen}>
                    <DropdownMenuTrigger asChild aria-haspopup="menu">
                      {spellPickerTriggerButton}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="bottom"
                      showScrollButtons
                      className="max-h-[min(75vh,40rem)] w-[var(--radix-dropdown-menu-trigger-width)] max-w-md p-0"
                    >
                      <div className="sticky top-0 z-10 border-b bg-popover px-3 py-2 text-left text-sm font-semibold">
                        {t('Select a spell…')}
                      </div>
                      <div className="px-1 py-2" role="listbox" aria-label={t('Select a spell…')}>
                        {spellPickerList}
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  className="justify-start gap-2"
                  variant="outline"
                  onClick={() => {
                    setSpellToEdit(null)
                    setSpellToClone(null)
                    setCreateOpen(true)
                  }}
                >
                  <Wand2 className="size-4" />
                  {t('Create a Spell')}
                </Button>
                {selectedSpell && (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      title={
                        favoriteIds.has(selectedSpell.id)
                          ? t('Remove from favorites')
                          : t('Add to favorites')
                      }
                      onClick={() => toggleFavorite(selectedSpell.id)}
                    >
                      <Star
                        className={`size-4 ${favoriteIds.has(selectedSpell.id) ? 'fill-amber-400 text-amber-500' : ''}`}
                      />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="shrink-0" title={t('More options')}>
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {selectedSpellIsOwn ? (
                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => {
                              setSpellToClone(null)
                              setSpellToEdit(selectedSpell)
                              setCreateOpen(true)
                            }}
                          >
                            <Pencil className="size-4" />
                            {t('Edit spell')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => {
                              setSpellToEdit(null)
                              setSpellToClone(selectedSpell)
                              setCreateOpen(true)
                            }}
                          >
                            <Copy className="size-4" />
                            {t('Clone spell')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="gap-2" onClick={() => setDefinitionSpell(selectedSpell)}>
                          <FileText className="size-4" />
                          {t('View definition')}
                        </DropdownMenuItem>
                        {selectedSpellIsOwn ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="gap-2 text-destructive focus:text-destructive"
                              onClick={() => handleDeleteSpell(selectedSpell)}
                            >
                              <Trash2 className="size-4" />
                              {t('Delete')}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            </div>

            {spellsCatalogSyncing ? (
              <p className="text-xs text-muted-foreground">{t('Loading spells from your relays…')}</p>
            ) : null}

            {spellsForSelect.length === 0 && !spellsCatalogSyncing && (
              <p className="text-sm text-muted-foreground">{t('No spells yet. Create one with the button above.')}</p>
            )}
          </>
        )}

        {/* Feed — faux spells and kind-777 spells all use NoteList */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedFauxSpell === 'notifications' && !pubkey ? (
            <div className="py-8 text-center text-muted-foreground">
              {t('Please log in to view notifications.')}
            </div>
          ) : isFollowFeedFauxSpellId(selectedFauxSpell ?? '') && !pubkey ? (
            <div className="py-8 text-center text-muted-foreground">
              {t('Please login to view following feed')}
            </div>
          ) : selectedFauxSpell === 'bookmarks' && !pubkey ? (
            <div className="py-8 text-center text-muted-foreground">
              {t('Please login to view bookmarks')}
            </div>
          ) : showFollowFeedLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('loading...')}</div>
          ) : selectedFauxSpell && fauxSubRequests.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{fauxFeedEmptyMessage}</div>
          ) : selectedFauxSpell && fauxSubRequests.length > 0 ? (
            <>
              {selectedFauxSpell === 'notifications' ? (
                <div className="flex shrink-0 justify-end px-1 pb-2">
                  <HideUntrustedContentButton type="notifications" size="titlebar-icon" />
                </div>
              ) : null}
              <div className="min-h-0 min-w-0 flex-1">
                <NoteList
                  ref={spellFeedListRef}
                  subRequests={subRequests}
                  feedSubscriptionKey={spellFeedSubscriptionKey}
                  showKinds={showKinds}
                  spellFeedInstrumentToken={spellFeedInstrumentToken}
                  onSpellFeedFirstPaint={handleSpellFeedFirstPaint}
                  timelineLoadingSafetyTimeoutMs={
                    selectedFauxSpell === 'notifications'
                      ? NOTIFICATION_SPELL_LOADING_SAFETY_MS
                      : undefined
                  }
                  clientSideKindFilter={selectedFauxSpell === 'notifications'}
                  useFilterAsIs={fauxNoteListUseFilterAsIs}
                  oneShotFetch={false}
                  showKind1OPs={
                    selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)
                      ? showKind1OPs
                      : true
                  }
                  showKind1Replies={
                    selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)
                      ? showKind1Replies
                      : true
                  }
                  showKind1111={
                    selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)
                      ? showKind1111
                      : true
                  }
                  hideReplies={
                    selectedFauxSpell && isFollowFeedFauxSpellId(selectedFauxSpell)
                      ? hideRepliesFollowing
                      : false
                  }
                  extraShouldHideEvent={
                    selectedFauxSpell === 'notifications' && pubkey
                      ? notificationsMentionExtraHide
                      : undefined
                  }
                  hideUntrustedNotes={
                    selectedFauxSpell === 'notifications' ? hideUntrustedNotifications : false
                  }
                />
              </div>
            </>
          ) : selectedSpell ? (
            subRequests.length > 0 ? (
              <NoteList
                ref={spellFeedListRef}
                subRequests={subRequests}
                feedSubscriptionKey={spellFeedSubscriptionKey}
                showKinds={showKinds}
                spellFeedInstrumentToken={spellFeedInstrumentToken}
                onSpellFeedFirstPaint={handleSpellFeedFirstPaint}
                useFilterAsIs
              />
            ) : !pubkey &&
              selectedSpell.tags.some(
                (tag) => tag[0] === 'authors' && (tag.includes('$me') || tag.includes('$contacts'))
              ) ? (
              <div className="py-8 text-center text-muted-foreground">
                {t('Log in to run this spell (it uses $me or $contacts).')}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                {t(
                  'Could not run this spell. Check that it has a valid REQ/COUNT command, or add write relays in settings.'
                )}
              </div>
            )
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              {t('Select a spell to view its feed.')}
            </div>
          )}
        </div>
      </div>

      <CreateSpellDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            setSpellToEdit(null)
            setSpellToClone(null)
          }
        }}
        spellToEdit={spellToEdit}
        spellToClone={spellToClone}
        onSaved={(ev) => {
          void loadSpells()
          if (ev && spellToEdit && selectedSpell?.id === spellToEdit.id) {
            setSelectedSpell(ev)
          }
          if (ev && spellToClone && selectedSpell?.id === spellToClone.id) {
            setSelectedSpell(ev)
          }
        }}
      />

      <Dialog open={!!definitionSpell} onOpenChange={(open) => !open && setDefinitionSpell(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {definitionSpell ? getSpellName(definitionSpell) : t('Spell definition')}
            </DialogTitle>
          </DialogHeader>
          {definitionSpell && (
            <div className="space-y-4 text-sm">
              {definitionSpell.content?.trim() && (
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">{t('Description')}</div>
                  <p className="whitespace-pre-wrap break-words">{definitionSpell.content.trim()}</p>
                </div>
              )}
              <div>
                <div className="mb-2 font-medium text-muted-foreground">{t('Tags')}</div>
                <dl className="space-y-1.5 font-mono text-xs">
                  {definitionSpell.tags.map((tag, i) => (
                    <div key={i} className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <dt className="shrink-0 text-muted-foreground">{tag[0]}:</dt>
                      <dd className="min-w-0 break-all">
                        {tag.length > 1 ? tag.slice(1).join(', ') : '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="overflow-wrap-anywhere break-words text-xs text-muted-foreground">
                <span className="font-medium">id:</span> <span className="break-all">{definitionSpell.id}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PrimaryPageLayout>
  )
})

export default SpellsPage
