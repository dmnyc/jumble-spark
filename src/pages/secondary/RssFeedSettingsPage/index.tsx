import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/PageManager'
import { ExtendedKind, FAST_WRITE_RELAY_URLS, PROFILE_RELAY_URLS } from '@/constants'
import { getLatestEvent } from '@/lib/event'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from '@/providers/NostrProvider'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import storage from '@/services/local-storage.service'
import { createRssFeedListDraftEvent } from '@/lib/draft-event'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import { CloudUpload, Loader, Trash2, Plus, Download, Upload } from 'lucide-react'
import logger from '@/lib/logger'
import { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import rssFeedService from '@/services/rss-feed.service'
import { parseOpml, generateOpml, downloadFile } from '@/lib/opml'
import { toast } from 'sonner'
import { normalizeHttpUrl } from '@/lib/url'

// Helper function to normalize and deduplicate feed URLs
const normalizeAndDeduplicateUrls = (urls: string[]): string[] => {
  const normalizedUrls = urls
    .map(url => normalizeHttpUrl(url.trim()))
    .filter((url): url is string => url.length > 0) // Filter out invalid URLs
  
  // Deduplicate by creating a Set of normalized URLs, preserving order
  const seen = new Set<string>()
  const unique: string[] = []
  
  for (const url of normalizedUrls) {
    if (!seen.has(url)) {
      seen.add(url)
      unique.push(url)
    }
  }
  
  return unique
}

const RssFeedSettingsPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin, rssFeedListEvent, updateRssFeedListEvent } = useNostr()
  const [feedUrls, setFeedUrls] = useState<string[]>([])
  const [newFeedUrl, setNewFeedUrl] = useState('')
  const [showRssFeed, setShowRssFeed] = useState(true)
  const [hasChange, setHasChange] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [loading, setLoading] = useState(true)

  // Load RSS feed list from context (which is loaded from cache first, then relays if stale)
  useEffect(() => {
    // Load show RSS feed setting
    setShowRssFeed(storage.getShowRssFeed())

    // Load RSS feed list from context event (which comes from cache)
    if (!pubkey) {
      setLoading(false)
      return
    }

    if (rssFeedListEvent) {
      try {
        // Extract URLs from "u" tags and normalize them
        const urls = rssFeedListEvent.tags
          .filter(tag => tag[0] === 'u' && tag[1])
          .map(tag => tag[1] as string)
          .filter((url): url is string => {
            if (typeof url !== 'string') {
              logger.warn('[RssFeedSettingsPage] Invalid RSS feed URL (not a string)', { url, type: typeof url })
              return false
            }
            const trimmed = url.trim()
            if (trimmed.length === 0) {
              logger.warn('[RssFeedSettingsPage] Empty RSS feed URL found')
              return false
            }
            return true
          })
          .map(url => url.trim())
        
        // Normalize and deduplicate URLs
        const normalizedUrls = normalizeAndDeduplicateUrls(urls)
        
        if (normalizedUrls.length > 0) {
          setFeedUrls(normalizedUrls)
          logger.info('[RssFeedSettingsPage] Loaded RSS feed list from context', { 
            count: normalizedUrls.length, 
            urls: normalizedUrls,
            originalCount: urls.length 
          })
        } else {
          logger.info('[RssFeedSettingsPage] RSS feed list is empty or contains no valid URLs')
        }
      } catch (e) {
        logger.error('[RssFeedSettingsPage] Failed to parse RSS feed list from tags', { 
          error: e,
          tags: rssFeedListEvent.tags
        })
      }
    } else {
      logger.info('[RssFeedSettingsPage] No RSS feed list event in context (user may not have created one yet)')
    }
    
    setLoading(false)
  }, [pubkey, rssFeedListEvent])

  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()

  const refreshFromRelays = useCallback(async () => {
    if (!pubkey) return
    if (hasChange) {
      toast.message(t('Save or discard your changes before refreshing from relays'))
      return
    }
    setLoading(true)
    try {
      const events = await queryService.fetchEvents(FAST_WRITE_RELAY_URLS.concat(PROFILE_RELAY_URLS), {
        kinds: [ExtendedKind.RSS_FEED_LIST],
        authors: [pubkey],
        limit: 1
      })
      const latest = getLatestEvent(events)
      if (latest) {
        await indexedDb.putReplaceableEvent(latest)
        await updateRssFeedListEvent(latest)
        toast.success(t('RSS feed list refreshed'))
      } else {
        toast.message(t('No RSS feed list found on relays'))
      }
    } catch (e) {
      logger.error('[RssFeedSettingsPage] Refresh from relays failed', { error: e })
      toast.error(t('Failed to refresh'))
    } finally {
      setLoading(false)
    }
  }, [pubkey, hasChange, t, updateRssFeedListEvent])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(() => {
      void refreshFromRelays()
    })
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, refreshFromRelays])

  const handleShowRssFeedChange = (checked: boolean) => {
    setShowRssFeed(checked)
    storage.setShowRssFeed(checked)
    // Dispatch event to notify other components of the change
    window.dispatchEvent(new CustomEvent('rssFeedSettingChanged'))
    // No need to set hasChange here as this is a local storage setting, not a Nostr event
  }

  const handleAddFeed = () => {
    const url = newFeedUrl.trim()
    if (!url) return

    // Normalize and deduplicate all URLs (including the new one)
    const allUrls = [...feedUrls, url]
    const normalizedUrls = normalizeAndDeduplicateUrls(allUrls)
    
    // Check if the new URL was actually added (not a duplicate)
    const normalizedExistingUrls = normalizeAndDeduplicateUrls(feedUrls)
    const normalizedNewUrl = normalizeHttpUrl(url)
    
    if (!normalizedNewUrl) {
      // Invalid URL
      return
    }
    
    if (normalizedExistingUrls.includes(normalizedNewUrl)) {
      // Feed already exists
      return
    }

    setFeedUrls(normalizedUrls)
    setNewFeedUrl('')
    setHasChange(true)
  }

  const handleRemoveFeed = (url: string) => {
    setFeedUrls(feedUrls.filter(u => u !== url))
    setHasChange(true)
  }

  const handleImportOpml = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Reset input
    event.target.value = ''

    try {
      const text = await file.text()
      const feeds = parseOpml(text)
      
      if (feeds.length === 0) {
        toast.error(t('No RSS feeds found in OPML file'))
        return
      }

      // Extract URLs from OPML feeds
      const opmlUrls = feeds
        .map(feed => feed.xmlUrl)
        .filter((url): url is string => {
          try {
            new URL(url)
            return true
          } catch {
            return false
          }
        })

      if (opmlUrls.length === 0) {
        toast.error(t('No valid RSS feed URLs found in OPML file'))
        return
      }

      // Merge with existing feeds and normalize/deduplicate everything
      const allUrls = [...feedUrls, ...opmlUrls]
      const normalizedUrls = normalizeAndDeduplicateUrls(allUrls)
      
      // Check how many new URLs were actually added
      const normalizedExistingUrls = new Set(normalizeAndDeduplicateUrls(feedUrls))
      const newUrls = normalizedUrls.filter(url => !normalizedExistingUrls.has(url))
      
      if (newUrls.length === 0) {
        toast.info(t('All feeds from OPML file are already added'))
        return
      }

      // Update with normalized and deduplicated URLs
      setFeedUrls(normalizedUrls)
      setHasChange(true)
      toast.success(t('Imported {{count}} feed(s) from OPML file', { count: newUrls.length }))
    } catch (error) {
      logger.error('[RssFeedSettingsPage] Failed to import OPML file', { error })
      toast.error(t('Failed to import OPML file: {{error}}', { 
        error: error instanceof Error ? error.message : String(error) 
      }))
    }
  }

  const handleExportOpml = () => {
    // Normalize and deduplicate before exporting
    const normalizedUrls = normalizeAndDeduplicateUrls(feedUrls)
    
    if (normalizedUrls.length === 0) {
      toast.error(t('No feeds to export'))
      return
    }

    try {
      const opmlContent = generateOpml(normalizedUrls, 'Jumble RSS Feeds')
      const filename = `jumble-rss-feeds-${new Date().toISOString().split('T')[0]}.opml`
      downloadFile(opmlContent, filename, 'application/xml')
      toast.success(t('RSS feeds exported to OPML file'))
    } catch (error) {
      logger.error('[RssFeedSettingsPage] Failed to export OPML file', { error })
      toast.error(t('Failed to export OPML file'))
    }
  }

  const handleSave = async () => {
    if (!pubkey) {
      logger.error('[RssFeedSettingsPage] Cannot save: no pubkey')
      return
    }

    setPushing(true)
    try {
      // Normalize and deduplicate URLs before saving
      const normalizedUrls = normalizeAndDeduplicateUrls(feedUrls)
      
      logger.info('[RssFeedSettingsPage] Creating RSS feed list event', { 
        pubkey: pubkey.substring(0, 8),
        feedCount: normalizedUrls.length,
        originalCount: feedUrls.length,
        feedUrls: normalizedUrls 
      })
      
      const event = createRssFeedListDraftEvent(normalizedUrls)
      
      // Validate the event structure before publishing
      logger.info('[RssFeedSettingsPage] Draft event created', { 
        kind: event.kind,
        tagCount: event.tags.length,
        tags: event.tags,
        created_at: event.created_at 
      })
      logger.debug('[RSS] Event created with tags', {
        kind: event.kind,
        tagCount: event.tags.length,
        tags: event.tags
      })
      
      logger.debug('[RSS] About to call publish()')
      let result
      try {
        result = await publish(event)
        logger.debug('[RSS] Event published successfully!', {
          id: result.id,
          kind: result.kind,
          pubkey: result.pubkey?.substring(0, 8),
          content: result.content
        })
      } catch (publishError) {
        logger.error('[RSS] Publish failed!', publishError)
        throw publishError
      }
      
      logger.info('[RssFeedSettingsPage] Event published', { 
        eventId: result.id,
        kind: result.kind,
        pubkey: result.pubkey,
        created_at: result.created_at,
        content: result.content 
      })
      
      // Cache the event in IndexedDB for immediate access
      logger.debug('[RSS] About to cache event in IndexedDB', {
        eventId: result.id,
        kind: result.kind,
        pubkey: result.pubkey?.substring(0, 8)
      })
      
      try {
        logger.info('[RssFeedSettingsPage] Attempting to cache event in IndexedDB', { 
          eventId: result.id,
          kind: result.kind,
          pubkey: result.pubkey 
        })
        
        logger.debug('[RSS] Calling indexedDb.putReplaceableEvent()...')
        const savedEvent = await indexedDb.putReplaceableEvent(result)
        logger.debug('[RSS] Successfully cached to IndexedDB!', {
          eventId: savedEvent.id,
          kind: savedEvent.kind,
          pubkey: savedEvent.pubkey?.substring(0, 8),
          content: savedEvent.content
        })
        logger.info('[RssFeedSettingsPage] Successfully cached RSS feed list event to IndexedDB', { 
          eventId: savedEvent.id,
          kind: savedEvent.kind,
          pubkey: savedEvent.pubkey,
          feedCount: feedUrls.length 
        })
      } catch (cacheError) {
        logger.error('[RSS] Failed to cache to IndexedDB!', {
          error: cacheError,
          errorMessage: cacheError instanceof Error ? cacheError.message : String(cacheError),
          errorStack: cacheError instanceof Error ? cacheError.stack : undefined,
          eventId: result.id,
          kind: result.kind 
        })
        logger.error('[RssFeedSettingsPage] Failed to cache RSS feed list event', { 
          error: cacheError,
          eventId: result.id,
          kind: result.kind 
        })
        // Don't fail the save if caching fails, but log the error
      }
      
      // Verify the event was saved by reading it back
      logger.debug('[RSS] Verifying event was saved...')
      try {
        logger.info('[RssFeedSettingsPage] Verifying event was saved to IndexedDB', { 
          pubkey: pubkey.substring(0, 8),
          kind: ExtendedKind.RSS_FEED_LIST 
        })
        
        const savedEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.RSS_FEED_LIST)
        if (savedEvent) {
          logger.debug('[RSS] Event found in IndexedDB!', {
            eventId: savedEvent.id,
            expectedId: result.id,
            match: savedEvent.id === result.id,
            content: savedEvent.content
          })
          logger.info('[RssFeedSettingsPage] Event found in IndexedDB', { 
            eventId: savedEvent.id,
            expectedId: result.id,
            match: savedEvent.id === result.id,
            created_at: savedEvent.created_at,
            content: savedEvent.content 
          })
          
          if (savedEvent.id === result.id) {
            logger.debug('[RSS] Event IDs match! Verification successful!')
            logger.info('[RssFeedSettingsPage] Verified RSS feed list event in IndexedDB', { eventId: savedEvent.id })
          } else {
            logger.warn('[RSS] Event ID mismatch!', {
              expectedId: result.id,
              foundId: savedEvent.id
            })
            logger.warn('[RssFeedSettingsPage] RSS feed list event ID mismatch', { 
              expectedId: result.id,
              foundId: savedEvent.id,
              expectedCreatedAt: result.created_at,
              foundCreatedAt: savedEvent.created_at 
            })
          }
        } else {
          logger.error('[RSS] Event NOT found in IndexedDB after save!', {
            expectedId: result.id,
            pubkey: pubkey.substring(0, 8),
            kind: ExtendedKind.RSS_FEED_LIST 
          })
          logger.error('[RssFeedSettingsPage] RSS feed list event not found in IndexedDB after save', { 
            expectedId: result.id,
            pubkey: pubkey.substring(0, 8),
            kind: ExtendedKind.RSS_FEED_LIST 
          })
        }
      } catch (verifyError) {
        logger.error('[RSS] Error verifying event in IndexedDB!', verifyError)
        logger.error('[RssFeedSettingsPage] Failed to verify RSS feed list event in IndexedDB', { 
          error: verifyError,
          pubkey: pubkey.substring(0, 8),
          kind: ExtendedKind.RSS_FEED_LIST 
        })
      }
      
      // Update the context with the new event
      await updateRssFeedListEvent(result)
      
      // Dispatch custom event to notify other components (like RssFeedList) to refresh
      window.dispatchEvent(new CustomEvent('rssFeedListUpdated', { 
        detail: { pubkey, feedUrls: normalizedUrls, eventId: result.id } 
      }))
      
      // Trigger background refresh of feeds (don't wait for it)
      logger.info('[RssFeedSettingsPage] Triggering background refresh of RSS feeds', { feedCount: normalizedUrls.length })
      rssFeedService.backgroundRefreshFeeds(normalizedUrls).catch(err => {
        logger.error('[RssFeedSettingsPage] Background refresh failed', { error: err })
      })
      
      // Update local state with normalized URLs if they changed
      if (normalizedUrls.length !== feedUrls.length || 
          JSON.stringify(normalizedUrls.sort()) !== JSON.stringify(feedUrls.sort())) {
        setFeedUrls(normalizedUrls)
      }
      
      // Read relayStatuses immediately before it might be deleted
      const relayStatuses = (result as any).relayStatuses
      logger.info('[RssFeedSettingsPage] Publishing complete', { 
        eventId: result.id,
        relayStatusCount: relayStatuses?.length || 0,
        successCount: relayStatuses?.filter((s: any) => s.success).length || 0 
      })
      
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
      logger.error('[RssFeedSettingsPage] Failed to save RSS feed list', { 
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined 
      })
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
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('RSS Feed Settings')}
        controls={hideTitlebar ? undefined : <RefreshButton onClick={() => void refreshFromRelays()} />}
      >
        <div className="text-center text-sm text-muted-foreground py-8">{t('loading...')}</div>
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : t('RSS Feed Settings')}
      controls={hideTitlebar ? undefined : <RefreshButton onClick={() => void refreshFromRelays()} />}
    >
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
            {t('Show or hide the RSS page and sidebar entry')}
          </div>
        </div>

        {/* RSS Feed List */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('RSS Feeds')}</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportOpml}
                  disabled={feedUrls.length === 0}
                  className="text-xs"
                >
                  <Download className="h-3 w-3 mr-1" />
                  {t('Export OPML')}
                </Button>
                <label>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="text-xs cursor-pointer"
                  >
                    <span>
                      <Upload className="h-3 w-3 mr-1" />
                      {t('Import OPML')}
                    </span>
                  </Button>
                  <input
                    type="file"
                    accept=".opml,application/xml,text/xml"
                    onChange={handleImportOpml}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
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
            {pushing ? <Skeleton className="mr-2 size-4 shrink-0 rounded-sm" aria-hidden /> : <CloudUpload className="mr-2" />}
            {t('Save')}
          </Button>
        </div>
      </div>
    </SecondaryPageLayout>
  )
})

RssFeedSettingsPage.displayName = 'RssFeedSettingsPage'
export default RssFeedSettingsPage

