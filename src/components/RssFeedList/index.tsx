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

  useEffect(() => {
    const loadRssFeeds = async () => {
      setLoading(true)
      setError(null)

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
        }

        // Fetch and merge feeds (this handles errors gracefully and returns partial results)
        const fetchedItems = await rssFeedService.fetchMultipleFeeds(feedUrls)
        
        if (fetchedItems.length === 0) {
          // No items were successfully fetched, but don't show error if we tried
          // The fetchMultipleFeeds already logs warnings for failed feeds
          setError(null) // Clear any previous error
        }
        
        setItems(fetchedItems)
      } catch (err) {
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
        setLoading(false)
      }
    }

    loadRssFeeds()

    // Listen for RSS feed list updates
    const handleRssFeedListUpdate = (event: CustomEvent) => {
      const detail = event.detail as { pubkey: string; feedUrls: string[]; eventId: string }
      // Only refresh if it's for the current user
      if (detail.pubkey === pubkey) {
        logger.info('[RssFeedList] Received RSS feed list update event, refreshing...', { 
          eventId: detail.eventId,
          feedCount: detail.feedUrls.length 
        })
        loadRssFeeds()
      }
    }

    window.addEventListener('rssFeedListUpdated', handleRssFeedListUpdate as EventListener)

    return () => {
      window.removeEventListener('rssFeedListUpdated', handleRssFeedListUpdate as EventListener)
    }
  }, [pubkey, t])

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
      {items.map((item) => (
        <RssFeedItem key={`${item.feedUrl}-${item.guid}`} item={item} />
      ))}
    </div>
  )
}

