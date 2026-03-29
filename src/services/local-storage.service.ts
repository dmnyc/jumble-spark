import {
  DEFAULT_NIP_96_SERVICE,
  ExtendedKind,
  MEDIA_AUTO_LOAD_POLICY,
  NOTIFICATION_LIST_STYLE,
  DEFAULT_FEED_SHOW_KINDS,
  StorageKey
} from '@/constants'
import { kinds } from 'nostr-tools'
import { isSameAccount } from '@/lib/account'
import { randomString } from '@/lib/random'
import {
  TAccount,
  TAccountPointer,
  TFeedInfo,
  TFontSize,
  TMediaAutoLoadPolicy,
  TMediaUploadServiceConfig,
  TNoteListMode,
  TNotificationStyle,
  TRelaySet,
  TTheme,
  TThemeSetting,
} from '@/types'
import indexedDb from './indexed-db.service'

/** Keys we persist to IndexedDB (and migrate from localStorage when IDB is empty). */
const SETTINGS_KEYS = [
  StorageKey.RELAY_SETS,
  StorageKey.THEME_SETTING,
  StorageKey.THEME,
  StorageKey.ADD_CLIENT_TAG,
  StorageKey.FONT_SIZE,
  StorageKey.NOTE_LIST_MODE,
  StorageKey.ACCOUNTS,
  StorageKey.CURRENT_ACCOUNT,
  StorageKey.DEFAULT_ZAP_SATS,
  StorageKey.DEFAULT_ZAP_COMMENT,
  StorageKey.QUICK_ZAP,
  StorageKey.ZAP_REPLY_THRESHOLD,
  StorageKey.ACCOUNT_FEED_INFO_MAP,
  StorageKey.AUTOPLAY,
  StorageKey.HIDE_UNTRUSTED_INTERACTIONS,
  StorageKey.HIDE_UNTRUSTED_NOTIFICATIONS,
  StorageKey.HIDE_UNTRUSTED_NOTES,
  StorageKey.MEDIA_UPLOAD_SERVICE_CONFIG_MAP,
  StorageKey.DEFAULT_SHOW_NSFW,
  StorageKey.DISMISSED_TOO_MANY_RELAYS_ALERT,
  StorageKey.SHOW_KINDS,
  StorageKey.SHOW_KINDS_VERSION,
  StorageKey.SHOW_KIND_1_OPs,
  StorageKey.SHOW_KIND_1_REPLIES,
  StorageKey.SHOW_KIND_1111,
  StorageKey.FEED_KIND_FILTER_BYPASS,
  StorageKey.HIDE_CONTENT_MENTIONING_MUTED_USERS,
  StorageKey.NOTIFICATION_LIST_STYLE,
  StorageKey.MEDIA_AUTO_LOAD_POLICY,
  StorageKey.SHOWN_CREATE_WALLET_GUIDE_TOAST_PUBKEYS,
  StorageKey.SHOW_RECOMMENDED_RELAYS_PANEL,
  StorageKey.ADD_RANDOM_RELAYS_TO_PUBLISH,
  StorageKey.SHOW_PUBLISH_SUCCESS_TOASTS,
  StorageKey.SHOW_LIVE_ACTIVITIES_BANNER,
  StorageKey.DEFAULT_EXPIRATION_ENABLED,
  StorageKey.DEFAULT_EXPIRATION_MONTHS,
  StorageKey.DEFAULT_QUIET_ENABLED,
  StorageKey.DEFAULT_QUIET_DAYS,
  StorageKey.RESPECT_QUIET_TAGS,
  StorageKey.GLOBAL_QUIET_MODE,
  StorageKey.SHOW_RSS_FEED,
  StorageKey.PANE_MODE
] as const

class LocalStorageService {
  static instance: LocalStorageService

  private relaySets: TRelaySet[] = []
  private themeSetting: TThemeSetting = 'system'
  private theme: TTheme = 'light'
  private addClientTag: boolean = true
  private fontSize: TFontSize = 'medium'
  private accounts: TAccount[] = []
  private currentAccount: TAccount | null = null
  private noteListMode: TNoteListMode = 'posts'
  private defaultZapSats: number = 21
  private defaultZapComment: string = 'Zap!'
  private quickZap: boolean = false
  private zapReplyThreshold: number = 2100
  private accountFeedInfoMap: Record<string, TFeedInfo | undefined> = {}
  private mediaUploadService: string = DEFAULT_NIP_96_SERVICE
  private autoplay: boolean = true
  private hideUntrustedInteractions: boolean = false
  private hideUntrustedNotifications: boolean = false
  private hideUntrustedNotes: boolean = false
  private mediaUploadServiceConfigMap: Record<string, TMediaUploadServiceConfig> = {}
  private defaultShowNsfw: boolean = false
  private dismissedTooManyRelaysAlert: boolean = false
  private showKinds: number[] = []
  private showKind1OPs: boolean = true
  private showKind1Replies: boolean = true
  private showKind1111: boolean = true
  /** Omit kinds in feed REQ + skip client kind filtering (testing). */
  private feedKindFilterBypass: boolean = false
  private hideContentMentioningMutedUsers: boolean = false
  private notificationListStyle: TNotificationStyle = NOTIFICATION_LIST_STYLE.DETAILED
  private mediaAutoLoadPolicy: TMediaAutoLoadPolicy = MEDIA_AUTO_LOAD_POLICY.ALWAYS
  private showRecommendedRelaysPanel: boolean = false
  private shownCreateWalletGuideToastPubkeys: Set<string> = new Set()
  private defaultExpirationEnabled: boolean = false
  private defaultExpirationMonths: number = 6
  private defaultQuietEnabled: boolean = false
  private defaultQuietDays: number = 7
  private respectQuietTags: boolean = true
  private globalQuietMode: boolean = false
  private showRssFeed: boolean = true
  private panelMode: 'single' | 'double' = 'single'
  private addRandomRelaysToPublish: boolean = false
  private showPublishSuccessToasts: boolean = true
  private showLiveActivitiesBanner: boolean = true

  constructor() {
    if (!LocalStorageService.instance) {
      this.init()
      LocalStorageService.instance = this
    }
    return LocalStorageService.instance
  }

  init() {
    this.themeSetting =
      (window.localStorage.getItem(StorageKey.THEME_SETTING) as TThemeSetting) ?? 'system'
    const themeStr = window.localStorage.getItem(StorageKey.THEME) as TTheme | null
    this.theme = themeStr === 'dark' || themeStr === 'light' ? themeStr : 'light'
    const addClientTagStr = window.localStorage.getItem(StorageKey.ADD_CLIENT_TAG)
    this.addClientTag = addClientTagStr === null ? true : addClientTagStr === 'true'
    this.fontSize =
      (window.localStorage.getItem(StorageKey.FONT_SIZE) as TFontSize) ?? 'medium'
    const accountsStr = window.localStorage.getItem(StorageKey.ACCOUNTS)
    this.accounts = accountsStr ? JSON.parse(accountsStr) : []
    const currentAccountStr = window.localStorage.getItem(StorageKey.CURRENT_ACCOUNT)
    this.currentAccount = currentAccountStr ? JSON.parse(currentAccountStr) : null
    const noteListModeStr = window.localStorage.getItem(StorageKey.NOTE_LIST_MODE)
    this.noteListMode =
      noteListModeStr && ['posts', 'postsAndReplies', 'pictures'].includes(noteListModeStr)
        ? (noteListModeStr as TNoteListMode)
        : 'posts'
    const relaySetsStr = window.localStorage.getItem(StorageKey.RELAY_SETS)
    if (!relaySetsStr) {
      let relaySets: TRelaySet[] = []
      const legacyRelayGroupsStr = window.localStorage.getItem('relayGroups')
      if (legacyRelayGroupsStr) {
        const legacyRelayGroups = JSON.parse(legacyRelayGroupsStr)
        relaySets = legacyRelayGroups.map((group: any) => {
          return {
            id: randomString(),
            name: group.groupName,
            relayUrls: group.relayUrls
          }
        })
      }
      if (!relaySets.length) {
        relaySets = []
      }
      this.persistSetting(StorageKey.RELAY_SETS, JSON.stringify(relaySets))
      this.relaySets = relaySets
    } else {
      this.relaySets = JSON.parse(relaySetsStr)
    }

    const defaultZapSatsStr = window.localStorage.getItem(StorageKey.DEFAULT_ZAP_SATS)
    if (defaultZapSatsStr) {
      const num = parseInt(defaultZapSatsStr)
      if (!isNaN(num)) {
        this.defaultZapSats = num
      }
    }
    this.defaultZapComment = window.localStorage.getItem(StorageKey.DEFAULT_ZAP_COMMENT) ?? 'Zap!'
    this.quickZap = window.localStorage.getItem(StorageKey.QUICK_ZAP) === 'true'

    const zapReplyThresholdStr = window.localStorage.getItem(StorageKey.ZAP_REPLY_THRESHOLD)
    if (zapReplyThresholdStr) {
      const num = parseInt(zapReplyThresholdStr)
      if (!isNaN(num)) {
        this.zapReplyThreshold = num
      }
    }

    const accountFeedInfoMapStr =
      window.localStorage.getItem(StorageKey.ACCOUNT_FEED_INFO_MAP) ?? '{}'
    this.accountFeedInfoMap = JSON.parse(accountFeedInfoMapStr)

    // deprecated
    this.mediaUploadService =
      window.localStorage.getItem(StorageKey.MEDIA_UPLOAD_SERVICE) ?? DEFAULT_NIP_96_SERVICE

    this.autoplay = window.localStorage.getItem(StorageKey.AUTOPLAY) !== 'false'

    const hideUntrustedEvents =
      window.localStorage.getItem(StorageKey.HIDE_UNTRUSTED_EVENTS) === 'true'
    const storedHideUntrustedInteractions = window.localStorage.getItem(
      StorageKey.HIDE_UNTRUSTED_INTERACTIONS
    )
    const storedHideUntrustedNotifications = window.localStorage.getItem(
      StorageKey.HIDE_UNTRUSTED_NOTIFICATIONS
    )
    const storedHideUntrustedNotes = window.localStorage.getItem(StorageKey.HIDE_UNTRUSTED_NOTES)
    this.hideUntrustedInteractions = storedHideUntrustedInteractions
      ? storedHideUntrustedInteractions === 'true'
      : hideUntrustedEvents
    this.hideUntrustedNotifications = storedHideUntrustedNotifications
      ? storedHideUntrustedNotifications === 'true'
      : hideUntrustedEvents
    this.hideUntrustedNotes = storedHideUntrustedNotes
      ? storedHideUntrustedNotes === 'true'
      : hideUntrustedEvents

    const mediaUploadServiceConfigMapStr = window.localStorage.getItem(
      StorageKey.MEDIA_UPLOAD_SERVICE_CONFIG_MAP
    )
    if (mediaUploadServiceConfigMapStr) {
      this.mediaUploadServiceConfigMap = JSON.parse(mediaUploadServiceConfigMapStr)
    }

    this.defaultShowNsfw = window.localStorage.getItem(StorageKey.DEFAULT_SHOW_NSFW) === 'true'

    this.dismissedTooManyRelaysAlert =
      window.localStorage.getItem(StorageKey.DISMISSED_TOO_MANY_RELAYS_ALERT) === 'true'

    const storedValue = window.localStorage.getItem(StorageKey.SHOW_RECOMMENDED_RELAYS_PANEL)
    this.showRecommendedRelaysPanel = storedValue === 'true' // Default to false if not explicitly set to true

    const showKindsStr = window.localStorage.getItem(StorageKey.SHOW_KINDS)
    if (!showKindsStr) {
      this.showKinds = [...DEFAULT_FEED_SHOW_KINDS]
    } else {
      const showKindsVersionStr = window.localStorage.getItem(StorageKey.SHOW_KINDS_VERSION)
      const showKindsVersion = showKindsVersionStr ? parseInt(showKindsVersionStr) : 0
      const showKinds = JSON.parse(showKindsStr) as number[]
      if (showKindsVersion < 1) {
        showKinds.push(ExtendedKind.VIDEO, ExtendedKind.SHORT_VIDEO)
      }
      if (showKindsVersion < 2) {
        showKinds.push(ExtendedKind.ZAP_RECEIPT)
      }
      if (showKindsVersion < 3) {
        // Remove boosts (kind 6) from existing users' filters
        const repostIndex = showKinds.indexOf(kinds.Repost)
        if (repostIndex !== -1) {
          showKinds.splice(repostIndex, 1)
        }
      }
      if (showKindsVersion < 4) {
        // Add publications and wiki articles to existing users' filters
        if (!showKinds.includes(ExtendedKind.PUBLICATION)) {
          showKinds.push(ExtendedKind.PUBLICATION)
        }
        if (!showKinds.includes(ExtendedKind.PUBLICATION_CONTENT)) {
          showKinds.push(ExtendedKind.PUBLICATION_CONTENT)
        }
        if (!showKinds.includes(ExtendedKind.WIKI_ARTICLE)) {
          showKinds.push(ExtendedKind.WIKI_ARTICLE)
        }
      }
      if (showKindsVersion < 5) {
        // Remove publication content from existing users' filters (should only be embedded)
        const pubContentIndex = showKinds.indexOf(ExtendedKind.PUBLICATION_CONTENT)
        if (pubContentIndex !== -1) {
          showKinds.splice(pubContentIndex, 1)
        }
      }
      if (showKindsVersion < 6) {
        // Remove publications and publication content from existing users' filters (should only be embedded, not in feeds)
        const pubIndex = showKinds.indexOf(ExtendedKind.PUBLICATION)
        if (pubIndex !== -1) {
          showKinds.splice(pubIndex, 1)
        }
        const pubContentIndex = showKinds.indexOf(ExtendedKind.PUBLICATION_CONTENT)
        if (pubContentIndex !== -1) {
          showKinds.splice(pubContentIndex, 1)
        }
      }
      if (showKindsVersion < 7) {
        // Remove NIP-89 handler kinds from feed (not in filter UI; avoid showing in main feed)
        const nip89RecIndex = showKinds.indexOf(ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION)
        if (nip89RecIndex !== -1) {
          showKinds.splice(nip89RecIndex, 1)
        }
        const nip89InfoIndex = showKinds.indexOf(ExtendedKind.APPLICATION_HANDLER_INFO)
        if (nip89InfoIndex !== -1) {
          showKinds.splice(nip89InfoIndex, 1)
        }
      }
      if (showKindsVersion < 8) {
        // Boosts (kind 6) and publications removed from feed filter UI — strip from saved preferences
        for (let i = showKinds.length - 1; i >= 0; i--) {
          const k = showKinds[i]
          if (k === kinds.Repost || k === ExtendedKind.PUBLICATION) {
            showKinds.splice(i, 1)
          }
        }
      }
      if (showKindsVersion < 10) {
        if (showKinds.includes(ExtendedKind.POLL) && !showKinds.includes(ExtendedKind.ZAP_POLL)) {
          showKinds.push(ExtendedKind.ZAP_POLL)
        }
      }
      if (showKindsVersion < 11) {
        if (!showKinds.includes(ExtendedKind.GIT_RELEASE)) {
          showKinds.push(ExtendedKind.GIT_RELEASE)
        }
      }
      // v9: boosts are optional in the same filter list as other kinds; do not auto-enable (leave absent).
      this.showKinds = showKinds
      // Only persist when we read from localStorage. If SHOW_KINDS is missing here (migrated to IDB and
      // keys cleared), persisting would write DEFAULT_FEED_SHOW_KINDS to IndexedDB and wipe the user's
      // saved filter before initAsync/applySettings runs.
      this.persistSetting(StorageKey.SHOW_KINDS, JSON.stringify(this.showKinds))
      this.persistSetting(StorageKey.SHOW_KINDS_VERSION, '11')
    }

    // Feed filter: kind 1 OPs, kind 1 replies, kind 1111 (migrate from legacy showRepliesAndComments if set)
    const showKind1OPsStr = window.localStorage.getItem(StorageKey.SHOW_KIND_1_OPs)
    const showRepliesStr = window.localStorage.getItem(StorageKey.SHOW_REPLIES_AND_COMMENTS)
    const showKind1RepliesStr = window.localStorage.getItem(StorageKey.SHOW_KIND_1_REPLIES)
    const showKind1111Str = window.localStorage.getItem(StorageKey.SHOW_KIND_1111)
    if (showKind1OPsStr !== null) {
      this.showKind1OPs = showKind1OPsStr === 'true'
    } else {
      this.showKind1OPs = this.showKinds.includes(kinds.ShortTextNote)
    }
    if (showKind1RepliesStr !== null) {
      this.showKind1Replies = showKind1RepliesStr === 'true'
    } else if (showRepliesStr !== null) {
      this.showKind1Replies = showRepliesStr === 'true'
    } else {
      this.showKind1Replies = this.showKinds.includes(kinds.ShortTextNote)
    }
    if (showKind1111Str !== null) {
      this.showKind1111 = showKind1111Str === 'true'
    } else if (showRepliesStr !== null) {
      this.showKind1111 = showRepliesStr === 'true'
    } else {
      this.showKind1111 = this.showKinds.includes(ExtendedKind.COMMENT)
    }

    const feedKindFilterBypassStr = window.localStorage.getItem(StorageKey.FEED_KIND_FILTER_BYPASS)
    this.feedKindFilterBypass = feedKindFilterBypassStr === 'true'

    this.hideContentMentioningMutedUsers =
      window.localStorage.getItem(StorageKey.HIDE_CONTENT_MENTIONING_MUTED_USERS) === 'true'

    this.notificationListStyle =
      window.localStorage.getItem(StorageKey.NOTIFICATION_LIST_STYLE) ===
      NOTIFICATION_LIST_STYLE.COMPACT
        ? NOTIFICATION_LIST_STYLE.COMPACT
        : NOTIFICATION_LIST_STYLE.DETAILED

    const mediaAutoLoadPolicy = window.localStorage.getItem(StorageKey.MEDIA_AUTO_LOAD_POLICY)
    if (
      mediaAutoLoadPolicy &&
      Object.values(MEDIA_AUTO_LOAD_POLICY).includes(mediaAutoLoadPolicy as TMediaAutoLoadPolicy)
    ) {
      this.mediaAutoLoadPolicy = mediaAutoLoadPolicy as TMediaAutoLoadPolicy
    }

    const shownCreateWalletGuideToastPubkeysStr = window.localStorage.getItem(
      StorageKey.SHOWN_CREATE_WALLET_GUIDE_TOAST_PUBKEYS
    )
    this.shownCreateWalletGuideToastPubkeys = shownCreateWalletGuideToastPubkeysStr
      ? new Set(JSON.parse(shownCreateWalletGuideToastPubkeysStr))
      : new Set()

    // Initialize expiration and quiet settings
    const defaultExpirationEnabledStr = window.localStorage.getItem(StorageKey.DEFAULT_EXPIRATION_ENABLED)
    this.defaultExpirationEnabled = defaultExpirationEnabledStr === 'true'

    const defaultExpirationMonthsStr = window.localStorage.getItem(StorageKey.DEFAULT_EXPIRATION_MONTHS)
    if (defaultExpirationMonthsStr) {
      const num = parseInt(defaultExpirationMonthsStr)
      if (!isNaN(num) && num >= 0 && Number.isInteger(num)) {
        this.defaultExpirationMonths = num
      }
    }

    const defaultQuietEnabledStr = window.localStorage.getItem(StorageKey.DEFAULT_QUIET_ENABLED)
    this.defaultQuietEnabled = defaultQuietEnabledStr === 'true'

    const defaultQuietDaysStr = window.localStorage.getItem(StorageKey.DEFAULT_QUIET_DAYS)
    if (defaultQuietDaysStr) {
      const num = parseInt(defaultQuietDaysStr)
      if (!isNaN(num) && num >= 0 && Number.isInteger(num)) {
        this.defaultQuietDays = num
      }
    }

    const respectQuietTagsStr = window.localStorage.getItem(StorageKey.RESPECT_QUIET_TAGS)
    this.respectQuietTags = respectQuietTagsStr === null ? true : respectQuietTagsStr === 'true'

    const globalQuietModeStr = window.localStorage.getItem(StorageKey.GLOBAL_QUIET_MODE)
    this.globalQuietMode = globalQuietModeStr === 'true'

    const showRssFeedStr = window.localStorage.getItem(StorageKey.SHOW_RSS_FEED)
    this.showRssFeed = showRssFeedStr === null ? true : showRssFeedStr === 'true' // Default to true

    const panelModeStr = window.localStorage.getItem(StorageKey.PANE_MODE)
    this.panelMode = panelModeStr === 'double' ? 'double' : 'single' // Default to 'single'

    const addRandomRelaysStr = window.localStorage.getItem(StorageKey.ADD_RANDOM_RELAYS_TO_PUBLISH)
    this.addRandomRelaysToPublish = addRandomRelaysStr === null ? false : addRandomRelaysStr === 'true'

    const showPublishSuccessStr = window.localStorage.getItem(StorageKey.SHOW_PUBLISH_SUCCESS_TOASTS)
    this.showPublishSuccessToasts = showPublishSuccessStr !== 'false'

    const showLiveActivitiesStr = window.localStorage.getItem(StorageKey.SHOW_LIVE_ACTIVITIES_BANNER)
    this.showLiveActivitiesBanner = showLiveActivitiesStr !== 'false'

    // Clean up deprecated data
    window.localStorage.removeItem(StorageKey.ACCOUNT_PROFILE_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_FOLLOW_LIST_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_RELAY_LIST_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_MUTE_LIST_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_MUTE_DECRYPTED_TAGS_MAP)
    window.localStorage.removeItem(StorageKey.ACTIVE_RELAY_SET_ID)
    window.localStorage.removeItem(StorageKey.FEED_TYPE)
  }

  /** Persist a setting. Keys in SETTINGS_KEYS go only to IndexedDB; others use localStorage. */
  private persistSetting(key: string, value: string): void {
    if ((SETTINGS_KEYS as readonly string[]).includes(key)) {
      indexedDb.setSetting(key, value).catch(() => {})
      return
    }
    window.localStorage.setItem(key, value)
  }

  private initPromise: Promise<void> | null = null

  /**
   * Async init: hydrate from IndexedDB when available, otherwise migrate localStorage into IndexedDB.
   * Call this before app render so settings are read from IndexedDB.
   */
  async initAsync(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = (async () => {
      await indexedDb.init()
      const all = await indexedDb.getAllSettings()
      if (Object.keys(all).length > 0) {
        this.applySettings(all)
      } else {
        await this.migrateToIdb()
      }
      this.clearSettingsFromLocalStorage()
    })()
    return this.initPromise
  }

  /** Remove SETTINGS_KEYS from localStorage so we don't duplicate; source of truth is IndexedDB. */
  private clearSettingsFromLocalStorage(): void {
    for (const key of SETTINGS_KEYS) {
      window.localStorage.removeItem(key)
    }
  }

  private async migrateToIdb(): Promise<void> {
    for (const key of SETTINGS_KEYS) {
      const value = window.localStorage.getItem(key)
      if (value != null) await indexedDb.setSetting(key, value)
    }
  }

  private applySettings(record: Record<string, string>): void {
    const get = (k: string) => record[k] ?? window.localStorage.getItem(k)
    if (get(StorageKey.THEME_SETTING) != null) {
      this.themeSetting = (get(StorageKey.THEME_SETTING) as TThemeSetting) ?? this.themeSetting
    }
    const themeStr = get(StorageKey.THEME)
    if (themeStr === 'dark' || themeStr === 'light') this.theme = themeStr
    const addClientTagStr = get(StorageKey.ADD_CLIENT_TAG)
    if (addClientTagStr != null) this.addClientTag = addClientTagStr === 'true'
    if (get(StorageKey.FONT_SIZE) != null) {
      this.fontSize = (get(StorageKey.FONT_SIZE) as TFontSize) ?? this.fontSize
    }
    const noteListModeStr = get(StorageKey.NOTE_LIST_MODE)
    if (noteListModeStr != null && ['posts', 'postsAndReplies', 'pictures'].includes(noteListModeStr)) {
      this.noteListMode = noteListModeStr as TNoteListMode
    }
    const accountsStr = get(StorageKey.ACCOUNTS)
    if (accountsStr != null) this.accounts = JSON.parse(accountsStr) as TAccount[]
    const currentAccountStr = get(StorageKey.CURRENT_ACCOUNT)
    if (currentAccountStr != null) this.currentAccount = JSON.parse(currentAccountStr) as TAccount | null
    const relaySetsStr = get(StorageKey.RELAY_SETS)
    if (relaySetsStr != null) this.relaySets = JSON.parse(relaySetsStr) as TRelaySet[]
    const defaultZapSatsStr = get(StorageKey.DEFAULT_ZAP_SATS)
    if (defaultZapSatsStr != null) {
      const num = parseInt(defaultZapSatsStr)
      if (!isNaN(num)) this.defaultZapSats = num
    }
    const defaultZapCommentStr = get(StorageKey.DEFAULT_ZAP_COMMENT)
    if (defaultZapCommentStr != null) this.defaultZapComment = defaultZapCommentStr
    const quickZapStr = get(StorageKey.QUICK_ZAP)
    if (quickZapStr != null) this.quickZap = quickZapStr === 'true'
    const zapReplyStr = get(StorageKey.ZAP_REPLY_THRESHOLD)
    if (zapReplyStr != null) {
      const num = parseInt(zapReplyStr)
      if (!isNaN(num)) this.zapReplyThreshold = num
    }
    const accountFeedInfoStr = get(StorageKey.ACCOUNT_FEED_INFO_MAP)
    if (accountFeedInfoStr != null) this.accountFeedInfoMap = JSON.parse(accountFeedInfoStr) as Record<string, TFeedInfo | undefined>
    this.autoplay = get(StorageKey.AUTOPLAY) !== 'false'
    const hideInteractions = get(StorageKey.HIDE_UNTRUSTED_INTERACTIONS)
    if (hideInteractions != null) this.hideUntrustedInteractions = hideInteractions === 'true'
    const hideNotifications = get(StorageKey.HIDE_UNTRUSTED_NOTIFICATIONS)
    if (hideNotifications != null) this.hideUntrustedNotifications = hideNotifications === 'true'
    const hideNotes = get(StorageKey.HIDE_UNTRUSTED_NOTES)
    if (hideNotes != null) this.hideUntrustedNotes = hideNotes === 'true'
    const mediaConfigStr = get(StorageKey.MEDIA_UPLOAD_SERVICE_CONFIG_MAP)
    if (mediaConfigStr != null) this.mediaUploadServiceConfigMap = JSON.parse(mediaConfigStr) as Record<string, TMediaUploadServiceConfig>
    this.defaultShowNsfw = get(StorageKey.DEFAULT_SHOW_NSFW) === 'true'
    this.dismissedTooManyRelaysAlert = get(StorageKey.DISMISSED_TOO_MANY_RELAYS_ALERT) === 'true'
    this.showRecommendedRelaysPanel = get(StorageKey.SHOW_RECOMMENDED_RELAYS_PANEL) === 'true'
    this.addRandomRelaysToPublish = get(StorageKey.ADD_RANDOM_RELAYS_TO_PUBLISH) === 'true'
    const showPublishSuccessStr = get(StorageKey.SHOW_PUBLISH_SUCCESS_TOASTS)
    if (showPublishSuccessStr != null) this.showPublishSuccessToasts = showPublishSuccessStr !== 'false'
    const showLiveActivitiesStr = get(StorageKey.SHOW_LIVE_ACTIVITIES_BANNER)
    if (showLiveActivitiesStr != null) this.showLiveActivitiesBanner = showLiveActivitiesStr !== 'false'
    const showKindsStr = get(StorageKey.SHOW_KINDS)
    if (showKindsStr != null) this.showKinds = JSON.parse(showKindsStr) as number[]
    const showKind1OPsStr = get(StorageKey.SHOW_KIND_1_OPs)
    if (showKind1OPsStr != null) this.showKind1OPs = showKind1OPsStr === 'true'
    const showKind1RepliesStr = get(StorageKey.SHOW_KIND_1_REPLIES)
    if (showKind1RepliesStr != null) this.showKind1Replies = showKind1RepliesStr === 'true'
    const showKind1111Str = get(StorageKey.SHOW_KIND_1111)
    if (showKind1111Str != null) this.showKind1111 = showKind1111Str === 'true'
    const feedKindFilterBypassStr = get(StorageKey.FEED_KIND_FILTER_BYPASS)
    if (feedKindFilterBypassStr != null) this.feedKindFilterBypass = feedKindFilterBypassStr === 'true'
    this.hideContentMentioningMutedUsers = get(StorageKey.HIDE_CONTENT_MENTIONING_MUTED_USERS) === 'true'
    const notifStyle = get(StorageKey.NOTIFICATION_LIST_STYLE)
    if (notifStyle != null) this.notificationListStyle = notifStyle === NOTIFICATION_LIST_STYLE.COMPACT ? NOTIFICATION_LIST_STYLE.COMPACT : NOTIFICATION_LIST_STYLE.DETAILED
    const mediaPolicy = get(StorageKey.MEDIA_AUTO_LOAD_POLICY)
    if (mediaPolicy != null && Object.values(MEDIA_AUTO_LOAD_POLICY).includes(mediaPolicy as TMediaAutoLoadPolicy)) {
      this.mediaAutoLoadPolicy = mediaPolicy as TMediaAutoLoadPolicy
    }
    const shownWalletStr = get(StorageKey.SHOWN_CREATE_WALLET_GUIDE_TOAST_PUBKEYS)
    if (shownWalletStr != null) this.shownCreateWalletGuideToastPubkeys = new Set(JSON.parse(shownWalletStr) as string[])
    this.defaultExpirationEnabled = get(StorageKey.DEFAULT_EXPIRATION_ENABLED) === 'true'
    const defaultExpirationMonthsStr = get(StorageKey.DEFAULT_EXPIRATION_MONTHS)
    if (defaultExpirationMonthsStr != null) {
      const num = parseInt(defaultExpirationMonthsStr)
      if (!isNaN(num) && num >= 0) this.defaultExpirationMonths = num
    }
    this.defaultQuietEnabled = get(StorageKey.DEFAULT_QUIET_ENABLED) === 'true'
    const defaultQuietDaysStr = get(StorageKey.DEFAULT_QUIET_DAYS)
    if (defaultQuietDaysStr != null) {
      const num = parseInt(defaultQuietDaysStr)
      if (!isNaN(num) && num >= 0) this.defaultQuietDays = num
    }
    const respectQuietStr = get(StorageKey.RESPECT_QUIET_TAGS)
    if (respectQuietStr != null) this.respectQuietTags = respectQuietStr === 'true'
    this.globalQuietMode = get(StorageKey.GLOBAL_QUIET_MODE) === 'true'
    const showRssStr = get(StorageKey.SHOW_RSS_FEED)
    if (showRssStr != null) this.showRssFeed = showRssStr === 'true'
    const paneStr = get(StorageKey.PANE_MODE)
    if (paneStr != null && (paneStr === 'single' || paneStr === 'double')) this.panelMode = paneStr
  }

  getRelaySets() {
    return this.relaySets
  }

  setRelaySets(relaySets: TRelaySet[]) {
    this.relaySets = relaySets
    this.persistSetting(StorageKey.RELAY_SETS, JSON.stringify(this.relaySets))
  }

  getThemeSetting() {
    return this.themeSetting
  }

  setThemeSetting(themeSetting: TThemeSetting) {
    this.persistSetting(StorageKey.THEME_SETTING, themeSetting)
    this.themeSetting = themeSetting
  }

  getTheme(): TTheme {
    return this.theme
  }

  setTheme(theme: TTheme) {
    this.theme = theme
    this.persistSetting(StorageKey.THEME, theme)
  }

  getAddClientTag(): boolean {
    return this.addClientTag
  }

  setAddClientTag(value: boolean) {
    this.addClientTag = value
    this.persistSetting(StorageKey.ADD_CLIENT_TAG, value.toString())
  }

  getFontSize() {
    return this.fontSize
  }

  setFontSize(fontSize: TFontSize) {
    this.persistSetting(StorageKey.FONT_SIZE, fontSize)
    this.fontSize = fontSize
  }

  getNoteListMode() {
    return this.noteListMode
  }

  setNoteListMode(mode: TNoteListMode) {
    this.persistSetting(StorageKey.NOTE_LIST_MODE, mode)
    this.noteListMode = mode
  }

  getAccounts() {
    return this.accounts
  }

  findAccount(account: TAccountPointer) {
    return this.accounts.find((act) => isSameAccount(act, account))
  }

  getCurrentAccount() {
    return this.currentAccount
  }

  getAccountNsec(pubkey: string) {
    const account = this.accounts.find((act) => act.pubkey === pubkey && act.signerType === 'nsec')
    return account?.nsec
  }

  getAccountNcryptsec(pubkey: string) {
    const account = this.accounts.find(
      (act) => act.pubkey === pubkey && act.signerType === 'ncryptsec'
    )
    return account?.ncryptsec
  }

  addAccount(account: TAccount) {
    const index = this.accounts.findIndex((act) => isSameAccount(act, account))
    if (index !== -1) {
      this.accounts[index] = account
    } else {
      this.accounts.push(account)
    }
    this.persistSetting(StorageKey.ACCOUNTS, JSON.stringify(this.accounts))
    return this.accounts
  }

  removeAccount(account: TAccount) {
    this.accounts = this.accounts.filter((act) => !isSameAccount(act, account))
    this.persistSetting(StorageKey.ACCOUNTS, JSON.stringify(this.accounts))
    return this.accounts
  }

  switchAccount(account: TAccount | null) {
    if (isSameAccount(this.currentAccount, account)) {
      return
    }
    const act = this.accounts.find((act) => isSameAccount(act, account))
    if (!act) {
      return
    }
    this.currentAccount = act
    this.persistSetting(StorageKey.CURRENT_ACCOUNT, JSON.stringify(act))
  }

  getDefaultZapSats() {
    return this.defaultZapSats
  }

  setDefaultZapSats(sats: number) {
    this.defaultZapSats = sats
    this.persistSetting(StorageKey.DEFAULT_ZAP_SATS, sats.toString())
  }

  getDefaultZapComment() {
    return this.defaultZapComment
  }

  setDefaultZapComment(comment: string) {
    this.defaultZapComment = comment
    this.persistSetting(StorageKey.DEFAULT_ZAP_COMMENT, comment)
  }

  getQuickZap() {
    return this.quickZap
  }

  setQuickZap(quickZap: boolean) {
    this.quickZap = quickZap
    this.persistSetting(StorageKey.QUICK_ZAP, quickZap.toString())
  }

  getZapReplyThreshold() {
    return this.zapReplyThreshold
  }

  setZapReplyThreshold(sats: number) {
    this.zapReplyThreshold = sats
    this.persistSetting(StorageKey.ZAP_REPLY_THRESHOLD, sats.toString())
  }

  getFeedInfo(pubkey: string) {
    return this.accountFeedInfoMap[pubkey]
  }

  setFeedInfo(info: TFeedInfo, pubkey?: string | null) {
    this.accountFeedInfoMap[pubkey ?? 'default'] = info
    this.persistSetting(
      StorageKey.ACCOUNT_FEED_INFO_MAP,
      JSON.stringify(this.accountFeedInfoMap)
    )
  }

  getAutoplay() {
    return this.autoplay
  }

  setAutoplay(autoplay: boolean) {
    this.autoplay = autoplay
    this.persistSetting(StorageKey.AUTOPLAY, autoplay.toString())
  }

  getHideUntrustedInteractions() {
    return this.hideUntrustedInteractions
  }

  setHideUntrustedInteractions(hideUntrustedInteractions: boolean) {
    this.hideUntrustedInteractions = hideUntrustedInteractions
    this.persistSetting(
      StorageKey.HIDE_UNTRUSTED_INTERACTIONS,
      hideUntrustedInteractions.toString()
    )
  }

  getHideUntrustedNotifications() {
    return this.hideUntrustedNotifications
  }

  setHideUntrustedNotifications(hideUntrustedNotifications: boolean) {
    this.hideUntrustedNotifications = hideUntrustedNotifications
    this.persistSetting(
      StorageKey.HIDE_UNTRUSTED_NOTIFICATIONS,
      hideUntrustedNotifications.toString()
    )
  }

  getHideUntrustedNotes() {
    return this.hideUntrustedNotes
  }

  setHideUntrustedNotes(hideUntrustedNotes: boolean) {
    this.hideUntrustedNotes = hideUntrustedNotes
    this.persistSetting(StorageKey.HIDE_UNTRUSTED_NOTES, hideUntrustedNotes.toString())
  }

  getMediaUploadServiceConfig(pubkey?: string | null): TMediaUploadServiceConfig {
    const defaultConfig = { type: 'nip96', service: this.mediaUploadService } as const
    if (!pubkey) {
      return defaultConfig
    }
    return this.mediaUploadServiceConfigMap[pubkey] ?? defaultConfig
  }

  setMediaUploadServiceConfig(
    pubkey: string,
    config: TMediaUploadServiceConfig
  ): TMediaUploadServiceConfig {
    this.mediaUploadServiceConfigMap[pubkey] = config
    this.persistSetting(
      StorageKey.MEDIA_UPLOAD_SERVICE_CONFIG_MAP,
      JSON.stringify(this.mediaUploadServiceConfigMap)
    )
    return config
  }

  getDefaultShowNsfw() {
    return this.defaultShowNsfw
  }

  setDefaultShowNsfw(defaultShowNsfw: boolean) {
    this.defaultShowNsfw = defaultShowNsfw
    this.persistSetting(StorageKey.DEFAULT_SHOW_NSFW, defaultShowNsfw.toString())
  }

  getDismissedTooManyRelaysAlert() {
    return this.dismissedTooManyRelaysAlert
  }

  setDismissedTooManyRelaysAlert(dismissed: boolean) {
    this.dismissedTooManyRelaysAlert = dismissed
    this.persistSetting(StorageKey.DISMISSED_TOO_MANY_RELAYS_ALERT, dismissed.toString())
  }

  getShowRecommendedRelaysPanel() {
    return this.showRecommendedRelaysPanel
  }

  setShowRecommendedRelaysPanel(show: boolean) {
    this.showRecommendedRelaysPanel = show
    this.persistSetting(StorageKey.SHOW_RECOMMENDED_RELAYS_PANEL, show.toString())
  }

  getAddRandomRelaysToPublish(): boolean {
    return this.addRandomRelaysToPublish
  }

  setAddRandomRelaysToPublish(value: boolean) {
    this.addRandomRelaysToPublish = value
    this.persistSetting(StorageKey.ADD_RANDOM_RELAYS_TO_PUBLISH, value.toString())
  }

  getShowLiveActivitiesBanner(): boolean {
    return this.showLiveActivitiesBanner
  }

  setShowLiveActivitiesBanner(value: boolean) {
    this.showLiveActivitiesBanner = value
    this.persistSetting(StorageKey.SHOW_LIVE_ACTIVITIES_BANNER, value ? 'true' : 'false')
  }

  getShowKinds() {
    return this.showKinds
  }

  setShowKinds(newKinds: number[]) {
    this.showKinds = newKinds
    this.persistSetting(StorageKey.SHOW_KINDS, JSON.stringify(newKinds))
  }

  getShowKind1OPs(): boolean {
    return this.showKind1OPs
  }

  setShowKind1OPs(value: boolean) {
    this.showKind1OPs = value
    this.persistSetting(StorageKey.SHOW_KIND_1_OPs, value.toString())
  }

  getShowKind1Replies(): boolean {
    return this.showKind1Replies
  }

  setShowKind1Replies(value: boolean) {
    this.showKind1Replies = value
    this.persistSetting(StorageKey.SHOW_KIND_1_REPLIES, value.toString())
  }

  getShowKind1111(): boolean {
    return this.showKind1111
  }

  setShowKind1111(value: boolean) {
    this.showKind1111 = value
    this.persistSetting(StorageKey.SHOW_KIND_1111, value.toString())
  }

  getFeedKindFilterBypass(): boolean {
    return this.feedKindFilterBypass
  }

  setFeedKindFilterBypass(value: boolean) {
    this.feedKindFilterBypass = value
    this.persistSetting(StorageKey.FEED_KIND_FILTER_BYPASS, value.toString())
  }

  getHideContentMentioningMutedUsers() {
    return this.hideContentMentioningMutedUsers
  }

  setHideContentMentioningMutedUsers(hide: boolean) {
    this.hideContentMentioningMutedUsers = hide
    this.persistSetting(StorageKey.HIDE_CONTENT_MENTIONING_MUTED_USERS, hide.toString())
  }

  getNotificationListStyle() {
    return this.notificationListStyle
  }

  setNotificationListStyle(style: TNotificationStyle) {
    this.notificationListStyle = style
    this.persistSetting(StorageKey.NOTIFICATION_LIST_STYLE, style)
  }

  getMediaAutoLoadPolicy() {
    return this.mediaAutoLoadPolicy
  }

  setMediaAutoLoadPolicy(policy: TMediaAutoLoadPolicy) {
    this.mediaAutoLoadPolicy = policy
    this.persistSetting(StorageKey.MEDIA_AUTO_LOAD_POLICY, policy)
  }

  hasShownCreateWalletGuideToast(pubkey: string) {
    return this.shownCreateWalletGuideToastPubkeys.has(pubkey)
  }

  markCreateWalletGuideToastAsShown(pubkey: string) {
    if (this.shownCreateWalletGuideToastPubkeys.has(pubkey)) {
      return
    }
    this.shownCreateWalletGuideToastPubkeys.add(pubkey)
    this.persistSetting(
      StorageKey.SHOWN_CREATE_WALLET_GUIDE_TOAST_PUBKEYS,
      JSON.stringify(Array.from(this.shownCreateWalletGuideToastPubkeys))
    )
  }

  // Expiration settings
  getDefaultExpirationEnabled() {
    return this.defaultExpirationEnabled
  }

  setDefaultExpirationEnabled(enabled: boolean) {
    this.defaultExpirationEnabled = enabled
    this.persistSetting(StorageKey.DEFAULT_EXPIRATION_ENABLED, enabled.toString())
  }

  getDefaultExpirationMonths() {
    return this.defaultExpirationMonths
  }

  setDefaultExpirationMonths(months: number) {
    if (Number.isInteger(months) && months >= 0) {
      this.defaultExpirationMonths = months
      this.persistSetting(StorageKey.DEFAULT_EXPIRATION_MONTHS, months.toString())
    }
  }

  // Quiet settings
  getDefaultQuietEnabled() {
    return this.defaultQuietEnabled
  }

  setDefaultQuietEnabled(enabled: boolean) {
    this.defaultQuietEnabled = enabled
    this.persistSetting(StorageKey.DEFAULT_QUIET_ENABLED, enabled.toString())
  }

  getDefaultQuietDays() {
    return this.defaultQuietDays
  }

  setDefaultQuietDays(days: number) {
    if (Number.isInteger(days) && days >= 0) {
      this.defaultQuietDays = days
      this.persistSetting(StorageKey.DEFAULT_QUIET_DAYS, days.toString())
    }
  }

  getRespectQuietTags() {
    return this.respectQuietTags
  }

  setRespectQuietTags(respect: boolean) {
    this.respectQuietTags = respect
    this.persistSetting(StorageKey.RESPECT_QUIET_TAGS, respect.toString())
  }

  getGlobalQuietMode() {
    return this.globalQuietMode
  }

  setGlobalQuietMode(enabled: boolean) {
    this.globalQuietMode = enabled
    this.persistSetting(StorageKey.GLOBAL_QUIET_MODE, enabled.toString())
  }

  getShowRssFeed() {
    return this.showRssFeed
  }

  setShowRssFeed(show: boolean) {
    this.showRssFeed = show
    this.persistSetting(StorageKey.SHOW_RSS_FEED, show.toString())
  }

  getShowPublishSuccessToasts(): boolean {
    return this.showPublishSuccessToasts
  }

  setShowPublishSuccessToasts(show: boolean) {
    this.showPublishSuccessToasts = show
    this.persistSetting(StorageKey.SHOW_PUBLISH_SUCCESS_TOASTS, show.toString())
  }

  getPanelMode(): 'single' | 'double' {
    return this.panelMode
  }

  setPanelMode(mode: 'single' | 'double') {
    this.panelMode = mode
    this.persistSetting(StorageKey.PANE_MODE, mode)
  }

  getAccountNetworkHydrateAt(pubkey: string): number | undefined {
    try {
      const raw = window.localStorage.getItem(StorageKey.ACCOUNT_NETWORK_HYDRATE_AT_MAP)
      if (!raw) return undefined
      const map = JSON.parse(raw) as Record<string, unknown>
      const pk = pubkey.trim().toLowerCase()
      const v = map[pk]
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined
    } catch {
      return undefined
    }
  }

  setAccountNetworkHydrateAt(pubkey: string, atMs: number): void {
    try {
      const raw = window.localStorage.getItem(StorageKey.ACCOUNT_NETWORK_HYDRATE_AT_MAP)
      const map: Record<string, number> = raw ? (JSON.parse(raw) as Record<string, number>) : {}
      map[pubkey.trim().toLowerCase()] = atMs
      window.localStorage.setItem(StorageKey.ACCOUNT_NETWORK_HYDRATE_AT_MAP, JSON.stringify(map))
    } catch {
      /* ignore quota / privacy mode */
    }
  }
}

const instance = new LocalStorageService()
export default instance
