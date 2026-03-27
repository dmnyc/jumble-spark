import { useSmartNoteNavigation } from '@/PageManager'
import { ExtendedKind } from '@/constants'
import { getKindDescription } from '@/lib/kind-description'
import { toNote } from '@/lib/link'
import { stripNostrIdsFromPlainTextSnippet } from '@/lib/snippet-sanitize'
import { cn } from '@/lib/utils'
import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Skeleton } from '@/components/ui/skeleton'
import { Event, kinds } from 'nostr-tools'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

function quoteBacklinkSnippet(event: Event, maxLen = 96): string {
  const trim = (s: string) => {
    const cleaned = stripNostrIdsFromPlainTextSnippet(s)
    if (!cleaned) return ''
    const x = cleaned.replace(/\s+/g, ' ').trim()
    if (x.length <= maxLen) return x
    return `${x.slice(0, maxLen - 1).trimEnd()}…`
  }

  if (
    event.kind === kinds.ShortTextNote ||
    event.kind === ExtendedKind.COMMENT ||
    event.kind === ExtendedKind.VOICE_COMMENT
  ) {
    const c = event.content.trim()
    if (c) {
      const out = trim(c)
      if (out) return out
    }
  }
  if (event.kind === kinds.Highlights) {
    const ctx = event.tags.find((t) => t[0] === 'context')?.[1]
    if (ctx?.trim()) {
      const out = trim(ctx)
      if (out) return out
    }
  }
  if (event.kind === kinds.Label) {
    const L = event.tags.find((t) => t[0] === 'l' || t[0] === 'L')
    if (L) {
      const parts = [L[1], L[2], L[3]].filter(Boolean)
      if (parts.length) return trim(parts.join(' · '))
    }
    if (event.content.trim()) {
      const out = trim(event.content)
      if (out) return out
    }
  }
  if (event.kind === kinds.Report || event.kind === ExtendedKind.REPORT) {
    const rep = event.tags.find((t) => t[0] === 'report' || t[0] === 'Report')?.[1]
    if (rep) return trim(rep)
    if (event.content.trim()) {
      const out = trim(event.content)
      if (out) return out
    }
  }
  if (
    event.kind === kinds.BookmarkList ||
    event.kind === kinds.Pinlist ||
    event.kind === kinds.Genericlists ||
    event.kind === kinds.Bookmarksets ||
    event.kind === kinds.Curationsets
  ) {
    if (event.content.trim()) {
      const out = trim(event.content)
      if (out) return out
    }
    const dList = event.tags.find((t) => t[0] === 'd')?.[1]?.trim()
    if (dList) return trim(dList)
  }
  if (event.kind === kinds.BadgeAward) {
    if (event.content.trim()) {
      const out = trim(event.content)
      if (out) return out
    }
    const a = event.tags.find((t) => t[0] === 'a' || t[0] === 'A')?.[1]
    if (a) return trim(a)
  }
  const title = event.tags.find((t) => t[0] === 'title')?.[1]?.trim()
  if (title) return trim(title)
  const d = event.tags.find((t) => t[0] === 'd')?.[1]?.trim()
  if (d) return trim(d)
  return ''
}

/** One row of avatars for bookmark / list backlinks; dedupes by pubkey (newest event per author kept). */
export function BacklinkAvatarStrip({
  events,
  sectionLabel,
  relationLabelForTitle,
  getTitle
}: {
  events: Event[]
  sectionLabel: string
  /** Default tooltip when {@link getTitle} is omitted */
  relationLabelForTitle?: string
  /** Per-event tooltip (e.g. listed vs pinned) */
  getTitle?: (e: Event) => string
}) {
  const { navigateToNote } = useSmartNoteNavigation()
  const seen = new Set<string>()
  const unique = events.filter((e) => {
    if (seen.has(e.pubkey)) return false
    seen.add(e.pubkey)
    return true
  })

  if (unique.length === 0) return null

  return (
    <div className="mb-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {sectionLabel}
      </h3>
      <div className="mt-2 flex flex-wrap gap-2" role="list">
        {unique.map((e) => {
          const tip = getTitle ? getTitle(e) : (relationLabelForTitle ?? '')
          return (
            <button
              key={e.id}
              type="button"
              role="listitem"
              className={cn(
                'rounded-full transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              )}
              onClick={() => navigateToNote(toNote(e))}
              title={tip}
              aria-label={tip}
            >
              <UserAvatar
                userId={e.pubkey}
                size="medium"
                className="ring-1 ring-border/40"
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ThreadQuoteBacklinkSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-full max-w-md" />
      </div>
    </div>
  )
}

export default function ThreadQuoteBacklink({
  event,
  quoteKindLabel,
  variant = 'default'
}: {
  event: Event
  /** Short relation label (e.g. “Quoted this note”) for screen readers. */
  quoteKindLabel: string
  /** NIP-56 reports use warning styling at the bottom of the backlinks list. */
  variant?: 'default' | 'warning'
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()

  const snippet = useMemo(() => quoteBacklinkSnippet(event), [event])
  const kindLine = useMemo(() => getKindDescription(event.kind, event).description, [event])

  const secondary = snippet || kindLine
  const isWarning = variant === 'warning'

  return (
    <button
      type="button"
      className={cn(
        'group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        isWarning
          ? cn(
              'border border-amber-600/45 bg-amber-500/[0.07] hover:border-amber-600/60 hover:bg-amber-500/[0.11]',
              'dark:border-amber-500/40 dark:bg-amber-500/[0.08] dark:hover:border-amber-400/50 dark:hover:bg-amber-500/[0.12]',
              'focus-visible:ring-amber-600/50 dark:focus-visible:ring-amber-400/40'
            )
          : cn(
              'border border-transparent hover:border-border/80 hover:bg-muted/35',
              'focus-visible:ring-ring'
            )
      )}
      onClick={() => navigateToNote(toNote(event))}
      title={t('View full note and thread')}
      aria-label={`${quoteKindLabel}: ${secondary}`}
    >
      <UserAvatar
        userId={event.pubkey}
        size="medium"
        className={cn(
          'mt-0.5 ring-1',
          isWarning ? 'ring-amber-600/35 dark:ring-amber-400/35' : 'ring-border/40'
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Username
            userId={event.pubkey}
            className={cn(
              'text-sm font-medium',
              isWarning
                ? 'text-amber-950 group-hover:text-amber-900 dark:text-amber-50 dark:group-hover:text-amber-100'
                : 'text-foreground group-hover:text-primary'
            )}
          />
          <span
            className={cn(
              'text-[11px] tabular-nums',
              isWarning ? 'text-amber-900/75 dark:text-amber-100/70' : 'text-muted-foreground'
            )}
          >
            <FormattedTimestamp timestamp={event.created_at} short />
          </span>
        </div>
        <p
          className={cn(
            'mt-0.5 flex items-center gap-1.5 text-[11px] font-medium',
            isWarning ? 'text-amber-950/95 dark:text-amber-100/95' : 'text-muted-foreground/85'
          )}
        >
          {isWarning ? (
            <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          ) : null}
          {quoteKindLabel}
        </p>
        {secondary ? (
          <p
            className={cn(
              'mt-1 line-clamp-2 text-sm leading-snug',
              isWarning
                ? 'text-amber-950/90 group-hover:text-amber-950 dark:text-amber-50/95 dark:group-hover:text-amber-50'
                : 'text-muted-foreground group-hover:text-foreground/90'
            )}
          >
            {secondary}
          </p>
        ) : null}
      </div>
      <ChevronRight
        className={cn(
          'mt-2 size-4 shrink-0 transition-transform group-hover:translate-x-0.5',
          isWarning
            ? 'text-amber-700/70 group-hover:text-amber-800 dark:text-amber-300/70 dark:group-hover:text-amber-200'
            : 'text-muted-foreground/50 group-hover:text-muted-foreground'
        )}
        aria-hidden
      />
    </button>
  )
}
