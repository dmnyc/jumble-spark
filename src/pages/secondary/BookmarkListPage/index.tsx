import JsonViewDialog from '@/components/JsonViewDialog'
import PersonalListBech32List from '@/components/PersonalListBech32List'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { bookmarkBech32IdsFromListEvent } from '@/lib/personal-list-refs'
import { useNostr } from '@/providers/NostrProvider'
import { getLatestEvent } from '@/lib/event'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { fetchLatestReplaceableListEvent } from '@/lib/replaceable-list-latest'
import { normalizeUrl } from '@/lib/url'
import { PROFILE_FETCH_RELAY_URLS } from '@/constants'
import { queryService } from '@/services/client.service'
import { Code, MoreVertical } from 'lucide-react'
import { kinds } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NotFoundPage from '../NotFoundPage'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'

const BookmarkListPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const { profile, pubkey, bookmarkListEvent, relayList, updateBookmarkListEvent } = useNostr()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const [jsonOpen, setJsonOpen] = useState(false)
    const [jsonPayload, setJsonPayload] = useState<unknown>(null)

    const bech32Ids = useMemo(() => bookmarkBech32IdsFromListEvent(bookmarkListEvent), [bookmarkListEvent])

    const refreshFromRelays = useCallback(async () => {
      if (!pubkey) return
      const comprehensiveRelays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      let latest =
        (await fetchLatestReplaceableListEvent(pubkey, kinds.BookmarkList, comprehensiveRelays)) ?? null
      if (!latest) {
        const urls = Array.from(
          new Set(
            [
              ...PROFILE_FETCH_RELAY_URLS.map((u) => normalizeUrl(u) || u),
              ...(relayList?.write ?? []).map((u) => normalizeUrl(u) || u)
            ].filter(Boolean)
          )
        ).slice(0, 12)
        if (urls.length) {
          try {
            const events = await queryService.fetchEvents(urls, {
              kinds: [kinds.BookmarkList],
              authors: [pubkey],
              limit: 5
            })
            latest = getLatestEvent(events) ?? null
          } catch {
            /* ignore */
          }
        }
      }
      if (latest) await updateBookmarkListEvent(latest)
    }, [pubkey, favoriteRelays, blockedRelays, relayList?.write, updateBookmarkListEvent])

    const openJson = useCallback(() => {
      setJsonPayload({
        bookmarkListEvent: bookmarkListEvent ?? null,
        derivedBech32Ids: bech32Ids,
        note: 'Bookmarks are `e` / `a` tags on your kind 10003 (NIP-51) bookmark list replaceable event.'
      })
      setJsonOpen(true)
    }, [bookmarkListEvent, bech32Ids])

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

    if (!profile || !pubkey) {
      return <NotFoundPage />
    }

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={
          hideTitlebar
            ? undefined
            : t("username's bookmarks", { username: profile.username, defaultValue: `${profile.username}'s bookmarks` })
        }
        hideBackButton={hideTitlebar}
        controls={
          hideTitlebar ? undefined : (
            <div className="flex items-center gap-0">
              <RefreshButton onClick={() => void refreshFromRelays()} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('More options')}>
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openJson()}>
                    <Code className="mr-2 size-4" />
                    {t('View JSON')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
        displayScrollToTopButton
      >
        <JsonViewDialog value={jsonPayload} isOpen={jsonOpen} onClose={() => setJsonOpen(false)} />
        <div key={bookmarkListEvent?.id ?? 'none'} className="min-h-[30vh] pt-1">
          {bech32Ids.length === 0 ? (
            <p className="px-4 pt-4 text-center text-sm text-muted-foreground">{t('No entries in bookmark list')}</p>
          ) : (
            <PersonalListBech32List bech32Ids={bech32Ids} listMode="bookmark" />
          )}
        </div>
      </SecondaryPageLayout>
    )
  }
)

BookmarkListPage.displayName = 'BookmarkListPage'
export default BookmarkListPage
