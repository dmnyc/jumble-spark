import { kinds, type Filter } from 'nostr-tools'

/**
 * API base URL. Prefer `VITE_IMWALD_API_BASE_URL`; `VITE_JUMBLE_API_BASE_URL` is still read for existing deploys.
 */
export const IMWALD_API_BASE_URL =
  (import.meta.env.VITE_IMWALD_API_BASE_URL as string | undefined)?.trim() ||
  (import.meta.env.VITE_JUMBLE_API_BASE_URL as string | undefined)?.trim() ||
  'https://api.jumble.imwald.eu'

/** @deprecated Use {@link IMWALD_API_BASE_URL} */
export const JUMBLE_API_BASE_URL = IMWALD_API_BASE_URL

/** Git Republic web UI for repository links; override with VITE_GITREPUBLIC_WEB_BASE_URL for self-hosted. */
export const GITREPUBLIC_WEB_BASE_URL = (
  (import.meta.env.VITE_GITREPUBLIC_WEB_BASE_URL as string | undefined) ?? 'https://gitrepublic.imwald.eu'
)
  .trim()
  .replace(/\/$/, '')

/**
 * Piper TTS (same contract as aitherboard `POST /api/piper-tts`: JSON `{ text, voice?, speed? }`, body `audio/wav`).
 * Default production: `/api/piper-tts` (same origin; reverse-proxy to aitherboard — see PROXY_SETUP.md).
 * For cross-origin aitherboard instead, set full URL and configure CORS on that host.
 * If empty, read-aloud uses the Web Speech API only.
 */
export const READ_ALOUD_TTS_URL =
  (import.meta.env.VITE_READ_ALOUD_TTS_URL as string | undefined)?.trim() || ''

/** HiveTalk (WebRTC video call) base URL; override with VITE_HIVETALK_BASE_URL for self-hosted instances. */
export const HIVETALK_BASE_URL =
  (import.meta.env.VITE_HIVETALK_BASE_URL as string | undefined) ?? 'https://vanilla.hivetalk.org'

/**
 * Default URL for the sidebar “Download desktop app” entry (e.g. GitHub Releases with AppImage/deb).
 * Override per deploy with `DESKTOP_DOWNLOAD_URL` in `/config.json` (empty string hides the entry).
 */
export const DESKTOP_APP_DOWNLOAD_URL_DEFAULT =
  'https://github.com/Silberengel/jumble/releases'

export const DEFAULT_FAVORITE_RELAYS = [
  'wss://theforest.nostr1.com',
  'wss://orly-relay.imwald.eu',
  'wss://nostr.land',
  'wss://nostr21.com'
]

/**
 * Max concurrent relay connection + REQ setups (ensureRelay + subscribe) app-wide.
 * Limits parallel WebSocket handshakes when many relays or timeline shards open at once.
 */
export const MAX_CONCURRENT_RELAY_CONNECTIONS = 10

/**
 * Max concurrent live REQ subscriptions on a single relay. Some relays enforce ≤10 SUBs; stay under
 * the advertised cap to avoid "too many subscriptions" NOTICEs when other clients or shards overlap.
 * Use 7 so overlapping timeline waves / auth resubscribe still stay below 10.
 */
export const MAX_CONCURRENT_SUBS_PER_RELAY = 7

/**
 * How many timeline shards may open relay subscriptions at once. Each shard sends one REQ per relay
 * in its list; with 6 shards in parallel a popular relay can see 6+ SUBs from this app alone, and a
 * second feed wave (remount / strict mode) pushes past strict relay caps (e.g. nostr.sovbit.host ≤10).
 * 3 is a modest bump for faster multi-shard home loads; lower to 2 if a relay complains about SUB count.
 */
export const TIMELINE_SHARD_SUBSCRIBE_CONCURRENCY = 3

/** Max relays to publish each event to (outboxes first, then targets' inboxes, then extras). */
export const MAX_PUBLISH_RELAYS = 20

/** After a publish wave, failed NIP-65 write (outbox) relays are retried once after this delay. */
export const OUTBOX_PUBLISH_RETRY_DELAY_MS = 5000

/** Max merged URLs per REQ / timeline relay list (see `relay-url-priority`). */
export const MAX_REQ_RELAY_URLS = MAX_CONCURRENT_RELAY_CONNECTIONS

/** `SimplePool.ensureRelay` WebSocket handshake timeout (parallel multi-relay + slow TLS). */
export const RELAY_POOL_CONNECTION_TIMEOUT_MS = 20_000

/**
 * Minimum `ensureRelay` connect timeout for `READ_ONLY_RELAY_URLS` (NIP-42 aggregators): must outlast queued
 * extension `signEvent` when many relays send `AUTH` at once.
 */
export const RELAY_READ_ONLY_POOL_CONNECT_TIMEOUT_MS = 45_000

/**
 * nostr-tools `AbstractRelay.publishTimeout`: EVENT publish ACK and NIP-42 AUTH OK wait.
 * Default 4400ms is too tight when a browser extension queues many `signEvent` calls.
 */
export const RELAY_NIP42_PUBLISH_ACK_TIMEOUT_MS = 90_000

/** Multi-relay queries and timeline initial REQ: after the first event, wait this long then close (query) or finalize EOSE (live feed) while keeping the subscription open for new events. */
export const FIRST_RELAY_RESULT_GRACE_MS = 2000

/** Legacy name: was used to cap spell NoteList skeleton time; loading now ends on EOSE / first events / safety timeouts. Kept for forks. */
export const SPELL_FEED_LOADING_MAX_MS = 1000

/** @deprecated Alias of {@link SPELL_FEED_LOADING_MAX_MS}. */
export const SPELL_FEED_FIRST_RELAY_GRACE_MS = SPELL_FEED_LOADING_MAX_MS

/**
 * Implicit query feed grace ({@link FIRST_RELAY_RESULT_GRACE_MS}) applies only when the largest `limit` among
 * filters is at least this value. Omitting `limit` counts as 0 (no implicit grace).
 */
export const FEED_FIRST_RELAY_RESULT_GRACE_MIN_LIMIT = 200

/**
 * Kindless single-relay page REQ: explicit `limit`, no `kinds` (see NoteList `allowKindlessRelayExplore`).
 */
export const SINGLE_RELAY_KINDLESS_REQ_LIMIT = 500

/**
 * Minimum time between full account network hydrates (NostrProvider: relay + replaceable fetch from relays).
 * IndexedDB cache still applies on every load; this only skips redundant network merges after a recent run.
 */
export const ACCOUNT_SESSION_NETWORK_HYDRATE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Batched kind-0 queries (ReplaceableEventService) over many relays (inbox, favorites, cache, defaults).
 * Too low causes empty profiles and NIP-05 gaps when relays are slow or many URLs are queried.
 */
export const METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS = 16000
export const METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS = 500

/**
 * useFetchProfile: outer Promise.race on fetchProfileEvent and wait-for-shared-promise timeouts.
 * Must be greater than {@link METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS} so the batch can finish first.
 */
export const PROFILE_FETCH_PROMISE_TIMEOUT_MS = 20000

export const RECOMMENDED_RELAYS = DEFAULT_FAVORITE_RELAYS.concat([])

export const RECOMMENDED_BLOSSOM_SERVERS = [
  'https://blossom.band',
  'https://blossom.primal.net',
  'https://nostr.media'
]

export const StorageKey = {
  VERSION: 'version',
  THEME_SETTING: 'themeSetting',
  /** Resolved theme (light/dark) written by ThemeProvider; stored in IndexedDB. */
  THEME: 'theme',
  FONT_SIZE: 'fontSize',
  RELAY_SETS: 'relaySets',
  ACCOUNTS: 'accounts',
  CURRENT_ACCOUNT: 'currentAccount',
  ADD_CLIENT_TAG: 'addClientTag',
  NOTE_LIST_MODE: 'noteListMode',
  NOTIFICATION_TYPE: 'notificationType',
  DEFAULT_ZAP_SATS: 'defaultZapSats',
  DEFAULT_ZAP_COMMENT: 'defaultZapComment',
  QUICK_ZAP: 'quickZap',
  ZAP_REPLY_THRESHOLD: 'zapReplyThreshold',
  ACCOUNT_FEED_INFO_MAP: 'accountFeedInfoMap',
  /** Per-pubkey ms timestamps: last full network hydrate (see ACCOUNT_SESSION_NETWORK_HYDRATE_MIN_INTERVAL_MS). */
  ACCOUNT_NETWORK_HYDRATE_AT_MAP: 'accountNetworkHydrateAtMap',
  AUTOPLAY: 'autoplay',
  HIDE_UNTRUSTED_INTERACTIONS: 'hideUntrustedInteractions',
  HIDE_UNTRUSTED_NOTIFICATIONS: 'hideUntrustedNotifications',
  MEDIA_UPLOAD_SERVICE_CONFIG_MAP: 'mediaUploadServiceConfigMap',
  HIDE_UNTRUSTED_NOTES: 'hideUntrustedNotes',
  DEFAULT_SHOW_NSFW: 'defaultShowNsfw',
  DISMISSED_TOO_MANY_RELAYS_ALERT: 'dismissedTooManyRelaysAlert',
  SHOW_KINDS: 'showKinds',
  SHOW_KINDS_VERSION: 'showKindsVersion',
  SHOW_KIND_1_OPs: 'showKind1OPs',
  SHOW_KIND_1_REPLIES: 'showKind1Replies',
  SHOW_KIND_1111: 'showKind1111',
  /** When true, main feed REQs omit `kinds` and the client does not filter by kind (testing). */
  FEED_KIND_FILTER_BYPASS: 'feedKindFilterBypass',
  /** @deprecated use SHOW_KIND_1_REPLIES + SHOW_KIND_1111 */
  SHOW_REPLIES_AND_COMMENTS: 'showRepliesAndComments',
  HIDE_CONTENT_MENTIONING_MUTED_USERS: 'hideContentMentioningMutedUsers',
  NOTIFICATION_LIST_STYLE: 'notificationListStyle',
  MEDIA_AUTO_LOAD_POLICY: 'mediaAutoLoadPolicy',
  SHOWN_CREATE_WALLET_GUIDE_TOAST_PUBKEYS: 'shownCreateWalletGuideToastPubkeys',
  SHOW_RECOMMENDED_RELAYS_PANEL: 'showRecommendedRelaysPanel',
  DEFAULT_EXPIRATION_ENABLED: 'defaultExpirationEnabled',
  DEFAULT_EXPIRATION_MONTHS: 'defaultExpirationMonths',
  DEFAULT_QUIET_ENABLED: 'defaultQuietEnabled',
  DEFAULT_QUIET_DAYS: 'defaultQuietDays',
  RESPECT_QUIET_TAGS: 'respectQuietTags',
  GLOBAL_QUIET_MODE: 'globalQuietMode',
  SHOW_RSS_FEED: 'showRssFeed',
  PANE_MODE: 'paneMode',
  ADD_RANDOM_RELAYS_TO_PUBLISH: 'addRandomRelaysToPublish',
  /** When not `'false'`, show green Sonner toasts after successful publishes (default on). */
  SHOW_PUBLISH_SUCCESS_TOASTS: 'showPublishSuccessToasts',
  /** When not `'false'`, show NIP-53 live activity banner (default on). */
  SHOW_LIVE_ACTIVITIES_BANNER: 'showLiveActivitiesBanner',
  /** Persist timeline notes/reactions to IndexedDB (platform defaults; disable for relay-only). */
  EVENT_ARCHIVE_ENABLED: 'eventArchiveEnabled',
  /** Max approximate archive size (MB). `0` in UI means “use platform default”. */
  EVENT_ARCHIVE_MAX_MB: 'eventArchiveMaxMb',
  /** Max rows in event archive. `0` means use platform default. */
  EVENT_ARCHIVE_MAX_EVENTS: 'eventArchiveMaxEvents',
  /** In-memory session LRU max (events). Platform default if unset. */
  SESSION_EVENT_LRU_MAX: 'sessionEventLruMax',
  /** Temporary draft cache: new notes and replies. Persisted after 30s idle; restored on refresh; cleared on logout/switch. */
  POST_EDITOR_DRAFT: 'postEditorDraft',
  MEDIA_UPLOAD_SERVICE: 'mediaUploadService', // deprecated
  HIDE_UNTRUSTED_EVENTS: 'hideUntrustedEvents', // deprecated
  ACCOUNT_RELAY_LIST_EVENT_MAP: 'accountRelayListEventMap', // deprecated
  ACCOUNT_FOLLOW_LIST_EVENT_MAP: 'accountFollowListEventMap', // deprecated
  ACCOUNT_MUTE_LIST_EVENT_MAP: 'accountMuteListEventMap', // deprecated
  ACCOUNT_MUTE_DECRYPTED_TAGS_MAP: 'accountMuteDecryptedTagsMap', // deprecated
  ACCOUNT_PROFILE_EVENT_MAP: 'accountProfileEventMap', // deprecated
  ACTIVE_RELAY_SET_ID: 'activeRelaySetId', // deprecated
  FEED_TYPE: 'feedType' // deprecated
}

export const FONT_SIZE = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large'
} as const

/**
 * Random public relays (from NIP-66 lively list; write-tested monitors preferred) merged into the
 * publish relay picker. More candidates improve odds some accept open writes.
 */
export const RANDOM_PUBLISH_RELAY_COUNT = 5

/** Relays to query for NIP-66 relay monitoring events (30166), in addition to FAST_READ_RELAY_URLS. */
export const NIP66_DISCOVERY_RELAY_URLS = [
  'wss://thecitadel.nostr1.com',
  'wss://relay.nostr.watch',
  'wss://relaypag.es'
]

// Relay with bookstr composite index support
export const BOOKSTR_RELAY_URLS = [
  'wss://orly-relay.imwald.eu'
]

/**
 * Primary document relay for long-form/wiki/publication kinds:
 * 30023, 30818, 30817, 30041, 30040.
 */
export const DOCUMENT_RELAY_URLS = [
  'wss://thecitadel.nostr1.com',
  'wss://relay.wikifreedia.xyz'
] as const

/**
 * Block-list order (applied in sequence when building relay lists):
 * 1. READ_ONLY — never publish (search mirrors, index relays, NIP-42 read-only aggregators)
 * 2. SOCIAL_KIND_BLOCKED — skip for REQ/publish that touch {@link SOCIAL_KIND_BLOCKED_KINDS} (see list below)
 * 3. E_TAG_FILTER_BLOCKED — skip for reply/quote/stats fetches (#e, #a, #q filters)
 */
/**
 * Relays that must never receive publishes: search engines, index mirrors, and similar endpoints that only ingest
 * or aggregate for read. Distinct from {@link SOCIAL_KIND_BLOCKED_RELAY_URLS} (kind-coverage limits, not write policy).
 */
export const READ_ONLY_RELAY_URLS = [
  'wss://aggr.nostr.land',
  'wss://relay.nostr.watch',
  'wss://relaypag.es',
  'wss://relay.noswhere.com',
  'wss://search.nos.today',
  'wss://trending.nostr.wine',
  'wss://relay.nip46.com'
]

/**
 * Relays that need NIP-42 signed before the first REQ returns useful data. Same pool treatment as
 * {@link READ_ONLY_RELAY_URLS} (longer connect timeout + proactive `automaticallyAuth`), but **not**
 * necessarily read-only for publish — keep those relays out of {@link READ_ONLY_RELAY_URLS}.
 */
export const NIP42_POOL_AUTOMATIC_AUTH_RELAY_URLS = ['wss://nostr.wine'] as const

/**
 * Relays that reject or poorly serve “social” kinds (short notes, discussions, URL comments).
 * Strip these from REQ/publish relay stacks when the filter or event uses {@link SOCIAL_KIND_BLOCKED_KINDS},
 * or when a filter omits `kinds` (broad timeline).
 */
export const SOCIAL_KIND_BLOCKED_RELAY_URLS = [
  'wss://thecitadel.nostr1.com',
  'wss://profiles.nostr1.com',
  'wss://purplepag.es',
  'wss://relay.nsec.app',
  'wss://bucket.coracle.social',
  'wss://spatia-arcana.com',
  'wss://relay.wikifreedia.xyz',
  'wss://relay.gifbuddy.lol',
  'wss://hist.nostr.land',
]

/**
 * Relays that reject certain tag filters in REQs (e.g. `#e` on some stacks) and, on nostr.sovbit.host,
 * filter keys whose tag letter is uppercase (`#E`, `#A`, `#I`, …). Skip for reply/quote/stats fetches and
 * whenever filters use a capital letter after `#` in a tag key (see `relayFiltersUseCapitalLetterTagKeys` in
 * `relay-extended-tag-req-blocks.ts`).
 */
export const E_TAG_FILTER_BLOCKED_RELAY_URLS = [
  'wss://nostr.v0l.io',
  'wss://nostr.sovbit.host'
]

// Optimized relay list for read operations (includes aggregator)
export const FAST_READ_RELAY_URLS = [
  'wss://theforest.nostr1.com',
  'wss://orly-relay.imwald.eu',
  'wss://nostr.wine',
  'wss://nostr.land',
  'wss://nostr21.com',
  'wss://thecitadel.nostr1.com',
  'wss://aggr.nostr.land',
]

// Optimized relay list for write operations (no aggregator since it's read-only)
export const FAST_WRITE_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://thecitadel.nostr1.com',
  'wss://nos.lol',
  'wss://nostr.einundzwanzig.space'
]

/** Relays used for NIP-94 file metadata (kind 1063) / GIF discovery and publish.
 *  Publish to all of these so GIFs are discoverable across clients; some may be temporarily down. */
export const GIF_RELAY_URLS = [
  'wss://relay.gifbuddy.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://thecitadel.nostr1.com',
  'wss://nos.lol',
]

export const SEARCHABLE_RELAY_URLS = [
  'wss://freelay.sovbit.host',
  'wss://search.nos.today',
  'wss://nostr.wine', 
  'wss://orly-relay.imwald.eu',
  'wss://aggr.nostr.land',
  'wss://thecitadel.nostr1.com',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://relay.noswhere.com',
  'wss://relay.wikifreedia.xyz',
  'wss://nostr.einundzwanzig.space',
  'wss://nostrelites.org',
  'wss://spatia-arcana.com',
  'wss://nostr-pub.wellorder.net',
  'wss://pyramid.fiatjaf.com/',
  'wss://nostr.lopp.social/',
  'wss://relay.dergigi.com/'
  ]

export const PROFILE_RELAY_URLS = [
    'wss://nos.lol',
    'wss://relay.damus.io',
    'wss://profiles.nostr1.com',
    'wss://purplepag.es',
    'wss://thecitadel.nostr1.com'
  ]

  export const FOLLOWS_HISTORY_RELAY_URLS = [
    'wss://hist.nostr.land'
  ]

// Combined relay URLs for profile fetching - includes both FAST_READ_RELAY_URLS and SEARCHABLE_RELAY_URLS
export const PROFILE_FETCH_RELAY_URLS = [...SEARCHABLE_RELAY_URLS, ...FAST_READ_RELAY_URLS, ...PROFILE_RELAY_URLS]

export const GROUP_METADATA_EVENT_KIND = 39000

export const ExtendedKind = {
  PICTURE: 20,
  VIDEO: 21,
  SHORT_VIDEO: 22,
  POLL: 1068,
  /** NIP-B9 zap poll (paid votes via zaps). */
  ZAP_POLL: 6969,
  POLL_RESPONSE: 1018,
  COMMENT: 1111,
  VOICE: 1222,
  VOICE_COMMENT: 1244,
  PUBLIC_MESSAGE: 24,
  DISCUSSION: 11,
  FAVORITE_RELAYS: 10012,
  BLOCKED_RELAYS: 10006,
  BLOSSOM_SERVER_LIST: 10063,
  CACHE_RELAYS: 10432,
  /** HTTPS index-relay list (same `r` tag semantics as kind 10002; URLs are http/https). */
  HTTP_RELAY_LIST: 10243,
  RELAY_REVIEW: 31987,
  GROUP_METADATA: 39000,
  GROUP_LIST: 10009, // NIP-51 Group List
  /** NIP-51 follow sets (addressable); `p` tags name pubkeys in the set */
  FOLLOW_SET: 30000,
  ZAP_REQUEST: 9734,
  ZAP_RECEIPT: 9735,
  PUBLICATION: 30040,
  WIKI_ARTICLE: 30818,
  WIKI_ARTICLE_MARKDOWN: 30817,
  PUBLICATION_CONTENT: 30041,
  CITATION_INTERNAL: 30,
  CITATION_EXTERNAL: 31,
  CITATION_HARDCOPY: 32,
  CITATION_PROMPT: 33,
  RSS_FEED_LIST: 10895,
  /** Client-only synthetic "parent" for RSS article threads; never published to relays */
  RSS_THREAD_ROOT: 99999,
  /**
   * NIP-18: generic repost (kind 16) for any event **except** kind 1 — zaps (9735), reactions, comments, etc.
   * Kind **6** (`kinds.Repost` from nostr-tools) is only for reposting kind 1. See `createRepostDraftEvent`.
   */
  GENERIC_REPOST: 16,
  /** NIP-25: reaction to external content (NIP-73 `k` + `i`), e.g. http(s) URLs */
  EXTERNAL_REACTION: 17,
  // NIP-89 Application Handlers
  APPLICATION_HANDLER_RECOMMENDATION: 31989,
  APPLICATION_HANDLER_INFO: 31990,
  PAYMENT_INFO: 10133,
  FOLLOW_PACK: 39089,
  /** NIP-56: reporting / flagging (tagged `p` for reported pubkey, optional `e` for reported note) */
  REPORT: 1984,
  /** NIP-94 File Metadata (e.g. GIFs) */
  FILE_METADATA: 1063,
  /** NIP-66 Relay discovery (relay characteristics from NIP-11 or probing) */
  RELAY_DISCOVERY: 30166,
  /** NIP-66 Relay monitor announcement (intent to publish 30166 at a frequency) */
  RELAY_MONITOR_ANNOUNCEMENT: 10166,
  /** NIP-52 Date-based calendar event (all-day / multi-day) */
  CALENDAR_EVENT_DATE: 31922,
  /** NIP-52 Time-based calendar event */
  CALENDAR_EVENT_TIME: 31923,
  /** NIP-52 Calendar event RSVP */
  CALENDAR_EVENT_RSVP: 31925,
  /** NIP-A7 Spells: portable relay query filters (kind 777) */
  SPELL: 777,
  /** NIP-58 Badges: profile badges list (addressable, d=profile_badges) */
  PROFILE_BADGES: 30008,
  /** NIP-58 Badges: badge definition (addressable) */
  BADGE_DEFINITION: 30009,
  /** Web page bookmark (URL in i/I or r tags); used in RSS+Web relay discovery */
  WEB_BOOKMARK: 39701,
  /** NIP-34 / Git Republic: repository announcement (addressable) */
  GIT_REPO_ANNOUNCEMENT: 30617,
  /** NIP-34 / Git Republic: issue */
  GIT_ISSUE: 1621,
  /** Git Republic: release (linked to repo via `a` tag) */
  GIT_RELEASE: 1642
}

/**
 * Kinds subscribed on `#e` / `#a` for the OP in {@link useQuoteEvents} (thread “backlinks” shard),
 * alongside kind-1 `#q` quotes. Covers highlights, long-form, NIP-32 labels, NIP-56 reports,
 * NIP-51 lists (bookmarks, pins, generic/bookmark/curation sets), and NIP-58 badge awards.
 */
export const THREAD_BACKLINK_STREAM_KINDS: readonly number[] = [
  kinds.Highlights,
  kinds.LongFormArticle,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  ExtendedKind.PUBLICATION_CONTENT,
  kinds.Label,
  kinds.Report,
  kinds.BookmarkList,
  kinds.Pinlist,
  kinds.Genericlists,
  kinds.Bookmarksets,
  kinds.Curationsets,
  kinds.BadgeAward
]

/**
 * {@link THREAD_BACKLINK_STREAM_KINDS} without kind 9802. Highlights use separate low-`kinds` REQs so
 * relays that reject large `kinds` arrays still return NIP-84 backlinks.
 */
export const THREAD_BACKLINK_STREAM_KINDS_WITHOUT_HIGHLIGHT: readonly number[] =
  THREAD_BACKLINK_STREAM_KINDS.filter((k) => k !== kinds.Highlights)

/**
 * When a filter touches these kinds (or omits `kinds`), omit {@link SOCIAL_KIND_BLOCKED_RELAY_URLS} from the relay
 * stack — those relays do not carry this note/comment surface (kinds **1** / **1111** / **11** per relay policy).
 * @see {@link relayFilterIncludesSocialKindBlockedKind}
 */
export const SOCIAL_KIND_BLOCKED_KINDS: readonly number[] = [
  kinds.ShortTextNote,
  ExtendedKind.DISCUSSION,
  ExtendedKind.COMMENT
]

const SOCIAL_KIND_BLOCKED_KIND_SET = new Set<number>(SOCIAL_KIND_BLOCKED_KINDS)

export function isSocialKindBlockedKind(kind: number): boolean {
  return SOCIAL_KIND_BLOCKED_KIND_SET.has(kind)
}

/**
 * True when a filter should avoid relays that do not carry social-note surface.
 *
 * Important: kindless lookup filters (e.g. `ids`, `authors + #d`) are often used for
 * publication / replaceable resolution and must keep relays like thecitadel in scope.
 */
export function relayFilterIncludesSocialKindBlockedKind(filter: Filter): boolean {
  const k = filter.kinds
  if (k === undefined) {
    const ids = Array.isArray(filter.ids) ? filter.ids.length : 0
    const dTags = Array.isArray((filter as Record<string, unknown>)['#d'])
      ? ((filter as Record<string, unknown>)['#d'] as unknown[]).length
      : 0
    // Scoped lookups are not "broad social feed" queries.
    if (ids > 0 || dTags > 0) return false
    return true
  }
  const arr = Array.isArray(k) ? k : [k]
  return arr.some((kind) => SOCIAL_KIND_BLOCKED_KIND_SET.has(kind))
}

/**
 * Document/event kinds that should always include {@link DOCUMENT_RELAY_URLS} in read/publish relay candidates.
 */
export const DOCUMENT_RELAY_KINDS: readonly number[] = [
  kinds.LongFormArticle, // 30023
  ExtendedKind.WIKI_ARTICLE, // 30818
  ExtendedKind.WIKI_ARTICLE_MARKDOWN, // 30817
  ExtendedKind.PUBLICATION_CONTENT, // 30041
  ExtendedKind.PUBLICATION // 30040
]

const DOCUMENT_RELAY_KIND_SET = new Set<number>(DOCUMENT_RELAY_KINDS)

export function isDocumentRelayKind(kind: number): boolean {
  return DOCUMENT_RELAY_KIND_SET.has(kind)
}

export function relayFilterIncludesDocumentRelayKind(filter: Filter): boolean {
  const k = filter.kinds
  if (k === undefined) return false
  const arr = Array.isArray(k) ? k : [k]
  return arr.some((kind) => DOCUMENT_RELAY_KIND_SET.has(kind))
}

/**
 * After dropping {@link SOCIAL_KIND_BLOCKED_RELAY_URLS} from a relay stack: if every URL was removed but the caller
 * passed exactly one relay (e.g. a favorite-relay chip), keep it. Blended stacks still omit these relays; a
 * user-targeted single-relay feed should actually contact that relay (e.g. thecitadel for kinds the relay does carry).
 */
export function relaysAfterSocialKindBlockedStrip(
  originalDedupedUrls: string[],
  afterStrip: string[]
): string[] {
  if (afterStrip.length > 0) return afterStrip
  if (originalDedupedUrls.length === 1) return [...originalDedupedUrls]
  return afterStrip
}

/** Event kinds that show “Read this note aloud” in note options (Web Speech API). */
export const READ_ALOUD_KINDS: readonly number[] = [
  kinds.ShortTextNote,
  ExtendedKind.DISCUSSION,
  ExtendedKind.COMMENT,
  kinds.LongFormArticle,
  ExtendedKind.PUBLICATION,
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  ExtendedKind.WIKI_ARTICLE
]

/** NIP-52 calendar event kinds (addressable by d-tag); use in isReplaceableEvent. */
export const CALENDAR_EVENT_KINDS = [
  ExtendedKind.CALENDAR_EVENT_DATE,
  ExtendedKind.CALENDAR_EVENT_TIME
]

/** Maximum invitees for calendar event group invites (one kind 24 with all as p-tags). */
export const MAX_CALENDAR_INVITEES = 10

export const SUPPORTED_KINDS = [
  kinds.ShortTextNote,
  kinds.Repost,
  ExtendedKind.GENERIC_REPOST,
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.POLL,
  ExtendedKind.ZAP_POLL,
  ExtendedKind.COMMENT,
  ExtendedKind.VOICE,
  ExtendedKind.VOICE_COMMENT,
  // ExtendedKind.PUBLIC_MESSAGE, // Excluded - public messages should only appear in notifications
  kinds.Highlights,
  kinds.LongFormArticle,
  ExtendedKind.RELAY_REVIEW,
  ExtendedKind.DISCUSSION,
  ExtendedKind.ZAP_RECEIPT,
  ExtendedKind.CALENDAR_EVENT_DATE,
  ExtendedKind.CALENDAR_EVENT_TIME,
  ExtendedKind.PUBLICATION,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  // ExtendedKind.PUBLICATION_CONTENT, // Excluded - publication content should only be embedded in publications
  // NIP-89 Application Handlers
  ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION,
  ExtendedKind.APPLICATION_HANDLER_INFO,
  ExtendedKind.GIT_REPO_ANNOUNCEMENT,
  ExtendedKind.GIT_ISSUE,
  ExtendedKind.GIT_RELEASE
]

/**
 * Kinds for profile-style feeds and the kind-filter UI (includes boosts). Excludes publications,
 * publication content, and NIP-89 handler kinds.
 */
export const PROFILE_FEED_KINDS = SUPPORTED_KINDS.filter(
  (k) =>
    k !== ExtendedKind.PUBLICATION &&
    k !== ExtendedKind.PUBLICATION_CONTENT &&
    k !== ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION &&
    k !== ExtendedKind.APPLICATION_HANDLER_INFO
)

/** Long-form, wiki, and publication index events for the profile "Articles and Publications" tab. */
export const PROFILE_PUBLICATIONS_TAB_KINDS: readonly number[] = [
  kinds.LongFormArticle,
  ExtendedKind.PUBLICATION,
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN
]

const PROFILE_PUBLICATIONS_TAB_KIND_SET = new Set<number>(PROFILE_PUBLICATIONS_TAB_KINDS)

/** NIP native media kinds for the profile Media tab (and Spells → media faux spell). */
export const PROFILE_MEDIA_TAB_KINDS: readonly number[] = [
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.VOICE
]

const PROFILE_MEDIA_TAB_KIND_SET = new Set<number>(PROFILE_MEDIA_TAB_KINDS)

/**
 * Kinds subscribed on the profile Posts tab only. Omits publication kinds and native media kinds so those
 * events appear only on Articles/Publications and Media; {@link PROFILE_FEED_KINDS} is unchanged for the home
 * feed and kind-filter defaults.
 */
export const PROFILE_POSTS_TAB_KINDS: readonly number[] = PROFILE_FEED_KINDS.filter(
  (k) => !PROFILE_PUBLICATIONS_TAB_KIND_SET.has(k) && !PROFILE_MEDIA_TAB_KIND_SET.has(k)
)

/**
 * {@link PROFILE_FEED_KINDS} without reposts (kind 6 / 16). Default for the global kind filter, home feed,
 * and most faux spells. Reposts are still shown on profile timelines, Spells → Following, and Follows latest.
 */
export const DEFAULT_FEED_SHOW_KINDS = PROFILE_FEED_KINDS.filter(
  (k) =>
    k !== kinds.Repost &&
    k !== ExtendedKind.GENERIC_REPOST &&
    k !== ExtendedKind.GIT_REPO_ANNOUNCEMENT &&
    k !== ExtendedKind.GIT_ISSUE
)

/** Order for faux-spells in the feed / spell picker. */
export const FAUX_SPELL_ORDER = [
  'notifications',
  'discussions',
  'following',
  'favorites',
  'followPacks',
  'media',
  'interests',
  'bookmarks',
  'calendar'
] as const

/**
 * Trailing lookahead must not be `(?=\\.)` alone: that matches between host labels (e.g. imwald . eu).
 * Use `\\.(?:\\s|$)` for sentence-ending dots; `,(?=/|\\s|$)` ends before a comma that is not part of a
 * comma-separated URL segment (e.g. typo `eu,/` or `eu, `).
 */
export const URL_REGEX =
  /https?:\/\/[\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*]+(?:,[^\s.][\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,]*)*[^\s.,;:'")\]}!?，。；："'！？】）](?=\.(?:\s|$)|,\s|,(?=\/|\s|$)|$|[^\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,])/giu
export const WS_URL_REGEX =
  /wss?:\/\/[\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*]+[^\s.,;:'")\]}!?，。；："'！？】）](?=\.(?:\s|$)|,\s|,(?=\/|\s|$)|$|[^\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,])/giu
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
/** @see {@link '@/lib/content-patterns'} — single source for emoji + nostr regexes */
export {
  EMOJI_SHORT_CODE_MAX_INNER_LENGTH,
  EMOJI_SHORT_CODE_REGEX,
  EMBEDDED_EVENT_REGEX,
  EMBEDDED_MENTION_REGEX
} from '@/lib/content-patterns'
export const HASHTAG_REGEX = /#[a-zA-Z0-9_\-\u00C0-\u017F\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF]+/g
export const LN_INVOICE_REGEX = /(ln(?:bc|tb|bcrt))([0-9]+[munp]?)?1([02-9ac-hj-np-z]+)/g
export const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA70}-\u{1FAFF}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F18E}]|[\u{3030}]|[\u{2B50}]|[\u{2B55}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{3297}]|[\u{3299}]|[\u{303D}]|[\u{00A9}]|[\u{00AE}]|[\u{2122}]|[\u{23E9}-\u{23EF}]|[\u{23F0}]|[\u{23F3}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]/gu
export const YOUTUBE_URL_REGEX =
  /https?:\/\/(?:(?:www|m)\.)?(?:youtube\.com\/(?:watch\?[^#\s]*|embed\/[\w-]+|shorts\/[\w-]+|live\/[\w-]+)|youtu\.be\/[\w-]+)(?:\?[^#\s]*)?(?:#[^\s]*)?/gi

/** Maintainer / official zap recipient pubkey for this distribution. */
export const IMWALD_MAINTAINER_PUBKEY =
  'f4eb8e62add1340b9cadcd9861e669b2e907cea534e0f7f3ac974c11c758a51a'

/** @deprecated Use {@link IMWALD_MAINTAINER_PUBKEY} */
export const JUMBLE_PUBKEY = IMWALD_MAINTAINER_PUBKEY
export const CODY_PUBKEY = '8125b911ed0e94dbe3008a0be48cfe5cd0c0b05923cfff917ae7e87da8400883'
export const SILBERENGEL_PUBKEY = 'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1'

export const NIP_96_SERVICE = [
  'https://mockingyou.com',
  'https://nostpic.com',
  'https://nostr.build', // default
  'https://nostrcheck.me',
  'https://nostrmedia.com',
  'https://files.sovbit.host'
]
export const DEFAULT_NIP_96_SERVICE = 'https://nostr.build'

export const DEFAULT_NOSTRCONNECT_RELAY = [
  'wss://relay.nsec.app/',
  'wss://bucket.coracle.social/',
  'wss://relay.primal.net/',
  'wss://thecitadel.nostr1.com/'
]

export const POLL_TYPE = {
  MULTIPLE_CHOICE: 'multiplechoice',
  SINGLE_CHOICE: 'singlechoice'
} as const

export const NOTIFICATION_LIST_STYLE = {
  COMPACT: 'compact',
  DETAILED: 'detailed'
} as const

export const MEDIA_AUTO_LOAD_POLICY = {
  ALWAYS: 'always',
  WIFI_ONLY: 'wifi-only',
  NEVER: 'never'
} as const

export const DEFAULT_RSS_FEEDS = ['https://divineoffice.org/feed/']
