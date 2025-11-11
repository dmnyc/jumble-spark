import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from '@/providers/NostrProvider'
import rssFeedService, { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import { ExtendedKind, DEFAULT_RSS_FEEDS } from '@/constants'
import indexedDb from '@/services/indexed-db.service'
import RssFeedItem from '../RssFeedItem'
import { Loader, AlertCircle } from 'lucide-react'
import logger from '@/lib/logger'

export default function RssFeedList() {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
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

        if (pubkey) {
          try {
            const event = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.RSS_FEED_LIST)
            if (event && event.content) {
              try {
                const urls = JSON.parse(event.content) as string[]
                if (Array.isArray(urls) && urls.length > 0) {
                  feedUrls = urls
                }
              } catch (e) {
                logger.error('[RssFeedList] Failed to parse RSS feed list', { error: e })
                // Use default feeds on parse error
              }
            }
          } catch (e) {
            logger.error('[RssFeedList] Failed to load RSS feed list event', { error: e })
            // Use default feeds on error
          }
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

