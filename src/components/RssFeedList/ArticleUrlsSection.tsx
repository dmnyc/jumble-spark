import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Section chrome for the article-URL card list (Nostr threads + merged RSS by URL). */
export function ArticleUrlsSection({
  children,
  subtitleKey = 'Article URLs subtitle'
}: {
  children: ReactNode
  /** `Article URLs Nostr manual subtitle` when the URLs toggle hides RSS-only URL groups. */
  subtitleKey?: string
}) {
  const { t } = useTranslation()
  return (
    <section className="space-y-3" aria-labelledby="imwald-article-urls-heading">
      <div className="space-y-1 px-0.5">
        <h2
          id="imwald-article-urls-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('Article URLs')}
        </h2>
        <p className="text-[11px] leading-snug text-muted-foreground/90">{t(subtitleKey)}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
