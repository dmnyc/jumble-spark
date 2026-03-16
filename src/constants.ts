import { kinds } from 'nostr-tools'

/** API base URL; override with VITE_JUMBLE_API_BASE_URL for forks (e.g. https://api.jumble.imwald.eu). */
export const JUMBLE_API_BASE_URL =
  (import.meta.env.VITE_JUMBLE_API_BASE_URL as string | undefined) ?? 'https://api.jumble.imwald.eu'

export const DEFAULT_FAVORITE_RELAYS = [
  'wss://theforest.nostr1.com',
  'wss://orly-relay.imwald.eu',
  'wss://nostr.land'
]

export const RECOMMENDED_RELAYS = DEFAULT_FAVORITE_RELAYS.concat([])

export const RECOMMENDED_BLOSSOM_SERVERS = [
  'https://blossom.band',
  'https://blossom.primal.net',
  'https://nostr.media'
]

export const StorageKey = {
  VERSION: 'version',
  THEME_SETTING: 'themeSetting',
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
  LAST_READ_NOTIFICATION_TIME_MAP: 'lastReadNotificationTimeMap',
  ACCOUNT_FEED_INFO_MAP: 'accountFeedInfoMap',
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

export const ApplicationDataKey = {
  NOTIFICATIONS_SEEN_AT: 'seen_notifications_at'
}

export const BIG_RELAY_URLS = [
  'wss://theforest.nostr1.com',
  'wss://orly-relay.imwald.eu',
  'wss://nostr.land',
  'wss://thecitadel.nostr1.com',
]

/** Relays to query for NIP-66 relay monitoring events (30166), in addition to BIG_RELAY_URLS. */
export const NIP66_DISCOVERY_RELAY_URLS = [
  'wss://thecitadel.nostr1.com',
  'wss://relay.nostr.watch',
  'wss://relaypag.es'
]

// Relay with bookstr composite index support
export const BOOKSTR_RELAY_URLS = [
  'wss://orly-relay.imwald.eu'
]

// Optimized relay list for read operations (includes aggregator)
export const FAST_READ_RELAY_URLS = [
  'wss://theforest.nostr1.com',
  'wss://orly-relay.imwald.eu',
  'wss://nostr.wine',
  'wss://nostr.land',
  'wss://nostr21.com',
  'wss://thecitadel.nostr1.com',
  'wss://aggr.nostr.land'
]

// Optimized relay list for write operations (no aggregator since it's read-only)
export const FAST_WRITE_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://thecitadel.nostr1.com',
  'wss://nos.lol'
]

/** Relays used for NIP-94 file metadata (kind 1063) / GIF discovery and publish.
 *  Include relay.gifbuddy.lol (GifBuddy) so we get many kind 1063 GIFs; damus/primal/thecitadel have fewer. */
export const GIF_RELAY_URLS = [
  'wss://relay.gifbuddy.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://thecitadel.nostr1.com'
]

export const SEARCHABLE_RELAY_URLS = [
  'wss://nostr.sovbit.host',
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
  'wss://nostr.mom'
  ]

export const PROFILE_RELAY_URLS = [
    'wss://nos.lol',
    'wss://relay.damus.io',
    'wss://profiles.nostr1.com'
  ]

// Combined relay URLs for profile fetching - includes both BIG_RELAY_URLS and SEARCHABLE_RELAY_URLS
export const PROFILE_FETCH_RELAY_URLS = [...SEARCHABLE_RELAY_URLS, ...PROFILE_RELAY_URLS]

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
  RELAY_MONITOR_ANNOUNCEMENT: 10166
}

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
  ExtendedKind.PUBLICATION,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  // ExtendedKind.PUBLICATION_CONTENT, // Excluded - publication content should only be embedded in publications
  // NIP-89 Application Handlers
  ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION,
  ExtendedKind.APPLICATION_HANDLER_INFO
]

export const URL_REGEX =
  /https?:\/\/[\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*]+(?:,[^\s.][\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,]*)*[^\s.,;:'")\]}!?，。；："'！？】）](?=\.|,\s|$|[^\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*,])/giu
export const WS_URL_REGEX =
  /wss?:\/\/[\w\p{L}\p{N}\p{M}&.\-/?=#@%+_:!~*]+[^\s.,;:'")\]}!?，。；："'！？】）]/giu
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
/** Matches :shortcode: or :short code: (allows letters, digits, underscore, hyphen, space) */
export const EMOJI_SHORT_CODE_REGEX = /:[a-zA-Z0-9_\-\s]+:/g
export const EMBEDDED_EVENT_REGEX = /nostr:(note1[a-z0-9]{58}|nevent1[a-z0-9]+|naddr1[a-z0-9]+)/g
export const EMBEDDED_MENTION_REGEX = /nostr:(npub1[a-z0-9]{58}|nprofile1[a-z0-9]+)/g
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
