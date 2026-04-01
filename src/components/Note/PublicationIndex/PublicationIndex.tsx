import { ExtendedKind } from '@/constants'
import { Event, kinds, nip19 } from 'nostr-tools'
import { useEffect, useMemo, useState, useCallback, useSyncExternalStore } from 'react'
import { usePublicationSectionLoader } from '@/hooks/usePublicationSectionLoader'
import { parsePublicationATagCoordinate, publicationRefKey } from '@/lib/publication-section-fetch'
import { cn } from '@/lib/utils'
import AsciidocArticle from '../AsciidocArticle/AsciidocArticle'
import MarkdownArticle from '../MarkdownArticle/MarkdownArticle'
import { generateBech32IdFromATag } from '@/lib/tag'
import logger from '@/lib/logger'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { RefreshCw, ArrowUp } from 'lucide-react'
import indexedDb from '@/services/indexed-db.service'
import { useSecondaryPageOptional } from '@/PageManager'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { dTagToTitleCase } from '@/lib/event-metadata'
import Image from '@/components/Image'
import NoteOptions from '@/components/NoteOptions'
import {
  getRenderedPublicationEventsVersion,
  getRenderedPublicationEventsDeep,
  subscribeRenderedPublicationEvents,
  upsertRenderedPublicationEvents
} from '@/lib/publication-rendered-events'

interface PublicationReference {
  coordinate?: string
  /**
   * Optional historical snapshot id (`a` tag field 4) or direct `e` tag id.
   * For `a` references this is metadata only and MUST NOT drive section fetches.
   */
  eventId?: string
  event?: Event
  kind?: number
  pubkey?: string
  identifier?: string
  relay?: string
  type: 'a' | 'e' // 'a' for addressable (coordinate), 'e' for event ID
  nestedRefs?: PublicationReference[] // Discovered nested references
}

interface ToCItem {
  title: string
  coordinate: string
  event?: Event
  kind: number
  children?: ToCItem[]
}

interface PublicationMetadata {
  title?: string
  summary?: string
  image?: string
  author?: string
  version?: string
  type?: string
  source?: string
  publishedOn?: string
  publishedBy?: string
  tags: string[]
}

function publicationSectionNotesLink(ref: {
  coordinate?: string
  eventId?: string
  relay?: string
}): string | null {
  if (ref.coordinate) {
    const aTag = ['a', ref.coordinate, ref.relay || '', ref.eventId || '']
    const bech32Id = generateBech32IdFromATag(aTag)
    if (bech32Id) return `/notes?events=${encodeURIComponent(bech32Id)}`
  }
  if (ref.eventId) {
    if (
      ref.eventId.startsWith('note1') ||
      ref.eventId.startsWith('nevent1') ||
      ref.eventId.startsWith('naddr1')
    ) {
      return `/notes?events=${encodeURIComponent(ref.eventId)}`
    }
    if (/^[0-9a-f]{64}$/i.test(ref.eventId)) {
      try {
        const nevent = nip19.neventEncode({ id: ref.eventId })
        return `/notes?events=${encodeURIComponent(nevent)}`
      } catch {
        return `/notes?events=${encodeURIComponent(ref.eventId)}`
      }
    }
  }
  return null
}

export default function PublicationIndex({
  event,
  className,
  isNested = false,
  parentImageUrl,
  flattenHierarchy = false,
  chapterDepth = 0,
  publicationFootnotesContainerId
}: {
  event: Event
  className?: string
  isNested?: boolean
  parentImageUrl?: string
  flattenHierarchy?: boolean
  chapterDepth?: number
  publicationFootnotesContainerId?: string
}) {
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })
  // Parse publication metadata from event tags
  const metadata = useMemo<PublicationMetadata>(() => {
    const meta: PublicationMetadata = { tags: [] }
    
    for (const [tagName, tagValue] of event.tags) {
      if (tagName === 'title') {
        meta.title = tagValue
      } else if (tagName === 'summary') {
        meta.summary = tagValue
      } else if (tagName === 'image') {
        meta.image = tagValue
      } else if (tagName === 'author') {
        meta.author = tagValue
      } else if (tagName === 'version') {
        meta.version = tagValue
      } else if (tagName === 'type') {
        meta.type = tagValue
      } else if (tagName === 'source') {
        meta.source = tagValue
      } else if (tagName === 'published_on') {
        meta.publishedOn = tagValue
      } else if (tagName === 'published_by') {
        meta.publishedBy = tagValue
      } else if (tagName === 't' && tagValue) {
        meta.tags.push(tagValue.toLowerCase())
      }
    }
    
    // Fallback title from d-tag if no title (convert to title case)
    if (!meta.title) {
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1]
      if (dTag) {
        meta.title = dTagToTitleCase(dTag)
      }
    }
    
    return meta
  }, [event])
  const bookMetadata = useMemo(() => extractBookMetadata(event), [event])
  const isBookstrEvent = (event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata.book
  const isTopLevelPublication = !isNested && event.kind === ExtendedKind.PUBLICATION
  const forceFlatHierarchy = flattenHierarchy || isBookstrEvent || isTopLevelPublication
  const resolvedPublicationFootnotesContainerId = useMemo(
    () =>
      publicationFootnotesContainerId ??
      (isTopLevelPublication ? `publication-footnotes-${event.id}` : undefined),
    [publicationFootnotesContainerId, isTopLevelPublication, event.id]
  )
  const [isRetrying, setIsRetrying] = useState(false)

  // Extract references from 'a' tags (addressable events) and 'e' tags (event IDs)
  const referencesData = useMemo(() => {
    const refs: PublicationReference[] = []
    for (const tag of event.tags) {
      if (tag[0] === 'a' && tag[1]) {
        const parsed = parsePublicationATagCoordinate(tag[1])
        if (parsed) {
          refs.push({
            type: 'a',
            coordinate: parsed.coordinate,
            // `a[3]` is historization metadata for this coordinate revision only.
            // Keep it for diagnostics/UI context; fetches resolve by coordinate, not by this id.
            eventId: tag[3],
            kind: parsed.kind,
            pubkey: parsed.pubkey,
            identifier: parsed.identifier,
            relay: tag[2]
          })
        }
      } else if (tag[0] === 'e' && tag[1]) {
        // Event ID reference
        refs.push({
          type: 'e',
          eventId: tag[1],
          relay: tag[2]
        })
      }
    }
    return refs
  }, [event])

  const { retryKeys, failedKeys, referencesWithEvents } =
    usePublicationSectionLoader(event, referencesData)
  const renderedEventsVersion = useSyncExternalStore(
    subscribeRenderedPublicationEvents,
    getRenderedPublicationEventsVersion,
    getRenderedPublicationEventsVersion
  )

  // Helper function to format bookstr titles (remove hyphens, title case)
  const formatBookstrTitle = useCallback((title: string, event?: Event): string => {
    if (!event) return title
    
    // Check if this is a bookstr event
    const bookMetadata = extractBookMetadata(event)
    const isBookstr = (event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata.book
    
    if (isBookstr) {
      // Remove hyphens and convert to title case
      return title
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    }
    
    return title
  }, [])


  // Build table of contents from references (tag-derived titles before sections load)
  const tableOfContents = useMemo<ToCItem[]>(() => {
    const toc: ToCItem[] = []

    const coordinateOfEvent = (ev: Event): string | null => {
      const d = ev.tags.find((tag) => tag[0] === 'd')?.[1]
      if (!d) return null
      return `${ev.kind}:${ev.pubkey.toLowerCase()}:${d}`
    }

    const titleFromEvent = (ev: Event): string => {
      const titleTag = ev.tags.find((tag) => tag[0] === 'title')?.[1]
      if (titleTag) return titleTag
      const dTag = ev.tags.find((tag) => tag[0] === 'd')?.[1]
      if (dTag) return formatBookstrTitle(dTag, ev)
      return 'Untitled'
    }

    const titleFromIdentifier = (identifier: string, kind?: number) => {
      const raw = identifier || 'Untitled'
      if (
        kind === ExtendedKind.PUBLICATION ||
        kind === ExtendedKind.PUBLICATION_CONTENT ||
        kind === kinds.LongFormArticle ||
        kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN
      ) {
        return raw
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')
      }
      return raw
    }

    const knownByCoordinate = new Map<string, Event>()
    for (const ref of referencesWithEvents) {
      if (!ref.event) continue
      const coord = coordinateOfEvent(ref.event)
      if (coord) knownByCoordinate.set(coord, ref.event)
    }
    for (const ev of getRenderedPublicationEventsDeep(event.id)) {
      const coord = coordinateOfEvent(ev)
      if (coord && !knownByCoordinate.has(coord)) {
        knownByCoordinate.set(coord, ev)
      }
    }

    for (const ref of referencesWithEvents) {
      const coord = ref.coordinate || ref.eventId || ''
      if (!coord) continue

      let title: string
      if (ref.event) {
        title = titleFromEvent(ref.event)
      } else if (ref.type === 'a' && ref.kind === kinds.ShortTextNote) {
        title = 'Note'
      } else if (ref.type === 'a' && ref.identifier) {
        title = titleFromIdentifier(ref.identifier, ref.kind)
      } else {
        title = 'Section'
      }

      const tocItem: ToCItem = {
        title,
        coordinate: coord,
        event: ref.event,
        kind: ref.kind || ref.event?.kind || 0
      }

      // For nested 30040 publications, recursively get their ToC
      if (ref.kind === ExtendedKind.PUBLICATION && ref.event) {
        const nestedRefs: ToCItem[] = []
        
        // Parse nested references from this publication
        for (const tag of ref.event.tags) {
          if (tag[0] === 'a' && tag[1]) {
            const parsed = parsePublicationATagCoordinate(tag[1])
            if (!parsed) continue
            const kind = parsed.kind
            
            if (
              kind === ExtendedKind.PUBLICATION_CONTENT ||
              kind === ExtendedKind.WIKI_ARTICLE ||
              kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN ||
              kind === kinds.LongFormArticle ||
              kind === kinds.ShortTextNote ||
              kind === ExtendedKind.PUBLICATION
            ) {
              const knownNestedEvent = knownByCoordinate.get(parsed.coordinate)
              const nestedTitle = knownNestedEvent
                ? titleFromEvent(knownNestedEvent)
                : kind === kinds.ShortTextNote
                  ? 'Note'
                  : titleFromIdentifier(parsed.identifier, kind)
              
              nestedRefs.push({
                title: nestedTitle,
                coordinate: parsed.coordinate,
                kind,
                event: knownNestedEvent
              })
            }
          }
        }
        
        if (nestedRefs.length > 0) {
          tocItem.children = nestedRefs
        }
      }
      
      toc.push(tocItem)
    }
    
    return toc
  }, [referencesWithEvents, formatBookstrTitle, event.id, renderedEventsVersion])

  // Scroll to ToC (scroll to top of page)
  const scrollToToc = useCallback(() => {
    // Find the scrollable container (could be window or a drawer/scrollable div)
    let scrollContainer: HTMLElement | Window = window
    const tocElement = document.getElementById('publication-toc')
    
    if (tocElement) {
      // Walk up the DOM tree to find the scrollable container
      let element = tocElement.parentElement
      while (element && element !== document.body) {
        const style = window.getComputedStyle(element)
        const overflowY = style.overflowY
        
        // Check if this element is scrollable
        if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
          if (element.scrollHeight > element.clientHeight) {
            scrollContainer = element
            break
          }
        }
        element = element.parentElement
      }
    }
    
    // Scroll to top
    if (scrollContainer === window) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      (scrollContainer as HTMLElement).scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [])

  // Scroll to section
  const scrollToSection = (coordinate: string) => {
    const element = document.getElementById(`section-${coordinate.replace(/:/g, '-')}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }


  useEffect(() => {
    void indexedDb.putReplaceableEvent(event).catch((err) => {
      logger.error('[PublicationIndex] Error caching publication event:', err)
    })
  }, [event])

  useEffect(() => {
    const loaded = referencesWithEvents
      .filter((r) => r.event)
      .map((r) => r.event!)
    if (loaded.length > 0) {
      upsertRenderedPublicationEvents(event.id, loaded)
    }
    if (loaded.length === 0) return
    const t = window.setTimeout(() => {
      void indexedDb.putPublicationWithNestedEvents(event, loaded).catch((err) => {
        logger.error('[PublicationIndex] Error caching publication with nested events:', err)
      })
    }, 400)
    return () => clearTimeout(t)
  }, [referencesWithEvents, event])

  const handleManualRetry = useCallback(() => {
    setIsRetrying(true)
    const keys =
      failedKeys.length > 0
        ? failedKeys
        : (referencesData.map((r) => r.coordinate || r.eventId).filter(Boolean) as string[])
    retryKeys(keys)
    window.setTimeout(() => setIsRetrying(false), 600)
  }, [failedKeys, referencesData, retryKeys])


  return (
    <div className={cn('space-y-6', className)}>
      {/* Publication Metadata - only show for top-level publications */}
      {!isNested && (
        <div className="prose prose-zinc max-w-none dark:prose-invert">
          <header className="mb-8 border-b pb-6">
            <div className="mb-6 rounded-xl border border-border/50 bg-muted/20 px-5 py-6 text-center">
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground/80 mb-2">
                Publication
              </div>
              <h1 className="font-serif text-4xl md:text-5xl font-semibold leading-tight tracking-wide break-words">
                {metadata.title ||
                  (isBookstrEvent
                    ? bookMetadata.book
                      ? bookMetadata.book
                          .split('-')
                          .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                          .join(' ')
                      : 'Bookstr Publication'
                    : 'Untitled Publication')}
              </h1>
              {metadata.author && (
                <div className="mt-3 text-sm text-muted-foreground">
                  by <span className="font-medium text-foreground/90">{metadata.author}</span>
                </div>
              )}
              {(metadata.type || metadata.version || metadata.publishedOn || metadata.publishedBy) && (
                <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {metadata.type && <span>Type: {metadata.type}</span>}
                  {metadata.version && <span>Version: {metadata.version}</span>}
                  {metadata.publishedOn && <span>Published: {metadata.publishedOn}</span>}
                  {metadata.publishedBy && <span>Publisher: {metadata.publishedBy}</span>}
                </div>
              )}
              {metadata.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {metadata.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border/60 px-2.5 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {metadata.source && (
                <div className="mt-4 text-xs text-muted-foreground">
                  Source:{' '}
                  <a
                    href={metadata.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline break-all"
                  >
                    {metadata.source}
                  </a>
                </div>
              )}
              {metadata.summary && (
                <blockquote className="mt-5 border-l-4 border-primary/70 pl-4 pr-2 italic text-muted-foreground text-left leading-relaxed">
                  <p className="break-words">{metadata.summary}</p>
                </blockquote>
              )}
              {/* Display image for top-level 30040 publication */}
              {metadata.image && (
                <div className="mt-5 flex justify-center">
                  <Image
                    image={{ url: metadata.image, pubkey: event.pubkey }}
                    className="max-w-[400px] w-full h-auto rounded-lg"
                    classNames={{
                      wrapper: 'rounded-lg',
                      errorPlaceholder: 'aspect-square h-[30vh]'
                    }}
                  />
                </div>
              )}
              <div className="mt-5 mx-auto h-px w-24 bg-border/70" />
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              {isBookstrEvent && (
                <>
                  {bookMetadata.book && (
                    <div>
                      <span className="font-semibold">Book:</span> {bookMetadata.book
                        .split('-')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                        .join(' ')}
                    </div>
                  )}
                  {bookMetadata.chapter && (
                    <div>
                      <span className="font-semibold">Chapter:</span> {bookMetadata.chapter}
                    </div>
                  )}
                  {bookMetadata.verse && (
                    <div>
                      <span className="font-semibold">Verse:</span> {bookMetadata.verse}
                    </div>
                  )}
                  {bookMetadata.version && (
                    <div>
                      <span className="font-semibold">Version:</span> {bookMetadata.version.toUpperCase()}
                    </div>
                  )}
                </>
              )}
            </div>
          </header>
        </div>
      )}

      {/* Table of Contents - only show for top-level publications */}
      {!isNested && tableOfContents.length > 0 && (
        <div id="publication-toc" className="border rounded-lg p-6 bg-muted/30 scroll-mt-24">
          <h2 className="font-serif text-2xl font-semibold tracking-wide mb-4">Table of Contents</h2>
          <nav>
            <ul className="space-y-2">
              {tableOfContents.map((item, index) => (
                <ToCItemComponent 
                  key={index} 
                  item={item} 
                  onItemClick={scrollToSection}
                  level={0}
                />
              ))}
            </ul>
          </nav>
        </div>
      )}

      {/* Failed sections banner */}
      {!isNested && failedKeys.length > 0 && referencesWithEvents.length > 0 && (
        <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-yellow-800 dark:text-yellow-200">
              {failedKeys.length} section{failedKeys.length !== 1 ? 's' : ''} failed to load.
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRetry}
              disabled={isRetrying}
            >
              {isRetrying ? (
                <Skeleton className="mr-2 inline-block size-4 shrink-0 rounded-sm align-middle" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Retry All
            </Button>
          </div>
        </div>
      )}

      {/* Sections */}
      {referencesData.length === 0 ? (
        <div className="p-6 border rounded-lg bg-muted/30 text-center text-sm text-muted-foreground">
          This publication index has no linked sections.
        </div>
      ) : (
        <div className="space-y-8">
          {referencesWithEvents.map((ref, index) => {
            const sectionKey = publicationRefKey(ref)
            const coordinate = ref.coordinate || ref.eventId || ''
            const sectionId = `section-${coordinate.replace(/:/g, '-')}`
            const notesLink = publicationSectionNotesLink(ref)

            if (!ref.event) {
              if (ref.loadStatus === 'error') {
                return (
                  <div key={sectionKey || index} id={sectionId} className="scroll-mt-24 p-4 border rounded-lg bg-muted/50">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-muted-foreground">
                        Section {index + 1}: unable to load{' '}
                        {notesLink ? (
                          <a
                            href={notesLink}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              push(notesLink)
                            }}
                            className="text-primary hover:underline cursor-pointer"
                          >
                            {coordinate || 'unknown'}
                          </a>
                        ) : (
                          <span>{coordinate || 'unknown'}</span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => retryKeys([sectionKey])}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={sectionKey || index}
                  id={sectionId}
                  className="scroll-mt-24 rounded-lg border border-dashed p-6 bg-muted/20 space-y-3"
                  aria-busy
                >
                  <Skeleton className="h-5 w-2/3 max-w-md" />
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-28 w-full" />
                </div>
              )
            }

            const eventKind = ref.event?.kind ?? ref.kind ?? 0
            const effectiveParentImageUrl = !isNested ? metadata.image : parentImageUrl

            if (eventKind === ExtendedKind.PUBLICATION) {
              const publicationTitleTag = ref.event.tags.find((tag) => tag[0] === 'title')?.[1]
              const publicationDTag = ref.event.tags.find((tag) => tag[0] === 'd')?.[1]
              const publicationTitle = publicationTitleTag
                ? publicationTitleTag
                : publicationDTag
                  ? formatBookstrTitle(publicationDTag, ref.event)
                  : 'Publication'
              const publicationDepth = chapterDepth + 1
              const sectionTitleClassName =
                publicationDepth <= 1
                  ? 'font-serif text-2xl md:text-3xl font-semibold leading-tight tracking-wide break-words'
                  : publicationDepth === 2
                    ? 'font-serif text-xl md:text-2xl font-medium leading-tight tracking-wide break-words text-muted-foreground'
                    : 'font-serif text-lg md:text-xl font-medium leading-tight tracking-wide break-words text-muted-foreground'
              const useInlinePublicationHeader = forceFlatHierarchy
              const publicationContainerClassName = isNested
                ? forceFlatHierarchy
                  ? 'scroll-mt-24 pt-6 relative'
                  : 'border-l-4 border-primary pl-6 scroll-mt-24 pt-6 relative'
                : 'scroll-mt-24 pt-6 relative'
              return (
                <div
                  key={sectionKey || index}
                  id={sectionId}
                  className={publicationContainerClassName}
                >
                  {useInlinePublicationHeader ? (
                    <div className="mb-4 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                      <div className="flex items-start justify-end gap-2 mb-2">
                        <div className="flex items-center gap-2 shrink-0">
                          {!isNested && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="opacity-70 hover:opacity-100"
                              onClick={scrollToToc}
                              title="Back to Table of Contents"
                            >
                              <ArrowUp className="h-4 w-4 mr-2" />
                              ToC
                            </Button>
                          )}
                          <NoteOptions event={ref.event} />
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80 mb-1">
                          Section
                        </div>
                        <h3 className={sectionTitleClassName}>
                          {publicationTitle}
                        </h3>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute top-0 right-0 flex items-center gap-2">
                      {!isNested && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-70 hover:opacity-100"
                          onClick={scrollToToc}
                          title="Back to Table of Contents"
                        >
                          <ArrowUp className="h-4 w-4 mr-2" />
                          ToC
                        </Button>
                      )}
                      <NoteOptions event={ref.event} />
                    </div>
                  )}
                  <PublicationIndex
                    event={ref.event}
                    isNested={true}
                    parentImageUrl={effectiveParentImageUrl}
                    flattenHierarchy={forceFlatHierarchy}
                    chapterDepth={publicationDepth}
                    publicationFootnotesContainerId={resolvedPublicationFootnotesContainerId}
                  />
                </div>
              )
            }

            const renderAsAsciidoc =
              eventKind === ExtendedKind.PUBLICATION_CONTENT ||
              eventKind === ExtendedKind.WIKI_ARTICLE

            if (renderAsAsciidoc) {
              return (
                <div key={sectionKey || index} id={sectionId} className="scroll-mt-24 pt-6 relative">
                  <div className="absolute top-0 right-0 flex items-center gap-2">
                    {!isNested && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-70 hover:opacity-100"
                        onClick={scrollToToc}
                        title="Back to Table of Contents"
                      >
                        <ArrowUp className="h-4 w-4 mr-2" />
                        ToC
                      </Button>
                    )}
                    <NoteOptions event={ref.event} />
                  </div>
                  <AsciidocArticle
                    event={ref.event}
                    hideImagesAndInfo={true}
                    parentImageUrl={effectiveParentImageUrl}
                    footnotesContainerId={resolvedPublicationFootnotesContainerId}
                  />
                </div>
              )
            }

            // All non-publication, non-AsciiDoc section kinds use markdown renderer.
            return (
              <div key={sectionKey || index} id={sectionId} className="scroll-mt-24 pt-6 relative">
                <div className="absolute top-0 right-0 flex items-center gap-2">
                  {!isNested && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="opacity-70 hover:opacity-100"
                      onClick={scrollToToc}
                      title="Back to Table of Contents"
                    >
                      <ArrowUp className="h-4 w-4 mr-2" />
                      ToC
                    </Button>
                  )}
                  <NoteOptions event={ref.event} />
                </div>
                <MarkdownArticle
                  event={ref.event}
                  hideMetadata={true}
                  parentImageUrl={effectiveParentImageUrl}
                />
              </div>
            )
          })}
        </div>
      )}
      {isTopLevelPublication && resolvedPublicationFootnotesContainerId && (
        <div id={resolvedPublicationFootnotesContainerId} className="mt-10 space-y-8" />
      )}
    </div>
  )
}

// ToC Item Component - renders nested table of contents items
function ToCItemComponent({
  item,
  onItemClick,
  level
}: {
  item: ToCItem
  onItemClick: (coordinate: string) => void
  level: number
}) {
  const indentClass = level > 0 ? `ml-${level * 4}` : ''
  
  return (
    <li className={cn('list-none', indentClass)}>
      <button
        onClick={() => onItemClick(item.coordinate)}
        className="font-serif text-left text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline cursor-pointer tracking-wide"
      >
        {item.title}
      </button>
      {item.children && item.children.length > 0 && (
        <ul className="mt-2 space-y-1">
          {item.children.map((child, childIndex) => (
            <ToCItemComponent
              key={childIndex}
              item={child}
              onItemClick={onItemClick}
              level={level + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

