import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { cleanUrl } from '@/lib/url'
import {
  extractExternalUrlNostrForExpandable,
  getBrowserAppOrigin,
  parseSameOriginAppNostrUrl
} from '@/lib/nostr-from-http-url'
import { ChevronDown } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmbeddedMention } from './EmbeddedMention'
import { EmbeddedNormalUrl } from './EmbeddedNormalUrl'
import { EmbeddedNote } from './EmbeddedNote'
import WebPreview from '@/components/WebPreview'

type RenderMode = 'note-content' | 'article'

export function HttpNostrAwareUrl({
  url,
  renderMode,
  containingEvent,
  className
}: {
  url: string
  renderMode: RenderMode
  containingEvent?: Event
  className?: string
}) {
  const { t } = useTranslation()
  const appOrigin = useMemo(() => getBrowserAppOrigin(), [])
  const sameOriginTarget = useMemo(
    () => parseSameOriginAppNostrUrl(url, appOrigin),
    [url, appOrigin]
  )
  const expandableTarget = useMemo(
    () => (!sameOriginTarget ? extractExternalUrlNostrForExpandable(url, appOrigin) : null),
    [url, appOrigin, sameOriginTarget]
  )

  const cleaned = cleanUrl(url) || url

  if (sameOriginTarget) {
    if (sameOriginTarget.kind === 'event') {
      return (
        <EmbeddedNote
          noteId={sameOriginTarget.id}
          className={cn('mt-2', className)}
          containingEvent={containingEvent}
        />
      )
    }
    return (
      <span className={cn('inline', className)}>
        <EmbeddedMention userId={sameOriginTarget.id} className="inline" />
      </span>
    )
  }

  if (expandableTarget) {
    return (
      <ExpandableExternalNostrLink
        url={url}
        cleanedUrl={cleaned}
        target={expandableTarget}
        containingEvent={containingEvent}
        className={className}
        expandLabel={t('link.expandNostrEmbed')}
      />
    )
  }

  if (renderMode === 'article') {
    return <WebPreview url={cleaned} className={cn('mt-2', className)} />
  }

  return <EmbeddedNormalUrl url={url} />
}

function ExpandableExternalNostrLink({
  url,
  cleanedUrl,
  target,
  containingEvent,
  className,
  expandLabel
}: {
  url: string
  cleanedUrl: string
  target: { kind: 'event' | 'profile'; id: string }
  containingEvent?: Event
  className?: string
  expandLabel: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <span className={cn('inline-flex max-w-full flex-wrap items-center gap-0.5 align-baseline', className)}>
      <EmbeddedNormalUrl url={url}>{cleanedUrl}</EmbeddedNormalUrl>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        aria-label={expandLabel}
        title={expandLabel}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')} />
      </Button>
      {open ? (
        <span className="block w-full basis-full">
          {target.kind === 'event' ? (
            <EmbeddedNote
              noteId={target.id}
              className="mt-2"
              containingEvent={containingEvent}
            />
          ) : (
            <span className="mt-2 inline-block">
              <EmbeddedMention userId={target.id} />
            </span>
          )}
        </span>
      ) : null}
    </span>
  )
}
