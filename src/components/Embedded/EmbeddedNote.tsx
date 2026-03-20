import { Skeleton } from '@/components/ui/skeleton'
import { FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS, ExtendedKind } from '@/constants'
import { useFetchEvent } from '@/hooks'
import { normalizeUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import client from '@/services/client.service'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { Event, nip19 } from 'nostr-tools'
import ClientSelect from '../ClientSelect'
import MainNoteCard from '../NoteCard/MainNoteCard'
import { Button } from '../ui/button'
import { EmbeddedCalendarEvent } from './EmbeddedCalendarEvent'
import { Search } from 'lucide-react'
import logger from '@/lib/logger'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { contentParserService } from '@/services/content-parser.service'
import { useSmartNoteNavigation } from '@/PageManager'
import { toNote } from '@/lib/link'

export function EmbeddedNote({ 
  noteId, 
  className,
  containingEvent 
}: { 
  noteId: string
  className?: string
  containingEvent?: Event // Event that contains this embedded note - use its author's relays and relay hints
}) {
  const { event, isFetching } = useFetchEvent(noteId)
  const [retryEvent, setRetryEvent] = useState<Event | undefined>(undefined)
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const maxRetries = 3

  // If the first fetch fails, try a force retry (max 3 attempts)
  useEffect(() => {
    if (!isFetching && !event && !isRetrying && retryCount < maxRetries) {
      setIsRetrying(true)
      setRetryCount(prev => prev + 1)
      
      client.fetchEventForceRetry(noteId)
        .then((retryResult: any) => {
          if (retryResult) {
            setRetryEvent(retryResult)
          }
        })
        .catch((error: any) => {
          logger.warn('EmbeddedNote retry failed', {
            attempt: retryCount + 1,
            maxRetries,
            noteId,
            error
          })
        })
        .finally(() => {
          setIsRetrying(false)
        })
    }
  }, [isFetching, event, noteId, isRetrying, retryCount])

  const finalEvent = event || retryEvent
  const finalIsFetching = isFetching || (isRetrying && retryCount <= maxRetries)

  if (finalIsFetching) {
    return <EmbeddedNoteSkeleton className={className} />
  }

  if (!finalEvent) {
    return <EmbeddedNoteNotFound className={className} noteId={noteId} onEventFound={setRetryEvent} containingEvent={containingEvent} />
  }

  // Check if this event has bookstr tags (at least "book" tag)
  const bookMetadata = extractBookMetadata(finalEvent)
  const hasBookstrTags = !!bookMetadata.book

  // If it has bookstr tags, render directly as bookstr content (no need to search)
  if (hasBookstrTags) {
    return (
      <div data-embedded-note data-bookstr onClick={(e) => e.stopPropagation()}>
        <EmbeddedBookstrEvent event={finalEvent} originalNoteId={noteId} className={className} />
      </div>
    )
  }

  // NIP-52 calendar event (scheduled video call) – render as calendar card
  if (finalEvent.kind === ExtendedKind.CALENDAR_EVENT_TIME || finalEvent.kind === ExtendedKind.CALENDAR_EVENT_DATE) {
    return (
      <div data-embedded-note onClick={(e) => e.stopPropagation()}>
        <EmbeddedCalendarEvent event={finalEvent} className={className} />
      </div>
    )
  }

  // Otherwise, render as regular embedded note
  return (
    <div data-embedded-note onClick={(e) => e.stopPropagation()}>
      <MainNoteCard
        className={cn('w-full', className)}
        event={finalEvent}
        embedded
        originalNoteId={noteId}
      />
    </div>
  )
}

function EmbeddedNoteSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('text-left p-2 sm:p-3 border rounded-lg', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center space-x-2">
        <Skeleton className="w-9 h-9 rounded-full" />
        <div>
          <Skeleton className="h-3 w-16 my-1" />
          <Skeleton className="h-3 w-16 my-1" />
        </div>
      </div>
      <Skeleton className="w-full h-4 my-1 mt-2" />
      <Skeleton className="w-2/3 h-4 my-1" />
    </div>
  )
}

function EmbeddedNoteNotFound({ 
  noteId, 
  className,
  onEventFound,
  containingEvent
}: { 
  noteId: string
  className?: string
  onEventFound?: (event: Event) => void
  containingEvent?: Event // Event that contains this embedded note - use its author's relays and relay hints
}) {
  const { t } = useTranslation()
  const [isSearchingExternal, setIsSearchingExternal] = useState(false)
  const [triedExternal, setTriedExternal] = useState(false)
  const [externalRelays, setExternalRelays] = useState<string[]>([])
  const [hexEventId, setHexEventId] = useState<string | null>(null)

  // Calculate which external relays would be tried when user clicks "Try external relays".
  // IMPORTANT: For embedded events, we should search:
  // 1. Containing event author's relays (outboxes + inboxes)
  // 2. Relay hints from containing event (e, a, q tags - 3rd position)
  // 3. Bech32 hints + embedded event author's relays
  // 4. Relays where embedded event was seen
  // 5. SEARCHABLE_RELAY_URLS
  useEffect(() => {
    const getExternalRelays = async () => {
      const alreadyTriedRelaysSet = new Set<string>()
      ;[...FAST_READ_RELAY_URLS].forEach(url => {
        const normalized = normalizeUrl(url)
        if (normalized) alreadyTriedRelaysSet.add(normalized)
      })

      let hintRelays: string[] = []
      let extractedHexEventId: string | null = null

      // 1. Extract relay hints from containing event (e, a, q tags - 3rd position)
      if (containingEvent) {
        for (const tag of containingEvent.tags) {
          if (['e', 'a', 'q'].includes(tag[0]) && tag.length > 2 && typeof tag[2] === 'string') {
            const hint = tag[2]
            if (hint.startsWith('wss://') || hint.startsWith('ws://')) {
              hintRelays.push(hint)
            }
          }
        }
        
        // Also get containing event author's relays
        try {
          const containingAuthorRelayList = await client.fetchRelayList(containingEvent.pubkey).catch(() => ({ read: [] as string[], write: [] as string[] }))
          hintRelays.push(...(containingAuthorRelayList.read ?? []).slice(0, 10), ...(containingAuthorRelayList.write ?? []).slice(0, 10))
        } catch (err) {
          logger.debug('Failed to fetch containing event author relays', { error: err })
        }
      }

      // 2. Extract hints from bech32 ID and embedded event author
      if (!/^[0-9a-f]{64}$/.test(noteId)) {
        try {
          const { type, data } = nip19.decode(noteId)

          if (type === 'nevent') {
            extractedHexEventId = data.id
            if (data.relays) hintRelays.push(...data.relays)
            if (data.author) {
              const authorRelayList = await client.fetchRelayList(data.author).catch(() => ({ read: [] as string[], write: [] as string[] }))
              hintRelays.push(...(authorRelayList.read ?? []).slice(0, 10), ...(authorRelayList.write ?? []).slice(0, 10))
            }
          } else if (type === 'naddr') {
            if (data.relays) hintRelays.push(...data.relays)
            const authorRelayList = await client.fetchRelayList(data.pubkey).catch(() => ({ read: [] as string[], write: [] as string[] }))
            hintRelays.push(...(authorRelayList.read ?? []).slice(0, 10), ...(authorRelayList.write ?? []).slice(0, 10))
          } else if (type === 'note') {
            extractedHexEventId = data
          }
        } catch (err) {
          logger.error('Failed to parse external relays', { error: err, noteId })
        }
      } else {
        extractedHexEventId = noteId
      }
      
      setHexEventId(extractedHexEventId)
      
      // 3. Get relays where this embedded event was seen
      const seenOn = extractedHexEventId ? client.getSeenEventRelayUrls(extractedHexEventId) : []
      hintRelays.push(...seenOn)
      
      // Normalize all hint relays
      const normalizedHints = hintRelays
        .map(url => normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
      
      // Combine hints with SEARCHABLE_RELAY_URLS (always include as fallback)
      // Normalize SEARCHABLE_RELAY_URLS for comparison
      const normalizedSearchableRelays = SEARCHABLE_RELAY_URLS
        .map(url => normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
      
      // Combine all potential relays (hints + searchable)
      const allPotentialRelays = new Set([...normalizedHints, ...normalizedSearchableRelays])
      
      // Filter out relays that were already tried
      const externalRelays = Array.from(allPotentialRelays).filter(
        relay => !alreadyTriedRelaysSet.has(relay)
      )
      
      // Deduplicate final relay list
      setExternalRelays(externalRelays)
      
      logger.debug('External relays calculated', {
        noteId,
        hintRelaysCount: normalizedHints.length,
        searchableRelaysCount: normalizedSearchableRelays.length,
        alreadyTriedCount: alreadyTriedRelaysSet.size,
        externalRelaysCount: externalRelays.length,
        externalRelays: externalRelays.slice(0, 10) // Log first 10
      })
    }

    getExternalRelays()
  }, [noteId])

  const handleTryExternalRelays = async () => {
    if (!hexEventId || isSearchingExternal) return
    
    if (externalRelays.length === 0) {
      logger.warn('No external relays to search', { noteId, hexEventId })
      setTriedExternal(true)
      return
    }
    
    setIsSearchingExternal(true)
    try {
      logger.info('Searching external relays', { 
        noteId, 
        hexEventId, 
        relayCount: externalRelays.length,
        relays: externalRelays.slice(0, 5) // Log first 5 relays
      })
      
      const event = await client.fetchEventWithExternalRelays(hexEventId, externalRelays)
      
      if (event) {
        logger.info('Event found on external relay', { noteId, hexEventId })
        if (onEventFound) {
          onEventFound(event)
        }
      } else {
        logger.info('Event not found on external relays', { 
          noteId, 
          hexEventId, 
          relayCount: externalRelays.length 
        })
      }
    } catch (error) {
      logger.error('External relay fetch failed', { error, noteId, hexEventId, externalRelays })
    } finally {
      setIsSearchingExternal(false)
      setTriedExternal(true)
    }
  }

  const hasExternalRelays = externalRelays.length > 0

  return (
    <div className={cn('text-left p-3 border rounded-lg', className)}>
      <div className="flex flex-col items-center text-muted-foreground gap-3">
        <div className="text-sm font-medium">{t('Note not found')}</div>
        
        {!triedExternal && hasExternalRelays && (
          <div className="flex flex-col items-center gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTryExternalRelays}
              disabled={isSearchingExternal}
              className="gap-2 w-full"
            >
              {isSearchingExternal ? (
                <>
                  <Search className="w-4 h-4 animate-spin" />
                  {t('Searching...')}
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  {t('Try external relays')} ({externalRelays.length})
                </>
              )}
            </Button>
            <details className="text-xs text-muted-foreground w-full">
              <summary className="cursor-pointer hover:text-foreground text-center list-none">
                {t('Show relays')}
              </summary>
              <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                {externalRelays.map((relay, i) => (
                  <div key={i} className="font-mono text-[10px] truncate px-2 py-0.5 bg-muted/50 rounded">
                    {relay}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
        
        {!triedExternal && !hasExternalRelays && (
          <div className="text-xs text-center">{t('No external relay hints available')}</div>
        )}
        
        {triedExternal && (
          <div className="text-xs text-center">{t('Note could not be found anywhere')}</div>
        )}
        
        <ClientSelect className="w-full" originalNoteId={noteId} />
      </div>
    </div>
  )
}

/**
 * Render a single bookstr event directly (no searching needed)
 */
function EmbeddedBookstrEvent({ event, originalNoteId, className }: { event: Event; originalNoteId?: string; className?: string }) {
  const [parsedContent, setParsedContent] = useState<string | null>(null)
  const bookMetadata = extractBookMetadata(event)
  const { navigateToNote } = useSmartNoteNavigation()

  useEffect(() => {
    const parseContent = async () => {
      try {
        const result = await contentParserService.parseContent(event.content, {
          eventKind: ExtendedKind.PUBLICATION_CONTENT
        })
        setParsedContent(result.html)
      } catch (err) {
        logger.warn('Error parsing bookstr event content', { error: err, eventId: event.id.substring(0, 8) })
        setParsedContent(event.content)
      }
    }
    parseContent()
  }, [event])

  const chapterNum = bookMetadata.chapter
  const verseNum = bookMetadata.verse
  const version = bookMetadata.version
  const bookName = bookMetadata.book 
    ? bookMetadata.book
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    : ''

  const content = parsedContent || event.content

  return (
    <div 
      className={cn('border rounded-lg p-3 bg-muted/30 clickable', className)}
      data-event-id={event.id}
      onClick={(e) => {
        // Don't navigate if clicking on interactive elements
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('[role="button"]') || target.closest('a')) {
          return
        }
        e.stopPropagation()
        client.addEventToCache(event)
        const noteUrl = toNote(originalNoteId ?? event)
        navigateToNote(noteUrl)
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <h4 className="font-semibold text-sm">
          {bookName}
          {chapterNum && ` ${chapterNum}`}
          {verseNum && `:${verseNum}`}
          {version && ` (${version.toUpperCase()})`}
        </h4>
      </div>

      {/* Content */}
      <div className="flex gap-2 text-sm leading-relaxed items-baseline">
        {/* Verse number on the left - only show verse number, not chapter:verse */}
        <span className="font-semibold text-muted-foreground shrink-0 min-w-[2.5rem] text-right">
          {verseNum || null}
        </span>
        {/* Content on the right */}
        <span className="flex-1" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  )
}
