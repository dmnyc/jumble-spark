import { kinds } from 'nostr-tools'

/** API base URL; override with VITE_JUMBLE_API_BASE_URL for forks (e.g. https://api.jumble.imwald.eu). */
export const JUMBLE_API_BASE_URL =
  (import.meta.env.VITE_JUMBLE_API_BASE_URL as string | undefined) ?? 'https://api.jumble.imwald.eu'

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
  'wss://nostr.land'
]

/**
 * Max concurrent relay connection + REQ setups (ensureRelay + subscribe) app-wide.
 * Limits parallel WebSocket handshakes when many relays or timeline shards open at once.
 */
export const MAX_CONCURRENT_RELAY_CONNECTIONS = 10

/** Max relays to publish each event to (outboxes first, then targets' inboxes, then extras). */
export const MAX_PUBLISH_RELAYS = MAX_CONCURRENT_RELAY_CONNECTIONS

/** Max merged URLs per REQ / timeline relay list (see `relay-url-priority`). */
export const MAX_REQ_RELAY_URLS = MAX_CONCURRENT_RELAY_CONNECTIONS

/** Multi-relay queries and timeline initial REQ: after the first event, wait this long then close (query) or finalize EOSE (live feed) while keeping the subscription open for new events. */
export const FIRST_RELAY_RESULT_GRACE_MS = 5000

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
 * Block-list order (applied in sequence when building relay lists):
 * 1. READ_ONLY — never publish
 * 2. KIND_1_BLOCKED — skip for kind 1 read/write
 * 3. E_TAG_FILTER_BLOCKED — skip for reply/quote/stats fetches (#e, #a, #q filters)
 */
/** Relays that must never be used for publishing (read-only aggregators, etc.). */
export const READ_ONLY_RELAY_URLS = ['wss://aggr.nostr.land']

/** Relays that block kind 1 (microblogging); skip for kind 1 read and write. */
export const KIND_1_BLOCKED_RELAY_URLS = [
  'wss://thecitadel.nostr1.com',
  'wss://hist.nostr.land',
  'wss://profiles.nostr1.com',
  'wss://purplepag.es',
  'wss://wikifreedia.xyz'
]

/** Relays that reject #e (and similar) tag filters; skip for reply/quote/stats fetches. */
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
  'wss://nos.lol'
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
  'wss://relay.nsec.app',
  'wss://bucket.coracle.social',
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
    'wss://purplepag.es'
  ]

// Combined relay URLs for profile fetching - includes both FAST_READ_RELAY_URLS and SEARCHABLE_RELAY_URLS
export const PROFILE_FETCH_RELAY_URLS = [...SEARCHABLE_RELAY_URLS, ...FAST_READ_RELAY_URLS, ...PROFILE_RELAY_URLS]

export const GROUP_METADATA_EVENT_KIND = 39000

export const ExtendedKind = {
  PICTURE: 20,
  VIDEO: 21,
  SHORT_VIDEO: 22,
  POLL: 1068,
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
  RELAY_REVIEW: 31987,
  GROUP_METADATA: 39000,
  GROUP_LIST: 10009, // NIP-51 Group List
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
  // NIP-89 Application Handlers
  APPLICATION_HANDLER_RECOMMENDATION: 31989,
  APPLICATION_HANDLER_INFO: 31990,
  PAYMENT_INFO: 10133,
  FOLLOW_PACK: 39089,
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
  SPELL: 777
}

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
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.POLL,
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
  ExtendedKind.APPLICATION_HANDLER_INFO
]

/** Kinds for profile feed and favorites-style feeds: supported kinds except boosts (kind 6), publications, publication content, NIP-89 handlers. */
export const PROFILE_FEED_KINDS = SUPPORTED_KINDS.filter(
  (k) =>
    k !== kinds.Repost &&
    k !== ExtendedKind.PUBLICATION &&
    k !== ExtendedKind.PUBLICATION_CONTENT &&
    k !== ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION &&
    k !== ExtendedKind.APPLICATION_HANDLER_INFO
)

/** Order for faux-spells in the feed / spell picker. */
export const FAUX_SPELL_ORDER = [
  'notifications',
  'discussions',
  'following',
  'followPacks',
  'media',
  'interests',
  'bookmarks',
  'calendar'
] as const

export const URL_REGEX =
  /https?:\/\/[\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*]+(?:,[^\s.][\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,]*)*[^\s.,;:'")\]}!?，。；："'！？】）](?=\.|,\s|$|[^\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,])/giu
export const WS_URL_REGEX =
  /wss?:\/\/[\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*]+[^\s.,;:'")\]}!?，。；："'！？】）]/giu
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

export const JUMBLE_PUBKEY = 'f4eb8e62add1340b9cadcd9861e669b2e907cea534e0f7f3ac974c11c758a51a'
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
