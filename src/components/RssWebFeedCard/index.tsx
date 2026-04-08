import RssFeedItem from '@/components/RssFeedItem'
import RssUrlThreadStatsBar from '@/components/RssUrlThreadStatsBar'
import WebPreview from '@/components/WebPreview'
import { cn } from '@/lib/utils'
import { createRssThreadRootEvent } from '@/lib/rss-article'
import { isHttpArticleUrl } from '@/lib/rss-web-feed'
import type { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import { isWebOnlyFauxRssItem } from '@/services/rss-feed.service'
import { Globe, Rss } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartRssArticleNavigation } from '@/PageManager'

/**
 * Single feed card for an article URL: RSS body and/or faux web item (OpenGraph), plus compact thread counts.
 * Opens RssArticlePage in the secondary panel for full article, comments, and highlights (like a note page).
 */
export default function RssWebFeedCard({
  canonicalUrl,
  rssItems,
  className,
  /** When true (RSS column): hide Nostr thread UI; open article read-only until promoted in URL feed. */
  rssColumnReadOnly = false
}: {
  canonicalUrl: string
  rssItems: TRssFeedItem[]
  className?: string
  rssColumnReadOnly?: boolean
}) {
  const { t } = useTranslation()
  const { navigateToRssArticle } = useSmartRssArticleNavigation()
  const syntheticRoot = useMemo(() => createRssThreadRootEvent(canonicalUrl), [canonicalUrl])

  const hasRealRss = rssItems.some((i) => !isWebOnlyFauxRssItem(i))
  const showRssRows = rssItems.length > 0
  const showWebOgPreview = isHttpArticleUrl(canonicalUrl)

  const openArticle = () => {
    navigateToRssArticle(canonicalUrl, rssColumnReadOnly ? { rssFeedReadOnly: true } : undefined)
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm overflow-hidden',
        'cursor-pointer transition-colors hover:bg-muted/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      role="link"
      tabIndex={0}
      onClick={openArticle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openArticle()
        }
      }}
    >
      <div
        className="flex min-w-0 items-center gap-1.5 border-b border-border/40 px-3 py-1.5 text-[11px] sm:text-xs text-muted-foreground"
        aria-label={hasRealRss ? t('RSS feed item label') : t('Web URL item label')}
      >
        {hasRealRss ? (
          <Rss className="size-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
        ) : (
          <Globe className="size-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{canonicalUrl}</span>
      </div>

      <div className="not-prose max-w-full border-b border-border/60 bg-muted/10 pointer-events-none">
        {showRssRows ? (
          <div className="divide-y divide-border/60">
            {rssItems.map((item) => (
              <RssFeedItem
                key={`${item.feedUrl}-${item.guid}`}
                item={item}
                layout="list"
                className="rounded-none border-0 shadow-none bg-transparent"
              />
            ))}
          </div>
        ) : null}
        {showWebOgPreview ? (
          <div className={cn(showRssRows && 'border-t border-border/60')}>
            <WebPreview url={canonicalUrl} className="w-full" />
          </div>
        ) : null}
        {!showWebOgPreview && !showRssRows ? (
          <p className="px-3 py-2 text-sm text-muted-foreground break-all">{canonicalUrl}</p>
        ) : null}
      </div>
      {rssItems.length > 1 ? (
        <p className="pointer-events-none border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          {t('{{count}} RSS entries for this URL', { count: rssItems.length })}
        </p>
      ) : null}

      {!rssColumnReadOnly ? <RssUrlThreadStatsBar event={syntheticRoot} /> : null}
    </div>
  )
}
