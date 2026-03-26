import { InviteePicker } from '@/components/InviteePicker'
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ExtendedKind } from '@/constants'
import { appendCuratedReadOnlyRelays } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import {
  buildFollowSetTags,
  dedupeFollowSetEventsByD,
  extractFollowSetEditorFields,
  labelFollowSetEvent
} from '@/lib/follow-set-spell'
import { randomString } from '@/lib/random'
import { showPublishingError } from '@/lib/publishing-feedback'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { getRelayUrlsWithFavoritesFastReadAndInbox } from '@/lib/favorites-feed-relays'
import { createFollowSetDraftEvent } from '@/lib/draft-event'
import logger from '@/lib/logger'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { queryService } from '@/services/client.service'
import dayjs from 'dayjs'
import type { Event } from 'nostr-tools'
import { Pencil, Plus, Trash2, Users } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const FOLLOW_SET_FETCH_OPTS = {
  eoseTimeout: 2000,
  globalTimeout: 15000,
  firstRelayResultGraceMs: false
} as const

const FollowSetsSettingsPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { pubkey, publish, attemptDelete, checkLogin, relayList } = useNostr()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const [lists, setLists] = useState<Event[]>([])
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [editing, setEditing] = useState<Event | null>(null)
    const [formD, setFormD] = useState('')
    const [formTitle, setFormTitle] = useState('')
    const [formDescription, setFormDescription] = useState('')
    const [formImage, setFormImage] = useState('')
    const [formPubkeys, setFormPubkeys] = useState<string[]>([])
    const [deleteTarget, setDeleteTarget] = useState<Event | null>(null)
    const [deleting, setDeleting] = useState(false)

    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()

    const buildReadRelays = useCallback((): string[] => {
      const feedUrls = getRelayUrlsWithFavoritesFastReadAndInbox(
        favoriteRelays,
        blockedRelays,
        relayList?.read ?? [],
        { userWriteRelays: relayList?.write ?? [] }
      )
      return appendCuratedReadOnlyRelays(feedUrls, blockedRelays)
    }, [favoriteRelays, blockedRelays, relayList?.read, relayList?.write])

    const loadLists = useCallback(async () => {
      if (!pubkey) {
        setLists([])
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const urls = buildReadRelays()
        if (!urls.length) {
          setLists([])
          return
        }
        const events = await queryService.fetchEvents(
          urls,
          { authors: [pubkey], kinds: [ExtendedKind.FOLLOW_SET], limit: 500 },
          FOLLOW_SET_FETCH_OPTS
        )
        setLists(dedupeFollowSetEventsByD(events))
      } catch (e) {
        logger.warn('[FollowSetsSettings] Failed to load follow sets', e)
        toast.error(t('Failed to load follow sets'))
        setLists([])
      } finally {
        setLoading(false)
      }
    }, [pubkey, buildReadRelays, t])

    useEffect(() => {
      void loadLists()
    }, [loadLists])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(() => void loadLists())
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, loadLists])

    const openNew = () => {
      setEditing(null)
      setFormD(randomString(16))
      setFormTitle('')
      setFormDescription('')
      setFormImage('')
      setFormPubkeys([])
      setDialogOpen(true)
    }

    const openEdit = (ev: Event) => {
      const f = extractFollowSetEditorFields(ev)
      setEditing(ev)
      setFormD(f.d)
      setFormTitle(f.title)
      setFormDescription(f.description)
      setFormImage(f.image)
      setFormPubkeys(f.pubkeys)
      setDialogOpen(true)
    }

    const closeDialog = () => {
      setDialogOpen(false)
      setEditing(null)
    }

    const handleSave = async () => {
      if (!(await checkLogin())) return
      if (!pubkey) return
      let tags: string[][]
      try {
        tags = buildFollowSetTags({
          d: formD,
          title: formTitle,
          description: formDescription,
          image: formImage,
          pubkeys: formPubkeys
        })
      } catch (e) {
        toast.error((e as Error).message)
        return
      }

      setSaving(true)
      try {
        let createdAt = dayjs().unix()
        if (editing && createdAt === editing.created_at) {
          await new Promise((r) => setTimeout(r, 1100))
          createdAt = dayjs().unix()
        }
        const draft = createFollowSetDraftEvent(tags, '', createdAt)
        await publish(draft)
        toast.success(t('Follow set saved'))
        closeDialog()
        await loadLists()
      } catch (e) {
        showPublishingError(e instanceof Error ? e : new Error(String(e)))
      } finally {
        setSaving(false)
      }
    }

    const handleConfirmDelete = async () => {
      if (!deleteTarget) return
      if (!(await checkLogin())) return
      setDeleting(true)
      try {
        await attemptDelete(deleteTarget)
        toast.success(t('Follow set deleted'))
        setDeleteTarget(null)
        await loadLists()
      } catch (e) {
        showPublishingError(e instanceof Error ? e : new Error(String(e)))
      } finally {
        setDeleting(false)
      }
    }

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('Follow sets')}
        hideBackButton={hideTitlebar}
        controls={hideTitlebar ? undefined : <RefreshButton onClick={() => void loadLists()} />}
        displayScrollToTopButton
      >
        <div className="min-w-0 space-y-4 px-4 pb-8 pt-2">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('Follow sets settings intro')}
          </p>

          {!pubkey ? (
            <p className="text-sm text-muted-foreground">{t('Login to set')}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={openNew} className="gap-2">
                  <Plus className="size-4" />
                  {t('New follow set')}
                </Button>
              </div>

              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : lists.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('No follow sets yet')}</p>
              ) : (
                <ul className="space-y-2">
                  {lists.map((ev) => (
                    <li
                      key={extractFollowSetEditorFields(ev).d}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-card px-3 py-3"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{labelFollowSetEvent(ev)}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {extractFollowSetEditorFields(ev).pubkeys.length} {t('members')}
                            <span className="mx-1">·</span>
                            <code className="text-[11px]">d={extractFollowSetEditorFields(ev).d}</code>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(ev)}
                          title={t('Edit')}
                        >
                          <Pencil className="size-4" />
                          <span className="sr-only">{t('Edit')}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(ev)}
                          title={t('Delete')}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">{t('Delete')}</span>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
          <DialogContent className="max-h-[min(90dvh,36rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? t('Edit follow set') : t('New follow set')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label htmlFor="follow-set-d">{t('List id (d tag)')}</Label>
                <Input
                  id="follow-set-d"
                  value={formD}
                  onChange={(e) => setFormD(e.target.value)}
                  disabled={!!editing}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{t('Follow set d tag hint')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="follow-set-title">{t('Title')}</Label>
                <Input
                  id="follow-set-title"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder={t('Optional display title')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="follow-set-desc">{t('Description')}</Label>
                <Textarea
                  id="follow-set-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  placeholder={t('Optional')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="follow-set-image">{t('Image URL')}</Label>
                <Input
                  id="follow-set-image"
                  value={formImage}
                  onChange={(e) => setFormImage(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className="space-y-1">
                <Label id="follow-set-members-label">{t('People in this list')}</Label>
                <InviteePicker
                  labelId="follow-set-members-label"
                  value={formPubkeys}
                  onChange={setFormPubkeys}
                  placeholder={t('Search by name or npub…')}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={closeDialog}>
                {t('Cancel')}
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={saving || !formD.trim()}>
                {saving ? t('loading...') : t('Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Delete follow set?')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('Delete follow set confirm')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t('Cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault()
                  void handleConfirmDelete()
                }}
              >
                {deleting ? t('loading...') : t('Delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SecondaryPageLayout>
    )
  }
)

FollowSetsSettingsPage.displayName = 'FollowSetsSettingsPage'
export default FollowSetsSettingsPage
