import JsonViewDialog from '@/components/JsonViewDialog'
import MuteButton from '@/components/MuteButton'
import Nip05 from '@/components/Nip05'
import ProfileAbout from '@/components/ProfileAbout'
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
import { Skeleton } from '@/components/ui/skeleton'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { createMuteListDraftEvent } from '@/lib/draft-event'
import { useMuteList } from '@/contexts/mute-list-context'
import indexedDb from '@/services/indexed-db.service'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Code, Eraser, Lock, MoreVertical, Unlock } from 'lucide-react'
import dayjs from 'dayjs'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import NotFoundPage from '../NotFoundPage'

const MuteListPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { profile, pubkey, muteListEvent, publish, updateMuteListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { getMutePubkeys } = useMuteList()
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonPayload, setJsonPayload] = useState<unknown>(null)
  const mutePubkeys = useMemo(() => getMutePubkeys(), [getMutePubkeys])
  const [visibleMutePubkeys, setVisibleMutePubkeys] = useState<string[]>([])
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const bumpList = useCallback(() => setListRefreshKey((k) => k + 1), [])

  const openMuteListJson = useCallback(async () => {
    const derivedPubkeys = getMutePubkeys()
    let indexedDbDecryptedPrivateTags: string[][] | null = null
    if (muteListEvent?.id) {
      try {
        indexedDbDecryptedPrivateTags = await indexedDb.getMuteDecryptedTags(muteListEvent.id)
      } catch {
        indexedDbDecryptedPrivateTags = null
      }
    }
    setJsonPayload({
      muteListEvent: muteListEvent ?? null,
      derivedMutePubkeys: derivedPubkeys,
      indexedDbDecryptedPrivateTags,
      note:
        'Private mutes live in kind 10000 `content` (NIP-04). Decrypt failures in the console usually mean wrong key, read-only session, or bad/corrupt ciphertext — not necessarily a bad public tag list.'
    })
    setJsonOpen(true)
  }, [getMutePubkeys, muteListEvent])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpList)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bumpList])

  useEffect(() => {
    setVisibleMutePubkeys(mutePubkeys.slice(0, 10))
  }, [mutePubkeys, listRefreshKey])

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && mutePubkeys.length > visibleMutePubkeys.length) {
        setVisibleMutePubkeys((prev) => [
          ...prev,
          ...mutePubkeys.slice(prev.length, prev.length + 10)
        ])
      }
    }, options)

    const currentBottomRef = bottomRef.current
    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [visibleMutePubkeys, mutePubkeys])

  const handleCleanList = useCallback(async () => {
    if (!pubkey || cleaning) return
    setCleaning(true)
    try {
      if (dayjs().unix() === muteListEvent?.created_at) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      const comprehensiveRelays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      const draft = createMuteListDraftEvent([], '')
      const published = await publish(draft, { specifiedRelayUrls: comprehensiveRelays })
      await updateMuteListEvent(published, [])
      bumpList()
      toast.success(t('List cleaned'))
    } catch (e) {
      toast.error(t('Failed to clean list') + ': ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setCleaning(false)
      setCleanConfirmOpen(false)
    }
  }, [pubkey, cleaning, favoriteRelays, blockedRelays, publish, updateMuteListEvent, bumpList, t])

  if (!profile) {
    return <NotFoundPage />
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : t("username's muted", { username: profile.username })}
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
                <DropdownMenuItem onClick={() => void openMuteListJson()}>
                  <Code className="size-4 mr-2" />
                  {t('View JSON')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setCleanConfirmOpen(true)}
                >
                  <Eraser className="size-4 mr-2" />
                  {t('Clean list')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      }
      displayScrollToTopButton
    >
      <JsonViewDialog
        value={jsonPayload}
        isOpen={jsonOpen}
        onClose={() => setJsonOpen(false)}
      />
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
      <div key={listRefreshKey} className="space-y-2 px-4 pt-2">
        {visibleMutePubkeys.map((pubkey, index) => (
          <UserItem key={`${index}-${pubkey}`} pubkey={pubkey} />
        ))}
        {mutePubkeys.length > visibleMutePubkeys.length && <div ref={bottomRef} />}
      </div>
    </SecondaryPageLayout>
  )
})
MuteListPage.displayName = 'MuteListPage'
export default MuteListPage

function UserItem({ pubkey }: { pubkey: string }) {
  const { changing, getMuteType, switchToPrivateMute, switchToPublicMute } = useMuteList()
  const { profile } = useFetchProfile(pubkey)
  const muteType = useMemo(() => getMuteType(pubkey), [pubkey, getMuteType])
  const [switching, setSwitching] = useState(false)

  return (
    <div className="flex gap-2 items-start">
      <UserAvatar userId={pubkey} className="shrink-0" />
      <div className="w-full overflow-hidden">
        <Username
          userId={pubkey}
          className="font-semibold truncate max-w-full w-fit"
          skeletonClassName="h-4"
        />
        <Nip05 pubkey={pubkey} />
        <ProfileAbout about={profile?.about} className="line-clamp-2 text-muted-foreground text-sm break-words" />
      </div>
      <div className="flex gap-2 items-center">
        {switching ? (
          <Button disabled variant="ghost" size="icon">
            <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
          </Button>
        ) : muteType === 'private' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (switching) return

              setSwitching(true)
              switchToPublicMute(pubkey).finally(() => setSwitching(false))
            }}
            disabled={changing}
          >
            <Lock className="text-green-400" />
          </Button>
        ) : muteType === 'public' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (switching) return

              setSwitching(true)
              switchToPrivateMute(pubkey).finally(() => setSwitching(false))
            }}
            disabled={changing}
          >
            <Unlock className="text-muted-foreground" />
          </Button>
        ) : null}
        <MuteButton pubkey={pubkey} />
      </div>
    </div>
  )
}
