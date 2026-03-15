import {
  DEFAULT_NIP_96_SERVICE,
  ExtendedKind,
  MEDIA_AUTO_LOAD_POLICY,
  NOTIFICATION_LIST_STYLE,
  SUPPORTED_KINDS,
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
  TThemeSetting,
  TTranslationServiceConfig
} from '@/types'

class LocalStorageService {
  static instance: LocalStorageService

  private relaySets: TRelaySet[] = []
  private themeSetting: TThemeSetting = 'system'
  private fontSize: TFontSize = 'medium'
  private accounts: TAccount[] = []
  private currentAccount: TAccount | null = null
  private noteListMode: TNoteListMode = 'posts'
  private lastReadNotificationTimeMap: Record<string, number> = {}
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
  private translationServiceConfigMap: Record<string, TTranslationServiceConfig> = {}
  private mediaUploadServiceConfigMap: Record<string, TMediaUploadServiceConfig> = {}
  private defaultShowNsfw: boolean = false
  private dismissedTooManyRelaysAlert: boolean = false
  private showKinds: number[] = []
  private showKind1OPs: boolean = true
  private showKind1Replies: boolean = true
  private showKind1111: boolean = true
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
    const lastReadNotificationTimeMapStr =
      window.localStorage.getItem(StorageKey.LAST_READ_NOTIFICATION_TIME_MAP) ?? '{}'
    this.lastReadNotificationTimeMap = JSON.parse(lastReadNotificationTimeMapStr)

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
      window.localStorage.setItem(StorageKey.RELAY_SETS, JSON.stringify(relaySets))
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

    const translationServiceConfigMapStr = window.localStorage.getItem(
      StorageKey.TRANSLATION_SERVICE_CONFIG_MAP
    )
    if (translationServiceConfigMapStr) {
      this.translationServiceConfigMap = JSON.parse(translationServiceConfigMapStr)
    }

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
      // Default: show all supported kinds except reposts, publications, and publication content
      // Publications (30040) and Publication Content (30041) should only be embedded, not shown in feeds
      this.showKinds = SUPPORTED_KINDS.filter(
        kind => kind !== kinds.Repost && 
                kind !== ExtendedKind.PUBLICATION && 
                kind !== ExtendedKind.PUBLICATION_CONTENT
      )
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
        // Remove reposts from existing users' filters
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
      this.showKinds = showKinds
    }
    window.localStorage.setItem(StorageKey.SHOW_KINDS, JSON.stringify(this.showKinds))
    window.localStorage.setItem(StorageKey.SHOW_KINDS_VERSION, '6')

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

    // Clean up deprecated data
    window.localStorage.removeItem(StorageKey.ACCOUNT_PROFILE_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_FOLLOW_LIST_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_RELAY_LIST_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_MUTE_LIST_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_MUTE_DECRYPTED_TAGS_MAP)
    window.localStorage.removeItem(StorageKey.ACTIVE_RELAY_SET_ID)
    window.localStorage.removeItem(StorageKey.FEED_TYPE)
  }

  getRelaySets() {
    return this.relaySets
  }

  setRelaySets(relaySets: TRelaySet[]) {
    this.relaySets = relaySets
    window.localStorage.setItem(StorageKey.RELAY_SETS, JSON.stringify(this.relaySets))
  }

  getThemeSetting() {
    return this.themeSetting
  }

  setThemeSetting(themeSetting: TThemeSetting) {
    window.localStorage.setItem(StorageKey.THEME_SETTING, themeSetting)
    this.themeSetting = themeSetting
  }

  getFontSize() {
    return this.fontSize
  }

  setFontSize(fontSize: TFontSize) {
    window.localStorage.setItem(StorageKey.FONT_SIZE, fontSize)
    this.fontSize = fontSize
  }

  getNoteListMode() {
    return this.noteListMode
  }

  setNoteListMode(mode: TNoteListMode) {
    window.localStorage.setItem(StorageKey.NOTE_LIST_MODE, mode)
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
    window.localStorage.setItem(StorageKey.ACCOUNTS, JSON.stringify(this.accounts))
    return this.accounts
  }

  removeAccount(account: TAccount) {
    this.accounts = this.accounts.filter((act) => !isSameAccount(act, account))
    window.localStorage.setItem(StorageKey.ACCOUNTS, JSON.stringify(this.accounts))
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
    window.localStorage.setItem(StorageKey.CURRENT_ACCOUNT, JSON.stringify(act))
  }

  getDefaultZapSats() {
    return this.defaultZapSats
  }

  setDefaultZapSats(sats: number) {
    this.defaultZapSats = sats
    window.localStorage.setItem(StorageKey.DEFAULT_ZAP_SATS, sats.toString())
  }

  getDefaultZapComment() {
    return this.defaultZapComment
  }

  setDefaultZapComment(comment: string) {
    this.defaultZapComment = comment
    window.localStorage.setItem(StorageKey.DEFAULT_ZAP_COMMENT, comment)
  }

  getQuickZap() {
    return this.quickZap
  }

  setQuickZap(quickZap: boolean) {
    this.quickZap = quickZap
    window.localStorage.setItem(StorageKey.QUICK_ZAP, quickZap.toString())
  }

  getZapReplyThreshold() {
    return this.zapReplyThreshold
  }

  setZapReplyThreshold(sats: number) {
    this.zapReplyThreshold = sats
    window.localStorage.setItem(StorageKey.ZAP_REPLY_THRESHOLD, sats.toString())
  }

  getLastReadNotificationTime(pubkey: string) {
    return this.lastReadNotificationTimeMap[pubkey] ?? 0
  }

  setLastReadNotificationTime(pubkey: string, time: number) {
    this.lastReadNotificationTimeMap[pubkey] = time
    window.localStorage.setItem(
      StorageKey.LAST_READ_NOTIFICATION_TIME_MAP,
      JSON.stringify(this.lastReadNotificationTimeMap)
    )
  }

  getFeedInfo(pubkey: string) {
    return this.accountFeedInfoMap[pubkey]
  }

  setFeedInfo(info: TFeedInfo, pubkey?: string | null) {
    this.accountFeedInfoMap[pubkey ?? 'default'] = info
    window.localStorage.setItem(
      StorageKey.ACCOUNT_FEED_INFO_MAP,
      JSON.stringify(this.accountFeedInfoMap)
    )
  }

  getAutoplay() {
    return this.autoplay
  }

  setAutoplay(autoplay: boolean) {
    this.autoplay = autoplay
    window.localStorage.setItem(StorageKey.AUTOPLAY, autoplay.toString())
  }

  getHideUntrustedInteractions() {
    return this.hideUntrustedInteractions
  }

  setHideUntrustedInteractions(hideUntrustedInteractions: boolean) {
    this.hideUntrustedInteractions = hideUntrustedInteractions
    window.localStorage.setItem(
      StorageKey.HIDE_UNTRUSTED_INTERACTIONS,
      hideUntrustedInteractions.toString()
    )
  }

  getHideUntrustedNotifications() {
    return this.hideUntrustedNotifications
  }

  setHideUntrustedNotifications(hideUntrustedNotifications: boolean) {
    this.hideUntrustedNotifications = hideUntrustedNotifications
    window.localStorage.setItem(
      StorageKey.HIDE_UNTRUSTED_NOTIFICATIONS,
      hideUntrustedNotifications.toString()
    )
  }

  getHideUntrustedNotes() {
    return this.hideUntrustedNotes
  }

  setHideUntrustedNotes(hideUntrustedNotes: boolean) {
    this.hideUntrustedNotes = hideUntrustedNotes
    window.localStorage.setItem(StorageKey.HIDE_UNTRUSTED_NOTES, hideUntrustedNotes.toString())
  }

  getTranslationServiceConfig(pubkey?: string | null) {
    return this.translationServiceConfigMap[pubkey ?? '_'] ?? { service: 'jumble' }
  }

  setTranslationServiceConfig(config: TTranslationServiceConfig, pubkey?: string | null) {
    this.translationServiceConfigMap[pubkey ?? '_'] = config
    window.localStorage.setItem(
      StorageKey.TRANSLATION_SERVICE_CONFIG_MAP,
      JSON.stringify(this.translationServiceConfigMap)
    )
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
    window.localStorage.setItem(
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
    window.localStorage.setItem(StorageKey.DEFAULT_SHOW_NSFW, defaultShowNsfw.toString())
  }

  getDismissedTooManyRelaysAlert() {
    return this.dismissedTooManyRelaysAlert
  }

  setDismissedTooManyRelaysAlert(dismissed: boolean) {
    this.dismissedTooManyRelaysAlert = dismissed
    window.localStorage.setItem(StorageKey.DISMISSED_TOO_MANY_RELAYS_ALERT, dismissed.toString())
  }

  getShowRecommendedRelaysPanel() {
    return this.showRecommendedRelaysPanel
  }

  setShowRecommendedRelaysPanel(show: boolean) {
    this.showRecommendedRelaysPanel = show
    window.localStorage.setItem(StorageKey.SHOW_RECOMMENDED_RELAYS_PANEL, show.toString())
  }

  getShowKinds() {
    return this.showKinds
  }

  setShowKinds(newKinds: number[]) {
    this.showKinds = newKinds
    window.localStorage.setItem(StorageKey.SHOW_KINDS, JSON.stringify(newKinds))
  }

  getShowKind1OPs(): boolean {
    return this.showKind1OPs
  }

  setShowKind1OPs(value: boolean) {
    this.showKind1OPs = value
    window.localStorage.setItem(StorageKey.SHOW_KIND_1_OPs, value.toString())
  }

  getShowKind1Replies(): boolean {
    return this.showKind1Replies
  }

  setShowKind1Replies(value: boolean) {
    this.showKind1Replies = value
    window.localStorage.setItem(StorageKey.SHOW_KIND_1_REPLIES, value.toString())
  }

  getShowKind1111(): boolean {
    return this.showKind1111
  }

  setShowKind1111(value: boolean) {
    this.showKind1111 = value
    window.localStorage.setItem(StorageKey.SHOW_KIND_1111, value.toString())
  }

  getHideContentMentioningMutedUsers() {
    return this.hideContentMentioningMutedUsers
  }

  setHideContentMentioningMutedUsers(hide: boolean) {
    this.hideContentMentioningMutedUsers = hide
    window.localStorage.setItem(StorageKey.HIDE_CONTENT_MENTIONING_MUTED_USERS, hide.toString())
  }

  getNotificationListStyle() {
    return this.notificationListStyle
  }

  setNotificationListStyle(style: TNotificationStyle) {
    this.notificationListStyle = style
    window.localStorage.setItem(StorageKey.NOTIFICATION_LIST_STYLE, style)
  }

  getMediaAutoLoadPolicy() {
    return this.mediaAutoLoadPolicy
  }

  setMediaAutoLoadPolicy(policy: TMediaAutoLoadPolicy) {
    this.mediaAutoLoadPolicy = policy
    window.localStorage.setItem(StorageKey.MEDIA_AUTO_LOAD_POLICY, policy)
  }

  hasShownCreateWalletGuideToast(pubkey: string) {
    return this.shownCreateWalletGuideToastPubkeys.has(pubkey)
  }

  markCreateWalletGuideToastAsShown(pubkey: string) {
    if (this.shownCreateWalletGuideToastPubkeys.has(pubkey)) {
      return
    }
    this.shownCreateWalletGuideToastPubkeys.add(pubkey)
    window.localStorage.setItem(
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
    window.localStorage.setItem(StorageKey.DEFAULT_EXPIRATION_ENABLED, enabled.toString())
  }

  getDefaultExpirationMonths() {
    return this.defaultExpirationMonths
  }

  setDefaultExpirationMonths(months: number) {
    if (Number.isInteger(months) && months >= 0) {
      this.defaultExpirationMonths = months
      window.localStorage.setItem(StorageKey.DEFAULT_EXPIRATION_MONTHS, months.toString())
    }
  }

  // Quiet settings
  getDefaultQuietEnabled() {
    return this.defaultQuietEnabled
  }

  setDefaultQuietEnabled(enabled: boolean) {
    this.defaultQuietEnabled = enabled
    window.localStorage.setItem(StorageKey.DEFAULT_QUIET_ENABLED, enabled.toString())
  }

  getDefaultQuietDays() {
    return this.defaultQuietDays
  }

  setDefaultQuietDays(days: number) {
    if (Number.isInteger(days) && days >= 0) {
      this.defaultQuietDays = days
      window.localStorage.setItem(StorageKey.DEFAULT_QUIET_DAYS, days.toString())
    }
  }

  getRespectQuietTags() {
    return this.respectQuietTags
  }

  setRespectQuietTags(respect: boolean) {
    this.respectQuietTags = respect
    window.localStorage.setItem(StorageKey.RESPECT_QUIET_TAGS, respect.toString())
  }

  getGlobalQuietMode() {
    return this.globalQuietMode
  }

  setGlobalQuietMode(enabled: boolean) {
    this.globalQuietMode = enabled
    window.localStorage.setItem(StorageKey.GLOBAL_QUIET_MODE, enabled.toString())
  }

  getShowRssFeed() {
    return this.showRssFeed
  }

  setShowRssFeed(show: boolean) {
    this.showRssFeed = show
    window.localStorage.setItem(StorageKey.SHOW_RSS_FEED, show.toString())
  }

  getPanelMode(): 'single' | 'double' {
    return this.panelMode
  }

  setPanelMode(mode: 'single' | 'double') {
    this.panelMode = mode
    window.localStorage.setItem(StorageKey.PANE_MODE, mode)
  }
}

const instance = new LocalStorageService()
export default instance
