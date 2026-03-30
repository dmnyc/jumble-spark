import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { ExtendedKind } from '@/constants'
import { createWebBookmarkDraftEvent } from '@/lib/draft-event'
import { getRelayUrlsWithFavoritesFastReadAndInbox } from '@/lib/favorites-feed-relays'
import logger from '@/lib/logger'
import { showPublishingError } from '@/lib/publishing-feedback'
import {
  canonicalizeRssArticleUrl,
  createRssThreadRootEvent,
  expandArticleUrlThreadQueryValues,
  getWebBookmarkArticleUrl
} from '@/lib/rss-article'
import { appendCuratedReadOnlyRelays } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import noteStatsService from '@/services/note-stats.service'
import { Trash2 } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * NIP-B0 (kind 39701) web bookmarks for the current article URL: list, add, and remove (replaceable tombstone).
 * Shown under URL cards on {@link RssArticlePage}, separate from NIP-51 bookmark lists.
 */
export default function RssArticleWebBookmarks({ articleUrl }: { articleUrl: string }) {
  const { t } = useTranslation()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { pubkey, publish, attemptDelete, relayList, account } = useNostr()

  const canonical = useMemo(() => canonicalizeRssArticleUrl(articleUrl), [articleUrl])
  const iVals = useMemo(() => {
    const v = expandArticleUrlThreadQueryValues(canonical)
    return v.length > 0 ? v : [canonical]
  }, [canonical])

  const relayUrls = useMemo(() => {
    const read = relayList?.read ?? []
    const base = getRelayUrlsWithFavoritesFastReadAndInbox(favoriteRelays, blockedRelays, read, {})
    if (!base.length) return []
    return appendCuratedReadOnlyRelays(base, blockedRelays)
  }, [favoriteRelays, blockedRelays, relayList?.read])

  const [mine, setMine] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')

  const reload = useCallback(async () => {
    if (!pubkey || !relayUrls.length) {
      setMine([])
      return
    }
    setLoading(true)
    try {
      const filters = [
        { authors: [pubkey], kinds: [ExtendedKind.WEB_BOOKMARK], '#i': iVals, limit: 40 },
        { authors: [pubkey], kinds: [ExtendedKind.WEB_BOOKMARK], '#I': iVals, limit: 40 }
      ]
      const batches = await Promise.all(
        filters.map((f) => client.fetchEvents(relayUrls, f, { cache: false }).catch(() => [] as Event[]))
      )
      const byKey = new Map<string, Event>()
      for (const ev of batches.flat()) {
        if (ev.pubkey !== pubkey) continue
        const u = getWebBookmarkArticleUrl(ev)
        if (!u || canonicalizeRssArticleUrl(u) !== canonical) continue
        const d = ev.tags.find((t) => t[0] === 'd')?.[1]
        const key = d ? `wb:${pubkey}:${d}` : ev.id
        const prev = byKey.get(key)
        if (!prev || ev.created_at > prev.created_at) byKey.set(key, ev)
      }
      setMine([...byKey.values()].sort((a, b) => b.created_at - a.created_at))
    } catch (e) {
      logger.warn('[RssArticleWebBookmarks] fetch failed', e)
      setMine([])
    } finally {
      setLoading(false)
    }
  }, [pubkey, relayUrls, iVals, canonical])

  useEffect(() => {
    void reload()
  }, [reload])

  const rssRootId = useMemo(() => createRssThreadRootEvent(articleUrl).id, [articleUrl])

  const onSave = async () => {
    if (!pubkey || account?.signerType === 'npub') {
      showPublishingError(new Error(t('Sign in to publish web bookmark')))
      return
    }
    setSaving(true)
    try {
      const draft = createWebBookmarkDraftEvent({
        url: articleUrl,
        title: title.trim() || undefined,
        note: note.trim() || undefined
      })
      const ev = await publish(draft)
      setTitle('')
      setNote('')
      await reload()
      noteStatsService.updateNoteStatsByEvents([ev], undefined, {
        interactionTargetNoteId: rssRootId
      })
    } catch (e) {
      showPublishingError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setSaving(false)
    }
  }

  const onRemove = async (ev: Event) => {
    try {
      await attemptDelete(ev)
      await reload()
    } catch (e) {
      showPublishingError(e instanceof Error ? e : new Error(String(e)))
    }
  }

  if (!pubkey) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {t('Log in to save web bookmarks')}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/15 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('Web bookmarks')}</h3>
        {loading ? <span className="text-xs text-muted-foreground">{t('Loading...')}</span> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('Web bookmarks NIP intro')}
      </p>

      {mine.length > 0 ? (
        <ul className="space-y-2">
          {mine.map((ev) => {
            const label =
              ev.tags.find((t) => t[0] === 'title')?.[1]?.trim() || getWebBookmarkArticleUrl(ev) || t('Web bookmark')
            return (
              <li
                key={`${ev.pubkey}:${ev.tags.find((t) => t[0] === 'd')?.[1] ?? ev.id}`}
                className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-background/50 px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 break-words">{label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  title={t('Remove web bookmark')}
                  onClick={() => void onRemove(ev)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : !loading ? (
        <p className="text-xs text-muted-foreground">{t('No web bookmark for this URL yet')}</p>
      ) : null}

      <Separator />

      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor="wb-title" className="text-xs text-muted-foreground">
            {t('Title')} ({t('optional')})
          </Label>
          <Input
            id="wb-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('Page title')}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wb-note" className="text-xs text-muted-foreground">
            {t('Note')} ({t('optional')})
          </Label>
          <Textarea
            id="wb-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('Short description')}
            rows={2}
            className="min-h-[4rem] resize-y text-sm"
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={saving || account?.signerType === 'npub'}
          onClick={() => void onSave()}
        >
          {saving ? t('Publishing...') : t('Save web bookmark')}
        </Button>
      </div>
    </div>
  )
}
