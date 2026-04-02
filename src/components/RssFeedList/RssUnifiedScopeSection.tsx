import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Section chrome for the RSS column: feed items and article cards backed by subscribed feeds. */
export function RssUnifiedScopeSection({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <section className="space-y-3" aria-labelledby="imwald-rss-unified-heading">
      <div className="space-y-1 px-0.5">
        <h2
          id="imwald-rss-unified-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('RSS feed column title')}
        </h2>
        <p className="text-[11px] leading-snug text-muted-foreground/90">
          {t('RSS feed column subtitle')}
        </p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
