import { ExtendedKind } from '@/constants'
import {
  getGitRepublicRepoContext,
  gitRepublicRepoWebUrl,
  type GitRepublicRepoContext
} from '@/lib/git-republic-event'
import { cn } from '@/lib/utils'
import { Event, nip19 } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, GitBranch, CircleDot, Tag } from 'lucide-react'
import MarkdownArticle from './MarkdownArticle/MarkdownArticle'

function repoHeadline(ctx: GitRepublicRepoContext): string {
  const name = ctx.displayName || ctx.repoId
  try {
    const npub = nip19.npubEncode(ctx.ownerHex)
    const short = `${npub.slice(0, 14)}…`
    return `${short} / ${name}`
  } catch {
    return name
  }
}

export default function GitRepublicEventCard({
  event,
  className,
  variant = 'full'
}: {
  event: Event
  className?: string
  variant?: 'full' | 'compact'
}) {
  const { t } = useTranslation()
  const ctx = useMemo(() => getGitRepublicRepoContext(event), [event])
  const webUrl = useMemo(() => (ctx ? gitRepublicRepoWebUrl(ctx) : null), [ctx])

  const subject = event.tags.find((t) => t[0] === 'subject')?.[1]
  const titleTag = event.tags.find((t) => t[0] === 'title')?.[1]
  const tagName = event.tags.find((t) => t[0] === 'tag')?.[1]
  const description =
    event.kind === ExtendedKind.GIT_REPO_ANNOUNCEMENT
      ? event.tags.find((t) => t[0] === 'description')?.[1]
      : undefined

  const isDraft = event.tags.some((t) => t[0] === 'draft' && t[1] === 'true')
  const isPrerelease = event.tags.some((t) => t[0] === 'prerelease' && t[1] === 'true')

  const { Icon, badge, headline } = useMemo(() => {
    if (event.kind === ExtendedKind.GIT_REPO_ANNOUNCEMENT) {
      const name = event.tags.find((t) => t[0] === 'name')?.[1] || ctx?.repoId || t('Git Republic repository')
      return {
        Icon: GitBranch,
        badge: t('Git Republic repository'),
        headline: name
      }
    }
    if (event.kind === ExtendedKind.GIT_ISSUE) {
      return {
        Icon: CircleDot,
        badge: t('Git Republic issue'),
        headline: subject || t('Git Republic issue')
      }
    }
    if (event.kind === ExtendedKind.GIT_RELEASE) {
      const h = titleTag || tagName || t('Git Republic release')
      return { Icon: Tag, badge: t('Git Republic release'), headline: h }
    }
    return { Icon: GitBranch, badge: t('Git Republic'), headline: t('Git Republic event') }
  }, [event, ctx?.repoId, subject, tagName, titleTag, t])

  const body =
    event.kind === ExtendedKind.GIT_REPO_ANNOUNCEMENT
      ? description || event.content
      : event.content

  const compact = variant === 'compact'

  return (
    <div
      className={cn(
        'rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/[0.08] via-background to-sky-500/[0.06] shadow-sm',
        compact ? 'p-3' : 'p-4',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary',
            compact ? 'size-9' : 'size-10'
          )}
          aria-hidden
        >
          <Icon className={compact ? 'size-4' : 'size-5'} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className={cn('flex flex-wrap items-center gap-2', compact && 'sr-only')}>
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              {badge}
            </span>
            {isDraft ? (
              <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-amber-700 dark:text-amber-400">
                {t('Draft')}
              </span>
            ) : null}
            {isPrerelease ? (
              <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-sky-700 dark:text-sky-400">
                {t('Pre-release')}
              </span>
            ) : null}
          </div>
          {compact && (isDraft || isPrerelease) ? (
            <div className="flex flex-wrap gap-1">
              {isDraft ? (
                <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[0.6rem] font-medium text-amber-700 dark:text-amber-400">
                  {t('Draft')}
                </span>
              ) : null}
              {isPrerelease ? (
                <span className="rounded bg-sky-500/15 px-1 py-0.5 text-[0.6rem] font-medium text-sky-700 dark:text-sky-400">
                  {t('Pre-release')}
                </span>
              ) : null}
            </div>
          ) : null}
          <h3
            className={cn(
              'font-semibold leading-snug text-foreground break-words',
              compact ? 'text-sm' : 'text-base'
            )}
          >
            {headline}
          </h3>
          {event.kind === ExtendedKind.GIT_RELEASE && tagName ? (
            <p className="font-mono text-xs text-muted-foreground">{tagName}</p>
          ) : null}
          {ctx ? (
            <p className="truncate text-xs text-muted-foreground" title={repoHeadline(ctx)}>
              {repoHeadline(ctx)}
            </p>
          ) : null}
          {webUrl ? (
            <a
              href={webUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex max-w-full items-center gap-1 text-xs font-medium text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{t('Open in Git Republic')}</span>
            </a>
          ) : null}
        </div>
      </div>
      {body.trim() ? (
        <div className={cn(compact ? 'mt-2 line-clamp-4' : 'mt-3', 'min-w-0 text-sm')}>
          <MarkdownArticle event={{ ...event, content: body }} hideMetadata className="prose-sm" />
        </div>
      ) : null}
    </div>
  )
}
