import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { cn } from '@/lib/utils'
import { ExtendedKind } from '@/constants'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import UserAvatar from '../UserAvatar'

const MAX_VISIBLE = 28

/**
 * Small avatar strip of users who boosted (kind 6) the note — shown under the OP on the note page.
 */
export default function NoteBoostBadges({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const noteStats = useNoteStatsById(event.id)

  const boosters = useMemo(() => {
    if (event.kind === ExtendedKind.DISCUSSION) return []
    return (noteStats?.reposts ?? [])
      .filter((r) => !hideUntrustedInteractions || isUserTrusted(r.pubkey))
      .sort((a, b) => b.created_at - a.created_at)
  }, [noteStats, event.kind, hideUntrustedInteractions, isUserTrusted])

  if (shouldHideInteractions(event) || boosters.length === 0) {
    return null
  }

  const visible = boosters.slice(0, MAX_VISIBLE)
  const overflow = boosters.length - visible.length

  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-0 gap-y-1', className)}
      role="list"
      aria-label={t('Boosts')}
    >
      {visible.map((r, i) => (
        <div
          key={r.id}
          role="listitem"
          className={cn(i > 0 && '-ml-2')}
          style={{ zIndex: visible.length - i }}
        >
          <UserAvatar userId={r.pubkey} size="small" className="ring-2 ring-background" />
        </div>
      ))}
      {overflow > 0 ? (
        <span
          className="-ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-2 ring-background"
          title={t('No more boosts')}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
