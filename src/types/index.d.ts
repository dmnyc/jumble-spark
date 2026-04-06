import { Event, Filter, VerifiedEvent } from 'nostr-tools'
import { MEDIA_AUTO_LOAD_POLICY, NOTIFICATION_LIST_STYLE, POLL_TYPE } from '../constants'

export type TSubRequestFilter = Omit<Filter, 'since' | 'until'> & { limit: number }

export type TFeedSubRequest = {
  urls: string[]
  filter: Omit<Filter, 'since' | 'until'>
  /** Optional UI hint used by feed UIs (e.g. Favorites) to explain why an event was included. */
  reasonLabel?: string
  /**
   * When set with {@link reasonLabel}, the label is shown only if the event was received from this relay
   * (normalized like other relay URLs), so broad filters (e.g. kinds-only) do not mis-tag other shards’ events.
   */
  reasonLabelIfSeenOnRelay?: string
}

export type TProfile = {
  username: string
  pubkey: string
  npub: string
  original_username?: string
  banner?: string
  avatar?: string
  nip05?: string
  nip05List?: string[]
  about?: string
  website?: string
  websiteList?: string[]
  lud06?: string
  lud16?: string
  lightningAddress?: string
  lightningAddressList?: string[]
  created_at?: number
}

export type TPaymentInfo = {
  methods?: Array<{
    type: string // Payment type (e.g., "bitcoin", "lightning", "ethereum")
    authority?: string // Payment authority/address (from NIP-A3 tag[2])
    payto?: string // Full payto:// URI
    displayType?: string // Human-readable type name
    address?: string // Legacy field, use authority instead
    currency?: string
    minAmount?: number
    maxAmount?: number
    extra?: string[] // Optional extra fields from NIP-A3
    [key: string]: any
  }>
  payto?: string // Root-level payto (legacy)
  type?: string // Root-level type (legacy)
  authority?: string // Root-level authority (legacy)
  currency?: string // Root-level currency (legacy)
  [key: string]: any
}
export type TMailboxRelayScope = 'read' | 'write' | 'both'
export type TMailboxRelay = {
  url: string
  scope: TMailboxRelayScope
}
export type TRelayList = {
  write: string[]
  read: string[]
  originalRelays: TMailboxRelay[]
  /** Kind 10243 — index relays (https://…); read/write/both same as NIP-65 `r` tags. */
  httpRead: string[]
  httpWrite: string[]
  httpOriginalRelays: TMailboxRelay[]
}

export type TRelayInfo = {
  url: string
  shortUrl: string
  name?: string
  description?: string
  icon?: string
  pubkey?: string
  contact?: string
  supported_nips?: number[]
  software?: string
  version?: string
  tags?: string[]
  payments_url?: string
  limitation?: {
    auth_required?: boolean
    payment_required?: boolean
  }
  /** Set when caching; used to expire relay info and refetch NIP-11. */
  cachedAt?: number
}

/** NIP-66 relay discovery (kind 30166) parsed tags. Used to supplement NIP-11 / static lists. */
export type TNip66RelayDiscovery = {
  url: string
  supportedNips: number[]
  requirements: { auth?: boolean; payment?: boolean; writes?: boolean; pow?: boolean }
  rttOpenMs?: number
  rttReadMs?: number
  rttWriteMs?: number
  networkType?: string
  relayType?: string
  topics?: string[]
  created_at: number
  /** Pubkey of the 30166 event author (the monitor who reported this relay). */
  monitorPubkey?: string
}

export type TWebMetadata = {
  title?: string | null
  description?: string | null
  image?: string | null
}

export type TRelaySet = {
  id: string
  aTag: string[]
  name: string
  relayUrls: string[]
}

export type TConfig = {
  relayGroups: TRelaySet[]
  theme: TThemeSetting
}

export type TThemeSetting = 'light' | 'dark' | 'system'
export type TTheme = 'light' | 'dark'
export type TFontSize = 'small' | 'medium' | 'large'

export type TDraftEvent = Pick<Event, 'content' | 'created_at' | 'kind' | 'tags'>

export type TNip07 = {
  getPublicKey: () => Promise<string>
  signEvent: (draftEvent: TDraftEvent) => Promise<VerifiedEvent>
  nip04?: {
    encrypt?: (pubkey: string, plainText: string) => Promise<string>
    decrypt?: (pubkey: string, cipherText: string) => Promise<string>
  }
  getRelays?: () => Promise<{ [url: string]: { read: boolean; write: boolean } }>
}

export interface ISigner {
  getPublicKey: () => Promise<string>
  signEvent: (draftEvent: TDraftEvent) => Promise<VerifiedEvent>
  nip04Encrypt: (pubkey: string, plainText: string) => Promise<string>
  nip04Decrypt: (pubkey: string, cipherText: string) => Promise<string>
}

export type TSignerType = 'nsec' | 'nip-07' | 'bunker' | 'browser-nsec' | 'ncryptsec' | 'npub'

export type TAccount = {
  pubkey: string
  signerType: TSignerType
  ncryptsec?: string
  nsec?: string
  bunker?: string
  bunkerClientSecretKey?: string
  npub?: string
}

export type TAccountPointer = Pick<TAccount, 'pubkey' | 'signerType'>

export type TFeedType = 'relays' | 'relay' | 'all-favorites'
export type TFeedInfo = { feedType: TFeedType; id?: string }

export type TLanguage = 'en' | 'zh' | 'pl'

export type TImetaInfo = {
  url: string
  blurHash?: string
  dim?: { width: number; height: number }
  pubkey?: string
  // NIP-92 fields
  m?: string // MIME type
  alt?: string // Alternative text
  x?: string // SHA256 hash as specified in NIP 94
  fallback?: string[] // Array of fallback URLs
  image?: string // Poster/thumbnail image URL (for videos)
  thumb?: string // Thumbnail URL for images
  size?: number // File size in bytes (NIP-94)
}

export type TPublishOptions = {
  specifiedRelayUrls?: string[]
  additionalRelayUrls?: string[]
  /** Kind 10012 `relay` URLs for publish priority (outboxes → author inboxes → favorites → fast relays). */
  favoriteRelayUrls?: string[]
  /** User-blocked relay URLs (normalized); excluded from prioritized publish lists before capping. */
  blockedRelayUrls?: string[]
  minPow?: number
  disableFallbacks?: boolean // If true, don't use fallback relays when publishing fails
  /** Override global "Add client tag" preference for this publish (default: read from localStorage) */
  addClientTag?: boolean
}

/** Options for {@link ClientService.publishEvent} (second argument bundle in code: favorites + internal retry pass). */
export type TPublishEventExtras = {
  favoriteRelayUrls?: string[]
  /** When true (internal): only publish to the given URLs; do not merge outboxes or schedule outbox retry. */
  skipOutboxRetry?: boolean
  /** Shown in relay batch logs and an info line (e.g. "NIP-65 outbox retry — 2nd attempt"). */
  publishBatchLabel?: string
}

export type TNoteListMode = 'posts' | 'postsAndReplies' | 'you' | 'bookmarksAndHashtags'

export type TNotificationType = 'all' | 'mentions' | 'reactions' | 'zaps'

export type TPageRef = {
  scrollToTop: (behavior?: ScrollBehavior) => void
  /** Optional: reload the current page’s primary data (feed, profile, note, etc.). */
  refresh?: () => void
}

export type TEmoji = {
  shortcode: string
  url: string
}

export type TMediaUploadServiceConfig =
  | {
      type: 'nip96'
      service: string
    }
  | {
      type: 'blossom'
    }

export type TPollType = (typeof POLL_TYPE)[keyof typeof POLL_TYPE]

export type TPollCreateData = {
  isMultipleChoice: boolean
  options: string[]
  relays: string[]
  endsAt?: number
}

export type TSearchType = 'profile' | 'profiles' | 'notes' | 'note' | 'hashtag' | 'relay' | 'dtag'

export type TSearchParams = {
  type: TSearchType
  search: string
  input?: string
  /** Present for profile rows from typeahead; avoids redundant fetch and shows cached avatar/name immediately. */
  profile?: TProfile
}

export type TNotificationStyle =
  (typeof NOTIFICATION_LIST_STYLE)[keyof typeof NOTIFICATION_LIST_STYLE]

export type TAwesomeRelayCollection = {
  id: string
  name: string
  description: string
  relays: string[]
}

export type TMediaAutoLoadPolicy =
  (typeof MEDIA_AUTO_LOAD_POLICY)[keyof typeof MEDIA_AUTO_LOAD_POLICY]
