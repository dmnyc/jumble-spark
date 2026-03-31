import JsonViewDialog from '@/components/JsonViewDialog'
import ProfileList from '@/components/ProfileList'
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
import { useFetchFollowings, useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { FOLLOWS_HISTORY_RELAY_URLS } from '@/constants'
import { createFollowListDraftEvent } from '@/lib/draft-event'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Code, Eraser, MoreVertical } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const FollowingListPage = forwardRef(({ id, index, hideTitlebar = false }: { id?: string; index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { pubkey: accountPubkey, publish, updateFollowListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [listRefreshNonce, setListRefreshNonce] = useState(0)
  const { profile } = useFetchProfile(id)
  const { followings, followListEvent } = useFetchFollowings(profile?.pubkey, listRefreshNonce)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [followJsonPayload, setFollowJsonPayload] = useState<unknown>(null)
  const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const isOwnList = !!accountPubkey && profile?.pubkey === accountPubkey

  const bumpList = useCallback(() => setListRefreshNonce((n) => n + 1), [])

  const openFollowingListJson = useCallback(() => {
    setFollowJsonPayload({
      pubkey: profile?.pubkey ?? null,
      contactsKind3Event: followListEvent ?? null,
      derivedFollowingPubkeys: followings,
      note: 'Following pubkeys are derived from `p` tags on the kind 3 contacts event when present.'
    })
    setJsonOpen(true)
  }, [profile?.pubkey, followListEvent, followings])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpList)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bumpList])

  const handleCleanList = useCallback(async () => {
    if (!accountPubkey || !isOwnList || cleaning) return
    setCleaning(true)
    try {
      const comprehensiveRelays = await buildAccountListRelayUrlsForMerge({
        accountPubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })

      if (followListEvent) {
        const historyDraft = createFollowListDraftEvent(followListEvent.tags ?? [], followListEvent.content ?? '')
        await publish(historyDraft, { specifiedRelayUrls: FOLLOWS_HISTORY_RELAY_URLS })
      }

      const draft = createFollowListDraftEvent([], '')
      const published = await publish(draft, { specifiedRelayUrls: comprehensiveRelays })
      await updateFollowListEvent(published)
      bumpList()
      toast.success(t('List cleaned'))
    } catch (e) {
      toast.error(t('Failed to clean list') + ': ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setCleaning(false)
      setCleanConfirmOpen(false)
    }
  }, [
    accountPubkey,
    isOwnList,
    cleaning,
    followListEvent,
    publish,
    updateFollowListEvent,
    favoriteRelays,
    blockedRelays,
    bumpList,
    t
  ])

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={
        hideTitlebar
          ? undefined
          : profile?.username
            ? t("username's following", { username: profile.username })
            : t('Following')
      }
      hideBackButton={hideTitlebar}
      controls={
        hideTitlebar ? undefined : (
          <div className="flex items-center gap-0">
            <RefreshButton onClick={bumpList} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('More options')}>
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openFollowingListJson()}>
                  <Code className="size-4 mr-2" />
                  {t('View JSON')}
                </DropdownMenuItem>
                {isOwnList ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setCleanConfirmOpen(true)}
                  >
                    <Eraser className="size-4 mr-2" />
                    {t('Clean list')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      }
      displayScrollToTopButton
    >
      <JsonViewDialog value={followJsonPayload} isOpen={jsonOpen} onClose={() => setJsonOpen(false)} />
      <ProfileList pubkeys={followings} />
      <AlertDialog open={cleanConfirmOpen} onOpenChange={setCleanConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Clean this list?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Clean follows list confirm with backup')}
            </AlertDialogDescription>
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
    </SecondaryPageLayout>
  )
})
FollowingListPage.displayName = 'FollowingListPage'
export default FollowingListPage
