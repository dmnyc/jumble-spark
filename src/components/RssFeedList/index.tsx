import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from '@/providers/NostrProvider'
import rssFeedService, { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import { DEFAULT_RSS_FEEDS } from '@/constants'
import RssFeedItem from '../RssFeedItem'
import { Loader, AlertCircle } from 'lucide-react'
import logger from '@/lib/logger'

export default function RssFeedList() {
  const { t } = useTranslation()
  const { pubkey, rssFeedListEvent } = useNostr()
  const [items, setItems] = useState<TRssFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

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
        let feedUrls: string[] = DEFAULT_RSS_FEEDS

        if (pubkey && rssFeedListEvent) {
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
            
            if (urls.length > 0) {
              feedUrls = urls
              logger.info('[RssFeedList] Loaded RSS feed list from context', { 
                feedCount: urls.length,
                eventId: rssFeedListEvent.id,
                urls
              })
            } else {
              logger.info('[RssFeedList] RSS feed list is empty or contains no valid URLs, using default feeds')
            }
          } catch (e) {
            logger.error('[RssFeedList] Failed to parse RSS feed list from tags', { 
              error: e,
              tags: rssFeedListEvent.tags
            })
            // Use default feeds on parse error
          }
        } else if (pubkey) {
          logger.info('[RssFeedList] No RSS feed list event in context, using default feeds')
          // Trigger background refresh for default feeds when no event exists
          rssFeedService.backgroundRefreshFeeds(feedUrls, abortController.signal).catch(err => {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
              logger.error('[RssFeedList] Background refresh of default feeds failed', { error: err })
            }
          })
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
        
        // Check if aborted after fetching
        if (abortController.signal.aborted || !isMounted) {
          if (isMounted) {
            setRefreshing(false)
          }
          return
        }
        
        if (fetchedItems.length === 0) {
          // No items were successfully fetched, but don't show error if we tried
          // The fetchMultipleFeeds already logs warnings for failed feeds
          setError(null) // Clear any previous error
        }
        
        setItems(fetchedItems)
        
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
    <div className="space-y-4 px-4 py-3">
      {refreshing && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground border-b">
          <Loader className="h-4 w-4 animate-spin" />
          <span>{t('Refreshing feeds...')}</span>
        </div>
      )}
      {items.map((item) => (
        <RssFeedItem key={`${item.feedUrl}-${item.guid}`} item={item} />
      ))}
    </div>
  )
}

