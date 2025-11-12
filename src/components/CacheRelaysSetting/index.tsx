import { Button } from '@/components/ui/button'
import { normalizeUrl, isLocalNetworkUrl } from '@/lib/url'
import logger from '@/lib/logger'
import { useNostr } from '@/providers/NostrProvider'
import { TMailboxRelay, TMailboxRelayScope } from '@/types'
import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import MailboxRelay from '../MailboxSetting/MailboxRelay'
import NewMailboxRelayInput from '../MailboxSetting/NewMailboxRelayInput'
import RelayCountWarning from '../MailboxSetting/RelayCountWarning'
import DiscoveredRelays from '../MailboxSetting/DiscoveredRelays'
import { createCacheRelaysDraftEvent } from '@/lib/draft-event'
import { getRelayListFromEvent } from '@/lib/event-metadata'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import { CloudUpload, Loader, Trash2, RefreshCw, Database, WrapText, Search, X, TriangleAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import indexedDb from '@/services/indexed-db.service'
import postEditorCache from '@/services/post-editor-cache.service'
import { StorageKey } from '@/constants'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { toast } from 'sonner'
import { Event } from 'nostr-tools'

export default function CacheRelaysSetting() {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { pubkey, cacheRelayListEvent, checkLogin, publish, updateCacheRelayListEvent } = useNostr()
  const [relays, setRelays] = useState<TMailboxRelay[]>([])
  const [hasChange, setHasChange] = useState(false)
  const [pushing, setPushing] = useState(false)
  const justSavedRef = useRef(false)
  const [cacheInfo, setCacheInfo] = useState<Record<string, number>>({})
  const [browsingCache, setBrowsingCache] = useState(false)
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [storeItems, setStoreItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [wordWrapEnabled, setWordWrapEnabled] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (active.id !== over?.id) {
      const oldIndex = relays.findIndex((relay) => relay.url === active.id)
      const newIndex = relays.findIndex((relay) => relay.url === over?.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        setRelays((relays) => arrayMove(relays, oldIndex, newIndex))
        setHasChange(true)
      }
    }
  }

  useEffect(() => {
    if (!cacheRelayListEvent) {
      setRelays([])
      setHasChange(false)
      return
    }

    const cacheRelayList = getRelayListFromEvent(cacheRelayListEvent)
    const newRelays = cacheRelayList.originalRelays
    
    // Use functional update to compare with current state
    setRelays((currentRelays) => {
      // Check if relays are actually different (deep comparison)
      const areRelaysEqual = 
        newRelays.length === currentRelays.length &&
        newRelays.every((relay, index) => 
          relay.url === currentRelays[index]?.url && 
          relay.scope === currentRelays[index]?.scope
        )
      
      // Only update and reset hasChange if relays actually changed AND we just saved
      // This prevents resetting hasChange when user is actively making changes
      if (!areRelaysEqual) {
        if (justSavedRef.current) {
          // We just saved, so this update is expected - reset hasChange
          justSavedRef.current = false
          setHasChange(false)
        }
        return newRelays
      }
      
      // If relays are equal, don't update state (prevents unnecessary re-render)
      return currentRelays
    })
  }, [cacheRelayListEvent])

  if (!pubkey) {
    return (
      <div className="flex flex-col w-full items-center">
        <Button size="lg" onClick={() => checkLogin()}>
          {t('Login to set')}
        </Button>
      </div>
    )
  }

  if (cacheRelayListEvent === undefined) {
    return <div className="text-center text-sm text-muted-foreground">{t('loading...')}</div>
  }

  const changeCacheRelayScope = (url: string, scope: TMailboxRelayScope) => {
    setRelays((prev) => prev.map((r) => (r.url === url ? { ...r, scope } : r)))
    setHasChange(true)
  }

  const removeCacheRelay = (url: string) => {
    setRelays((prev) => prev.filter((r) => r.url !== url))
    setHasChange(true)
  }

  const saveNewCacheRelay = (url: string) => {
    if (url === '') return null
    const normalizedUrl = normalizeUrl(url)
    if (!normalizedUrl) {
      return t('Invalid relay URL')
    }
    // Cache relays must be local network URLs only
    if (!isLocalNetworkUrl(normalizedUrl)) {
      return t('Cache relays must be local network URLs only (e.g., ws://localhost:4869 or ws://127.0.0.1:4869)')
    }
    if (relays.some((r) => r.url === normalizedUrl)) {
      return t('Relay already exists')
    }
    setRelays([...relays, { url: normalizedUrl, scope: 'both' }])
    setHasChange(true)
    return null
  }

  const handleAddDiscoveredRelays = (newRelays: TMailboxRelay[]) => {
    // Filter to only local network URLs for cache relays
    const localRelays = newRelays.filter(newRelay => isLocalNetworkUrl(newRelay.url))
    const relaysToAdd = localRelays.filter(
      newRelay => !relays.some(r => r.url === newRelay.url)
    )
    if (relaysToAdd.length > 0) {
      setRelays([...relays, ...relaysToAdd])
      setHasChange(true)
    }
  }

  useEffect(() => {
    // Load cache info on mount
    loadCacheInfo()
  }, [])

  const loadCacheInfo = async () => {
    try {
      const info = await indexedDb.getStoreInfo()
      setCacheInfo(info)
    } catch (error) {
      logger.error('Failed to load cache info', { error })
    }
  }

  const handleClearCache = async () => {
    if (!confirm(t('Are you sure you want to clear all cached data? This will delete all stored events and settings from your browser.'))) {
      return
    }

    try {
      // Clear IndexedDB
      await indexedDb.clearAllCache()
      
      // Clear localStorage (but keep essential settings like theme, accounts, etc.)
      // We'll only clear Jumble-specific cache keys, not all localStorage
      const cacheKeys = Object.values(StorageKey).filter(key => 
        key.includes('CACHE') || key.includes('EVENT') || key.includes('FEED') || key.includes('NOTIFICATION')
      )
      cacheKeys.forEach(key => {
        try {
          window.localStorage.removeItem(key)
        } catch (e) {
          logger.warn(`Failed to remove ${key} from localStorage`, e as Error)
        }
      })

      // Clear service worker caches
      if ('caches' in window) {
        const cacheNames = await caches.keys()
        await Promise.all(
          cacheNames
            .filter(name => name.includes('nostr') || name.includes('satellite') || name.includes('external'))
            .map(name => caches.delete(name))
        )
      }

      // Clear post editor cache
      postEditorCache.clearPostCache({})

      // Reload cache info
      await loadCacheInfo()
      
      toast.success(t('Cache cleared successfully'))
    } catch (error) {
      logger.error('Failed to clear cache', { error })
      toast.error(t('Failed to clear cache'))
    }
  }

  const handleRefreshCache = async () => {
    try {
      // Force database upgrade to update structure
      await indexedDb.forceDatabaseUpgrade()
      
      // Reload cache info
      await loadCacheInfo()
      
      toast.success(t('Cache refreshed successfully'))
    } catch (error) {
      logger.error('Failed to refresh cache', { error })
      toast.error(t('Failed to refresh cache'))
    }
  }

  const handleBrowseCache = () => {
    setBrowsingCache(true)
    setSelectedStore(null)
    setStoreItems([])
    setSearchQuery('')
    loadCacheInfo()
  }

  const handleStoreClick = async (storeName: string) => {
    setSelectedStore(storeName)
    setSearchQuery('')
    setLoadingItems(true)
    try {
      // For publication stores, use special method that only shows masters
      const items = storeName === 'publicationEvents'
        ? await indexedDb.getPublicationStoreItems(storeName)
        : await indexedDb.getStoreItems(storeName)
      setStoreItems(items)
    } catch (error) {
      logger.error('Failed to load store items', { error })
      toast.error(t('Failed to load store items'))
      setStoreItems([])
    } finally {
      setLoadingItems(false)
    }
  }

  const filteredStoreItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return storeItems
    }
    
    const query = searchQuery.toLowerCase().trim()
    return storeItems.filter(item => {
      // Search in key
      if (item.key?.toLowerCase().includes(query)) {
        return true
      }
      
      // Search in JSON content
      try {
        const jsonString = JSON.stringify(item.value)
        if (jsonString.toLowerCase().includes(query)) {
          return true
        }
      } catch (e) {
        // If JSON.stringify fails, skip
      }
      
      // Search in addedAt timestamp
      const dateString = new Date(item.addedAt).toLocaleString().toLowerCase()
      if (dateString.includes(query)) {
        return true
      }
      
      return false
    })
  }, [storeItems, searchQuery])

  const handleDeleteItem = async (key: string) => {
    if (!selectedStore) return
    
    try {
      // For publication stores, parse the key to get pubkey and d-tag
      if (selectedStore === 'publicationEvents') {
        // Key format is "pubkey" or "pubkey:d-tag"
        const parts = key.split(':')
        const pubkey = parts[0]
        const d = parts[1] || undefined
        const result = await indexedDb.deletePublicationAndNestedEvents(pubkey, d)
        toast.success(t('Deleted {{count}} event(s)', { count: result.deleted }))
      } else {
        await indexedDb.deleteStoreItem(selectedStore, key)
        toast.success(t('Item deleted successfully'))
      }
      
      // Reload items
      const items = selectedStore === 'publicationEvents'
        ? await indexedDb.getPublicationStoreItems(selectedStore)
        : await indexedDb.getStoreItems(selectedStore)
      setStoreItems(items)
      // Update cache info
      loadCacheInfo()
    } catch (error) {
      logger.error('Failed to delete item', { error })
      toast.error(t('Failed to delete item'))
    }
  }

  const handleDeleteAllItems = async () => {
    if (!selectedStore) return
    
    if (!confirm(t('Are you sure you want to delete all items from this store?'))) {
      return
    }
    
    try {
      await indexedDb.clearStore(selectedStore)
      setStoreItems([])
      // Update cache info
      loadCacheInfo()
      toast.success(t('All items deleted successfully'))
    } catch (error) {
      logger.error('Failed to delete all items', { error })
      toast.error(t('Failed to delete all items'))
    }
  }

  const handleCleanupDuplicates = async () => {
    if (!selectedStore) return
    
    if (!confirm(t('Clean up duplicate replaceable events? This will keep only the newest version of each event.'))) {
      return
    }
    
    setLoadingItems(true)
    try {
      const result = await indexedDb.cleanupDuplicateReplaceableEvents(selectedStore)
      // Reload items
      const items = await indexedDb.getStoreItems(selectedStore)
      setStoreItems(items)
      // Reset search query to show all items
      setSearchQuery('')
      // Update cache info
      loadCacheInfo()
      // Reload items to get accurate count after cleanup
      const itemsAfterCleanup = await indexedDb.getStoreItems(selectedStore)
      const actualCount = itemsAfterCleanup.length
      
      // Show message with actual count
      if (actualCount !== result.kept) {
        toast.success(t('Cleaned up {{deleted}} duplicate entries, kept {{kept}} (total items after cleanup: {{total}})', { 
          deleted: result.deleted, 
          kept: result.kept,
          total: actualCount
        }))
      } else {
        toast.success(t('Cleaned up {{deleted}} duplicate entries, kept {{kept}}', { deleted: result.deleted, kept: result.kept }))
      }
    } catch (error) {
      logger.error('Failed to cleanup duplicates', { error })
      if (error instanceof Error && error.message === 'Not a replaceable event store') {
        toast.error(t('This store does not contain replaceable events'))
      } else {
        toast.error(t('Failed to cleanup duplicates'))
      }
    } finally {
      setLoadingItems(false)
    }
  }

  // Check if an event is invalid
  const isInvalidEvent = useCallback((item: { key: string; value: any; addedAt: number }, storeName?: string | null): boolean => {
    if (!item) return true
    
    // RSS feed items are not Nostr events, so skip validation for that store
    // Handle both old format (with item property) and new format (with value property)
    if (storeName === 'rssFeedItems') {
      // Old format has item property, new format has value property - both are valid for RSS items
      if (item.value || (item as any).item) {
        return false
      }
      // If neither exists, it's invalid
      return true
    }
    
    // For other stores, check if value exists
    if (!item.value) return true
    
    const event = item.value as Event
    // Check for required Nostr event fields
    if (!event.pubkey || !event.kind || typeof event.created_at !== 'number') {
      return true
    }
    
    // Check for tags array (required for Nostr events)
    if (!event.tags || !Array.isArray(event.tags)) {
      return true
    }
    
    // Check for id and sig (these should be present in valid events)
    if (!event.id || !event.sig) {
      return true
    }
    
    return false
  }, [])

  // Get explanation for why an event is invalid
  const getInvalidEventExplanation = useCallback((item: { key: string; value: any; addedAt: number }): string => {
    if (!item || !item.value) {
      return t('Event has no value data')
    }
    
    const event = item.value as Event
    const missing: string[] = []
    
    if (!event.pubkey) missing.push(t('pubkey'))
    if (!event.kind) missing.push(t('kind'))
    if (typeof event.created_at !== 'number') missing.push(t('created_at'))
    if (!event.tags || !Array.isArray(event.tags)) missing.push(t('tags'))
    if (!event.id) missing.push(t('id'))
    if (!event.sig) missing.push(t('sig'))
    
    if (missing.length > 0) {
      return t('Event is missing required fields: {{fields}}', { fields: missing.join(', ') })
    }
    
    return t('Event appears to be invalid or corrupted')
  }, [t])

  const save = async () => {
    if (!pubkey) return

    setPushing(true)
    try {
      const event = createCacheRelaysDraftEvent(relays)
      const result = await publish(event)
      // Set flag before updating so useEffect knows to reset hasChange
      justSavedRef.current = true
      await updateCacheRelayListEvent(result)
      
      // Show publishing feedback
      if ((result as any).relayStatuses) {
        showPublishingFeedback({
          success: true,
          relayStatuses: (result as any).relayStatuses,
          successCount: (result as any).relayStatuses.filter((s: any) => s.success).length,
          totalCount: (result as any).relayStatuses.length
        }, {
          message: t('Cache relays saved'),
          duration: 6000
        })
      } else {
        showSimplePublishSuccess(t('Cache relays saved'))
      }
    } catch (error) {
      // Reset flag on error
      justSavedRef.current = false
      logger.error('Failed to save cache relays', { error })
      // Show error feedback
      if (error instanceof Error && (error as any).relayStatuses) {
        showPublishingFeedback({
          success: false,
          relayStatuses: (error as any).relayStatuses,
          successCount: (error as any).relayStatuses.filter((s: any) => s.success).length,
          totalCount: (error as any).relayStatuses.length
        }, {
          message: error.message || t('Failed to save cache relays'),
          duration: 6000
        })
      } else {
        showPublishingError(error instanceof Error ? error : new Error(t('Failed to save cache relays')))
      }
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Cache Relays Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">{t('Cache Relays')}</h3>
        <div className="text-xs text-muted-foreground space-y-1">
          <div>{t('Cache relays are used to store and retrieve events locally. These relays are merged with your inbox and outbox relays.')}</div>
        </div>
        <DiscoveredRelays onAdd={handleAddDiscoveredRelays} localOnly={true} />
        <RelayCountWarning relays={relays} />
        <Button className="w-full" disabled={!pubkey || pushing || !hasChange} onClick={save}>
          {pushing ? <Loader className="animate-spin" /> : <CloudUpload />}
          {t('Save')}
        </Button>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext items={relays.map((r) => r.url)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {relays.map((relay) => (
                <MailboxRelay
                  key={relay.url}
                  mailboxRelay={relay}
                  changeMailboxRelayScope={changeCacheRelayScope}
                  removeMailboxRelay={removeCacheRelay}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <NewMailboxRelayInput saveNewMailboxRelay={saveNewCacheRelay} />
      </div>

      {/* In-Browser Cache Section */}
      <div className="space-y-4 border-t pt-4">
        <h3 className="text-sm font-semibold">{t('In-Browser Cache')}</h3>
        <div className="text-xs text-muted-foreground space-y-1">
          <div>{t('Clear cached data stored in your browser, including IndexedDB events, localStorage settings, and service worker caches.')}</div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1 w-full sm:w-auto"
            onClick={handleClearCache}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('Clear Cache')}
          </Button>
          <Button
            variant="outline"
            className="flex-1 w-full sm:w-auto"
            onClick={handleRefreshCache}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('Refresh Cache')}
          </Button>
          <Button
            variant="outline"
            className="flex-1 w-full sm:w-auto"
            onClick={handleBrowseCache}
          >
            <Database className="h-4 w-4 mr-2" />
            {t('Browse Cache')}
          </Button>
        </div>
        {Object.keys(cacheInfo).length > 0 && (
          <div className="text-xs text-muted-foreground space-y-1 mt-2">
            <div className="font-semibold">{t('Cache Statistics:')}</div>
            {Object.entries(cacheInfo).map(([storeName, count]) => (
              <div key={storeName}>
                {storeName}: {count} {t('items')}
              </div>
            ))}
          </div>
        )}
      </div>

      {isSmallScreen ? (
        <Drawer open={browsingCache} onOpenChange={setBrowsingCache}>
          <DrawerContent className="max-h-[90vh]">
            <DrawerHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <DrawerTitle>
                    {selectedStore ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedStore(null)
                            setStoreItems([])
                          }}
                        >
                          ← {t('Back')}
                        </Button>
                        {selectedStore}
                      </div>
                    ) : (
                      t('Browse Cache')
                    )}
                  </DrawerTitle>
                  <DrawerDescription>
                    {selectedStore
                      ? t('View cached items in this store.')
                      : t('View details about cached data in IndexedDB stores. Click on a store to view its items.')}
                  </DrawerDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setWordWrapEnabled(!wordWrapEnabled)}
                  title={wordWrapEnabled ? t('Disable word wrap') : t('Enable word wrap')}
                >
                  <WrapText className={`h-4 w-4 ${wordWrapEnabled ? '' : 'opacity-50'}`} />
                </Button>
              </div>
            </DrawerHeader>
            <div className={`px-4 pb-4 space-y-4 overflow-y-auto ${wordWrapEnabled ? 'overflow-x-hidden break-words' : 'overflow-x-auto'}`}>
              {!selectedStore ? (
                // Store list view
                Object.keys(cacheInfo).length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t('No cached data found.')}</div>
                ) : (
                  Object.entries(cacheInfo).map(([storeName, count]) => (
                    <div
                      key={storeName}
                      className="border rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleStoreClick(storeName)}
                    >
                      <div className="font-semibold text-sm break-words">{storeName}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {count} {t('items')}
                      </div>
                    </div>
                  ))
                )
              ) : (
                // Store items view
                loadingItems ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader className="animate-spin h-6 w-6" />
                  </div>
                ) : (
                  <>
                    <div className="relative py-1">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="text"
                        placeholder={t('Search items...')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                    {storeItems.length === 0 ? (
                      <div className="text-sm text-muted-foreground">{t('No items in this store.')}</div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs text-muted-foreground">
                            {filteredStoreItems.length} {t('of')} {storeItems.length} {t('items')}
                            {searchQuery.trim() && ` ${t('matching')} "${searchQuery}"`}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCleanupDuplicates}
                              className="h-7 text-xs"
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              {t('Cleanup Duplicates')}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={handleDeleteAllItems}
                              className="h-7 text-xs"
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              {t('Delete All')}
                            </Button>
                          </div>
                        </div>
                        {filteredStoreItems.length === 0 ? (
                          <div className="text-sm text-muted-foreground">{t('No items match your search.')}</div>
                        ) : (
                          filteredStoreItems.map((item, index) => {
                            const nestedCount = (item as any).nestedCount
                            const invalid = isInvalidEvent(item, selectedStore)
                            const invalidExplanation = invalid ? getInvalidEventExplanation(item) : ''
                            return (
                              <div key={item.key || index} className="border rounded-lg p-3 break-words relative">
                                <div className="absolute top-2 right-2 flex items-center gap-1">
                                  {invalid && (
                                    <HoverCard>
                                      <HoverCardTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0 text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400"
                                          title={invalidExplanation}
                                        >
                                          <TriangleAlert className="h-3 w-3" />
                                        </Button>
                                      </HoverCardTrigger>
                                      <HoverCardContent className="w-80">
                                        <div className="space-y-2">
                                          <div className="font-semibold text-sm flex items-center gap-2">
                                            <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                                            {t('Invalid Event')}
                                          </div>
                                          <div className="text-sm text-muted-foreground">
                                            {invalidExplanation}
                                          </div>
                                        </div>
                                      </HoverCardContent>
                                    </HoverCard>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteItem(item.key)}
                                    className="h-6 w-6 p-0"
                                    title={t('Delete item')}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                                <div className={`font-semibold text-xs mb-2 break-all ${invalid ? 'pr-16' : 'pr-8'}`}>
                                  {item.key}
                                  {typeof nestedCount === 'number' && nestedCount > 0 && (
                                    <span className="ml-2 text-muted-foreground">
                                      ({nestedCount} {t('nested events')})
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground mb-2">
                                  {t('Added at')}: {new Date(item.addedAt).toLocaleString()}
                                </div>
                                <pre className={`text-xs bg-muted p-2 rounded overflow-auto max-h-96 select-text ${wordWrapEnabled ? 'overflow-x-hidden whitespace-pre-wrap break-words' : 'overflow-x-auto whitespace-pre'}`}>
                                  {JSON.stringify(item.value, null, 2)}
                                </pre>
                              </div>
                            )
                          })
                        )}
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={browsingCache} onOpenChange={setBrowsingCache}>
          <DialogContent className="max-w-[1000px] max-h-[1000px] overflow-y-auto overflow-x-hidden">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <DialogTitle>
                    {selectedStore ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedStore(null)
                            setStoreItems([])
                          }}
                        >
                          ← {t('Back')}
                        </Button>
                        {selectedStore}
                      </div>
                    ) : (
                      t('Browse Cache')
                    )}
                  </DialogTitle>
                  <DialogDescription>
                    {selectedStore
                      ? t('View cached items in this store.')
                      : t('View details about cached data in IndexedDB stores. Click on a store to view its items.')}
                  </DialogDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setWordWrapEnabled(!wordWrapEnabled)}
                  title={wordWrapEnabled ? t('Disable word wrap') : t('Enable word wrap')}
                >
                  <WrapText className={`h-4 w-4 ${wordWrapEnabled ? '' : 'opacity-50'}`} />
                </Button>
              </div>
            </DialogHeader>
            <div className={`space-y-4 ${wordWrapEnabled ? 'overflow-x-hidden break-words' : 'overflow-x-auto'}`}>
              {!selectedStore ? (
                // Store list view
                Object.keys(cacheInfo).length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t('No cached data found.')}</div>
                ) : (
                  Object.entries(cacheInfo).map(([storeName, count]) => (
                    <div
                      key={storeName}
                      className="border rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleStoreClick(storeName)}
                    >
                      <div className="font-semibold text-sm break-words">{storeName}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {count} {t('items')}
                      </div>
                    </div>
                  ))
                )
              ) : (
                // Store items view
                <>
                  {loadingItems ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader className="animate-spin h-6 w-6" />
                    </div>
                  ) : (
                    <>
                      <div className="relative py-1">
                        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder={t('Search items...')}
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-8"
                        />
                      </div>
                      {storeItems.length === 0 ? (
                        <div className="text-sm text-muted-foreground">{t('No items in this store.')}</div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs text-muted-foreground">
                              {filteredStoreItems.length} {t('of')} {storeItems.length} {t('items')}
                              {searchQuery.trim() && ` ${t('matching')} "${searchQuery}"`}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCleanupDuplicates}
                                className="h-7 text-xs"
                              >
                                <RefreshCw className="h-3 w-3 mr-1" />
                                {t('Cleanup Duplicates')}
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleDeleteAllItems}
                                className="h-7 text-xs"
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                {t('Delete All')}
                              </Button>
                            </div>
                          </div>
                          {filteredStoreItems.length === 0 ? (
                            <div className="text-sm text-muted-foreground">{t('No items match your search.')}</div>
                          ) : (
                            filteredStoreItems.map((item, index) => {
                              const nestedCount = (item as any).nestedCount
                              const invalid = isInvalidEvent(item, selectedStore)
                              const invalidExplanation = invalid ? getInvalidEventExplanation(item) : ''
                              return (
                                <div key={item.key || index} className="border rounded-lg p-3 break-words relative">
                                  <div className="absolute top-2 right-2 flex items-center gap-1">
                                    {invalid && (
                                      <HoverCard>
                                        <HoverCardTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400"
                                            title={invalidExplanation}
                                          >
                                            <TriangleAlert className="h-3 w-3" />
                                          </Button>
                                        </HoverCardTrigger>
                                        <HoverCardContent className="w-80">
                                          <div className="space-y-2">
                                            <div className="font-semibold text-sm flex items-center gap-2">
                                              <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                                              {t('Invalid Event')}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                              {invalidExplanation}
                                            </div>
                                          </div>
                                        </HoverCardContent>
                                      </HoverCard>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteItem(item.key)}
                                      className="h-6 w-6 p-0"
                                      title={t('Delete item')}
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  <div className={`font-semibold text-xs mb-2 break-all ${invalid ? 'pr-16' : 'pr-8'}`}>
                                    {item.key}
                                    {typeof nestedCount === 'number' && nestedCount > 0 && (
                                      <span className="ml-2 text-muted-foreground">
                                        ({nestedCount} {t('nested events')})
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground mb-2">
                                    {t('Added at')}: {new Date(item.addedAt).toLocaleString()}
                                  </div>
                                  <pre className={`text-xs bg-muted p-2 rounded overflow-auto max-h-96 select-text ${wordWrapEnabled ? 'overflow-x-hidden whitespace-pre-wrap break-words' : 'overflow-x-auto whitespace-pre'}`}>
                                    {JSON.stringify(item.value, null, 2)}
                                  </pre>
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

