import JsonViewDialog from '@/components/JsonViewDialog'
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
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { createInterestListDraftEvent } from '@/lib/draft-event'
import { normalizeTopic } from '@/lib/discussion-topics'
import { toNoteList } from '@/lib/link'
import { fetchLatestReplaceableListEvent } from '@/lib/replaceable-list-latest'
import { cn } from '@/lib/utils'
import { useSmartHashtagNavigation } from '@/PageManager'
import { useInterestList } from '@/providers/InterestListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import { Code, Eraser, MoreVertical, Trash2 } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import NotFoundPage from '../NotFoundPage'

const INTEREST_LIST_KIND = 10015

const InterestListPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const { navigateToHashtag } = useSmartHashtagNavigation()
    const { profile, pubkey, interestListEvent, publish, updateInterestListEvent } = useNostr()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const { subscribedTopics, subscribe, unsubscribe, changing } = useInterestList()
    const [topicInput, setTopicInput] = useState('')
    const [jsonOpen, setJsonOpen] = useState(false)
    const [jsonPayload, setJsonPayload] = useState<unknown>(null)
    const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false)
    const [cleaning, setCleaning] = useState(false)

    const topicsSorted = useMemo(
      () => [...subscribedTopics].sort((a, b) => a.localeCompare(b)),
      [subscribedTopics]
    )

    const refreshFromRelays = useCallback(async () => {
      if (!pubkey) return
      const comprehensiveRelays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      let latest =
        (await fetchLatestReplaceableListEvent(pubkey, INTEREST_LIST_KIND, comprehensiveRelays)) ?? null
      if (!latest) {
        latest = (await client.fetchInterestListEvent(pubkey)) ?? null
      }
      if (latest) await updateInterestListEvent(latest)
    }, [pubkey, favoriteRelays, blockedRelays, updateInterestListEvent])

    const openJson = useCallback(() => {
      setJsonPayload({
        interestListEvent: interestListEvent ?? null,
        derivedTopics: topicsSorted,
        note: 'Interest list is kind 10015; subscribed topics are stored as `t` tags.'
      })
      setJsonOpen(true)
    }, [interestListEvent, topicsSorted])

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

    const onAddTopic = async (e: React.FormEvent) => {
      e.preventDefault()
      const raw = topicInput.trim().replace(/^#+/u, '')
      const normalized = normalizeTopic(raw)
      if (!normalized) {
        toast.error(t('Interest topic invalid'))
        return
      }
      await subscribe(normalized)
      setTopicInput('')
    }

    const handleCleanList = useCallback(async () => {
      if (!pubkey || cleaning) return
      setCleaning(true)
      try {
        const comprehensiveRelays = await buildAccountListRelayUrlsForMerge({
          accountPubkey: pubkey,
          favoriteRelays: favoriteRelays ?? [],
          blockedRelays
        })
        const draft = createInterestListDraftEvent([], '')
        const published = await publish(draft, { specifiedRelayUrls: comprehensiveRelays })
        await updateInterestListEvent(published)
        toast.success(t('List cleaned'))
      } catch (e) {
        toast.error(t('Failed to clean list') + ': ' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setCleaning(false)
        setCleanConfirmOpen(false)
      }
    }, [pubkey, cleaning, favoriteRelays, blockedRelays, publish, updateInterestListEvent, t])

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
            : t("username's interest topics", {
                username: profile.username,
                defaultValue: `${profile.username}'s interest topics`
              })
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
        <div className="min-w-0 space-y-3 px-3 pb-4 pt-2">
          <p className="text-sm text-muted-foreground">{t('Interests list section subtitle')}</p>
          <form onSubmit={(ev) => void onAddTopic(ev)} className="flex flex-wrap items-center gap-2">
            <Input
              value={topicInput}
              onChange={(ev) => setTopicInput(ev.target.value)}
              placeholder={t('Interest topic placeholder')}
              className="min-w-[12rem] flex-1"
              disabled={changing}
              aria-label={t('Interest topic placeholder')}
            />
            <Button type="submit" disabled={changing || !topicInput.trim()}>
              {t('Interest list add topic')}
            </Button>
          </form>
          {topicsSorted.length === 0 ? (
            <p className="pt-2 text-center text-sm text-muted-foreground">{t('No interest topics in list')}</p>
          ) : (
            <ul className="space-y-1">
              {topicsSorted.map((topic) => (
                <li
                  key={topic}
                  className={cn(
                    'flex min-h-[48px] items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2'
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                    onClick={() => navigateToHashtag(toNoteList({ hashtag: topic }))}
                  >
                    #{topic}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    disabled={changing}
                    title={t('Remove from interest list')}
                    aria-label={t('Remove from interest list')}
                    onClick={() => void unsubscribe(topic)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SecondaryPageLayout>
    )
  }
)

InterestListPage.displayName = 'InterestListPage'
export default InterestListPage
