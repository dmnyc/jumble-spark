import RssFeedList from '@/components/RssFeedList'
import { RefreshButton } from '@/components/RefreshButton'
import PrimaryPageLayout, { type TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { Button } from '@/components/ui/button'
import { DEFAULT_RSS_FEEDS } from '@/constants'
import logger from '@/lib/logger'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { useNostr } from '@/providers/NostrProvider'
import rssFeedService from '@/services/rss-feed.service'
import { Rss, Search } from 'lucide-react'
import { TPageRef } from '@/types'
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const RssPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { pubkey, relayList, rssFeedListEvent } = useNostr()
  const [rssRefreshKey, setRssRefreshKey] = useState(0)
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)

  const handleRefresh = useCallback(() => {
    void syncUserDeletionTombstones(pubkey, relayList)
    let feedUrls: string[] = []
    if (pubkey && rssFeedListEvent) {
      try {
        feedUrls = rssFeedListEvent.tags
          .filter((tag) => tag[0] === 'u' && tag[1])
          .map((tag) => tag[1] as string)
          .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      } catch {
        feedUrls = []
      }
    } else {
      feedUrls = DEFAULT_RSS_FEEDS
    }
    rssFeedService.backgroundRefreshFeeds(feedUrls).catch((err) => {
      logger.error('[RssPage] Background refresh failed', { error: err })
    })
    if (pubkey) {
      window.dispatchEvent(
        new CustomEvent('rssFeedListUpdated', {
          detail: { pubkey, feedUrls, eventId: 'manual-refresh' }
        })
      )
    }
    setRssRefreshKey((k) => k + 1)
  }, [pubkey, relayList, rssFeedListEvent])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: handleRefresh
    }),
    [handleRefresh]
  )

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="rss"
      titlebar={
        <div className="flex h-full w-full items-center justify-between gap-2 pr-1">
          <div className="flex items-center gap-2 pl-3">
            <Rss className="size-5" />
            <div className="app-chrome-title">{t('RSS + Web')}</div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="titlebar-icon"
              onClick={() => window.dispatchEvent(new CustomEvent('toggleRssFilters'))}
              title={t('Toggle filters')}
            >
              <Search className="h-4 w-4" />
            </Button>
            <RefreshButton onClick={handleRefresh} />
          </div>
        </div>
      }
      displayScrollToTopButton
    >
      <div className="min-w-0 px-2 pt-2">
        <RssFeedList key={rssRefreshKey} />
      </div>
    </PrimaryPageLayout>
  )
})

RssPage.displayName = 'RssPage'
export default RssPage
