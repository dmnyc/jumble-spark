import { ExtendedKind } from '@/constants'
import { cn } from '@/lib/utils'
import { Event, kinds } from 'nostr-tools'
import { useTranslation } from 'react-i18next'

/**
 * Compact card for interaction events in notification-style feeds (boosts, poll votes).
 * Reactions use ReactionEmojiDisplay in Note (emoji + user + blurb) instead of this card.
 */
export default function NotificationEventCard({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()

  if (event.kind === kinds.Repost) {
    return (
      <div
        className={cn(
          'rounded-lg border border-border bg-card px-4 py-3 text-card-foreground shadow-sm',
          className
        )}
      >
        <p className="text-sm font-medium">{t('Notification boost summary')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('Notification boost detail')}</p>
      </div>
    )
  }

  if (event.kind === ExtendedKind.POLL_RESPONSE) {
    const n = event.tags.filter((tag) => tag[0] === 'response' && tag[1]).length
    return (
      <div
        className={cn(
          'rounded-lg border border-border bg-card px-4 py-3 text-card-foreground shadow-sm',
          className
        )}
      >
        <p className="text-sm font-medium">{t('Notification poll vote summary')}</p>
        {n > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('Notification poll vote options count', { count: n })}
          </p>
        ) : null}
      </div>
    )
  }

  return null
}
