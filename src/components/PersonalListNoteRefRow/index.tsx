import { useFetchEvent } from '@/hooks'
import { toNote } from '@/lib/link'
import { useSmartNoteNavigation } from '@/PageManager'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * One row in bookmark / pin list pages (same idea as {@link UserItem} on mute/follow lists).
 */
export default function PersonalListNoteRefRow({ bech32Id }: { bech32Id: string }) {
  const { t } = useTranslation()
  const { event, isFetching } = useFetchEvent(bech32Id)
  const { navigateToNote } = useSmartNoteNavigation()
  const preview = useMemo(() => {
    const c = event?.content?.trim()
    if (!c) return ''
    return c.replace(/\s+/g, ' ').slice(0, 140)
  }, [event?.content])

  const onOpen = () => navigateToNote(toNote(bech32Id))

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
    <Button
      type="button"
      variant="ghost"
      className="h-auto min-h-[3.5rem] w-full justify-start gap-2 rounded-none px-4 py-2 font-normal hover:bg-muted/60"
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
  )
}
