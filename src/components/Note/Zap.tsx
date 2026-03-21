import { useFetchEvent } from '@/hooks'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { formatAmount } from '@/lib/lightning'
import { toNote, toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import { Zap as ZapIcon } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartNoteNavigation, useSecondaryPage } from '@/PageManager'
import Username from '../Username'
import UserAvatar from '../UserAvatar'

export default function Zap({ event, className }: { event: Event; className?: string }) {
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
  const { navigateToNote } = useSmartNoteNavigation()
  const { push } = useSecondaryPage()

  if (!zapInfo || !zapInfo.senderPubkey || !zapInfo.amount) {
    return (
      <div
        className={cn(
          'text-sm text-muted-foreground rounded-lg border border-border bg-muted/20 p-4',
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

  return (
    <div
      className={cn(
        'relative rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm',
        className
      )}
    >
      {/* Zapped note/profile link in bottom-right corner */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (isEventZap) {
            // Event zap - navigate to the zapped event
            if (targetEvent) {
              navigateToNote(toNote(targetEvent.id))
            } else if (zapInfo.eventId) {
              navigateToNote(toNote(zapInfo.eventId))
            }
          } else if (isProfileZap && actualRecipientPubkey) {
            // Profile zap - navigate to the zapped profile
            push(toProfile(actualRecipientPubkey))
          }
        }}
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

