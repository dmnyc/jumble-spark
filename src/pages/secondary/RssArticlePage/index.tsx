import NoteInteractions from '@/components/NoteInteractions'
import NoteStats from '@/components/NoteStats'
import RssFeedItem from '@/components/RssFeedItem'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import indexedDb from '@/services/indexed-db.service'
import type { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import {
  createWebOnlyRssFeedItem,
  isWebOnlyFauxRssItem
} from '@/services/rss-feed.service'
import { isHttpArticleUrl, promoteRssArticleForNostrThread } from '@/lib/rss-web-feed'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useNostr } from '@/providers/NostrProvider'
import { decodeRssArticlePathSegment, createRssThreadRootEvent, canonicalizeRssArticleUrl } from '@/lib/rss-article'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function normalizeFeedUrl(url: string): string {
  return url.trim().replace(/\/$/, '')
}

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
    const [rssFeedReadOnly, setRssFeedReadOnly] = useState(() => {
      try {
        return new URLSearchParams(window.location.search).get('rssFeedReadOnly') === '1'
      } catch {
        return false
      }
    })
    const [threadUnlocked, setThreadUnlocked] = useState(false)
    const [promotingThread, setPromotingThread] = useState(false)
    const showNostrThread = !rssFeedReadOnly || threadUnlocked
    const { rssFeedListEvent } = useNostr()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const [contentKey, setContentKey] = useState(0)
    const [allCachedItems, setAllCachedItems] = useState<TRssFeedItem[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedSource, setSelectedSource] = useState<'all' | string>('all')

    const articleUrl = useMemo(() => {
      try {
        return decodeRssArticlePathSegment(articleKey)
      } catch {
        return ''
      }
    }, [articleKey])

    useEffect(() => {
      setThreadUnlocked(false)
      try {
        setRssFeedReadOnly(
          new URLSearchParams(window.location.search).get('rssFeedReadOnly') === '1'
        )
      } catch {
        setRssFeedReadOnly(false)
      }
    }, [articleKey])

    useEffect(() => {
      const sync = () => {
        try {
          setRssFeedReadOnly(
            new URLSearchParams(window.location.search).get('rssFeedReadOnly') === '1'
          )
        } catch {
          setRssFeedReadOnly(false)
        }
      }
      window.addEventListener('popstate', sync)
      return () => window.removeEventListener('popstate', sync)
    }, [])

    const subscribedFeedUrls = useMemo(() => {
      if (!rssFeedListEvent?.tags?.length) return new Set<string>()
      const s = new Set<string>()
      for (const t of rssFeedListEvent.tags) {
        if (t[0] === 'u' && t[1]) s.add(normalizeFeedUrl(String(t[1])))
      }
      return s
    }, [rssFeedListEvent])

    const matchingItems = useMemo(() => {
      if (!articleUrl) return []
      const canon = canonicalizeRssArticleUrl(articleUrl)
      const fromDb = allCachedItems.filter((i) => canonicalizeRssArticleUrl(i.link) === canon)
      let result =
        subscribedFeedUrls.size === 0
          ? fromDb
          : fromDb.filter((i) => subscribedFeedUrls.has(normalizeFeedUrl(i.feedUrl)))
      if (initialItem && canonicalizeRssArticleUrl(initialItem.link) === canon) {
        const norm = normalizeFeedUrl(initialItem.feedUrl)
        const has = result.some(
          (i) => normalizeFeedUrl(i.feedUrl) === norm && i.guid === initialItem.guid
        )
        if (!has) result = [initialItem, ...result]
      }
      if (!loading && result.length === 0 && isHttpArticleUrl(articleUrl)) {
        return [createWebOnlyRssFeedItem(articleUrl)]
      }
      return result
    }, [allCachedItems, articleUrl, subscribedFeedUrls, initialItem, loading])

    const sourceOptions = useMemo(() => {
      const m = new Map<string, string>()
      for (const i of matchingItems) {
        const u = normalizeFeedUrl(i.feedUrl)
        if (!m.has(u)) {
          m.set(
            u,
            isWebOnlyFauxRssItem(i) ? t('Web page') : (i.feedTitle?.trim() || u)
          )
        }
      }
      return [...m.entries()].map(([url, title]) => ({ url, title }))
    }, [matchingItems, t])

    const itemsToRender = useMemo(() => {
      if (matchingItems.length === 0) return []
      if (matchingItems.length === 1 || selectedSource === 'all') return matchingItems
      return matchingItems.filter((i) => normalizeFeedUrl(i.feedUrl) === selectedSource)
    }, [matchingItems, selectedSource])

    useEffect(() => {
      if (sourceOptions.length <= 1) {
        if (selectedSource !== 'all') setSelectedSource('all')
        return
      }
      if (
        selectedSource !== 'all' &&
        !sourceOptions.some((o) => o.url === selectedSource)
      ) {
        setSelectedSource('all')
      }
    }, [sourceOptions, selectedSource])

    useEffect(() => {
      if (!articleUrl) {
        setLoading(false)
        return
      }
      let cancelled = false
      ;(async () => {
        setLoading(true)
        try {
          const items = await indexedDb.getRssFeedItems()
          if (cancelled) return
          setAllCachedItems(items)
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
      return () => {
        cancelled = true
      }
    }, [articleUrl])

    const syntheticRoot = useMemo(
      () => (articleUrl ? createRssThreadRootEvent(articleUrl) : null),
      [articleUrl]
    )

    const primaryRssItem = itemsToRender[0] ?? null

    useEffect(() => {
      if (hideTitlebar) {
        sessionStorage.setItem('notePageTitle', primaryRssItem ? t('RSS article') : t('Web page'))
      }
      return () => {
        if (hideTitlebar) {
          sessionStorage.removeItem('notePageTitle')
        }
      }
    }, [hideTitlebar, t, primaryRssItem])

    const refreshArticle = useCallback(async () => {
      setContentKey((k) => k + 1)
      if (!articleUrl) return
      setLoading(true)
      try {
        const items = await indexedDb.getRssFeedItems()
        setAllCachedItems(items)
      } finally {
        setLoading(false)
      }
    }, [articleUrl])

    const onPromoteForNostrThread = useCallback(async () => {
      if (!articleUrl || !isHttpArticleUrl(articleUrl)) return
      setPromotingThread(true)
      try {
        await promoteRssArticleForNostrThread(articleUrl)
        setThreadUnlocked(true)
      } finally {
        setPromotingThread(false)
      }
    }, [articleUrl])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(() => {
        void refreshArticle()
      })
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, refreshArticle])

    const refreshControls = hideTitlebar ? undefined : <RefreshButton onClick={() => void refreshArticle()} />

    if (!articleUrl) {
      return (
        <SecondaryPageLayout
          ref={ref}
          index={index}
          title={hideTitlebar ? undefined : t('RSS article')}
          controls={refreshControls}
        >
          <div key={contentKey} className="px-4 py-6 text-sm text-muted-foreground">
            {t('Invalid article link.')}
          </div>
        </SecondaryPageLayout>
      )
    }

    if (loading && matchingItems.length === 0) {
      return (
        <SecondaryPageLayout
          ref={ref}
          index={index}
          title={hideTitlebar ? undefined : t('RSS article')}
          controls={refreshControls}
        >
          <div key={contentKey} className="px-4 py-6 text-sm text-muted-foreground">
            {t('Loading…')}
          </div>
        </SecondaryPageLayout>
      )
    }

    if (matchingItems.length === 0) {
      return (
        <SecondaryPageLayout
          ref={ref}
          index={index}
          title={hideTitlebar ? undefined : t('Web page')}
          controls={refreshControls}
          displayScrollToTopButton
        >
          <div key={contentKey} className="px-4 pt-3 pb-4 w-full space-y-4">
            <p className="text-xs text-muted-foreground">
              {t('Opened by URL — not from your RSS list. Nostr thread is still tied to this link.')}
            </p>
            {rssFeedReadOnly && !threadUnlocked ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t('RSS read-only thread hint')}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={promotingThread}
                  onClick={() => void onPromoteForNostrThread()}
                >
                  {t('Respond to this RSS entry')}
                </Button>
              </div>
            ) : null}
            {showNostrThread && syntheticRoot ? (
              <div className="px-0 w-full">
                <NoteStats className="mt-2" event={syntheticRoot} fetchIfNotExisting displayTopZapsAndLikes />
              </div>
            ) : null}
            {showNostrThread ? <Separator /> : null}
            <div className="w-full">
              {showNostrThread && syntheticRoot ? (
                <NoteInteractions
                  key={`rss-interactions-${syntheticRoot.id}`}
                  pageIndex={index}
                  event={syntheticRoot}
                  showQuotes={false}
                />
              ) : null}
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
        controls={refreshControls}
        displayScrollToTopButton
      >
        <div key={contentKey} className="min-w-0">
          <div className="px-4 pt-3 w-full space-y-3">
            {rssFeedReadOnly && !threadUnlocked ? (
              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{t('RSS read-only thread hint')}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={promotingThread || !isHttpArticleUrl(articleUrl)}
                  onClick={() => void onPromoteForNostrThread()}
                >
                  {t('Respond to this RSS entry')}
                </Button>
              </div>
            ) : null}
            {sourceOptions.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="rss-thread-feed-source" className="text-xs text-muted-foreground">
                  {t('RSS feed source')}
                </Label>
                <Select
                  value={selectedSource}
                  onValueChange={(v) => setSelectedSource(v === 'all' ? 'all' : v)}
                >
                  <SelectTrigger id="rss-thread-feed-source" className="h-9 w-full max-w-md text-sm">
                    <SelectValue placeholder={t('RSS feed source')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('All feed sources')}</SelectItem>
                    {sourceOptions.map(({ url, title }) => (
                      <SelectItem key={url} value={url}>
                        {title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div
              className={
                itemsToRender.length > 1 ? 'divide-y divide-border rounded-lg border border-border overflow-hidden' : ''
              }
            >
              {itemsToRender.map((it) => (
                <RssFeedItem
                  key={`${it.feedUrl}-${it.guid}`}
                  item={it}
                  layout="detail"
                  className={itemsToRender.length > 1 ? 'rounded-none border-0' : ''}
                  readOnlyHighlights={rssFeedReadOnly && !threadUnlocked}
                />
              ))}
            </div>
          </div>
          {showNostrThread && syntheticRoot ? (
            <div className="px-4 w-full">
              <NoteStats className="mt-3" event={syntheticRoot} fetchIfNotExisting displayTopZapsAndLikes />
            </div>
          ) : null}
          {showNostrThread ? <Separator className="mt-4" /> : null}
          <div className="px-4 pb-4 w-full">
            {showNostrThread && syntheticRoot ? (
              <NoteInteractions
                key={`rss-interactions-${syntheticRoot.id}`}
                pageIndex={index}
                event={syntheticRoot}
                showQuotes={false}
              />
            ) : null}
          </div>
        </div>
      </SecondaryPageLayout>
    )
  }
)

RssArticlePage.displayName = 'RssArticlePage'
export default RssArticlePage
