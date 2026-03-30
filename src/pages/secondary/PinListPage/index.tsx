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
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { pinBech32IdsFromListEvent } from '@/lib/personal-list-refs'
import { fetchNewestPinListForPubkey } from '@/lib/replaceable-list-latest'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import indexedDb from '@/services/indexed-db.service'
import { Code, MoreVertical } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NotFoundPage from '../NotFoundPage'

const PinListPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const { profile, pubkey } = useNostr()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const [pinListEvent, setPinListEvent] = useState<Event | null>(null)
    const [jsonOpen, setJsonOpen] = useState(false)
    const [jsonPayload, setJsonPayload] = useState<unknown>(null)

    const loadPins = useCallback(async () => {
      if (!pubkey) {
        setPinListEvent(null)
        return
      }
      let cached: Event | null | undefined
      try {
        cached = (await indexedDb.getReplaceableEvent(pubkey, 10001)) ?? undefined
      } catch {
        cached = undefined
      }
      const relays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      const fromNet = await fetchNewestPinListForPubkey(pubkey, relays)
      const best =
        !cached && fromNet
          ? fromNet
          : cached && !fromNet
            ? cached
            : cached && fromNet
              ? fromNet.created_at >= cached.created_at
                ? fromNet
                : cached
              : null
      setPinListEvent(best ?? null)
      if (best) {
        try {
          await indexedDb.putReplaceableEvent(best)
        } catch {
          /* ignore */
        }
      }
    }, [pubkey, favoriteRelays, blockedRelays])

    useEffect(() => {
      void loadPins()
    }, [loadPins])

    const bech32Ids = useMemo(() => pinBech32IdsFromListEvent(pinListEvent), [pinListEvent])

    const openJson = useCallback(() => {
      setJsonPayload({
        pinListEvent: pinListEvent ?? null,
        derivedBech32Ids: bech32Ids,
        note: 'Pins are `e` / `a` tags on your kind 10001 replaceable pin list event.'
      })
      setJsonOpen(true)
    }, [pinListEvent, bech32Ids])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(() => {
        void loadPins()
      })
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, loadPins])

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
            : t("username's pinned notes", {
                username: profile.username,
                defaultValue: `${profile.username}'s pinned notes`
              })
        }
        hideBackButton={hideTitlebar}
        controls={
          hideTitlebar ? undefined : (
            <div className="flex items-center gap-0">
              <RefreshButton onClick={() => void loadPins()} />
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
        <div key={pinListEvent?.id ?? 'none'} className="min-h-[30vh] pt-1">
          {bech32Ids.length === 0 ? (
            <p className="px-4 pt-4 text-center text-sm text-muted-foreground">{t('No pinned notes in list')}</p>
          ) : (
            <PersonalListBech32List
              bech32Ids={bech32Ids}
              listMode="pin"
              onEntryRemoved={() => void loadPins()}
            />
          )}
        </div>
      </SecondaryPageLayout>
    )
  }
)

PinListPage.displayName = 'PinListPage'
export default PinListPage
