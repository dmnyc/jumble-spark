import { useFetchEvent } from '@/hooks'
import { useRemovePinListEntry } from '@/hooks/useRemovePinListEntry'
import { toNote } from '@/lib/link'
import { useSmartNoteNavigation } from '@/PageManager'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useBookmarksOptional } from '@/providers/bookmarks-context'
import { useNostr } from '@/providers/NostrProvider'
import { ChevronRight, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Event } from 'nostr-tools'

type TListMode = 'bookmark' | 'pin'

/**
 * One row in bookmark / pin list pages (same idea as {@link UserItem} on mute/follow lists).
 */
export default function PersonalListNoteRefRow({
  bech32Id,
  listMode,
  onEntryRemoved
}: {
  bech32Id: string
  listMode?: TListMode
  onEntryRemoved?: () => void
}) {
  const { t } = useTranslation()
  const { event, isFetching } = useFetchEvent(bech32Id)
  const { navigateToNote } = useSmartNoteNavigation()
  const { checkLogin } = useNostr()
  const bookmarks = useBookmarksOptional()
  const removePinEntry = useRemovePinListEntry(onEntryRemoved)
  const [removing, setRemoving] = useState(false)

  const preview = useMemo(() => {
    const c = event?.content?.trim()
    if (!c) return ''
    return c.replace(/\s+/g, ' ').slice(0, 140)
  }, [event?.content])

  const onOpen = () => navigateToNote(toNote(bech32Id))

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!listMode || removing) return
      void checkLogin(async () => {
        setRemoving(true)
        try {
          if (listMode === 'bookmark') {
            if (!bookmarks) {
              toast.error(t('Remove bookmark failed'))
              return
            }
            const ok = event
              ? await bookmarks.removeBookmark(event as Event)
              : await bookmarks.removeBookmarkByBech32(bech32Id)
            if (ok) {
              toast.success(t('Removed from bookmarks'))
            } else {
              toast.info(t('Bookmark not in list'))
            }
          } else {
            const ok = await removePinEntry(bech32Id, event as Event | null)
            if (ok) {
              toast.success(t('Note unpinned'))
            } else {
              toast.info(t('Pin not in list'))
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          toast.error(
            listMode === 'bookmark'
              ? `${t('Remove bookmark failed')}: ${msg}`
              : `${t('Failed to remove pin')}: ${msg}`
          )
        } finally {
          setRemoving(false)
        }
      })
    },
    [
      bech32Id,
      bookmarks,
      checkLogin,
      event,
      listMode,
      removePinEntry,
      removing,
      t
    ]
  )

  if (isFetching) {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[3.5rem] w-full items-stretch border-b border-border/60 last:border-b-0">
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-h-[3.5rem] min-w-0 flex-1 justify-start gap-2 rounded-none px-4 py-2 font-normal hover:bg-muted/60"
        onClick={onOpen}
      >
        {event ? (
          <>
            <UserAvatar userId={event.pubkey} className="shrink-0" />
            <div className="min-w-0 flex-1 text-left">
              <Username
                userId={event.pubkey}
                className="max-w-full truncate font-semibold"
                skeletonClassName="h-4"
              />
              <div className="truncate text-sm text-muted-foreground">
                {preview || t('Event kind label', { kind: event.kind })}
              </div>
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1 text-left font-mono text-xs text-muted-foreground">
            {bech32Id.length > 36 ? `${bech32Id.slice(0, 28)}…` : bech32Id}
            <div className="mt-0.5 text-[11px]">{t('Event not loaded')}</div>
          </div>
        )}
        <ChevronRight className="size-4 shrink-0 opacity-50" />
      </Button>
      {listMode ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-auto min-w-[44px] shrink-0 rounded-none text-muted-foreground hover:text-destructive"
          disabled={removing}
          title={listMode === 'bookmark' ? t('Remove bookmark') : t('Unpin note')}
          aria-label={listMode === 'bookmark' ? t('Remove bookmark') : t('Unpin note')}
          onClick={handleRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}
