import { Event } from 'nostr-tools'
import { Highlighter } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import logger from '@/lib/logger'
import HighlightSourcePreview from '@/components/UniversalContent/HighlightSourcePreview'

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

export default function Highlight({
  event,
  className
}: {
  event: Event
  className?: string
}) {
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
    if (sourceTag) {
      if (sourceTag[0] === 'e' && sourceTag[1]) {
        source = {
          type: 'event' as const,
          value: sourceTag[1],
          bech32: nip19.noteEncode(sourceTag[1])
        }
      } else if (sourceTag[0] === 'a' && sourceTag[1]) {
        const [kind, pubkey, identifier] = sourceTag[1].split(':')
        const relay = sourceTag[2]
        source = {
          type: 'addressable' as const,
          value: sourceTag[1],
          bech32: nip19.naddrEncode({
            kind: parseInt(kind),
            pubkey,
            identifier: identifier || '',
            relays: relay ? [relay] : []
          })
        }
      } else if (sourceTag[0] === 'r') {
        // Check if the r-tag value is a URL or Nostr address
        if (sourceTag[1] && isUrlOrNostrAddress(sourceTag[1])) {
          source = {
            type: 'url' as const,
            value: sourceTag[1],
            bech32: sourceTag[1]
          }
        } else if (sourceTag[1]) {
          // It's plain text, store it as a quote source
          quoteSource = sourceTag[1]
        }
      }
    }

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
              <div className="text-base font-normal mb-4 whitespace-pre-wrap break-words border-l-4 border-green-500 pl-5 py-4 leading-relaxed bg-green-50/30 dark:bg-green-950/20 rounded-r-lg">
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
                <HighlightSourcePreview source={source} className="w-full" />
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

