import { Event, kinds } from 'nostr-tools'
import { Highlighter } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import logger from '@/lib/logger'
import HighlightSourcePreview from '@/components/UniversalContent/HighlightSourcePreview'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useSmartNoteNavigationOptional } from '@/PageManager'
import { toNote } from '@/lib/link'
import { useFetchEvent } from '@/hooks'
import { useEffect, useState, useMemo } from 'react'
import { ExtendedKind } from '@/constants'

/**
 * Check if a string is a URL or Nostr address
 */
function isUrlOrNostrAddress(value: string | undefined): boolean {
  if (!value || typeof value !== 'string') {
    return false
  }
  
  // Check if it's a URL (http://, https://, or starts with common URL patterns)
  try {
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('ws://') || value.startsWith('wss://')) {
      new URL(value) // Validate it's a proper URL
      return true
    }
  } catch {
    // Not a valid URL
  }

  // Check if it's a Nostr address (nostr: prefix or bech32 encoded)
  if (value.startsWith('nostr:')) {
    return true
  }

  // Check if it's a bech32 encoded Nostr address
  try {
    const decoded = nip19.decode(value)
    if (['npub', 'nprofile', 'nevent', 'naddr', 'note', 'nrelay'].includes(decoded.type)) {
      return true
    }
  } catch {
    // Not a valid Nostr address
  }

  return false
}

/**
 * Simple author card for highlights with Nostr sources (e-tags, r-tags)
 * Shows just "A note from: [user badge]" instead of the full embedded note
 * The word "note" is a hyperlink to the referenced event
 */
function HighlightAuthorCard({ 
  authorPubkey, 
  eventId,
  onClick 
}: { 
  authorPubkey: string
  eventId?: string
  onClick?: () => void
}) {
  const { navigateToNote } = useSmartNoteNavigationOptional()
  
  const handleNoteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onClick) {
      onClick()
    } else if (eventId) {
      navigateToNote(toNote(eventId))
    }
  }
  
  return (
    <div 
      className="flex items-center gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50"
    >
      <span className="text-sm text-muted-foreground">
        A{' '}
        <button
          onClick={handleNoteClick}
          className="text-primary hover:text-primary/80 hover:underline font-medium cursor-pointer"
        >
          note
        </button>
        {' '}from:
      </span>
      <UserAvatar userId={authorPubkey} size="small" />
      <Username userId={authorPubkey} className="text-sm font-medium" />
    </div>
  )
}

export default function Highlight({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  // State for storing the referenced event's author
  const [referencedEventAuthor, setReferencedEventAuthor] = useState<string | null>(null)
  const [sourceEventId, setSourceEventId] = useState<string | null>(null)
  const [sourceBech32, setSourceBech32] = useState<string | null>(null)
  
  try {

    // Extract the source (e-tag, a-tag, or r-tag) with improved priority handling
    let source = null
    let quoteSource: string | null = null // For plain text r-tags that aren't URLs/Nostr addresses
    let sourceTag: string[] | undefined
    
    // Check for 'source' marker first (highest priority)
    for (const tag of event.tags) {
      if (tag[2] === 'source' || tag[3] === 'source') {
        sourceTag = tag
        break
      }
    }
    
    // If no 'source' marker found, process tags in priority order: e > a > r
    if (!sourceTag) {
      for (const tag of event.tags) {
        // Give 'e' tags highest priority
        if (tag[0] === 'e') {
          sourceTag = tag
          continue
        }
        
        // Give 'a' tags second priority (but don't override 'e' tags)
        if (tag[0] === 'a' && (!sourceTag || sourceTag[0] !== 'e')) {
          sourceTag = tag
          continue
        }
        
        // Give 'r' tags lowest priority
        if (tag[0] === 'r' && (!sourceTag || sourceTag[0] === 'r')) {
          sourceTag = tag
          continue
        }
      }
    }
    
    // Process the selected source tag
    // We'll fetch the referenced event to get the author pubkey
    let tempSourceEventId: string | null = null // Event ID or bech32 for fetching the event
    let tempSourceBech32: string | null = null // Bech32 ID for navigation
    if (sourceTag) {
      if (sourceTag[0] === 'e' && sourceTag[1]) {
        source = {
          type: 'event' as const,
          value: sourceTag[1],
          bech32: nip19.noteEncode(sourceTag[1])
        }
        tempSourceEventId = sourceTag[1] // Store event ID for fetching
        tempSourceBech32 = nip19.noteEncode(sourceTag[1]) // Store bech32 for navigation
      } else if (sourceTag[0] === 'a' && sourceTag[1]) {
        const [kind, pubkey, identifier] = sourceTag[1].split(':')
        const relay = sourceTag[2]
        const bech32 = nip19.naddrEncode({
          kind: parseInt(kind),
          pubkey,
          identifier: identifier || '',
          relays: relay ? [relay] : []
        })
        source = {
          type: 'addressable' as const,
          value: sourceTag[1],
          bech32
        }
        tempSourceEventId = bech32 // Store bech32 for fetching the event
        tempSourceBech32 = bech32 // Store bech32 for navigation
      } else if (sourceTag[0] === 'r') {
        // Check if the r-tag value is a URL or Nostr address
        if (sourceTag[1] && isUrlOrNostrAddress(sourceTag[1])) {
          // Try to decode as Nostr address to extract author
          try {
            const decoded = nip19.decode(sourceTag[1])
            if (decoded.type === 'naddr') {
              // For naddr, we have the pubkey directly
              source = {
                type: 'url' as const,
                value: sourceTag[1],
                bech32: sourceTag[1]
              }
            } else if (decoded.type === 'nevent') {
              // For nevent, we can fetch the event to get the author
              tempSourceEventId = sourceTag[1] // Store bech32 for fetching
              tempSourceBech32 = sourceTag[1] // Store bech32 for navigation
              source = {
                type: 'url' as const,
                value: sourceTag[1],
                bech32: sourceTag[1]
              }
            } else if (decoded.type === 'note') {
              // For note, we can fetch the event to get the author
              tempSourceEventId = sourceTag[1] // Store bech32 for fetching
              tempSourceBech32 = sourceTag[1] // Store bech32 for navigation
              source = {
                type: 'url' as const,
                value: sourceTag[1],
                bech32: sourceTag[1]
              }
            } else {
              // Other Nostr types or URL
              source = {
                type: 'url' as const,
                value: sourceTag[1],
                bech32: sourceTag[1]
              }
            }
          } catch {
            // Not a valid Nostr address, treat as regular URL
            source = {
              type: 'url' as const,
              value: sourceTag[1],
              bech32: sourceTag[1]
            }
          }
        } else if (sourceTag[1]) {
          // It's plain text, store it as a quote source
          quoteSource = sourceTag[1]
        }
      }
    }
    
    // Update state for fetching the referenced event
    useEffect(() => {
      if (tempSourceEventId) {
        setSourceEventId(tempSourceEventId)
        setSourceBech32(tempSourceBech32)
      }
    }, [tempSourceEventId, tempSourceBech32])

    // Fetch the referenced event to get the author pubkey and check if it has a special card
    const { event: referencedEvent } = useFetchEvent(sourceEventId || undefined)
    
    // Determine if the referenced event has a special card that should be used instead of simple author card
    const hasSpecialCard = useMemo(() => {
      // For r-tags that are regular URLs (http/https), they have OpenGraph cards - always use those
      if (sourceTag && sourceTag[0] === 'r' && sourceTag[1]) {
        if (sourceTag[1].startsWith('http://') || sourceTag[1].startsWith('https://')) {
          return true // URLs have OpenGraph cards - use full preview
        }
      }
      
      if (!referencedEvent) {
        // For a-tags, check the kind from the tag itself (before event is loaded)
        if (sourceTag && sourceTag[0] === 'a' && sourceTag[1]) {
          const [kindStr] = sourceTag[1].split(':')
          const kind = parseInt(kindStr)
          // Longform articles (30023) have their own preview card
          if (kind === kinds.LongFormArticle) {
            return true
          }
        }
        return false // Don't know yet - wait for event to load
      }
      
      // Events with special preview cards that should always use full preview
      const specialCardKinds = [
        kinds.LongFormArticle, // 30023 - has LongFormArticlePreview
        ExtendedKind.POLL, // Has PollPreview
        ExtendedKind.DISCUSSION, // Has DiscussionNote
        ExtendedKind.VIDEO, // Has VideoNotePreview
        ExtendedKind.SHORT_VIDEO, // Has VideoNotePreview
        ExtendedKind.PICTURE, // Has PictureNotePreview
        ExtendedKind.PUBLICATION, // Has PublicationCard
        ExtendedKind.WIKI_ARTICLE, // Has special card
        ExtendedKind.WIKI_ARTICLE_MARKDOWN, // Has special card
        ExtendedKind.VOICE, // Has special card
        ExtendedKind.VOICE_COMMENT, // Has special card
      ]
      
      return specialCardKinds.includes(referencedEvent.kind)
    }, [referencedEvent, sourceTag])
    
    // Update the author when we get the referenced event
    useEffect(() => {
      if (referencedEvent) {
        setReferencedEventAuthor(referencedEvent.pubkey)
      }
    }, [referencedEvent])
    
    // For a-tags, we can also extract the pubkey directly from the tag (for immediate display)
    useEffect(() => {
      if (sourceTag && sourceTag[0] === 'a' && sourceTag[1] && !referencedEventAuthor && !hasSpecialCard) {
        const [kindStr, pubkey] = sourceTag[1].split(':')
        const kind = parseInt(kindStr)
        // Only set author for a-tags that don't have special cards
        if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey) && kind !== kinds.LongFormArticle) {
          setReferencedEventAuthor(pubkey)
        }
      }
    }, [sourceTag, referencedEventAuthor, hasSpecialCard])

    // Extract the context (the main quote/full text being highlighted from)
    const contextTag = event.tags.find(tag => tag[0] === 'context')
    const context = contextTag?.[1] || event.content // Default to content if no context
    
    // The event.content is the highlighted portion
    const highlightedText = event.content

    return (
      <div className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 ${className || ''}`}>
        <div className="flex-1 min-w-0">
            {/* Full quoted text with highlighted portion */}
            {context && (
              <div className="note-content text-base font-normal mb-4 whitespace-pre-wrap break-words border-l-4 border-green-500 pl-5 py-4 leading-relaxed bg-green-50/30 dark:bg-green-950/20 rounded-r-lg">
                {contextTag && highlightedText ? (
                  // If we have both context and highlighted text, show the highlight within the context
                  <div>
                    {(() => {
                      // Strip outer quotation marks if present
                      let cleanContext = context.trim()
                      if (cleanContext.startsWith('"') && cleanContext.endsWith('"')) {
                        cleanContext = cleanContext.slice(1, -1).trim()
                      }
                      // Strip outer quotation marks from highlighted text if present
                      let cleanHighlightedText = highlightedText.trim()
                      if (cleanHighlightedText.startsWith('"') && cleanHighlightedText.endsWith('"')) {
                        cleanHighlightedText = cleanHighlightedText.slice(1, -1).trim()
                      }
                      return cleanContext.split(cleanHighlightedText).map((part, index) => (
                        <span key={index}>
                          {part}
                          {index < cleanContext.split(cleanHighlightedText).length - 1 && (
                            <mark className="bg-green-200 dark:bg-green-600 dark:text-white px-1 rounded font-medium">
                              {cleanHighlightedText}
                            </mark>
                          )}
                        </span>
                      ))
                    })()}
                  </div>
                ) : (
                  // If no context tag, just show the content as a regular quote
                  <div>
                    {(() => {
                      // Strip outer quotation marks if present
                      let cleanContext = context.trim()
                      if (cleanContext.startsWith('"') && cleanContext.endsWith('"')) {
                        cleanContext = cleanContext.slice(1, -1).trim()
                      }
                      return cleanContext
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Quote source (plain text r-tag) */}
            {quoteSource && (
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 italic">
                {quoteSource.trimStart().startsWith('—') ? quoteSource : `— ${quoteSource}`}
              </div>
            )}

            {/* Source preview card */}
            {source && (
              <div className="mt-3">
                {/* Only show simple author card if:
                    1. We have the author pubkey
                    2. The referenced event doesn't have a special card (like LongFormArticle preview)
                    3. For r-tags: only if it's a Nostr address, not a regular URL (URLs have OpenGraph cards)
                */}
                {referencedEventAuthor && !hasSpecialCard ? (
                  <HighlightAuthorCard 
                    authorPubkey={referencedEventAuthor} 
                    eventId={sourceBech32 || undefined}
                  />
                ) : (
                  // For sources with special cards, URLs with OpenGraph, or while loading, show full preview
                  <HighlightSourcePreview source={source} className="w-full" />
                )}
              </div>
            )}
          </div>
        </div>
    )
  } catch (error) {
    logger.error('Highlight component error', { error, eventId: event.id })
    return (
      <div className={`relative border-l-4 border-red-500 bg-red-50/50 dark:bg-red-950/20 rounded-r-lg p-4 ${className || ''}`}>
        <div className="flex items-start gap-3">
          <Highlighter className="w-5 h-5 text-red-600 dark:text-red-500 shrink-0 mt-1" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-red-800 dark:text-red-200">Highlight Error:</div>
            <div className="text-red-700 dark:text-red-300 text-sm">{String(error)}</div>
            <div className="mt-2 text-sm">Content: {event.content}</div>
            <div className="text-sm">Context: {event.tags.find(tag => tag[0] === 'context')?.[1] || 'No context found'}</div>
          </div>
        </div>
      </div>
    )
  }
}

