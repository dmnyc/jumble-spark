import { useEffect, useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from '@/providers/NostrProvider'
import rssFeedService, { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import { DEFAULT_RSS_FEEDS } from '@/constants'
import RssFeedItem from '../RssFeedItem'
import { Loader, AlertCircle, Search } from 'lucide-react'
import logger from '@/lib/logger'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Check, ChevronDown } from 'lucide-react'

export default function RssFeedList() {
  const { t } = useTranslation()
  const { pubkey, rssFeedListEvent } = useNostr()
  const { isSmallScreen } = useScreenSize()
  const [items, setItems] = useState<TRssFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  
  // Filter states
  const [selectedFeeds, setSelectedFeeds] = useState<string[]>(['all'])
  const [timeFilter, setTimeFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [showFilters, setShowFilters] = useState<boolean>(false)
  const [isCompactView, setIsCompactView] = useState<boolean>(true)
  const [feedPopoverOpen, setFeedPopoverOpen] = useState<boolean>(false)
  
  // Pagination state
  const [showCount, setShowCount] = useState<number>(25)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Listen for filter toggle events
  useEffect(() => {
    const handleToggleFilters = () => {
      setShowFilters(prev => !prev)
    }

    window.addEventListener('toggleRssFilters', handleToggleFilters)
    return () => {
      window.removeEventListener('toggleRssFilters', handleToggleFilters)
    }
  }, [])

  useEffect(() => {
    // Create AbortController for this effect
    let abortController = new AbortController()
    let isMounted = true
    let isLoading = false
    let timeoutId: NodeJS.Timeout | null = null

    const loadRssFeeds = async (forceNewController = false) => {
      // If forced, create a new controller (for manual refreshes)
      if (forceNewController) {
        abortController.abort() // Abort old one
        abortController = new AbortController()
      }

      // Check if already aborted or if a load is already in progress
      if (abortController.signal.aborted || isLoading) {
        logger.debug('[RssFeedList] Skipping load - already aborted or loading', { 
          aborted: abortController.signal.aborted, 
          isLoading 
        })
        return
      }

      // Clear any existing timeout
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      isLoading = true
      setLoading(true)
      setError(null)
      
      // Set a timeout to prevent infinite loading (30 seconds)
      timeoutId = setTimeout(() => {
        if (isMounted && isLoading) {
          logger.warn('[RssFeedList] Feed loading timeout - aborting and showing partial results')
          abortController.abort()
          isLoading = false
          if (isMounted) {
            setLoading(false)
          }
        }
      }, 30000)

      try {
        // Get feed URLs from event or use default
        let feedUrls: string[] = []

        if (pubkey && rssFeedListEvent) {
          // User has an event - use only feeds from that event (even if empty)
          try {
            // Extract URLs from "u" tags
            const urls = rssFeedListEvent.tags
              .filter(tag => tag[0] === 'u' && tag[1])
              .map(tag => tag[1] as string)
              .filter((url): url is string => {
                if (typeof url !== 'string') {
                  logger.warn('[RssFeedList] Invalid RSS feed URL (not a string)', { url, type: typeof url })
                  return false
                }
                const trimmed = url.trim()
                if (trimmed.length === 0) {
                  logger.warn('[RssFeedList] Empty RSS feed URL found')
                  return false
                }
                return true
              })
            
            feedUrls = urls
            if (urls.length > 0) {
              logger.info('[RssFeedList] Loaded RSS feed list from context', { 
                feedCount: urls.length,
                eventId: rssFeedListEvent.id,
                urls
              })
            } else {
              logger.info('[RssFeedList] RSS feed list event exists but is empty - will show empty feed')
            }
          } catch (e) {
            logger.error('[RssFeedList] Failed to parse RSS feed list from tags', { 
              error: e,
              tags: rssFeedListEvent.tags
            })
            // On parse error, treat as empty event (don't use defaults)
            feedUrls = []
          }
        } else if (pubkey) {
          // No event exists - use default feeds for demo
          logger.info('[RssFeedList] No RSS feed list event in context, using default feeds')
          feedUrls = DEFAULT_RSS_FEEDS
          // Trigger background refresh for default feeds when no event exists
          rssFeedService.backgroundRefreshFeeds(feedUrls, abortController.signal).catch(err => {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
              logger.error('[RssFeedList] Background refresh of default feeds failed', { error: err })
            }
          })
        } else {
          // No pubkey - use default feeds
          feedUrls = DEFAULT_RSS_FEEDS
        }

        // Check if aborted before fetching
        if (abortController.signal.aborted || !isMounted) {
          return
        }

        // Fetch and merge feeds (cache-first: returns cached items immediately, background-refreshes)
        // Show refreshing indicator (background refresh will run in background, or we'll wait if cache is empty)
        if (isMounted) {
          setRefreshing(true)
        }
        
        const fetchedItems = await rssFeedService.fetchMultipleFeeds(feedUrls, abortController.signal)
        
        // Always set items if we got them, even if signal was aborted (abort might happen after fetch completes)
        // Only skip setting items if component unmounted
        if (!isMounted) {
          setRefreshing(false)
          return
        }
        
        // Set items regardless of abort status (abort might have happened after fetch completed)
        if (fetchedItems.length === 0) {
          // No items were successfully fetched, but don't show error if we tried
          // The fetchMultipleFeeds already logs warnings for failed feeds
          setError(null) // Clear any previous error
        }
        
        setItems(fetchedItems)
        
        // Check if aborted after setting items (for cleanup)
        if (abortController.signal.aborted) {
          logger.debug('[RssFeedList] Signal was aborted after fetching, but items were set', {
            itemCount: fetchedItems.length
          })
        }
        
        // Set up a listener for cache updates (background refresh may add new items)
        // Re-check cache after a delay to see if background refresh added items
        const checkForUpdates = async () => {
          if (abortController.signal.aborted || !isMounted) {
            if (isMounted) {
              setRefreshing(false)
            }
            return
          }
          
          try {
            const updatedItems = await rssFeedService.fetchMultipleFeeds(feedUrls, abortController.signal)
            if (!abortController.signal.aborted && isMounted) {
              setRefreshing(false)
              if (updatedItems.length > fetchedItems.length) {
                // New items were added by background refresh
                setItems(updatedItems)
                logger.info('[RssFeedList] Updated items from background refresh', {
                  previousCount: fetchedItems.length,
                  newCount: updatedItems.length
                })
              }
            }
          } catch (err) {
            if (isMounted) {
              setRefreshing(false)
            }
            // Ignore errors in update check
          }
        }
        
        // Check for updates after 5 seconds (background refresh should be done by then)
        setTimeout(checkForUpdates, 5000)
      } catch (err) {
        // Don't handle abort errors - they're expected during cleanup
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }

        // Check if still mounted before setting error
        if (!isMounted) {
          return
        }

        logger.error('[RssFeedList] Error loading RSS feeds', { error: err })
        // Don't set error state - fetchMultipleFeeds handles individual feed failures gracefully
        // Only set error if there's a critical issue (like network completely down)
        if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
          // Network error - might be temporary, don't show persistent error
          setError(null)
        } else {
          setError(err instanceof Error ? err.message : t('Failed to load RSS feeds'))
        }
      } finally {
        isLoading = false
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        // Only update loading state if still mounted
        if (isMounted) {
          setLoading(false)
          // If we had no cached items, background refresh was awaited, so stop refreshing indicator
          if (items.length === 0) {
            setRefreshing(false)
          }
        }
      }
    }

    loadRssFeeds()

    // Listen for RSS feed list updates
    const handleRssFeedListUpdate = (event: CustomEvent) => {
      const detail = event.detail as { pubkey: string; feedUrls: string[]; eventId: string }
      // Only refresh if it's for the current user
      if (detail.pubkey === pubkey && isMounted) {
        logger.info('[RssFeedList] Received RSS feed list update event, refreshing...', { 
          eventId: detail.eventId,
          feedCount: detail.feedUrls.length 
        })
        
        // For manual refresh, show refreshing indicator
        if (detail.eventId === 'manual-refresh' && isMounted) {
          setRefreshing(true)
        }
        
        // For manual refresh, the background refresh is already triggered by the button
        // Just reload to show updated items (background refresh will update cache in the background)
        // For other updates (like event changes), also just reload
        loadRssFeeds(true)
      }
    }

    window.addEventListener('rssFeedListUpdated', handleRssFeedListUpdate as EventListener)

    return () => {
      isMounted = false
      isLoading = false
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      // Abort any in-flight requests
      abortController.abort()
      window.removeEventListener('rssFeedListUpdated', handleRssFeedListUpdate as EventListener)
    }
  }, [pubkey, rssFeedListEvent, t])

  // Normalize feed URL to prevent duplicates (e.g., with/without trailing slash)
  // This matches the normalization used in rss-feed.service.ts
  const normalizeFeedUrl = (url: string): string => {
    return url.trim().replace(/\/$/, '')
  }

  // Get unique feed URLs and titles from items
  // Normalize URLs to prevent duplicates (e.g., with/without trailing slash)
  const availableFeeds = useMemo(() => {
    const feedMap = new Map<string, { url: string; title: string }>()
    
    items.forEach(item => {
      const normalizedUrl = normalizeFeedUrl(item.feedUrl)
      if (!feedMap.has(normalizedUrl)) {
        feedMap.set(normalizedUrl, { url: normalizedUrl, title: item.feedTitle || item.feedUrl })
      }
    })
    return Array.from(feedMap.values())
  }, [items])

  // Helper function to truncate text
  const truncateText = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + '...'
  }

  // Handle feed selection change
  const handleFeedToggle = (feedUrl: string, checked: boolean) => {
    if (feedUrl === 'all') {
      // If "all" is checked, clear all other selections
      setSelectedFeeds(checked ? ['all'] : [])
    } else {
      // If a specific feed is checked, remove "all" if present
      setSelectedFeeds(prev => {
        const newSelection = checked
          ? [...prev.filter(f => f !== 'all'), feedUrl]
          : prev.filter(f => f !== feedUrl)
        // If nothing is selected, default to "all"
        return newSelection.length === 0 ? ['all'] : newSelection
      })
    }
  }

  // Filter items based on selected filters
  const filteredItems = useMemo(() => {
    let filtered = items

    // Filter by feed
    if (!selectedFeeds.includes('all') && selectedFeeds.length > 0) {
      const normalizedSelectedFeeds = selectedFeeds.map(f => normalizeFeedUrl(f))
      filtered = filtered.filter(item => 
        normalizedSelectedFeeds.includes(normalizeFeedUrl(item.feedUrl))
      )
    }

    // Filter by time
    if (timeFilter !== 'all') {
      const now = Date.now()
      let cutoffTime = 0
      
      switch (timeFilter) {
        case 'hour':
          cutoffTime = now - 60 * 60 * 1000
          break
        case 'day':
          cutoffTime = now - 24 * 60 * 60 * 1000
          break
        case 'week':
          cutoffTime = now - 7 * 24 * 60 * 60 * 1000
          break
        case 'month':
          cutoffTime = now - 30 * 24 * 60 * 60 * 1000
          break
      }
      
      filtered = filtered.filter(item => {
        if (!item.pubDate) return false
        return item.pubDate.getTime() >= cutoffTime
      })
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(item => {
        const titleMatch = item.title.toLowerCase().includes(query)
        const descMatch = item.description.toLowerCase().includes(query)
        const feedMatch = (item.feedTitle || '').toLowerCase().includes(query)
        return titleMatch || descMatch || feedMatch
      })
    }

    return filtered
  }, [items, selectedFeeds, timeFilter, searchQuery])

  // Reset showCount when filters change
  useEffect(() => {
    setShowCount(25)
  }, [selectedFeeds, timeFilter, searchQuery])

  // Pagination: slice to showCount for display
  const displayedItems = useMemo(() => {
    return filteredItems.slice(0, showCount)
  }, [filteredItems, showCount])

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!bottomRef.current || displayedItems.length >= filteredItems.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayedItems.length < filteredItems.length) {
          setShowCount((prev) => Math.min(prev + 25, filteredItems.length))
        }
      },
      { root: null, rootMargin: '100px', threshold: 0.1 }
    )

    observer.observe(bottomRef.current)

    return () => {
      observer.disconnect()
    }
  }, [displayedItems.length, filteredItems.length])

  // Get display text for feed selector
  const feedSelectorText = useMemo(() => {
    if (selectedFeeds.includes('all') || selectedFeeds.length === 0) {
      return t('All feeds')
    }
    if (selectedFeeds.length === 1) {
      const feed = availableFeeds.find(f => f.url === selectedFeeds[0])
      return feed ? truncateText(feed.title, 50) : t('All feeds')
    }
    return t('{{count}} feeds', { count: selectedFeeds.length })
  }, [selectedFeeds, availableFeeds, t])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">{t('Loading RSS feeds...')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <AlertCircle className="h-8 w-8 text-destructive mb-4" />
        <p className="text-sm text-destructive text-center">{error}</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t('No RSS feed items available')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Feed Counter Header - Always visible */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-1.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="compact-view"
              checked={isCompactView}
              onCheckedChange={setIsCompactView}
            />
            <Label htmlFor="compact-view" className="text-xs text-muted-foreground cursor-pointer">
              {isCompactView ? t('Compact') : t('Full')}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('Showing {{filtered}} of {{total}} items', { 
              filtered: displayedItems.length, 
              total: filteredItems.length 
            })}
          </p>
        </div>
      </div>

      {/* Filter Bar - Collapsible */}
      {showFilters && (
        <div className="sticky top-[2.5rem] z-10 bg-background border-b px-4 py-2">
          <div className={`flex ${isSmallScreen ? 'flex-col' : 'flex-row'} items-stretch gap-2`}>
            {/* Feed Selector - Multi-select with Popover */}
            <Popover open={feedPopoverOpen} onOpenChange={setFeedPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="h-8 text-xs md:text-sm md:h-9 flex-shrink-0 w-full md:w-auto justify-between"
                  style={{ minWidth: isSmallScreen ? '100%' : '300px' }}
                >
                  <span className="truncate">{feedSelectorText}</span>
                  <ChevronDown className="ml-2 h-3 w-3 md:h-4 md:w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className={`${isSmallScreen ? 'w-[calc(100vw-2rem)]' : 'w-[calc(100vw-2rem)] max-w-[400px]'} p-0`} align="start">
                <div className="max-h-[300px] overflow-y-auto">
                  <div className="p-2">
                    {/* All feeds option */}
                    <div
                      className="flex items-center space-x-2 p-2 rounded-sm hover:bg-accent cursor-pointer"
                      onClick={() => {
                        const isAllSelected = selectedFeeds.includes('all')
                        handleFeedToggle('all', !isAllSelected)
                      }}
                    >
                      <div className="flex items-center justify-center w-4 h-4 border border-border rounded">
                        {selectedFeeds.includes('all') && <Check className="w-3 h-3" />}
                      </div>
                      <label className="text-sm cursor-pointer flex-1">
                        {t('All feeds')}
                      </label>
                    </div>
                    {/* Individual feed options */}
                    {availableFeeds.map((feed) => {
                      const isChecked = selectedFeeds.includes(feed.url)
                      return (
                        <div
                          key={feed.url}
                          className="flex items-center space-x-2 p-2 rounded-sm hover:bg-accent cursor-pointer"
                          onClick={() => handleFeedToggle(feed.url, !isChecked)}
                        >
                          <div className="flex items-center justify-center w-4 h-4 border border-border rounded">
                            {isChecked && <Check className="w-3 h-3" />}
                          </div>
                          <label className="text-sm cursor-pointer flex-1 truncate" title={feed.title}>
                            {truncateText(feed.title, 50)}
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Time Filter */}
            <Select value={timeFilter} onValueChange={setTimeFilter}>
              <SelectTrigger className="h-8 text-xs md:text-sm md:h-9 flex-shrink-0 w-full md:w-auto" style={{ minWidth: isSmallScreen ? '100%' : '120px' }}>
                <SelectValue placeholder={t('All time')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('All time')}</SelectItem>
                <SelectItem value="hour">{t('Last hour')}</SelectItem>
                <SelectItem value="day">{t('Last day')}</SelectItem>
                <SelectItem value="week">{t('Last week')}</SelectItem>
                <SelectItem value="month">{t('Last month')}</SelectItem>
              </SelectContent>
            </Select>

            {/* Search Box */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('Search...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 md:h-9 pl-7 md:pl-8 text-xs md:text-sm w-full"
              />
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="space-y-4 px-4 py-3">
        {refreshing && (
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground border-b">
            <Loader className="h-4 w-4 animate-spin" />
            <span>{t('Refreshing feeds...')}</span>
          </div>
        )}
        
        {displayedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">
              {searchQuery || (!selectedFeeds.includes('all') && selectedFeeds.length > 0) || timeFilter !== 'all'
                ? t('No items match your filters')
                : t('No RSS feed items available')}
            </p>
          </div>
        ) : (
          <>
            {displayedItems.map((item) => (
              <RssFeedItem key={`${item.feedUrl}-${item.guid}`} item={item} compact={isCompactView} />
            ))}
            {/* Bottom ref for infinite scroll */}
            {displayedItems.length < filteredItems.length && (
              <div ref={bottomRef} className="flex items-center justify-center py-4">
                <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

