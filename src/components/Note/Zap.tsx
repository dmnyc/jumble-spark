import { useFetchEvent } from '@/hooks'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { formatAmount } from '@/lib/lightning'
import { toNote, toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import { Zap as ZapIcon } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartNoteNavigationOptional, useSecondaryPageOptional } from '@/PageManager'
import Username from '../Username'
import UserAvatar from '../UserAvatar'

export default function Zap({
  event,
  className,
  /** When the parent row already shows the zapper (e.g. reply list), hide the duplicate sender line. */
  omitSenderHeading,
  /** Dense thread row (e.g. kind 1111–sized), not the full note card. */
  variant = 'default'
}: {
  event: Event
  className?: string
  omitSenderHeading?: boolean
  variant?: 'default' | 'compact'
}) {
  // In quiet mode, we need to check the target event (if this is a zap receipt for an event)
  // For profile zaps, we can't check quiet mode since we don't have an event
  const zapInfo = useMemo(() => getZapInfoFromEvent(event), [event])
  const { event: targetEvent } = useFetchEvent(zapInfo?.eventId)
  
  // Check if the target event (if any) is in quiet mode
  const inQuietMode = targetEvent ? shouldHideInteractions(targetEvent) : false
  
  // Hide zap receipts in quiet mode as they contain emojis and text
  if (inQuietMode) {
    return null
  }
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })

  if (!zapInfo || !zapInfo.senderPubkey || !zapInfo.amount) {
    return (
      <div
        className={cn(
          'text-sm text-muted-foreground',
          variant === 'compact'
            ? 'py-0.5'
            : 'rounded-lg border border-border bg-muted/20 p-4',
          className
        )}
      >
        [{t('Invalid zap receipt')}]
      </div>
    )
  }

  // Determine if this is an event zap or profile zap
  const isEventZap = targetEvent || zapInfo?.eventId
  const isProfileZap = !isEventZap && zapInfo?.recipientPubkey

  // For event zaps, we need to determine the recipient from the zapped event
  const actualRecipientPubkey = useMemo(() => {
    if (isEventZap && targetEvent) {
      // Event zap - recipient is the author of the zapped event
      return targetEvent.pubkey
    } else if (isProfileZap) {
      // Profile zap - recipient is directly specified
      return zapInfo?.recipientPubkey
    }
    return undefined
  }, [isEventZap, isProfileZap, targetEvent, zapInfo?.recipientPubkey])

  const { senderPubkey, recipientPubkey, amount, comment } = zapInfo

  const openZapTarget = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (isEventZap) {
      if (targetEvent) {
        navigateToNote(toNote(targetEvent.id), targetEvent)
      } else if (zapInfo.eventId) {
        navigateToNote(toNote(zapInfo.eventId))
      }
    } else if (isProfileZap && actualRecipientPubkey) {
      push(toProfile(actualRecipientPubkey))
    }
  }

  if (variant === 'compact') {
    return (
      <div className={cn('text-sm text-muted-foreground', className)}>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <ZapIcon className="size-3.5 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
          <span className="tabular-nums font-medium text-foreground/90">{formatAmount(amount)}</span>
          <span>{t('sats')}</span>
          {recipientPubkey && recipientPubkey !== senderPubkey && (
            <span className="text-xs">
              <span>{t('zapped')}</span>{' '}
              <Username
                userId={recipientPubkey}
                className="inline font-medium text-foreground/85 hover:text-foreground"
              />
            </span>
          )}
          {(isEventZap || isProfileZap) && (
            <button
              type="button"
              onClick={openZapTarget}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {isEventZap
                ? t('Zapped note')
                : isProfileZap && actualRecipientPubkey
                  ? t('Zapped profile')
                  : t('Zap')}
            </button>
          )}
        </div>
        {comment ? (
          <p className="mt-1.5 pl-5 text-sm leading-snug text-muted-foreground whitespace-pre-wrap break-words">
            {comment}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm',
        className
      )}
    >
      <button
        type="button"
        onClick={openZapTarget}
        className="absolute bottom-3 right-3 flex items-center gap-2 rounded-md border border-border bg-secondary/80 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary"
      >
        {isEventZap ? (
          <span className="font-mono text-muted-foreground">
            {(targetEvent?.id || zapInfo.eventId)?.substring(0, 12)}…
          </span>
        ) : isProfileZap && actualRecipientPubkey ? (
          <>
            <UserAvatar userId={actualRecipientPubkey} size="xSmall" />
            <span>{t('Zapped profile')}</span>
          </>
        ) : (
          t('Zap')
        )}
      </button>

      <div className="flex items-start gap-3 pb-10 pr-2 sm:pr-36">
        <ZapIcon size={28} className="mt-0.5 shrink-0 text-primary" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          {!omitSenderHeading && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <UserAvatar userId={senderPubkey} size="small" />
              <Username userId={senderPubkey} className="font-semibold text-foreground" />
              <span className="text-sm text-muted-foreground">{t('zapped')}</span>
              {recipientPubkey && recipientPubkey !== senderPubkey && (
                <>
                  <UserAvatar userId={recipientPubkey} size="small" />
                  <Username userId={recipientPubkey} className="font-semibold text-foreground" />
                </>
              )}
            </div>
          )}

          {comment ? (
            <div className="mb-3 rounded-r-md border-l-[3px] border-primary bg-muted/40 py-2.5 pl-3 pr-2 dark:bg-muted/25">
              <p className="text-lg font-semibold leading-snug tracking-tight text-foreground whitespace-pre-wrap break-words">
                {comment}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
              {formatAmount(amount)}
            </span>
            <span className="text-base font-medium text-muted-foreground">{t('sats')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

