import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { cn } from '@/lib/utils'
import { hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type Props = {
  className?: string
  triggerClassName?: string
  /** Show the inline label on narrow viewports (e.g. full-screen post composer). */
  showLabelAlways?: boolean
  /** Separator under the row (e.g. post editor header). */
  withBottomBorder?: boolean
}

/**
 * Switch {@link useNostr} session among stored accounts (same as notifications spell).
 * Renders nothing when there is only one stored account or no session.
 */
export default function StoredAccountSwitchSelect({
  className,
  triggerClassName,
  showLabelAlways = false,
  withBottomBorder = false
}: Props) {
  const { t } = useTranslation()
  const { pubkey, accounts, switchAccount, isAccountSessionHydrating } = useNostr()

  const sessionPubkey = useMemo(() => {
    const cur = pubkey?.trim()
    return cur ? normalizeHexPubkey(cur) : null
  }, [pubkey])

  const storedAccountPubkeys = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const a of accounts) {
      const raw = a.pubkey?.trim()
      if (!raw) continue
      const p = normalizeHexPubkey(raw)
      if (!seen.has(p)) {
        seen.add(p)
        out.push(p)
      }
    }
    return out
  }, [accounts])

  const handlePick = useCallback(
    async (v: string) => {
      const target = normalizeHexPubkey(v)
      if (pubkey && hexPubkeysEqual(target, pubkey)) return
      const nextAccount = accounts.find((a) => hexPubkeysEqual(a.pubkey, target))
      if (!nextAccount) {
        toast.error(t('notificationsSwitchAccountFailed'))
        return
      }
      const switched = await switchAccount(nextAccount)
      if (!switched || !hexPubkeysEqual(normalizeHexPubkey(switched), target)) {
        toast.error(t('notificationsSwitchAccountFailed'))
      }
    },
    [pubkey, accounts, switchAccount, t]
  )

  if (storedAccountPubkeys.length <= 1 || !sessionPubkey) return null

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2',
        withBottomBorder && '-mx-1 mb-1 border-b border-border/60 px-1 pb-3',
        className
      )}
    >
      <span
        className={cn(
          'shrink-0 text-xs text-muted-foreground',
          showLabelAlways ? 'inline' : 'hidden sm:inline'
        )}
      >
        {t('notificationsViewAsAccount')}
      </span>
      <Select
        value={sessionPubkey}
        disabled={isAccountSessionHydrating}
        onValueChange={(v) => void handlePick(v)}
      >
        <SelectTrigger
          className={cn('h-9 min-w-0 flex-1', triggerClassName)}
          aria-label={t('notificationsViewAsAccountAria')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {storedAccountPubkeys.map((pk) => (
            <SelectItem key={pk} value={pk}>
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar userId={pk} size="small" className="shrink-0" />
                <Username
                  userId={pk}
                  className="min-w-0 truncate text-left font-normal"
                  skeletonClassName="h-4 w-24"
                />
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
