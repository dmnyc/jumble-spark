import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from '@/providers/NostrProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import storage from '@/services/local-storage.service'
import { createRssFeedListDraftEvent } from '@/lib/draft-event'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import { CloudUpload, Loader, Trash2, Plus } from 'lucide-react'
import logger from '@/lib/logger'
import { ExtendedKind } from '@/constants'
import indexedDb from '@/services/indexed-db.service'

const RssFeedSettingsPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const [feedUrls, setFeedUrls] = useState<string[]>([])
  const [newFeedUrl, setNewFeedUrl] = useState('')
  const [showRssFeed, setShowRssFeed] = useState(true)
  const [hasChange, setHasChange] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load show RSS feed setting
    setShowRssFeed(storage.getShowRssFeed())

    // Load RSS feed list from event
    const loadRssFeedList = async () => {
      if (!pubkey) {
        setLoading(false)
        return
      }

      try {
        const event = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.RSS_FEED_LIST)
        if (event && event.content) {
          try {
            const urls = JSON.parse(event.content) as string[]
            if (Array.isArray(urls)) {
              setFeedUrls(urls)
            }
          } catch (e) {
            logger.error('[RssFeedSettingsPage] Failed to parse RSS feed list', { error: e })
          }
        }
      } catch (error) {
        logger.error('[RssFeedSettingsPage] Failed to load RSS feed list', { error })
      } finally {
        setLoading(false)
      }
    }

    loadRssFeedList()
  }, [pubkey])

  const handleShowRssFeedChange = (checked: boolean) => {
    setShowRssFeed(checked)
    storage.setShowRssFeed(checked)
    // No need to set hasChange here as this is a local storage setting, not a Nostr event
  }

  const handleAddFeed = () => {
    const url = newFeedUrl.trim()
    if (!url) return

    // Basic URL validation
    try {
      new URL(url)
    } catch {
      // Invalid URL
      return
    }

    if (feedUrls.includes(url)) {
      // Feed already exists
      return
    }

    setFeedUrls([...feedUrls, url])
    setNewFeedUrl('')
    setHasChange(true)
  }

  const handleRemoveFeed = (url: string) => {
    setFeedUrls(feedUrls.filter(u => u !== url))
    setHasChange(true)
  }

  const handleSave = async () => {
    if (!pubkey) return

    setPushing(true)
    try {
      const event = createRssFeedListDraftEvent(feedUrls)
      const result = await publish(event)
      
      // Cache the event in IndexedDB for immediate access
      try {
        await indexedDb.putReplaceableEvent(result)
      } catch (cacheError) {
        logger.warn('[RssFeedSettingsPage] Failed to cache RSS feed list event', { error: cacheError })
        // Don't fail the save if caching fails
      }
      
      // Read relayStatuses immediately before it might be deleted
      const relayStatuses = (result as any).relayStatuses
      
      setHasChange(false)
      
      // Show publishing feedback
      if (relayStatuses && relayStatuses.length > 0) {
        showPublishingFeedback({
          success: true,
          relayStatuses: relayStatuses,
          successCount: relayStatuses.filter((s: any) => s.success).length,
          totalCount: relayStatuses.length
        }, {
          message: t('RSS feeds saved'),
          duration: 6000
        })
      } else {
        showSimplePublishSuccess(t('RSS feeds saved'))
      }
    } catch (error) {
      logger.error('[RssFeedSettingsPage] Failed to save RSS feed list', { error })
      // Show error feedback with relay statuses if available
      if (error instanceof Error && (error as any).relayStatuses) {
        const errorRelayStatuses = (error as any).relayStatuses
        showPublishingFeedback({
          success: false,
          relayStatuses: errorRelayStatuses,
          successCount: errorRelayStatuses.filter((s: any) => s.success).length,
          totalCount: errorRelayStatuses.length
        }, {
          message: error.message || t('Failed to save RSS feeds'),
          duration: 6000
        })
      } else {
        showPublishingError(error instanceof Error ? error : new Error(t('Failed to save RSS feeds')))
      }
    } finally {
      setPushing(false)
    }
  }

  if (!pubkey) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={hideTitlebar ? undefined : t('RSS Feed Settings')}>
        <div className="flex flex-col w-full items-center py-8">
          <Button size="lg" onClick={() => checkLogin()}>
            {t('Login to configure RSS feeds')}
          </Button>
        </div>
      </SecondaryPageLayout>
    )
  }

  if (loading) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={hideTitlebar ? undefined : t('RSS Feed Settings')}>
        <div className="text-center text-sm text-muted-foreground py-8">{t('loading...')}</div>
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={hideTitlebar ? undefined : t('RSS Feed Settings')}>
      <div className="px-4 pt-3 space-y-6">
        {/* Show RSS Feed Toggle */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Label htmlFor="show-rss-feed">{t('Show RSS Feed')}</Label>
            <Switch
              id="show-rss-feed"
              checked={showRssFeed}
              onCheckedChange={handleShowRssFeedChange}
            />
          </div>
          <div className="text-muted-foreground text-xs">
            {t('Show or hide the RSS feed tab in the main feed')}
          </div>
        </div>

        {/* RSS Feed List */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('RSS Feeds')}</Label>
            <div className="text-muted-foreground text-xs">
              {t('Add RSS feed URLs to subscribe to. If no feeds are configured, the default feed will be used.')}
            </div>
          </div>

          {/* Add Feed Input */}
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://example.com/feed.xml"
              value={newFeedUrl}
              onChange={(e) => setNewFeedUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddFeed()
                }
              }}
              className="flex-1"
            />
            <Button onClick={handleAddFeed} size="icon" variant="outline">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Feed List */}
          <div className="space-y-2">
            {feedUrls.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                {t('No feeds configured. Default feed will be used.')}
              </div>
            ) : (
              feedUrls.map((url) => (
                <div key={url} className="flex items-center justify-between p-3 border rounded-lg">
                  <span className="text-sm break-all flex-1 mr-2">{url}</span>
                  <Button
                    onClick={() => handleRemoveFeed(url)}
                    size="icon"
                    variant="ghost"
                    className="flex-shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Save Button */}
          <Button
            className="w-full"
            disabled={pushing || !hasChange}
            onClick={handleSave}
          >
            {pushing ? <Loader className="animate-spin mr-2" /> : <CloudUpload className="mr-2" />}
            {t('Save')}
          </Button>
        </div>
      </div>
    </SecondaryPageLayout>
  )
})

RssFeedSettingsPage.displayName = 'RssFeedSettingsPage'
export default RssFeedSettingsPage

