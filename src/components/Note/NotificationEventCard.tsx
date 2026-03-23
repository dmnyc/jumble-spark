import { ExtendedKind } from '@/constants'
import { cn } from '@/lib/utils'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Compact card for interaction events in notification-style feeds (reactions, boosts, poll votes).
 * The surrounding {@link Note} row still shows author + {@link ParentNotePreview} for the target.
 */
export default function NotificationEventCard({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()

  const reactionDisplay = useMemo(() => {
    if (event.kind !== kinds.Reaction) return null
    const raw = event.content?.trim() ?? ''
    if (!raw) return '❤️'
    if (raw.length > 64) return `${raw.slice(0, 64)}…`
    return raw
  }, [event.content, event.kind])

  if (event.kind === kinds.Reaction) {
    return (
      <div
        className={cn(
          'rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm',
          className
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-3xl leading-none select-none" aria-hidden>
            {reactionDisplay}
          </span>
          <p className="text-sm text-muted-foreground">{t('Notification reaction summary')}</p>
        </div>
      </div>
    )
  }

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
