import { simplifyUrl, isLocalNetworkUrl, normalizeUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNostr } from '@/providers/NostrProvider'
import { getRelayListFromEvent } from '@/lib/event-metadata'
import indexedDb from '@/services/indexed-db.service'
import { ExtendedKind } from '@/constants'
import { Check, ChevronDown, Server } from 'lucide-react'
import { NostrEvent } from 'nostr-tools'
import { Dispatch, SetStateAction, useCallback, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'
import relaySelectionService from '@/services/relay-selection.service'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import logger from '@/lib/logger'

export default function PostRelaySelector({
  parentEvent: _parentEvent,
  openFrom,
  setIsProtectedEvent,
  setAdditionalRelayUrls,
  content: postContent = '',
  isPublicMessage = false,
  mentions = []
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
  const { isSmallScreen } = useScreenSize()
  useCurrentRelays() // Keep this hook call for any side effects
  const { relaySets, favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { pubkey, relayList } = useNostr()
  const [selectedRelayUrls, setSelectedRelayUrls] = useState<string[]>([])
  const [selectableRelays, setSelectableRelays] = useState<string[]>([])
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

  // Memoize arrays to prevent unnecessary re-renders
  const memoizedFavoriteRelays = useMemo(() => favoriteRelays, [favoriteRelays])
  const memoizedBlockedRelays = useMemo(() => blockedRelays, [blockedRelays])
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
        setPreviousSelectableCount(newSelectableCount)
        
        // Only update selected relays if:
        // 1. User hasn't manually modified them, OR
        // 2. Selectable relays changed
        if (!hasManualSelection || selectableRelaysChanged) {
          // Ensure cache relays are included by default (but user can uncheck them)
          const cacheRelays = result.selectableRelays.filter(url => isLocalNetworkUrl(url))
          const selectedWithCache = Array.from(new Set([...result.selectedRelays, ...cacheRelays]))
          setSelectedRelayUrls(selectedWithCache)
          setDescription(result.description)
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
          setDescription('No relays selected')
        }
      } finally {
        setIsLoading(false)
      }
    }

    updateRelaySelection()
  }, [memoizedOpenFrom, _parentEvent, memoizedFavoriteRelays, memoizedBlockedRelays, memoizedRelaySets, isPublicMessage, pubkey, relayList, isDiscussionReply, postContent, mentions])

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
          setPreviousSelectableCount(newSelectableCount)
          
          // Only update selected relays if:
          // 1. User hasn't manually modified them, OR
          // 2. Selectable relays changed
          if (!hasManualSelection || selectableRelaysChanged) {
            // Ensure cache relays are included by default (but user can uncheck them)
            const cacheRelays = result.selectableRelays.filter(url => isLocalNetworkUrl(url))
            const selectedWithCache = Array.from(new Set([...result.selectedRelays, ...cacheRelays]))
            setSelectedRelayUrls(selectedWithCache)
            setDescription(result.description)
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
  }, [mentions, isDiscussionReply, memoizedFavoriteRelays, memoizedBlockedRelays, memoizedRelaySets, _parentEvent, isPublicMessage, pubkey, relayList, memoizedOpenFrom, previousSelectableCount, hasManualSelection, postContent])

  // Update description when selected relays change due to manual selection
  useEffect(() => {
    if (hasManualSelection && !isLoading) {
      const count = selectedRelayUrls.length
      setDescription(count === 0 ? 'No relays selected' : count === 1 ? simplifyUrl(selectedRelayUrls[0]) : `${count} relays`)
    }
  }, [selectedRelayUrls, hasManualSelection, isLoading])

  // Update parent component with selected relays
  useEffect(() => {
    // An event is "protected" if we have selected relays that aren't the default user write relays
    const userWriteRelays = relayList?.write || []
    const isProtectedEvent = selectedRelayUrls.length > 0 && !selectedRelayUrls.every(url => userWriteRelays.includes(url))
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
            onClick={handleSelectAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('Select All')}
          </button>
          <button
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
              return (
                <div
                  key={url}
                  className="flex items-center gap-2 p-2 hover:bg-accent rounded cursor-pointer touch-manipulation"
                  onClick={() => handleRelayCheckedChange(!isChecked, url)}
                >
                  <div className="flex items-center justify-center w-4 h-4 border border-border rounded">
                    {isChecked && <Check className="w-3 h-3" />}
                  </div>
                  <RelayIcon url={url} className="w-4 h-4" />
                  <span className="text-sm flex-1 truncate">{simplifyUrl(url)}</span>
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

  if (isSmallScreen) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('Post to')}</span>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
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
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-lg font-medium">{t('Select relays')}</span>
                  <span className="text-sm text-muted-foreground truncate">{description}</span>
                </div>
              </div>
              <ScrollArea className="flex-1 p-4">
                {content}
              </ScrollArea>
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
            className="h-8 px-3 text-xs justify-between min-w-0 flex-1"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Server className="w-3 h-3 shrink-0" />
              <span className="truncate">{triggerText}</span>
            </div>
            <ChevronDown className="w-3 h-3 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[90vw] max-w-md p-0 max-h-[40vh] flex flex-col" align="start" side="bottom" sideOffset={8}>
          <div className="p-3 border-b flex items-center justify-between shrink-0">
            <span className="text-sm font-medium">{t('Select relays')}</span>
            <span className="text-xs text-muted-foreground truncate ml-2">{description}</span>
          </div>
          <ScrollArea className="p-3 max-h-[30vh]">
            {content}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}