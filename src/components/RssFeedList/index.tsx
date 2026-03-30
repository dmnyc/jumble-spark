import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import rssFeedService, { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import { DEFAULT_RSS_FEEDS } from '@/constants'
import RssFeedItem from '../RssFeedItem'
import RssWebFeedCard from '../RssWebFeedCard'
import { ArticleUrlsSection } from './ArticleUrlsSection'
import { RssUnifiedScopeSection } from './RssUnifiedScopeSection'
import { canonicalizeRssArticleUrl, isClawstrDotComHttpUrl } from '@/lib/rss-article'
import {
  addManualRssWebUrl,
  fetchDiscoveredWebUrlsFromRelays,
  loadManualRssWebUrls,
  loadPromotedRssThreadUrls,
  loadRssWebFeedScopePreference,
  loadRssWebHideUnifiedClutterPreference,
  loadRssWebSuppressClawstrPreference,
  buildArticleUrlFeedRows,
  isHttpArticleUrl,
  isRssWebUnifiedClutterUrl,
  mergeDiscoveredRssWebUrls,
  rssWebRowHasRealFeedItems,
  saveRssWebFeedScopePreference,
  saveRssWebHideUnifiedClutterPreference,
  saveRssWebSuppressClawstrPreference,
  WEB_EXTERNAL_REACTION_PUBLISHED_EVENT,
  type ManualRssWebUrlEntry,
  type RssWebFeedScope
} from '@/lib/rss-web-feed'
import { RssFeedDisplayPrefsProvider } from './RssFeedDisplayPrefsContext'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, Search, Plus } from 'lucide-react'
import logger from '@/lib/logger'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Check, ChevronDown } from 'lucide-react'
import { normalizeHttpArticleUrl } from '@/lib/rss-article'
import {
  getRssFeedUrlHostname,
  getStandardRssFeedProfile
} from '@/lib/standard-rss-feed-url'
import { StandardRssFeedUrlInline } from '@/components/StandardRssFeedUrlRow'

function ManualRssUrlAddRow({
  className,
  onUrlAdded
}: {
  className?: string
  onUrlAdded: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = () => {
    setError('')
    const url = normalizeHttpArticleUrl(value)
    if (!url) {
      setError(t('Enter a valid http(s) URL'))
      return
    }
    setSaving(true)
    void (async () => {
      try {
        await addManualRssWebUrl(url)
        setOpen(false)
        setValue('')
        await Promise.resolve(onUrlAdded())
      } finally {
        setSaving(false)
      }
    })()
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={className ?? 'w-full justify-start gap-2 text-muted-foreground border-dashed'}
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4 shrink-0" />
        {t('+ Add a URL to this list')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Add a web URL')}</DialogTitle>
            <DialogDescription>
              {t('Add web URL to feed description')}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="https://example.com/article"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            autoFocus
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="button" disabled={saving} onClick={submit}>
              {t('Add to feed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function rssFeedItemArticleIsClawstrHost(item: TRssFeedItem): boolean {
  const l = item.link?.trim()
  if (!l || (!l.startsWith('http://') && !l.startsWith('https://'))) return false
  return isClawstrDotComHttpUrl(l) || isClawstrDotComHttpUrl(canonicalizeRssArticleUrl(l))
}

export default function RssFeedList() {
  const { t } = useTranslation()
  const { pubkey, rssFeedListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
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
  const [feedPopoverOpen, setFeedPopoverOpen] = useState<boolean>(false)
  
  // Pagination state (merged RSS+Web rows)
  const [showRowCount, setShowRowCount] = useState<number>(20)
  const bottomRef = useRef<HTMLDivElement>(null)
  /** True after user changes RSS+Web scope or “only my web events”; blocks async prefs from overwriting. */
  const rssWebPrefsUserTouchedRef = useRef(false)
  const [manualWebEntries, setManualWebEntries] = useState<ManualRssWebUrlEntry[]>([])
  /** Latest relay discovery (in-memory); URLs appear as faux cards even before IndexedDB merge. */
  const [relayDiscoveredUrls, setRelayDiscoveredUrls] = useState<ManualRssWebUrlEntry[]>([])
  const [suppressClawstrLinks, setSuppressClawstrLinks] = useState(true)
  const [hideUnifiedClutter, setHideUnifiedClutter] = useState(true)

  const refreshManualWebUrls = useCallback(() => {
    void loadManualRssWebUrls().then(setManualWebEntries)
  }, [])

  const [promotedThreadUrls, setPromotedThreadUrls] = useState<string[]>([])
  const promotedThreadUrlSet = useMemo(() => new Set(promotedThreadUrls), [promotedThreadUrls])

  const refreshPromotedThreadUrls = useCallback(() => {
    void loadPromotedRssThreadUrls().then(setPromotedThreadUrls)
  }, [])

  useEffect(() => {
    void loadManualRssWebUrls().then(setManualWebEntries)
  }, [])

  useEffect(() => {
    void loadPromotedRssThreadUrls().then(setPromotedThreadUrls)
  }, [])

  /** Bump to re-run relay URL discovery after publishing a kind-17 reaction. */
  const [relayDiscoveryTick, setRelayDiscoveryTick] = useState(0)

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
          } catch {
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

    items.forEach((item) => {
      const normalizedUrl = normalizeFeedUrl(item.feedUrl)
      if (!feedMap.has(normalizedUrl)) {
        const profile = getStandardRssFeedProfile(normalizedUrl)
        const fallback = profile
          ? t(profile.labelKey, { defaultValue: profile.defaultLabel })
          : getRssFeedUrlHostname(normalizedUrl)
        feedMap.set(normalizedUrl, {
          url: normalizedUrl,
          title: item.feedTitle?.trim() || fallback
        })
      }
    })
    return Array.from(feedMap.values())
  }, [items, t])

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

  /** Feed + time only (search is applied after merge so URL rows and links match too). */
  const baseFilteredItems = useMemo(() => {
    let filtered = items

    if (!selectedFeeds.includes('all') && selectedFeeds.length > 0) {
      const normalizedSelectedFeeds = selectedFeeds.map((f) => normalizeFeedUrl(f))
      filtered = filtered.filter((item) =>
        normalizedSelectedFeeds.includes(normalizeFeedUrl(item.feedUrl))
      )
    }

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

      filtered = filtered.filter((item) => {
        if (!item.pubDate) return false
        return item.pubDate.getTime() >= cutoffTime
      })
    }

    return filtered
  }, [items, selectedFeeds, timeFilter])

  /** When “hide clutter” is on, drop those entries from the feed (not only from URL cards). */
  const rssWebItemsRespectingClutterPref = useMemo(() => {
    if (!hideUnifiedClutter) return baseFilteredItems
    return baseFilteredItems.filter((item) => {
      const link = item.link?.trim()
      if (!link || !isHttpArticleUrl(link)) return true
      return !isRssWebUnifiedClutterUrl(link)
    })
  }, [baseFilteredItems, hideUnifiedClutter])

  const rssItemMatchesSearch = useCallback((item: TRssFeedItem, q: string) => {
    const query = q.toLowerCase().trim()
    if (!query) return true
    return (
      item.title.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      (item.feedTitle || '').toLowerCase().includes(query) ||
      (item.link || '').toLowerCase().includes(query) ||
      (item.guid || '').toLowerCase().includes(query)
    )
  }, [])

  type CombinedFeedRow =
    | {
        kind: 'web'
        canonicalUrl: string
        rssItems: TRssFeedItem[]
        latestPub: number
      }
    | { kind: 'rss'; item: TRssFeedItem }

  type UnifiedFeedRow =
    | { kind: 'url'; canonicalUrl: string; rssItems: TRssFeedItem[] }
    | { kind: 'rssEntry'; item: TRssFeedItem }

  const [feedScope, setFeedScope] = useState<RssWebFeedScope>('urls')

  useEffect(() => {
    const handler = () => {
      setRelayDiscoveryTick((n) => n + 1)
      refreshManualWebUrls()
      refreshPromotedThreadUrls()
    }
    window.addEventListener(WEB_EXTERNAL_REACTION_PUBLISHED_EVENT, handler)
    return () => window.removeEventListener(WEB_EXTERNAL_REACTION_PUBLISHED_EVENT, handler)
  }, [refreshManualWebUrls, refreshPromotedThreadUrls])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const discovered = await fetchDiscoveredWebUrlsFromRelays({
          accountPubkey: pubkey,
          favoriteRelays: favoriteRelays ?? [],
          blockedRelays: blockedRelays ?? [],
          excludeClutterUrls: hideUnifiedClutter
        })
        if (cancelled) return
        setRelayDiscoveredUrls(discovered)
        const didMerge = await mergeDiscoveredRssWebUrls(discovered)
        if (didMerge && !cancelled) refreshManualWebUrls()
      } catch {
        if (!cancelled) setRelayDiscoveredUrls([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey, favoriteRelays, blockedRelays, refreshManualWebUrls, relayDiscoveryTick, hideUnifiedClutter])

  const combinedFeedRows = useMemo((): CombinedFeedRow[] => {
    const { webRows, nonHttpItems } = buildArticleUrlFeedRows(
      rssWebItemsRespectingClutterPref,
      manualWebEntries,
      relayDiscoveredUrls,
      { excludeClutterLinks: hideUnifiedClutter }
    )
    const rest: CombinedFeedRow[] = nonHttpItems.map((item) => ({
      kind: 'rss' as const,
      item
    }))
    const merged = [...webRows, ...rest].sort((a, b) => {
      const ta = a.kind === 'web' ? a.latestPub : (a.item.pubDate?.getTime() ?? 0)
      const tb = b.kind === 'web' ? b.latestPub : (b.item.pubDate?.getTime() ?? 0)
      return tb - ta
    })
    if (!suppressClawstrLinks) return merged
    return merged.filter((row) => {
      if (row.kind === 'web') return !isClawstrDotComHttpUrl(row.canonicalUrl)
      return !rssFeedItemArticleIsClawstrHost(row.item)
    })
  }, [
    rssWebItemsRespectingClutterPref,
    manualWebEntries,
    relayDiscoveredUrls,
    suppressClawstrLinks,
    hideUnifiedClutter
  ])

  const combinedFeedRowsForSearch = useMemo((): CombinedFeedRow[] => {
    const q = searchQuery.trim()
    if (!q) return combinedFeedRows
    return combinedFeedRows.filter((row) => {
      if (row.kind === 'rss') {
        return rssItemMatchesSearch(row.item, q)
      }
      if (row.canonicalUrl.toLowerCase().includes(q.toLowerCase())) return true
      return row.rssItems.some((it) => rssItemMatchesSearch(it, q))
    })
  }, [combinedFeedRows, searchQuery, rssItemMatchesSearch])

  const urlScopeRows = useMemo((): UnifiedFeedRow[] => {
    return combinedFeedRowsForSearch
      .filter(
        (r): r is Extract<CombinedFeedRow, { kind: 'web' }> =>
          r.kind === 'web' &&
          (!rssWebRowHasRealFeedItems(r.rssItems) || promotedThreadUrlSet.has(r.canonicalUrl))
      )
      .sort((a, b) => b.latestPub - a.latestPub)
      .map((r) => ({
        kind: 'url' as const,
        canonicalUrl: r.canonicalUrl,
        rssItems: r.rssItems
      }))
  }, [combinedFeedRowsForSearch, promotedThreadUrlSet])

  const rssScopeRows = useMemo((): UnifiedFeedRow[] => {
    const picked = combinedFeedRowsForSearch.filter((r) => {
      if (r.kind === 'rss') {
        const link = r.item.link?.trim()
        if (link && isHttpArticleUrl(link)) {
          if (promotedThreadUrlSet.has(canonicalizeRssArticleUrl(link))) return false
        }
        return true
      }
      if (r.kind === 'web' && rssWebRowHasRealFeedItems(r.rssItems)) {
        return !promotedThreadUrlSet.has(r.canonicalUrl)
      }
      return false
    })
    const sorted = [...picked].sort((a, b) => {
      const ta = a.kind === 'web' ? a.latestPub : (a.item.pubDate?.getTime() ?? 0)
      const tb = b.kind === 'web' ? b.latestPub : (b.item.pubDate?.getTime() ?? 0)
      return tb - ta
    })
    return sorted.map((r) =>
      r.kind === 'web'
        ? {
            kind: 'url' as const,
            canonicalUrl: r.canonicalUrl,
            rssItems: r.rssItems
          }
        : { kind: 'rssEntry' as const, item: r.item }
    )
  }, [combinedFeedRowsForSearch, promotedThreadUrlSet])

  const feedDisplayBase = useMemo(
    () => ({ rows: feedScope === 'urls' ? urlScopeRows : rssScopeRows }),
    [feedScope, urlScopeRows, rssScopeRows]
  )

  const persistSuppressClawstr = useCallback((checked: boolean) => {
    rssWebPrefsUserTouchedRef.current = true
    setSuppressClawstrLinks(checked)
    void saveRssWebSuppressClawstrPreference(checked)
  }, [])

  const persistHideUnifiedClutter = useCallback((checked: boolean) => {
    rssWebPrefsUserTouchedRef.current = true
    setHideUnifiedClutter(checked)
    void saveRssWebHideUnifiedClutterPreference(checked)
  }, [])

  const persistFeedScope = useCallback((scope: RssWebFeedScope) => {
    rssWebPrefsUserTouchedRef.current = true
    setFeedScope(scope)
    void saveRssWebFeedScopePreference(scope)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [suppressClawstr, hideClutter, scope] = await Promise.all([
        loadRssWebSuppressClawstrPreference(),
        loadRssWebHideUnifiedClutterPreference(),
        loadRssWebFeedScopePreference()
      ])
      if (cancelled || rssWebPrefsUserTouchedRef.current) return
      setSuppressClawstrLinks(suppressClawstr)
      setHideUnifiedClutter(hideClutter)
      setFeedScope(scope)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const feedTotalCount = feedDisplayBase.rows.length

  // Reset pagination when filters change
  useEffect(() => {
    setShowRowCount(20)
  }, [selectedFeeds, timeFilter, searchQuery, feedScope, suppressClawstrLinks, hideUnifiedClutter])

  const displayedFeed = useMemo(
    () => ({ rows: feedDisplayBase.rows.slice(0, showRowCount) }),
    [feedDisplayBase, showRowCount]
  )

  const displayedCount = displayedFeed.rows.length

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!bottomRef.current || displayedCount >= feedTotalCount) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayedCount < feedTotalCount) {
          setShowRowCount((prev) => Math.min(prev + 20, feedTotalCount))
        }
      },
      { root: null, rootMargin: '100px', threshold: 0.1 }
    )

    observer.observe(bottomRef.current)

    return () => {
      observer.disconnect()
    }
  }, [displayedCount, feedTotalCount])

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
      <div className="space-y-3 px-4 py-8" role="status" aria-busy="true" aria-live="polite">
        <p className="text-sm text-muted-foreground">{t('Loading RSS feeds...')}</p>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
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

  if (items.length === 0 && manualWebEntries.length === 0) {
    return (
      <div className="space-y-4 px-4 py-6">
        <ManualRssUrlAddRow onUrlAdded={refreshManualWebUrls} />
        <p className="text-sm text-muted-foreground text-center">{t('No RSS feed items available')}</p>
      </div>
    )
  }

  return (
    <RssFeedDisplayPrefsProvider value={{ suppressClawstrLinks }}>
    <div className="space-y-3">
      {/* Feed header — view mode, display prefs, counts */}
      <div className="sticky top-0 z-10 space-y-1.5 border-b bg-background px-4 py-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div
              className="inline-flex max-w-full flex-wrap rounded-md border border-border bg-muted/30 p-0.5 sm:flex-nowrap"
              role="group"
              aria-label={t('RSS feed view mode')}
            >
              <Button
                type="button"
                variant={feedScope === 'urls' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 rounded-sm px-2 text-[11px] font-normal shadow-none sm:px-2.5 sm:text-xs"
                onClick={() => persistFeedScope('urls')}
              >
                {t('URLs')}
              </Button>
              <Button
                type="button"
                variant={feedScope === 'rss' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 rounded-sm px-2 text-[11px] font-normal shadow-none sm:px-2.5 sm:text-xs"
                onClick={() => persistFeedScope('rss')}
              >
                {t('RSS')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="suppress-clawstr-links"
                  checked={suppressClawstrLinks}
                  onCheckedChange={(c) => persistSuppressClawstr(c === true)}
                />
                <Label
                  htmlFor="suppress-clawstr-links"
                  className="cursor-pointer text-xs text-muted-foreground"
                >
                  {t('Suppress Clawstr links in RSS previews')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hide-unified-clutter"
                  checked={hideUnifiedClutter}
                  onCheckedChange={(c) => persistHideUnifiedClutter(c === true)}
                />
                <Label
                  htmlFor="hide-unified-clutter"
                  className="cursor-pointer text-xs text-muted-foreground"
                >
                  {t('Hide local, media & feed URLs from URL cards')}
                </Label>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground sm:text-right">
            {t('Showing {{filtered}} of {{total}} entries', {
              filtered: displayedCount,
              total: feedTotalCount
            })}
          </p>
        </div>
        <div className="relative w-full max-w-xl">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground sm:h-4 sm:w-4" />
          <Input
            type="search"
            placeholder={t('Search...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full pl-8 text-xs sm:h-9 sm:pl-9 sm:text-sm"
            aria-label={t('Search...')}
          />
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
                          <label className="text-sm cursor-pointer flex-1 min-w-0" title={feed.title}>
                            <StandardRssFeedUrlInline
                              feedUrl={feed.url}
                              title={feed.title}
                              maxLength={50}
                            />
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
          </div>
        </div>
      )}

      {/* Content */}
      <div className="space-y-4 px-4 py-3">
        <ManualRssUrlAddRow onUrlAdded={refreshManualWebUrls} />
        {refreshing && (
          <div className="flex items-center gap-2 border-b py-2" role="status" aria-busy="true">
            <Skeleton className="h-4 w-4 shrink-0 rounded-sm" aria-hidden />
            <Skeleton className="h-4 flex-1 max-w-[200px]" />
          </div>
        )}
        
        {feedTotalCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">
              {searchQuery || (!selectedFeeds.includes('all') && selectedFeeds.length > 0) || timeFilter !== 'all'
                ? t('No items match your filters')
                : feedScope === 'urls'
                  ? t('No URL-only items yet')
                  : t('No RSS feed items available')}
            </p>
          </div>
        ) : feedScope === 'urls' ? (
          <>
            <ArticleUrlsSection subtitleKey="Article URLs Nostr manual subtitle">
              {displayedFeed.rows
                .filter((r): r is Extract<UnifiedFeedRow, { kind: 'url' }> => r.kind === 'url')
                .map((row) => (
                  <RssWebFeedCard
                    key={row.canonicalUrl}
                    canonicalUrl={row.canonicalUrl}
                    rssItems={row.rssItems}
                  />
                ))}
            </ArticleUrlsSection>
            {displayedCount < feedTotalCount ? (
              <div ref={bottomRef} className="flex justify-center py-4">
                <Skeleton className="h-8 w-8 rounded-md" aria-hidden />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <RssUnifiedScopeSection>
              {displayedFeed.rows.map((row) =>
                row.kind === 'url' ? (
                  <RssWebFeedCard
                    key={row.canonicalUrl}
                    canonicalUrl={row.canonicalUrl}
                    rssItems={row.rssItems}
                    rssColumnReadOnly
                  />
                ) : (
                  <div
                    key={`${row.item.feedUrl}-${row.item.guid}`}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <RssFeedItem
                      item={row.item}
                      layout="list"
                      sourceStrip="rss"
                      className="rounded-none border-0 bg-transparent shadow-none"
                      rssEntryReadOnlyMode
                      onAfterPromoteRss={() => {
                        refreshManualWebUrls()
                        refreshPromotedThreadUrls()
                      }}
                    />
                  </div>
                )
              )}
            </RssUnifiedScopeSection>
            {displayedCount < feedTotalCount ? (
              <div ref={bottomRef} className="flex justify-center py-4">
                <Skeleton className="h-8 w-8 rounded-md" aria-hidden />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
    </RssFeedDisplayPrefsProvider>
  )
}

