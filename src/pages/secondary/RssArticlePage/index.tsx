import NoteInteractions from '@/components/NoteInteractions'
import NoteStats from '@/components/NoteStats'
import RssFeedItem from '@/components/RssFeedItem'
import WebPreview from '@/components/WebPreview'
import { Separator } from '@/components/ui/separator'
import indexedDb from '@/services/indexed-db.service'
import type { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { decodeRssArticlePathSegment, createRssThreadRootEvent } from '@/lib/rss-article'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

const RssArticlePage = forwardRef(
  (
    {
      articleKey,
      index,
      hideTitlebar = false,
      initialItem
    }: {
      articleKey: string
      index?: number
      hideTitlebar?: boolean
      initialItem?: TRssFeedItem
    },
    ref
  ) => {
    const { t } = useTranslation()
    const [item, setItem] = useState<TRssFeedItem | null>(initialItem ?? null)
    const [loading, setLoading] = useState(!initialItem)

    const articleUrl = useMemo(() => {
      try {
        return decodeRssArticlePathSegment(articleKey)
      } catch {
        return ''
      }
    }, [articleKey])

    useEffect(() => {
      if (initialItem || !articleUrl) {
        setLoading(false)
        return
      }
      let cancelled = false
      ;(async () => {
        try {
          const items = await indexedDb.getRssFeedItems()
          if (cancelled) return
          const found = items.find((i) => i.link === articleUrl) ?? null
          setItem(found)
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
      return () => {
        cancelled = true
      }
    }, [articleUrl, initialItem])

    const syntheticRoot = useMemo(
      () => (articleUrl ? createRssThreadRootEvent(articleUrl) : null),
      [articleUrl]
    )

    useEffect(() => {
      if (hideTitlebar) {
        sessionStorage.setItem('notePageTitle', item ? t('RSS article') : t('Web page'))
      }
      return () => {
        if (hideTitlebar) {
          sessionStorage.removeItem('notePageTitle')
        }
      }
    }, [hideTitlebar, t, item])

    if (!articleUrl) {
      return (
        <SecondaryPageLayout ref={ref} index={index} title={hideTitlebar ? undefined : t('RSS article')}>
          <div className="px-4 py-6 text-sm text-muted-foreground">{t('Invalid article link.')}</div>
        </SecondaryPageLayout>
      )
    }

    if (loading) {
      return (
        <SecondaryPageLayout ref={ref} index={index} title={hideTitlebar ? undefined : t('RSS article')}>
          <div className="px-4 py-6 text-sm text-muted-foreground">{t('Loading…')}</div>
        </SecondaryPageLayout>
      )
    }

    if (!item) {
      return (
        <SecondaryPageLayout
          ref={ref}
          index={index}
          title={hideTitlebar ? undefined : t('Web page')}
          displayScrollToTopButton
        >
          <div className="px-4 pt-3 pb-4 w-full space-y-4">
            <p className="text-xs text-muted-foreground">
              {t('Opened by URL — not from your RSS list. Nostr thread is still tied to this link.')}
            </p>
            <div className="not-prose max-w-full">
              <WebPreview url={articleUrl} className="w-full" />
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                {t('Open in browser')}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
            {syntheticRoot && (
              <div className="px-0 w-full">
                <NoteStats className="mt-2" event={syntheticRoot} fetchIfNotExisting={false} displayTopZapsAndLikes={false} />
              </div>
            )}
            <Separator />
            <div className="w-full">
              {syntheticRoot && (
                <NoteInteractions
                  key={`rss-interactions-${syntheticRoot.id}`}
                  pageIndex={index}
                  event={syntheticRoot}
                  showQuotes={false}
                />
              )}
            </div>
          </div>
        </SecondaryPageLayout>
      )
    }

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('RSS article')}
        displayScrollToTopButton
      >
        <div className="px-4 pt-3 w-full">
          <RssFeedItem item={item} layout="detail" />
        </div>
        {syntheticRoot && (
          <div className="px-4 w-full">
            <NoteStats className="mt-3" event={syntheticRoot} fetchIfNotExisting={false} displayTopZapsAndLikes={false} />
          </div>
        )}
        <Separator className="mt-4" />
        <div className="px-4 pb-4 w-full">
          {syntheticRoot && (
            <NoteInteractions
              key={`rss-interactions-${syntheticRoot.id}`}
              pageIndex={index}
              event={syntheticRoot}
              showQuotes={false}
            />
          )}
        </div>
      </SecondaryPageLayout>
    )
  }
)

RssArticlePage.displayName = 'RssArticlePage'
export default RssArticlePage
