import RssFeedItem from '@/components/RssFeedItem'
import type { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import { useTranslation } from 'react-i18next'

/** Classic RSS reader: one row per feed item, chronological. */
export function RssEntriesSection({ items }: { items: TRssFeedItem[] }) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  return (
    <section className="space-y-3" aria-labelledby="jumble-rss-entries-heading">
      <div className="space-y-1 px-0.5">
        <h2
          id="jumble-rss-entries-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('RSS timeline')}
        </h2>
        <p className="text-[11px] leading-snug text-muted-foreground/90">
          {t('RSS timeline subtitle')}
        </p>
      </div>
      <div className="space-y-0 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.map((item) => (
          <RssFeedItem
            key={`${item.feedUrl}-${item.guid}`}
            item={item}
            layout="list"
            sourceStrip="rss"
            className="rounded-none border-0 bg-transparent shadow-none"
          />
        ))}
      </div>
    </section>
  )
}
