import {
  getRssFeedUrlHostname,
  getStandardRssFeedProfile,
  type StandardRssFeedIcon,
  type StandardRssFeedProfile
} from '@/lib/standard-rss-feed-url'
import { cn } from '@/lib/utils'
import { BookOpen, Flame, Mail, Music2, Newspaper, Rss, Youtube } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const ICONS: Record<StandardRssFeedIcon, LucideIcon> = {
  music: Music2,
  youtube: Youtube,
  feedburner: Flame,
  reddit: Newspaper,
  substack: Mail,
  medium: BookOpen,
  rss: Rss
}

function ProfileIcon({ profile }: { profile: StandardRssFeedProfile | null }) {
  const Icon = profile ? ICONS[profile.icon] : Rss
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/80 bg-muted/40 text-muted-foreground"
      aria-hidden
    >
      <Icon className="size-4" strokeWidth={2} />
    </div>
  )
}

type Props = {
  feedUrl: string
  className?: string
  /** Trailing actions (e.g. remove button) */
  actions?: ReactNode
}

/**
 * Settings-style row: icon, friendly name for known feed URLs, optional id line, full URL link.
 */
export default function StandardRssFeedUrlRow({ feedUrl, className, actions }: Props) {
  const { t } = useTranslation()
  const profile = getStandardRssFeedProfile(feedUrl)
  const host = getRssFeedUrlHostname(feedUrl)
  const title = profile
    ? t(profile.labelKey, { defaultValue: profile.defaultLabel })
    : host

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg border p-3',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <ProfileIcon profile={profile} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium leading-tight">{title}</p>
          {profile?.detail ? (
            <p className="text-xs text-muted-foreground font-mono">{profile.detail}</p>
          ) : null}
          <a
            href={feedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block break-all text-xs text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {feedUrl}
          </a>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-col items-end gap-1">{actions}</div> : null}
    </div>
  )
}

type InlineProps = {
  feedUrl: string
  /** Prefer RSS channel title when we have it */
  title?: string
  /** Truncate display label (full string still in `title` tooltip) */
  maxLength?: number
  className?: string
}

const INLINE_ICONS: Record<StandardRssFeedIcon, LucideIcon> = ICONS

/**
 * Compact icon + label for filter menus (single line, truncated).
 */
export function StandardRssFeedUrlInline({ feedUrl, title, maxLength, className }: InlineProps) {
  const { t } = useTranslation()
  const profile = getStandardRssFeedProfile(feedUrl)
  const host = getRssFeedUrlHostname(feedUrl)
  const label =
    title?.trim() ||
    (profile
      ? t(profile.labelKey, { defaultValue: profile.defaultLabel })
      : host)
  const display =
    maxLength !== undefined && label.length > maxLength
      ? `${label.slice(0, maxLength)}…`
      : label
  const Icon = profile ? INLINE_ICONS[profile.icon] : Rss

  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-2', className)}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
      <span className="truncate" title={label}>
        {display}
      </span>
    </span>
  )
}
