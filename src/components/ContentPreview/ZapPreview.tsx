import { useFetchEvent } from '@/hooks'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { formatAmount } from '@/lib/lightning'
import { cn } from '@/lib/utils'
import { Zap } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Username from '../Username'

export default function ZapPreview({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const zapInfo = useMemo(() => getZapInfoFromEvent(event), [event])
  const { event: targetEvent } = useFetchEvent(zapInfo?.eventId)

  if (!zapInfo || !zapInfo.senderPubkey || !zapInfo.amount) {
    return (
      <div className={cn('rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground', className)}>
        [{t('Invalid zap receipt')}]
      </div>
    )
  }

  const { senderPubkey, recipientPubkey, amount, comment } = zapInfo

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm',
        className
      )}
    >
      <Zap size={24} className="mt-0.5 shrink-0 text-primary" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Username userId={senderPubkey} className="font-semibold text-foreground" />
          <span className="text-sm text-muted-foreground">{t('zapped')}</span>
          {recipientPubkey && recipientPubkey !== senderPubkey && (
            <Username userId={recipientPubkey} className="font-semibold text-foreground" />
          )}
        </div>
        {comment ? (
          <p className="mt-2 rounded-r-md border-l-[3px] border-primary bg-muted/40 py-2 pl-3 pr-1 text-base font-semibold leading-snug text-foreground dark:bg-muted/25 whitespace-pre-wrap break-words">
            {comment}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-lg font-bold tabular-nums text-foreground">{formatAmount(amount)}</span>
          <span className="text-sm font-medium text-muted-foreground">{t('sats')}</span>
        </div>
        {targetEvent && (
          <div className="mt-2 text-xs text-muted-foreground">
            {t('on note')} {targetEvent.id.substring(0, 8)}...
          </div>
        )}
      </div>
    </div>
  )
}

