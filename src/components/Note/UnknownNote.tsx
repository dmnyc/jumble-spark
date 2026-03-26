import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import ClientSelect from '../ClientSelect'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { ExtendedKind } from '@/constants'
import { canonicalizeRssArticleUrl, getArticleUrlFromCommentITags } from '@/lib/rss-article'
import { getKindDescription } from '@/lib/kind-description'
import { useMemo, useState } from 'react'
import EventViewer from './EventViewer'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronRight } from 'lucide-react'

const CONTENT_PREVIEW_MAX = 800

function truncatePreview(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max).trimEnd()}…`
}

export default function UnknownNote({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const [technicalOpen, setTechnicalOpen] = useState(false)
  const bookMetadata = useMemo(() => extractBookMetadata(event), [event])
  const displayEvent = useMemo(() => {
    if (event.kind !== ExtendedKind.RSS_THREAD_ROOT) return event
    const raw = getArticleUrlFromCommentITags(event)
    if (!raw) return event
    const c = canonicalizeRssArticleUrl(raw)
    if (c === raw) return event
    return { ...event, tags: [['i', c], ['I', c]] as Event['tags'] }
  }, [event])
  const isBookstrEvent = (event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata.book

  const formatBookName = (book: string) => {
    return book
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  const kindLabel = getKindDescription(event.kind)
  const contentRaw = event.content?.trim() ?? ''

  return (
    <div
      className={cn(
        'flex flex-col gap-3 my-4',
        className
      )}
    >
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-card-foreground shadow-sm space-y-3">
        <p className="text-sm text-muted-foreground leading-snug">
          {t('Unsupported event preview')}
        </p>
        <div>
          <h3 className="text-base font-semibold leading-tight text-foreground">
            {kindLabel.description}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground font-mono tabular-nums">
            {t('Event kind label', { kind: event.kind })}
          </p>
        </div>

        {isBookstrEvent && (
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            {bookMetadata.type && <span>{t('Type')}: {bookMetadata.type}</span>}
            {bookMetadata.book && <span>{t('Book')}: {formatBookName(bookMetadata.book)}</span>}
            {bookMetadata.chapter && <span>{t('Chapter')}: {bookMetadata.chapter}</span>}
            {bookMetadata.verse && <span>{t('Verse')}: {bookMetadata.verse}</span>}
            {bookMetadata.version && <span>{t('Version')}: {bookMetadata.version.toUpperCase()}</span>}
          </div>
        )}

        {contentRaw ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/95">
            {truncatePreview(contentRaw, CONTENT_PREVIEW_MAX)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">{t('No text content in event')}</p>
        )}

        {event.tags.length > 0 ? (
          <div className="border-t border-border/80 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              {t('Tags')}
            </p>
            <ul className="space-y-1.5 text-sm">
              {event.tags.map((tag, i) => (
                <li key={i} className="flex gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                  <span className="shrink-0 font-medium text-foreground/90">{tag[0]}</span>
                  <span className="min-w-0 break-all text-muted-foreground">
                    {tag.length > 1 ? tag.slice(1).join(' · ') : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ClientSelect event={event} />
      </div>

      <Collapsible open={technicalOpen} onOpenChange={setTechnicalOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-between gap-2 font-normal"
          >
            <span>{t('Technical details')}</span>
            {technicalOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <EventViewer event={displayEvent} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
