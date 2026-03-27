import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLongPressAction } from '@/hooks/use-long-press-action'
import { hardReloadPreservingFeedSnapshots } from '@/services/session-feed-snapshot.service'
import { RefreshCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function RefreshButton({
  onClick,
  /**
   * Long-press (~650ms). Default: full page reload while restoring session feed snapshots.
   * Pass `null` to disable long-press hard reload.
   */
  onLongPress
}: {
  onClick: () => void
  onLongPress?: (() => void) | null
}) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const longPressEnabled = onLongPress !== null
  const longPressFn = onLongPress === null ? () => {} : (onLongPress ?? hardReloadPreservingFeedSnapshots)
  const { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, consumeIfLongPress } =
    useLongPressAction(longPressFn, { enabled: longPressEnabled })

  const longPressTitle = onLongPress === null ? undefined : t('refresh.longPressHardReload')

  return (
    <Button
      variant="ghost"
      size="titlebar-icon"
      disabled={refreshing}
      title={longPressTitle}
      {...(longPressEnabled
        ? {
            onPointerDown,
            onPointerUp,
            onPointerLeave,
            onPointerCancel
          }
        : {})}
      onClick={() => {
        if (consumeIfLongPress()) return
        setRefreshing(true)
        onClick()
        setTimeout(() => setRefreshing(false), 500)
      }}
      className="text-muted-foreground focus:text-foreground [&_svg]:size-3 h-8 px-2 text-xs"
    >
      {refreshing ? (
        <Skeleton className="size-3 shrink-0 rounded-sm" aria-hidden />
      ) : (
        <RefreshCcw />
      )}
    </Button>
  )
}
