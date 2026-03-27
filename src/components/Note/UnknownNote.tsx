import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import ClientSelect from '../ClientSelect'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { ExtendedKind } from '@/constants'
import { canonicalizeRssArticleUrl, getArticleUrlFromCommentITags } from '@/lib/rss-article'
import { getKindDescription } from '@/lib/kind-description'
import NoteKindLabel from './NoteKindLabel'
import { useMemo, useState } from 'react'
import EventViewer from './EventViewer'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import PubkeyCopy from '@/components/PubkeyCopy'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { hexPubkeysEqual, isValidPubkey, userIdToPubkey } from '@/lib/pubkey'

const CONTENT_PREVIEW_MAX = 800

/** Tag names we render in structured sections (hidden from the flat tag list). */
const ELEVATED_TAG_NAMES = new Set([
  'title',
  't',
  'summary',
  'description',
  'image',
  'thumb',
  'banner',
  'content',
  'kind',
  'pubkey'
])

function truncatePreview(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max).trimEnd()}…`
}

function normText(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function joinTagRest(tag: string[]): string {
  return tag.slice(1).join(' ').trim()
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim())
}

type ElevatedTags = {
  title?: string
  topics: string[]
  summary?: string
  description?: string
  imageUrls: string[]
  tagContent?: string
  declaredKind?: string
  taggedPubkey?: string
}

function extractElevatedTags(tags: string[][]): ElevatedTags {
  let title: string | undefined
  const topics: string[] = []
  const summaryParts: string[] = []
  const descriptionParts: string[] = []
  const imageUrls: string[] = []
  const contentParts: string[] = []
  let declaredKind: string | undefined
  let taggedPubkey: string | undefined

  for (const tag of tags) {
    const name = tag[0]
    const rest = tag.slice(1)
    if (name === 't') {
      const v = rest[0]?.trim()
      if (v) topics.push(v)
      continue
    }
    if (name === 'title' && rest.length) {
      const j = joinTagRest(tag)
      if (j) title = title ? `${title} ${j}` : j
      continue
    }
    if (name === 'summary' && rest.length) {
      summaryParts.push(joinTagRest(tag))
      continue
    }
    if (name === 'description' && rest.length) {
      descriptionParts.push(joinTagRest(tag))
      continue
    }
    if ((name === 'image' || name === 'thumb' || name === 'banner') && rest.length) {
      const u = rest[0].trim()
      if (isHttpUrl(u) && !imageUrls.includes(u)) imageUrls.push(u)
      continue
    }
    if (name === 'content' && rest.length) {
      const j = joinTagRest(tag)
      if (j) contentParts.push(j)
      continue
    }
    if (name === 'kind' && rest.length && !declaredKind) {
      declaredKind = joinTagRest(tag)
      continue
    }
    if (name === 'pubkey' && rest.length && !taggedPubkey) {
      const raw = rest[0].trim()
      const pk = userIdToPubkey(raw)
      if (isValidPubkey(pk)) taggedPubkey = pk.toLowerCase()
      continue
    }
  }

  return {
    title,
    topics,
    summary: summaryParts.length ? summaryParts.join('\n') : undefined,
    description: descriptionParts.length ? descriptionParts.join('\n') : undefined,
    imageUrls,
    tagContent: contentParts.length ? contentParts.join('\n') : undefined,
    declaredKind,
    taggedPubkey
  }
}

export default function UnknownNote({
  event,
  className,
  showAuthorSummary,
  omitKindLabel
}: {
  event: Event
  className?: string
  /** When the parent does not render an author header (e.g. embedded unsupported notes). */
  showAuthorSummary?: boolean
  /** When the parent `Note` already shows a kind line above this body. */
  omitKindLabel?: boolean
}) {
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

  const kindLabel = getKindDescription(event.kind, event)
  const contentRaw = event.content?.trim() ?? ''

  const elevated = useMemo(() => extractElevatedTags(event.tags), [event.tags])
  const remainderTags = useMemo(
    () => event.tags.filter(tag => tag[0] && !ELEVATED_TAG_NAMES.has(tag[0])),
    [event.tags]
  )

  const headline = elevated.title?.trim() || kindLabel.description

  const contentNorm = contentRaw ? normText(contentRaw) : ''
  const elevatedBlocksNorm = [elevated.summary, elevated.description, elevated.tagContent]
    .filter(Boolean)
    .map(s => normText(s!))
  const showMainContent =
    !!contentRaw &&
    !elevatedBlocksNorm.some(b => b === contentNorm) &&
    !(elevated.title && normText(elevated.title) === contentNorm)

  const declaredKindTrimmed = elevated.declaredKind?.trim()
  const showDeclaredKindTag =
    !!declaredKindTrimmed && declaredKindTrimmed !== String(event.kind)

  const showTaggedPubkey =
    !!elevated.taggedPubkey &&
    isValidPubkey(elevated.taggedPubkey) &&
    (!isValidPubkey(event.pubkey) || !hexPubkeysEqual(elevated.taggedPubkey, event.pubkey))

  const hasAnyElevatedCopy =
    !!elevated.summary ||
    !!elevated.description ||
    !!elevated.tagContent ||
    elevated.imageUrls.length > 0

  const showNoTextPlaceholder =
    !contentRaw && !hasAnyElevatedCopy && !isBookstrEvent

  const proseClass = 'text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/95'

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

        {showAuthorSummary && isValidPubkey(event.pubkey) ? (
          <div className="flex min-w-0 items-center gap-2 border-b border-border/60 pb-3">
            <UserAvatar userId={event.pubkey} size="medium" className="shrink-0" />
            <Username
              userId={event.pubkey}
              className="min-w-0 truncate font-semibold text-sm"
              skeletonClassName="h-4"
            />
          </div>
        ) : null}

        <div>
          <h3 className="text-base font-semibold leading-tight text-foreground">{headline}</h3>
          {!omitKindLabel ? (
            <NoteKindLabel kind={event.kind} event={event} size="small" className="mt-1" />
          ) : null}
          {elevated.title?.trim() && !omitKindLabel ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="text-foreground/80">{kindLabel.description}</span>
              <span className="mx-1.5 text-border">·</span>
              <span className="font-mono tabular-nums">{t('Event kind label', { kind: event.kind })}</span>
            </p>
          ) : null}
          {showDeclaredKindTag ? (
            <p className="mt-1 text-xs text-muted-foreground">{t('Unknown note declared kind tag', { value: declaredKindTrimmed })}</p>
          ) : null}
        </div>

        {showTaggedPubkey ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground shrink-0">
              {t('Unknown note tagged pubkey')}
            </span>
            <PubkeyCopy pubkey={elevated.taggedPubkey!} />
          </div>
        ) : null}

        {elevated.topics.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              {t('Topics')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {elevated.topics.map((topic, i) => (
                <Badge key={`${topic}-${i}`} variant="secondary" className="font-normal">
                  {topic}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {elevated.imageUrls.length > 0 ? (
          <div className="space-y-2">
            {elevated.imageUrls.slice(0, 4).map((url, i) => (
              <img
                key={`${url}-${i}`}
                src={url}
                alt=""
                className="max-h-52 w-full rounded-md border border-border object-cover bg-muted"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ))}
          </div>
        ) : null}

        {elevated.summary ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              {t('Summary')}
            </p>
            <p className={cn(proseClass, 'text-muted-foreground')}>{truncatePreview(elevated.summary, CONTENT_PREVIEW_MAX)}</p>
          </div>
        ) : null}

        {elevated.description ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              {t('Description')}
            </p>
            <p className={proseClass}>{truncatePreview(elevated.description, CONTENT_PREVIEW_MAX)}</p>
          </div>
        ) : null}

        {elevated.tagContent && normText(elevated.tagContent) !== contentNorm ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              {t('Unknown note tagged content')}
            </p>
            <p className={proseClass}>{truncatePreview(elevated.tagContent, CONTENT_PREVIEW_MAX)}</p>
          </div>
        ) : null}

        {isBookstrEvent && (
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            {bookMetadata.type && <span>{t('Type')}: {bookMetadata.type}</span>}
            {bookMetadata.book && <span>{t('Book')}: {formatBookName(bookMetadata.book)}</span>}
            {bookMetadata.chapter && <span>{t('Chapter')}: {bookMetadata.chapter}</span>}
            {bookMetadata.verse && <span>{t('Verse')}: {bookMetadata.verse}</span>}
            {bookMetadata.version && <span>{t('Version')}: {bookMetadata.version.toUpperCase()}</span>}
          </div>
        )}

        {showMainContent ? (
          <p className={proseClass}>{truncatePreview(contentRaw, CONTENT_PREVIEW_MAX)}</p>
        ) : null}

        {showNoTextPlaceholder ? (
          <p className="text-sm text-muted-foreground italic">{t('No text content in event')}</p>
        ) : null}

        {remainderTags.length > 0 ? (
          <div className="border-t border-border/80 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              {t('Tags')}
            </p>
            <ul className="space-y-1.5 text-sm">
              {remainderTags.map((tag, i) => (
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
