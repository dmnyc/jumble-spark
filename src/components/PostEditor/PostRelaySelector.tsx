import {
  ExtendedKind,
  isSocialKindBlockedKind,
  MAX_PUBLISH_RELAYS,
  READ_ONLY_RELAY_URLS,
  SOCIAL_KIND_BLOCKED_RELAY_URLS
} from '@/constants'
import { NOSTR_URI_FOR_REPLY_PUBKEYS_REGEX } from '@/lib/content-patterns'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { simplifyUrl, isLocalNetworkUrl, normalizeAnyRelayUrl, normalizeHttpRelayUrl, normalizeUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNostr } from '@/providers/NostrProvider'
import { getRelayListFromEvent } from '@/lib/event-metadata'
import indexedDb from '@/services/indexed-db.service'
import { Check, ChevronDown, Server } from 'lucide-react'
import { NostrEvent } from 'nostr-tools'
import { Dispatch, SetStateAction, useCallback, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'
import relaySelectionService, { type RelaySourceType } from '@/services/relay-selection.service'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import logger from '@/lib/logger'

/** Stable default when `mentions` is omitted — inline `= []` is a new array every render and retriggers effects. */
const NO_MENTIONS: string[] = []

export default function PostRelaySelector({
  parentEvent: _parentEvent,
  openFrom,
  setIsProtectedEvent,
  setAdditionalRelayUrls,
  content: postContent = '',
  isPublicMessage = false,
  mentions = NO_MENTIONS
}: {
  parentEvent?: NostrEvent
  openFrom?: string[]
  setIsProtectedEvent: Dispatch<SetStateAction<boolean>>
  setAdditionalRelayUrls: Dispatch<SetStateAction<string[]>>
  content?: string
  isPublicMessage?: boolean
  mentions?: string[]
}) {
  const { t } = useTranslation()
  /** Subtitle + trigger must match {@link selectedRelayUrls} (service description ignored: cache relays are merged in after). */
  const describeRelaySelection = useCallback(
    (urls: string[]) => {
      const n = urls.length
      if (n === 0) return t('No relays selected')
      if (n === 1) return simplifyUrl(urls[0])
      return t('{{count}} relays', { count: n })
    },
    [t]
  )
  const { isSmallScreen } = useScreenSize()
  useCurrentRelays() // Keep this hook call for any side effects
  const { relaySets, favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { pubkey, relayList } = useNostr()
  const [selectedRelayUrls, setSelectedRelayUrls] = useState<string[]>([])
  const [selectableRelays, setSelectableRelays] = useState<string[]>([])
  const [relayTypes, setRelayTypes] = useState<Record<string, RelaySourceType>>({})
  const [description, setDescription] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [hasManualSelection, setHasManualSelection] = useState(false)
  const [previousSelectableCount, setPreviousSelectableCount] = useState(0)
  const [previousMentions, setPreviousMentions] = useState<string[]>([])

  // Initialize previousMentions with the initial mentions value
  useEffect(() => {
    setPreviousMentions(mentions)
  }, []) // Only run once on mount

  // For discussion replies, content doesn't affect relay selection
  // Check if this is a reply to a discussion by looking for "K" tag with "11"
  const isDiscussionReply = useMemo(() => {
    if (!_parentEvent) return false
    
    // Direct reply to discussion
    if (_parentEvent.kind === 11) return true
    
    // Check if parent event has "K" tag containing "11" (discussion root kind)
    const eventTags = _parentEvent.tags || []
    const kindTag = eventTags.find(([tagName]) => tagName === 'K')
    if (kindTag && kindTag[1] === '11') {
      return true
    }
    
    return false
  }, [_parentEvent])

  /**
   * Same merge order as {@link ClientService.publishEvent}: NIP-65 write list first, then relays checked here,
   * then cap at {@link MAX_PUBLISH_RELAYS}. Drives the cap hint so users see reserved “prepended” slots.
   */
  const publishCapPreview = useMemo(() => {
    const applySocialOutboxFilter =
      !isPublicMessage &&
      (_parentEvent == null ||
        isDiscussionReply ||
        (_parentEvent != null && isSocialKindBlockedKind(_parentEvent.kind)))

    const wsOut = (relayList?.write ?? [])
      .map((u) => normalizeUrl(u) || u)
      .filter((u): u is string => !!u)
    const httpOut = (relayList?.httpWrite ?? [])
      .map((u) => normalizeHttpRelayUrl(u) || u)
      .filter((u): u is string => !!u)
    let outbox = dedupeNormalizeRelayUrlsOrdered([...httpOut, ...wsOut])
    const readOnlySet = new Set(READ_ONLY_RELAY_URLS.map((u) => normalizeAnyRelayUrl(u) || u))
    const socialBlockedSet = new Set(SOCIAL_KIND_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
    outbox = dedupeNormalizeRelayUrlsOrdered(
      outbox.filter((url) => {
        const n = normalizeAnyRelayUrl(url) || url
        if (readOnlySet.has(n)) return false
        if (applySocialOutboxFilter && socialBlockedSet.has(n)) return false
        return true
      })
    )

    const merged = dedupeNormalizeRelayUrlsOrdered([...outbox, ...selectedRelayUrls])
    const capped = merged.slice(0, MAX_PUBLISH_RELAYS)
    const outboxNormSet = new Set(outbox)
    const outboxSlotsInPublish = capped.filter((u) => outboxNormSet.has(u)).length
    const selectedNorm = selectedRelayUrls.map((u) => normalizeAnyRelayUrl(u) || u)
    const selectedContacted = selectedNorm.filter((u) => capped.includes(u)).length

    const showCapHint =
      merged.length > MAX_PUBLISH_RELAYS ||
      selectedRelayUrls.length >= MAX_PUBLISH_RELAYS ||
      selectedContacted < selectedRelayUrls.length

    return {
      outboxSlotsInPublish,
      selectedContacted,
      selectedTotal: selectedRelayUrls.length,
      showCapHint
    }
  }, [
    relayList?.write,
    relayList?.httpWrite,
    selectedRelayUrls,
    isPublicMessage,
    _parentEvent,
    isDiscussionReply
  ])

  /**
   * Relay selection only cares about nostr:… mentions in the draft (see relay-selection.service).
   * Depending on full `postContent` re-ran the heavy relay effect on every keystroke.
   */
  const contentRelaySignature = useMemo(() => {
    if (isDiscussionReply) return ''
    if (isPublicMessage && mentions.length > 0) {
      // PM recipients come from `mentions` when set; content is ignored by selection service
      return ''
    }
    const matches = [...postContent.matchAll(NOSTR_URI_FOR_REPLY_PUBKEYS_REGEX)].map((m) => m[0])
    if (!matches.length) return ''
    return [...new Set(matches)].sort().join('\n')
  }, [postContent, isDiscussionReply, isPublicMessage, mentions])

  // Memoize arrays to prevent unnecessary re-renders
  const memoizedFavoriteRelays = useMemo(() => favoriteRelays, [favoriteRelays])
  const memoizedBlockedRelays = useMemo(() => {
    // Top-level compose or reply under a social thread: also block SOCIAL_KIND_BLOCKED_RELAY_URLS in the picker.
    const isSocialPublish =
      !isPublicMessage &&
      (_parentEvent == null ||
        isDiscussionReply ||
        isSocialKindBlockedKind(_parentEvent.kind))
    return isSocialPublish
      ? [...blockedRelays, ...SOCIAL_KIND_BLOCKED_RELAY_URLS]
      : blockedRelays
  }, [blockedRelays, isPublicMessage, _parentEvent, isDiscussionReply])
  const memoizedRelaySets = useMemo(() => relaySets, [relaySets])
  const memoizedOpenFrom = useMemo(() => openFrom, [openFrom])

  // Use centralized relay selection service - only for non-content dependencies
  useEffect(() => {
    const updateRelaySelection = async () => {
      setIsLoading(true)
      try {
        // Ensure cache relays (kind 10432) are included in userWriteRelays even if relayList hasn't been updated yet
        // Get cache relays directly from IndexedDB (don't fetch new every time)
        let userWriteRelays = relayList?.write || []
        if (pubkey) {
          try {
            const cacheRelayListEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)
            if (cacheRelayListEvent) {
              const cacheRelayList = getRelayListFromEvent(cacheRelayListEvent)
              // Get all cache relays (they should all be local network URLs)
              // Include both write and both-scoped relays (cache relays should be write-capable)
              const cacheRelays = [
                ...cacheRelayList.write,
                ...cacheRelayList.originalRelays
                  .filter(relay => (relay.scope === 'both' || relay.scope === 'write') && isLocalNetworkUrl(relay.url))
                  .map(relay => relay.url)
              ].filter(url => {
                // Filter out invalid/empty URLs
                if (!url || typeof url !== 'string' || url.trim() === '' || url === 'ws://' || url === 'wss://') return false
                return isLocalNetworkUrl(url)
              })
              const existingUrls = new Set(userWriteRelays.map(url => normalizeUrl(url) || url))
              const newCacheRelays = cacheRelays
                .map(url => normalizeUrl(url) || url)
                .filter((url): url is string => !!url && !existingUrls.has(url))
              if (newCacheRelays.length > 0) {
                userWriteRelays = [...newCacheRelays, ...userWriteRelays]
              }
            }
          } catch (error) {
            logger.warn('Failed to get cache relays from IndexedDB', { error, pubkey })
          }
        }
        
        const result = await relaySelectionService.selectRelays({
          userWriteRelays,
          userHttpWriteRelays: relayList?.httpWrite ?? [],
          userReadRelays: relayList?.read || [],
          favoriteRelays: memoizedFavoriteRelays,
          blockedRelays: memoizedBlockedRelays,
          relaySets: memoizedRelaySets,
          parentEvent: _parentEvent,
          isPublicMessage,
          content: isDiscussionReply ? '' : postContent, // Don't use content for discussion replies
          mentions: isPublicMessage ? mentions : undefined, // Pass mentions for PMs
          userPubkey: pubkey || undefined,
          openFrom: memoizedOpenFrom
        })

        const newSelectableCount = result.selectableRelays.length
        const selectableRelaysChanged = newSelectableCount !== previousSelectableCount
        
        setSelectableRelays(result.selectableRelays)
        setRelayTypes(result.relayTypes ?? {})
        setPreviousSelectableCount(newSelectableCount)
        
        // Only update selected relays if:
        // 1. User hasn't manually modified them, OR
        // 2. Selectable relays changed
        if (!hasManualSelection || selectableRelaysChanged) {
          // Ensure cache relays are included by default (but user can uncheck them)
          const cacheRelays = result.selectableRelays.filter(url => isLocalNetworkUrl(url))
          const selectedWithCache = Array.from(new Set([...result.selectedRelays, ...cacheRelays]))
          setSelectedRelayUrls(selectedWithCache)
          setDescription(describeRelaySelection(selectedWithCache))
          // Reset manual selection flag if relays changed
          if (selectableRelaysChanged && hasManualSelection) {
            setHasManualSelection(false)
          }
        }
        
    } catch (error) {
      logger.error('Failed to update relay selection', { error })
        setSelectableRelays([])
        if (!hasManualSelection) {
          setSelectedRelayUrls([])
          setDescription(t('No relays selected'))
        }
      } finally {
        setIsLoading(false)
      }
    }

    updateRelaySelection()
  }, [
    memoizedOpenFrom,
    _parentEvent,
    memoizedFavoriteRelays,
    memoizedBlockedRelays,
    memoizedRelaySets,
    isPublicMessage,
    pubkey,
    relayList,
    isDiscussionReply,
    contentRelaySignature,
    mentions,
    describeRelaySelection,
    t
  ])

  // Separate effect for mention changes in non-discussion replies
  useEffect(() => {
    if (isDiscussionReply) return // Skip for discussion replies
    
    const mentionsChanged = JSON.stringify(mentions) !== JSON.stringify(previousMentions)
    
    if (mentionsChanged) {
      setPreviousMentions(mentions)
      
      // Update relay selection when mentions change
      const updateRelaySelection = async () => {
        setIsLoading(true)
        try {
          // Ensure cache relays (kind 10432) are included in userWriteRelays even if relayList hasn't been updated yet
          // Get cache relays directly from IndexedDB (don't fetch new every time)
          let userWriteRelays = relayList?.write || []
          if (pubkey) {
            try {
              const cacheRelayListEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)
              if (cacheRelayListEvent) {
                const cacheRelayList = getRelayListFromEvent(cacheRelayListEvent)
                // Get all cache relays (they should all be local network URLs)
                // Include both write and both-scoped relays (cache relays should be write-capable)
                const cacheRelays = [
                  ...cacheRelayList.write,
                  ...cacheRelayList.originalRelays
                    .filter(relay => (relay.scope === 'both' || relay.scope === 'write') && isLocalNetworkUrl(relay.url))
                    .map(relay => relay.url)
                ].filter(url => isLocalNetworkUrl(url))
                const existingUrls = new Set(userWriteRelays.map(url => normalizeUrl(url) || url))
                const newCacheRelays = cacheRelays
                  .map(url => normalizeUrl(url) || url)
                  .filter((url): url is string => !!url && !existingUrls.has(url))
                if (newCacheRelays.length > 0) {
                  userWriteRelays = [...newCacheRelays, ...userWriteRelays]
                }
              }
            } catch (error) {
              logger.warn('Failed to get cache relays from IndexedDB', { error, pubkey })
            }
          }
          
          const result = await relaySelectionService.selectRelays({
            userWriteRelays,
            userHttpWriteRelays: relayList?.httpWrite ?? [],
            userReadRelays: relayList?.read || [],
            favoriteRelays: memoizedFavoriteRelays,
            blockedRelays: memoizedBlockedRelays,
            relaySets: memoizedRelaySets,
            parentEvent: _parentEvent,
            isPublicMessage,
            content: isDiscussionReply ? '' : postContent, // Don't use content for discussion replies
            mentions: isPublicMessage ? mentions : undefined, // Pass mentions for PMs
            userPubkey: pubkey || undefined,
            openFrom: memoizedOpenFrom
          })

          const newSelectableCount = result.selectableRelays.length
          const selectableRelaysChanged = newSelectableCount !== previousSelectableCount
          
          setSelectableRelays(result.selectableRelays)
          setRelayTypes(result.relayTypes ?? {})
          setPreviousSelectableCount(newSelectableCount)
          
          // Only update selected relays if:
          // 1. User hasn't manually modified them, OR
          // 2. Selectable relays changed
          if (!hasManualSelection || selectableRelaysChanged) {
            // Ensure cache relays are included by default (but user can uncheck them)
            const cacheRelays = result.selectableRelays.filter(url => isLocalNetworkUrl(url))
            const selectedWithCache = Array.from(new Set([...result.selectedRelays, ...cacheRelays]))
            setSelectedRelayUrls(selectedWithCache)
            setDescription(describeRelaySelection(selectedWithCache))
            // Reset manual selection flag if relays changed
            if (selectableRelaysChanged && hasManualSelection) {
              setHasManualSelection(false)
            }
          }
          
            } catch (error) {
              logger.error('Failed to update relay selection', { error })
        } finally {
          setIsLoading(false)
        }
      }
      
      updateRelaySelection()
    }
  }, [
    mentions,
    isDiscussionReply,
    memoizedFavoriteRelays,
    memoizedBlockedRelays,
    memoizedRelaySets,
    _parentEvent,
    isPublicMessage,
    pubkey,
    relayList,
    memoizedOpenFrom,
    previousSelectableCount,
    hasManualSelection,
    describeRelaySelection
  ])

  // Update description when selected relays change due to manual selection
  useEffect(() => {
    if (hasManualSelection && !isLoading) {
      setDescription(describeRelaySelection(selectedRelayUrls))
    }
  }, [selectedRelayUrls, hasManualSelection, isLoading, describeRelaySelection])

  // Update parent component with selected relays
  useEffect(() => {
    // An event is "protected" if we have selected relays that aren't the default user write relays
    const defaultUserWriteRelays = [...(relayList?.httpWrite ?? []), ...(relayList?.write || [])]
    const normW = (u: string) => normalizeAnyRelayUrl(u) || u
    const defaultNorm = new Set(defaultUserWriteRelays.map(normW))
    const isProtectedEvent =
      selectedRelayUrls.length > 0 &&
      !selectedRelayUrls.every((url) => defaultNorm.has(normW(url)))
    setIsProtectedEvent(isProtectedEvent)
    setAdditionalRelayUrls(selectedRelayUrls)
  }, [selectedRelayUrls, relayList, setIsProtectedEvent, setAdditionalRelayUrls])

  const handleRelayCheckedChange = useCallback((checked: boolean, url: string) => {
    setHasManualSelection(true)
    if (checked) {
      setSelectedRelayUrls(prev => [...prev, url])
    } else {
      setSelectedRelayUrls(prev => prev.filter(u => u !== url))
    }
  }, [])

  const handleSelectAll = useCallback(() => {
    setHasManualSelection(true)
    setSelectedRelayUrls([...selectableRelays])
  }, [selectableRelays])

  const handleClearAll = useCallback(() => {
    setHasManualSelection(true)
    setSelectedRelayUrls([])
  }, [])

  const content = (
    <>
      {selectableRelays.length > 0 && (
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            title={t('Select All')}
            onClick={handleSelectAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('Select All')}
          </button>
          <button
            type="button"
            title={t('Clear All')}
            onClick={handleClearAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('Clear All')}
          </button>
        </div>
      )}
      
      {isLoading ? (
        <div className="text-sm text-muted-foreground p-2">{t('Loading relays...')}</div>
      ) : selectableRelays.length === 0 ? (
        <div className="text-sm text-muted-foreground p-2">{t('No relays available')}</div>
      ) : (
        <div className="space-y-1">
          {(() => {
            // Sort relays so selected ones appear at the top
            const sortedRelays = [...selectableRelays].sort((a, b) => {
              const aSelected = selectedRelayUrls.includes(a)
              const bSelected = selectedRelayUrls.includes(b)
              if (aSelected && !bSelected) return -1
              if (!aSelected && bSelected) return 1
              return 0
            })
            
            return sortedRelays.map((url) => {
              const isChecked = selectedRelayUrls.includes(url)
              const sourceType = relayTypes[url]
              const typeLabel = sourceType ? t(`relayType_${sourceType}`) : ''
              return (
                <div
                  key={url}
                  className="flex items-center gap-2 p-2 hover:bg-accent rounded cursor-pointer touch-manipulation"
                  onClick={() => handleRelayCheckedChange(!isChecked, url)}
                >
                  <div className="flex items-center justify-center w-4 h-4 border border-border rounded shrink-0">
                    {isChecked && <Check className="w-3 h-3" />}
                  </div>
                  <RelayIcon url={url} className="w-4 h-4 shrink-0" />
                  <span className="text-sm flex-1 truncate min-w-0">{simplifyUrl(url)}</span>
                  {typeLabel && (
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {typeLabel}
                    </span>
                  )}
                </div>
              )
            })
          })()}
        </div>
      )}
    </>
  )

  // Create compact trigger button text
  const triggerText = useMemo(() => {
    if (isLoading) return t('Loading...')
    if (selectedRelayUrls.length === 0) return t('Select relays')
    if (selectedRelayUrls.length === 1) return simplifyUrl(selectedRelayUrls[0])
    return t('{{count}} relays', { count: selectedRelayUrls.length })
  }, [selectedRelayUrls, isLoading, t])

  const capHintEl =
    publishCapPreview.showCapHint &&
    (publishCapPreview.outboxSlotsInPublish > 0 ? (
      <span className="text-xs text-amber-600 dark:text-amber-500">
        {t('Publish relay cap hint with outbox first', {
          max: MAX_PUBLISH_RELAYS,
          reservedSlots: publishCapPreview.outboxSlotsInPublish,
          selected: publishCapPreview.selectedTotal,
          selectedContacted: publishCapPreview.selectedContacted
        })}
      </span>
    ) : (
      <span className="text-xs text-amber-600 dark:text-amber-500">
        {t('Publish relay cap hint', {
          max: MAX_PUBLISH_RELAYS,
          selected: publishCapPreview.selectedTotal,
          selectedContacted: publishCapPreview.selectedContacted
        })}
      </span>
    ))

  if (isSmallScreen) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('Post to')}</span>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              title={triggerText}
              className="h-8 px-3 text-xs justify-between min-w-0 flex-1"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Server className="w-3 h-3 shrink-0" />
                <span className="truncate">{triggerText}</span>
              </div>
              <ChevronDown className="w-3 h-3 shrink-0" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[60vh] p-0">
            <div className="flex flex-col h-full">
              <div className="p-4 border-b flex items-center justify-between shrink-0 pr-12">
                <div className="flex flex-col min-w-0 flex-1 gap-1">
                  <span className="text-lg font-medium">{t('Select relays')}</span>
                  <span className="text-sm text-muted-foreground truncate">{description}</span>
                  {capHintEl}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden p-4">
                {content}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">{t('Post to')}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            title={triggerText}
            className="h-8 px-3 text-xs justify-between min-w-0 flex-1"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Server className="w-3 h-3 shrink-0" />
              <span className="truncate">{triggerText}</span>
            </div>
            <ChevronDown className="w-3 h-3 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[90vw] max-w-md p-0 max-h-[40vh] flex flex-col overflow-hidden" align="start" side="bottom" sideOffset={8}>
          <div className="p-3 border-b flex flex-col gap-1 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{t('Select relays')}</span>
              <span className="text-xs text-muted-foreground truncate">{description}</span>
            </div>
            {capHintEl}
          </div>
          <div className="max-h-[35vh] min-h-0 overflow-y-scroll overflow-x-hidden p-3">
            {content}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}