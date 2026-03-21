import { Skeleton } from '@/components/ui/skeleton'
import { FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS, ExtendedKind } from '@/constants'
import { isRenderableNoteKind } from '@/lib/note-renderable-kinds'
import { useFetchEvent } from '@/hooks'
import { normalizeUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import client from '@/services/client.service'
import { useTranslation } from 'react-i18next'
import { useEffect, useMemo, useState } from 'react'
import { Event, nip19 } from 'nostr-tools'
import ClientSelect from '../ClientSelect'
import MainNoteCard from '../NoteCard/MainNoteCard'
import UnknownNote from '../Note/UnknownNote'
import { Button } from '../ui/button'
import { EmbeddedCalendarEvent } from './EmbeddedCalendarEvent'
import { Search } from 'lucide-react'
import logger from '@/lib/logger'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { contentParserService } from '@/services/content-parser.service'
import { useSmartNoteNavigation } from '@/PageManager'
import { toNote } from '@/lib/link'

/** Embedded `noteId` is often raw hex from parsers; must accept A–F and normalize for REQ `ids`. */
function hexEventIdFromNoteId(noteId: string): string | null {
  const trimmed = noteId.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  try {
    const { type, data } = nip19.decode(noteId)
    if (type === 'note') return data
    if (type === 'nevent') return data.id
    return null
  } catch {
    return null
  }
}

/** True if `fetchEventWithExternalRelays(noteId, …)` can build a REQ filter (hex, note, nevent, naddr). */
function canSearchOnExternalRelays(noteId: string): boolean {
  if (hexEventIdFromNoteId(noteId)) return true
  try {
    return nip19.decode(noteId.trim()).type === 'naddr'
  } catch {
    return false
  }
}

export type EmbeddedNoteIdValidation =
  | { valid: true }
  | {
      valid: false
      reason: 'empty' | 'invalid_hex' | 'invalid_bech32' | 'wrong_nip19_type'
      decodedType?: string
    }

/**
 * Only hex (64), note1, nevent1, and naddr1 are valid embedded note targets.
 * Malformed bech32, wrong kinds (npub, …), or bad hex length fail before fetch/search UI.
 */
export function validateEmbeddedNotePointer(noteId: string): EmbeddedNoteIdValidation {
  const s = noteId.trim()
  if (!s) return { valid: false, reason: 'empty' }

  if (/^[0-9a-f]{64}$/i.test(s)) return { valid: true }

  if (/^[0-9a-f]+$/i.test(s)) {
    return { valid: false, reason: 'invalid_hex' }
  }

  const looksLikeNostrBech32 =
    s.startsWith('n') && s.includes('1') && /^[a-z0-9]+$/i.test(s) && s.length >= 10

  if (looksLikeNostrBech32) {
    try {
      const { type } = nip19.decode(s)
      if (type === 'note' || type === 'nevent' || type === 'naddr') return { valid: true }
      return { valid: false, reason: 'wrong_nip19_type', decodedType: type }
    } catch {
      return { valid: false, reason: 'invalid_bech32' }
    }
  }

  try {
    const { type } = nip19.decode(s)
    if (type === 'note' || type === 'nevent' || type === 'naddr') return { valid: true }
    return { valid: false, reason: 'wrong_nip19_type', decodedType: type }
  } catch {
    return { valid: false, reason: 'invalid_bech32' }
  }
}

export function EmbeddedNote({
  noteId,
  className,
  containingEvent
}: {
  noteId: string
  className?: string
  containingEvent?: Event
}) {
  const validation = useMemo(() => validateEmbeddedNotePointer(noteId), [noteId])
  if (!validation.valid) {
    return (
      <EmbeddedNoteInvalid
        className={className}
        noteId={noteId}
        validation={validation}
      />
    )
  }
  return (
    <EmbeddedNoteContent
      noteId={noteId}
      className={className}
      containingEvent={containingEvent}
    />
  )
}

function EmbeddedNoteInvalid({
  noteId,
  className,
  validation
}: {
  noteId: string
  className?: string
  validation: Exclude<EmbeddedNoteIdValidation, { valid: true }>
}) {
  const { t } = useTranslation()
  const trimmed = noteId.trim()
  const isNsecLike = /^nsec1/i.test(trimmed) || validation.decodedType === 'nsec'
  const preview =
    trimmed.length > 96 ? `${trimmed.slice(0, 96)}…` : trimmed || '—'

  let message: string
  switch (validation.reason) {
    case 'empty':
      message = t('embeddedNoteInvalidEmpty')
      break
    case 'invalid_hex':
      message = t('embeddedNoteInvalidHex')
      break
    case 'wrong_nip19_type':
      message = t('embeddedNoteInvalidWrongKind', {
        type: validation.decodedType ?? 'unknown'
      })
      break
    case 'invalid_bech32':
    default:
      message = t('embeddedNoteInvalidBech32')
      break
  }

  return (
    <div
      className={cn('text-left p-3 border border-destructive/30 rounded-lg bg-destructive/5', className)}
      onClick={(e) => e.stopPropagation()}
      data-embedded-note-invalid
    >
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div className="text-sm font-medium text-destructive">{t('Invalid embedded note reference')}</div>
        <p className="text-xs leading-relaxed">{message}</p>
        {validation.reason !== 'empty' && !isNsecLike && (
          <pre className="text-[10px] font-mono whitespace-pre-wrap break-all rounded bg-muted/50 p-2 text-foreground/80">
            {preview}
          </pre>
        )}
        <ClientSelect className="w-full" originalNoteId={trimmed || undefined} />
      </div>
    </div>
  )
}

function EmbeddedNoteContent({
  noteId,
  className,
  containingEvent
}: {
  noteId: string
  className?: string
  containingEvent?: Event
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

  if (!isRenderableNoteKind(finalEvent.kind)) {
    return (
      <div
        data-embedded-note
        data-embedded-unsupported
        onClick={(e) => e.stopPropagation()}
      >
        <UnknownNote
          event={finalEvent}
          className={cn('my-0 p-2 sm:p-3 border rounded-lg w-full', className)}
        />
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
  const [externalSearchDetail, setExternalSearchDetail] = useState<
    null | 'unparseable' | 'no_relays' | 'searched'
  >(null)

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

      // 2. Hex id (any case) or bech32; hints from nevent/naddr for extra relays
      const quickHex = hexEventIdFromNoteId(noteId)
      if (quickHex) {
        extractedHexEventId = quickHex
      }
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
      } catch {
        // Plain hex ids are not valid bech32 — already handled via quickHex
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
    // containingEvent supplies e/a/q relay hints + author NIP-65 list — must rerun when parent loads
  }, [noteId, containingEvent?.id])

  const handleTryExternalRelays = async () => {
    if (isSearchingExternal) return

    if (!canSearchOnExternalRelays(noteId)) {
      logger.warn('External relay search skipped: unsupported note id', { noteId })
      setExternalSearchDetail('unparseable')
      setTriedExternal(true)
      return
    }

    if (externalRelays.length === 0) {
      logger.warn('No external relays to search', { noteId })
      setExternalSearchDetail('no_relays')
      setTriedExternal(true)
      return
    }

    setIsSearchingExternal(true)
    setExternalSearchDetail(null)
    let found: Event | undefined
    try {
      const idLog = hexEventId ?? hexEventIdFromNoteId(noteId) ?? noteId.slice(0, 16)
      logger.info('Searching external relays', {
        noteId,
        hexOrHint: idLog,
        relayCount: externalRelays.length,
        relays: externalRelays.slice(0, 5)
      })

      const event = await client.fetchEventWithExternalRelays(noteId, externalRelays)

      if (event) {
        logger.info('Event found on external relay', { noteId })
        found = event
        onEventFound?.(event)
      } else {
        logger.info('Event not found on external relays', {
          noteId,
          relayCount: externalRelays.length
        })
        setExternalSearchDetail('searched')
      }
    } catch (error) {
      logger.error('External relay fetch failed', { error, noteId, externalRelays })
      setExternalSearchDetail('searched')
    } finally {
      setIsSearchingExternal(false)
      if (!found) {
        setTriedExternal(true)
      }
    }
  }

  const hasExternalRelays = externalRelays.length > 0
  const showExternalTryButton =
    !triedExternal && hasExternalRelays && canSearchOnExternalRelays(noteId)

  return (
    <div className={cn('text-left p-3 border rounded-lg', className)}>
      <div className="flex flex-col items-center text-muted-foreground gap-3">
        <div className="text-sm font-medium">{t('Note not found')}</div>
        
        {showExternalTryButton && (
          <div className="flex flex-col items-center gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                void handleTryExternalRelays()
              }}
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

        {!triedExternal && hasExternalRelays && !canSearchOnExternalRelays(noteId) && (
          <div className="text-xs text-center text-muted-foreground">
            {t('External relay search is not available for this link type')}
          </div>
        )}

        {triedExternal && externalSearchDetail === 'unparseable' && (
          <div className="text-xs text-center">{t('External relay search is not available for this link type')}</div>
        )}

        {triedExternal && externalSearchDetail === 'no_relays' && (
          <div className="text-xs text-center">{t('No external relay hints available')}</div>
        )}

        {triedExternal && externalSearchDetail === 'searched' && (
          <div className="text-xs text-center">
            {t('Searched external relays not found', { count: externalRelays.length })}
          </div>
        )}

        {triedExternal && !externalSearchDetail && (
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
