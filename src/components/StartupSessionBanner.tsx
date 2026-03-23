import { useNostr } from '@/providers/NostrProvider'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SHOW_AFTER_MS = 400

/**
 * Shown while the logged-in account’s relay list and replaceable events are being merged from IndexedDB + network.
 * Debounced so fast sessions don’t flash the bar.
 */
export default function StartupSessionBanner() {
  const { isAccountSessionHydrating } = useNostr()
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isAccountSessionHydrating) {
      setVisible(false)
      return
    }
    const id = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    return () => clearTimeout(id)
  }, [isAccountSessionHydrating])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'flex w-full shrink-0 items-center justify-center gap-2 border-b border-border',
        'bg-background px-3 py-2 text-center text-sm text-muted-foreground'
      )}
    >
      <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />
      <span>
        {t('startupSessionHydrating', {
          defaultValue: 'Syncing your relays and profile from the network…'
        })}
      </span>
    </div>
  )
}
