import { Button } from '@/components/ui/button'
import logger from '@/lib/logger'
import { useNostr } from '@/providers/NostrProvider'
import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, RefreshCw, Database, WrapText, Search, X, TriangleAlert, Terminal, XCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import client from '@/services/client.service'
import indexedDb, { StoreNames } from '@/services/indexed-db.service'
import postEditorCache from '@/services/post-editor-cache.service'
import { StorageKey } from '@/constants'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { toast } from 'sonner'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { Event } from 'nostr-tools'

export default function InBrowserCacheSetting() {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const {
    pubkey,
    relayList,
    requestAccountNetworkHydrate
  } = useNostr()
  const [cacheInfo, setCacheInfo] = useState<Record<string, number>>({})
  const [browsingCache, setBrowsingCache] = useState(false)
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [storeItems, setStoreItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [wordWrapEnabled, setWordWrapEnabled] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [consoleLogs, setConsoleLogs] = useState<Array<{ type: string; message: string; formattedParts?: Array<{ text: string; style?: string }>; timestamp: number }>>([])
  const [showConsoleLogs, setShowConsoleLogs] = useState(false)
  const [consoleLogSearch, setConsoleLogSearch] = useState('')
  const [consoleLogLevel, setConsoleLogLevel] = useState<'errors-warnings' | 'all'>('all')
  const [cacheRefreshBusy, setCacheRefreshBusy] = useState(false)
  const consoleLogRef = useRef<Array<{ type: string; message: string; formattedParts?: Array<{ text: string; style?: string }>; timestamp: number }>>([])

  useEffect(() => {
    loadCacheInfo()
  }, [])

  const loadCacheInfo = async () => {
    try {
      const info = await indexedDb.getStoreInfo()
      setCacheInfo(info)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to load cache info', { error: message })
    }
  }

  const handleClearCache = async () => {
    if (!confirm(t('Are you sure you want to clear all cached data? This will delete all stored events and settings from your browser.'))) {
      return
    }

    try {
      await indexedDb.clearAllCache()
      await indexedDb.clearPiperTtsCache()

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

      if ('caches' in window) {
        try {
          const cacheNames = await caches.keys()
          const currentOrigin = window.location.origin

          const appCacheNames = [
            'nostr-images',
            'satellite-images',
            'external-images'
          ]

          const appCaches = cacheNames.filter(name => {
            if (appCacheNames.includes(name)) return true
            if (name.startsWith('workbox-') || name.startsWith('precache-')) return true
            if (name.includes(currentOrigin.replace(/https?:\/\//, '').split('/')[0])) return true
            return false
          })

          await Promise.all(appCaches.map(name => caches.delete(name).catch(error => {
            logger.warn(`Failed to delete cache: ${name}`, { error })
          })))
        } catch (error) {
          logger.warn('Failed to clear some service worker caches', { error })
        }
      }

      postEditorCache.clearAllPostCaches()
      client.clearInMemoryCaches()
      await loadCacheInfo()

      toast.success(t('Cache cleared successfully'))
      setTimeout(() => window.location.reload(), 1500)
    } catch (error) {
      logger.error('Failed to clear cache', { error })
      toast.error(t('Failed to clear cache'))
    }
  }

  const handleRefreshCache = async () => {
    try {
      setCacheRefreshBusy(true)
      await indexedDb.forceDatabaseUpgrade()
      await loadCacheInfo()
      if (pubkey) {
        await requestAccountNetworkHydrate()
        await syncUserDeletionTombstones(pubkey, relayList)
      }
      toast.success(t('Cache refreshed successfully'))
    } catch (error) {
      logger.error('Failed to refresh cache', { error })
      toast.error(t('Failed to refresh cache'))
    } finally {
      setCacheRefreshBusy(false)
    }
  }

  const handleBrowseCache = () => {
    setBrowsingCache(true)
    setSelectedStore(null)
    setStoreItems([])
    setSearchQuery('')
    loadCacheInfo()
  }

  const handleClearServiceWorker = async () => {
    if (!confirm(t('Are you sure you want to unregister the service worker? This will clear this app\'s service worker caches and you will need to reload the page.'))) {
      return
    }

    try {
      const currentOrigin = window.location.origin
      let unregisteredCount = 0
      let cacheClearedCount = 0

      if (window.isSecureContext && 'serviceWorker' in navigator) {
        let registrations: readonly ServiceWorkerRegistration[] = []
        try {
          registrations = await navigator.serviceWorker.getRegistrations()
        } catch (error) {
          logger.warn('Failed to get service worker registrations', { error })
        }

        if (registrations.length > 0) {
          const unregisterPromises = registrations.map(async (registration) => {
            try {
              const scope = registration.scope
              if (scope.startsWith(currentOrigin)) {
                const result = await registration.unregister()
                if (result) unregisteredCount++
                return result
              }
              return false
            } catch (error) {
              logger.warn('Failed to unregister a service worker', { error })
              return false
            }
          })
          await Promise.all(unregisterPromises)
        }
      }

      if ('caches' in window) {
        try {
          const cacheNames = await caches.keys()

          const appCacheNames = [
            'nostr-images',
            'satellite-images',
            'external-images'
          ]

          const appCaches = cacheNames.filter(name => {
            if (appCacheNames.includes(name)) return true
            if (name.startsWith('workbox-') || name.startsWith('precache-')) return true
            if (name.includes(currentOrigin.replace(/https?:\/\//, '').split('/')[0])) return true
            return false
          })

          await Promise.all(appCaches.map(name => {
            cacheClearedCount++
            return caches.delete(name).catch(error => {
              logger.warn(`Failed to delete cache: ${name}`, { error })
              cacheClearedCount--
            })
          }))
        } catch (error) {
          logger.warn('Failed to clear some caches', { error })
        }
      }

      if (unregisteredCount > 0 || cacheClearedCount > 0) {
        const message = unregisteredCount > 0 && cacheClearedCount > 0
          ? t('Service worker unregistered and caches cleared. Please reload the page.')
          : unregisteredCount > 0
          ? t('Service worker unregistered. Please reload the page.')
          : t('Service worker caches cleared. Please reload the page.')
        toast.success(message)
        setTimeout(() => window.location.reload(), 1000)
      } else {
        toast.info(t('No service workers or caches found for this app'))
      }
    } catch (error) {
      logger.error('Failed to unregister service worker', { error })
      toast.error(t('Failed to unregister service worker: ') + (error instanceof Error ? error.message : String(error)))
    }
  }

  useEffect(() => {
    const originalLog = console.log
    const originalError = console.error
    const originalWarn = console.warn
    const originalInfo = console.info

    const captureLog = (type: string, ...args: any[]) => {
      let message = ''
      let formattedParts: Array<{ text: string; style?: string }> = []

      if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('%c')) {
        const formatString = args[0]
        const parts = formatString.split(/%c/g)
        formattedParts = []

        for (let i = 0; i < parts.length; i++) {
          const text = parts[i]
          const style = i < args.length - 1 && typeof args[i + 1] === 'string' ? args[i + 1] : undefined
          formattedParts.push({ text, style })
        }

        const remainingArgs = args.slice(parts.length)
        if (remainingArgs.length > 0) {
          const remainingText = remainingArgs.map(arg => {
            if (typeof arg === 'object') {
              try { return JSON.stringify(arg, null, 2) } catch { return String(arg) }
            }
            return String(arg)
          }).join(' ')
          if (formattedParts.length > 0) {
            formattedParts[formattedParts.length - 1].text += ' ' + remainingText
          } else {
            formattedParts.push({ text: remainingText })
          }
        }

        message = formattedParts.map(p => p.text).join('')
      } else {
        message = args.map(arg => {
          if (typeof arg === 'object') {
            try { return JSON.stringify(arg, null, 2) } catch { return String(arg) }
          }
          return String(arg)
        }).join(' ')
        formattedParts = [{ text: message }]
      }

      const logEntry = { type, message, formattedParts, timestamp: Date.now() }
      consoleLogRef.current.push(logEntry)
      if (consoleLogRef.current.length > 1000) {
        consoleLogRef.current = consoleLogRef.current.slice(-1000)
      }
      if (showConsoleLogs) {
        setConsoleLogs([...consoleLogRef.current])
      }
    }

    console.log = (...args: any[]) => { captureLog('log', ...args); originalLog.apply(console, args) }
    console.error = (...args: any[]) => { captureLog('error', ...args); originalError.apply(console, args) }
    console.warn = (...args: any[]) => { captureLog('warn', ...args); originalWarn.apply(console, args) }
    console.info = (...args: any[]) => { captureLog('info', ...args); originalInfo.apply(console, args) }

    return () => {
      console.log = originalLog
      console.error = originalError
      console.warn = originalWarn
      console.info = originalInfo
    }
  }, [showConsoleLogs])

  const handleShowConsoleLogs = () => {
    setConsoleLogs([...consoleLogRef.current])
    setShowConsoleLogs(true)
    setConsoleLogSearch('')
    setConsoleLogLevel('all')
  }

  const handleClearConsoleLogs = () => {
    consoleLogRef.current = []
    setConsoleLogs([])
    toast.success(t('Console logs cleared'))
  }

  const filteredConsoleLogs = useMemo(() => {
    let filtered = [...consoleLogs]
    if (consoleLogLevel === 'errors-warnings') {
      filtered = filtered.filter(log => log.type === 'error' || log.type === 'warn')
    }
    if (consoleLogSearch.trim()) {
      const query = consoleLogSearch.toLowerCase().trim()
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(query) ||
        log.type.toLowerCase().includes(query)
      )
    }
    return filtered
  }, [consoleLogs, consoleLogSearch, consoleLogLevel])

  const handleStoreClick = async (storeName: string) => {
    setSelectedStore(storeName)
    setSearchQuery('')
    setLoadingItems(true)
    try {
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
    if (!searchQuery.trim()) return storeItems
    const query = searchQuery.toLowerCase().trim()
    return storeItems.filter(item => {
      if (item.key?.toLowerCase().includes(query)) return true
      try {
        if (JSON.stringify(item.value).toLowerCase().includes(query)) return true
      } catch (e) { /* skip */ }
      if (new Date(item.addedAt).toLocaleString().toLowerCase().includes(query)) return true
      return false
    })
  }, [storeItems, searchQuery])

  const handleDeleteItem = async (key: string) => {
    if (!selectedStore) return
    try {
      if (selectedStore === 'publicationEvents') {
        const parts = key.split(':')
        const pubkey = parts[0]
        const d = parts[1] || undefined
        const result = await indexedDb.deletePublicationAndNestedEvents(pubkey, d)
        toast.success(t('Deleted {{count}} event(s)', { count: result.deleted }))
      } else {
        await indexedDb.deleteStoreItem(selectedStore, key)
        toast.success(t('Item deleted successfully'))
      }
      const items = selectedStore === 'publicationEvents'
        ? await indexedDb.getPublicationStoreItems(selectedStore)
        : await indexedDb.getStoreItems(selectedStore)
      setStoreItems(items)
      loadCacheInfo()
    } catch (error) {
      logger.error('Failed to delete item', { error })
      toast.error(t('Failed to delete item'))
    }
  }

  const handleDeleteAllItems = async () => {
    if (!selectedStore) return
    if (!confirm(t('Are you sure you want to delete all items from this store?'))) return
    try {
      await indexedDb.clearStore(selectedStore)
      setStoreItems([])
      loadCacheInfo()
      toast.success(t('All items deleted successfully'))
    } catch (error) {
      logger.error('Failed to delete all items', { error })
      toast.error(t('Failed to delete all items'))
    }
  }

  const handleCleanupDuplicates = async () => {
    if (!selectedStore) return
    if (!confirm(t('Clean up duplicate replaceable events? This will keep only the newest version of each event.'))) return
    setLoadingItems(true)
    try {
      const result = await indexedDb.cleanupDuplicateReplaceableEvents(selectedStore)
      const items = await indexedDb.getStoreItems(selectedStore)
      setStoreItems(items)
      setSearchQuery('')
      loadCacheInfo()
      const itemsAfterCleanup = await indexedDb.getStoreItems(selectedStore)
      const actualCount = itemsAfterCleanup.length
      if (actualCount !== result.kept) {
        toast.success(t('Cleaned up {{deleted}} duplicate entries, kept {{kept}} (total items after cleanup: {{total}})', {
          deleted: result.deleted, kept: result.kept, total: actualCount
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

  const isInvalidEvent = useCallback((item: { key: string; value: any; addedAt: number }, storeName?: string | null): boolean => {
    if (!item) return true
    if (storeName === 'rssFeedItems') {
      return !(item.value || (item as any).item)
    }
    if (storeName === StoreNames.PIPER_TTS_CACHE) {
      const v = item.value as { blob?: unknown; mimeType?: string } | null
      return !(v && typeof v.mimeType === 'string' && v.blob instanceof Blob)
    }
    if (!item.value) return true
    const event = item.value as Event
    if (!event.pubkey || !event.kind || typeof event.created_at !== 'number') return true
    if (!event.tags || !Array.isArray(event.tags)) return true
    if (!event.id || !event.sig) return true
    return false
  }, [])

  const getInvalidEventExplanation = useCallback((item: { key: string; value: any; addedAt: number }): string => {
    if (!item || !item.value) return t('Event has no value data')
    const event = item.value as Event
    const missing: string[] = []
    if (!event.pubkey) missing.push(t('pubkey'))
    if (!event.kind) missing.push(t('kind'))
    if (typeof event.created_at !== 'number') missing.push(t('created_at'))
    if (!event.tags || !Array.isArray(event.tags)) missing.push(t('tags'))
    if (!event.id) missing.push(t('id'))
    if (!event.sig) missing.push(t('sig'))
    if (missing.length > 0) return t('Event is missing required fields: {{fields}}', { fields: missing.join(', ') })
    return t('Event appears to be invalid or corrupted')
  }, [t])

  const renderStoreListView = () =>
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
          <div className="text-xs text-muted-foreground mt-1">{count} {t('items')}</div>
        </div>
      ))
    )

  const renderStoreItemsView = () =>
    loadingItems ? (
      <div className="space-y-2 py-6" role="status" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
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
                <Button variant="outline" size="sm" onClick={handleCleanupDuplicates} className="h-7 text-xs">
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {t('Cleanup Duplicates')}
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDeleteAllItems} className="h-7 text-xs">
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
                              <div className="text-sm text-muted-foreground">{invalidExplanation}</div>
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

  const renderConsoleLogList = () =>
    filteredConsoleLogs.length === 0 ? (
      <div className="text-muted-foreground p-4 text-center">
        {consoleLogs.length === 0
          ? t('No console logs captured yet')
          : t('No logs match the current filters')
        }
      </div>
    ) : (
      filteredConsoleLogs.map((log, index) => (
        <div
          key={index}
          className={`p-2 rounded border ${
            log.type === 'error' ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800' :
            log.type === 'warn' ? 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800' :
            'bg-background border-border'
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground text-[10px] whitespace-nowrap">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span className="text-muted-foreground text-[10px] whitespace-nowrap">
              [{log.type}]
            </span>
            <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-words">
              {log.formattedParts ? (
                log.formattedParts.map((part, i) => {
                  if (part.style) {
                    const styleObj: Record<string, string> = {}
                    part.style.split(';').forEach(rule => {
                      const trimmed = rule.trim()
                      if (trimmed) {
                        const colonIndex = trimmed.indexOf(':')
                        if (colonIndex > 0) {
                          const key = trimmed.substring(0, colonIndex).trim()
                          const value = trimmed.substring(colonIndex + 1).trim()
                          const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
                          styleObj[camelKey] = value
                        }
                      }
                    })
                    return <span key={i} style={styleObj}>{part.text}</span>
                  }
                  return <span key={i}>{part.text}</span>
                })
              ) : (
                log.message
              )}
            </pre>
          </div>
        </div>
      ))
    )

  const consoleLogFilters = (
    <div className="flex min-w-0 flex-wrap gap-2">
      <Input
        placeholder={t('Search logs...')}
        value={consoleLogSearch}
        onChange={(e) => setConsoleLogSearch(e.target.value)}
        className="min-w-0 flex-1 basis-[min(100%,12rem)]"
      />
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          variant={consoleLogLevel === 'errors-warnings' ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setConsoleLogLevel('errors-warnings')}
        >
          {t('Errors & warnings')}
        </Button>
        <Button
          type="button"
          variant={consoleLogLevel === 'all' ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setConsoleLogLevel('all')}
        >
          {t('All')}
        </Button>
      </div>
    </div>
  )

  const browseCacheHeader = (
    <div className="flex items-center justify-between">
      <div className="flex-1">
        {selectedStore ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSelectedStore(null); setStoreItems([]) }}
            >
              ← {t('Back')}
            </Button>
            {selectedStore}
          </div>
        ) : (
          t('Browse Cache')
        )}
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
  )

  const browseCacheDescription = selectedStore
    ? t('View cached items in this store.')
    : t('View details about cached data in IndexedDB stores. Click on a store to view its items.')

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground space-y-1">
        <div>{t('Clear cached data stored in your browser, including IndexedDB events, localStorage settings, and service worker caches.')}</div>
        <div>
          {t('refreshCacheButtonExplainer', {
            defaultValue:
              'Refresh Cache runs an IndexedDB upgrade check, re-fetches your relay lists and profile-related events from the network (same work as the automatic startup sync), syncs kind-5 deletions into tombstones and removes deleted items from the local cache, then refreshes the store counts below.'
          })}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button variant="outline" className="shrink-0" onClick={handleClearCache}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('Clear Cache')}
        </Button>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={handleRefreshCache}
          disabled={cacheRefreshBusy}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${cacheRefreshBusy ? 'animate-spin' : ''}`} />
          {t('Refresh Cache')}
        </Button>
        <Button variant="outline" className="shrink-0" onClick={handleBrowseCache}>
          <Database className="mr-2 h-4 w-4" />
          {t('Browse Cache')}
        </Button>
        <Button variant="outline" className="shrink-0" onClick={handleClearServiceWorker}>
          <XCircle className="mr-2 h-4 w-4" />
          {t('Clear Service Worker')}
        </Button>
        <Button variant="outline" className="shrink-0" onClick={handleShowConsoleLogs}>
          <Terminal className="mr-2 h-4 w-4" />
          {t('View Console Logs')} ({consoleLogRef.current.length})
        </Button>
      </div>

      {isSmallScreen ? (
        <Drawer open={browsingCache} onOpenChange={setBrowsingCache}>
          <DrawerContent className="max-h-[90vh]">
            <DrawerHeader>
              {browseCacheHeader}
              <DrawerTitle className="sr-only">{t('Browse Cache')}</DrawerTitle>
              <DrawerDescription>{browseCacheDescription}</DrawerDescription>
            </DrawerHeader>
            <div className={`px-4 pb-4 space-y-4 overflow-y-auto ${wordWrapEnabled ? 'overflow-x-hidden break-words' : 'overflow-x-auto'}`}>
              {!selectedStore ? renderStoreListView() : renderStoreItemsView()}
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={browsingCache} onOpenChange={setBrowsingCache}>
          <DialogContent className="max-w-[1000px] max-h-[1000px] overflow-y-auto overflow-x-hidden">
            <DialogHeader>
              {browseCacheHeader}
              <DialogTitle className="sr-only">{t('Browse Cache')}</DialogTitle>
              <DialogDescription>{browseCacheDescription}</DialogDescription>
            </DialogHeader>
            <div className={`space-y-4 ${wordWrapEnabled ? 'overflow-x-hidden break-words' : 'overflow-x-auto'}`}>
              {!selectedStore ? renderStoreListView() : renderStoreItemsView()}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {isSmallScreen ? (
        <Drawer open={showConsoleLogs} onOpenChange={setShowConsoleLogs}>
          <DrawerContent className="max-h-[90vh]">
            <DrawerHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <DrawerTitle>{t('Console Logs')}</DrawerTitle>
                  <DrawerDescription>
                    {t('View recent console logs for debugging')} ({filteredConsoleLogs.length} / {consoleLogs.length} {t('entries')})
                  </DrawerDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleClearConsoleLogs}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('Clear')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowConsoleLogs(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </DrawerHeader>
            <div className="space-y-2 px-4 pb-2">{consoleLogFilters}</div>
            <div className="flex-1 overflow-auto px-4 pb-4">
              <div className="space-y-1 font-mono text-xs">{renderConsoleLogList()}</div>
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={showConsoleLogs} onOpenChange={setShowConsoleLogs}>
          <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col" withoutClose>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <DialogTitle>{t('Console Logs')}</DialogTitle>
                  <DialogDescription>
                    {t('View recent console logs for debugging')} ({filteredConsoleLogs.length} / {consoleLogs.length} {t('entries')})
                  </DialogDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleClearConsoleLogs}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('Clear')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowConsoleLogs(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-2 px-6 pb-4">{consoleLogFilters}</div>
            <div className="flex-1 overflow-auto px-6 pb-4">
              <div className="space-y-1 font-mono text-xs">{renderConsoleLogList()}</div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
