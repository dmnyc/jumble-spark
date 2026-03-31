import JsonViewDialog from '@/components/JsonViewDialog'
import PersonalListBech32List from '@/components/PersonalListBech32List'
import { RefreshButton } from '@/components/RefreshButton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
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
import { Code, Eraser, MoreVertical } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import NotFoundPage from '../NotFoundPage'

const PinListPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const { profile, pubkey, publish } = useNostr()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const [pinListEvent, setPinListEvent] = useState<Event | null>(null)
    const [jsonOpen, setJsonOpen] = useState(false)
    const [jsonPayload, setJsonPayload] = useState<unknown>(null)
    const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false)
    const [cleaning, setCleaning] = useState(false)

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

    const handleCleanList = useCallback(async () => {
      if (!pubkey || cleaning) return
      setCleaning(true)
      try {
        const comprehensiveRelays = await buildAccountListRelayUrlsForMerge({
          accountPubkey: pubkey,
          favoriteRelays: favoriteRelays ?? [],
          blockedRelays
        })
        const draft = { kind: 10001, content: '', tags: [], created_at: Math.floor(Date.now() / 1000) }
        const published = await publish(draft, { specifiedRelayUrls: comprehensiveRelays })
        setPinListEvent(published as Event)
        try {
          await indexedDb.putReplaceableEvent(published as Event)
        } catch {
          /* ignore */
        }
        toast.success(t('List cleaned'))
      } catch (e) {
        toast.error(t('Failed to clean list') + ': ' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setCleaning(false)
        setCleanConfirmOpen(false)
      }
    }, [pubkey, cleaning, favoriteRelays, blockedRelays, publish, t])

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
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setCleanConfirmOpen(true)}
                  >
                    <Eraser className="mr-2 size-4" />
                    {t('Clean list')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
        displayScrollToTopButton
      >
        <JsonViewDialog value={jsonPayload} isOpen={jsonOpen} onClose={() => setJsonOpen(false)} />
        <AlertDialog open={cleanConfirmOpen} onOpenChange={setCleanConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Clean this list?')}</AlertDialogTitle>
              <AlertDialogDescription>{t('Clean list confirm')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cleaning}>{t('Cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={cleaning}
                onClick={(e) => {
                  e.preventDefault()
                  void handleCleanList()
                }}
              >
                {cleaning ? t('loading...') : t('Clean list')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
