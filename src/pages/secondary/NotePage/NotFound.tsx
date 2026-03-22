import ClientSelect from '@/components/ClientSelect'
import { Button } from '@/components/ui/button'
import { FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { AlertCircle, Search } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logger from '@/lib/logger'

export default function NotFound({ 
  bech32Id, 
  onEventFound 
}: { 
  bech32Id?: string
  onEventFound?: (event: any) => void 
}) {
  const { t } = useTranslation()
  const [isSearchingExternal, setIsSearchingExternal] = useState(false)
  const [triedExternal, setTriedExternal] = useState(false)
  const [externalRelays, setExternalRelays] = useState<string[]>([])
  const [hexEventId, setHexEventId] = useState<string | null>(null)

  // Hints + seen + searchable + FAST_READ (second pass uses longer timeouts; include defaults again)
  useEffect(() => {
    if (!bech32Id) return

    const getExternalRelays = async () => {
      try {
        let bech32HintRelays: string[] = [] // Relay hints from bech32 (highest priority)
        let extractedHexEventId: string | null = null
        
        // CRITICAL: Parse relay hints from bech32 ID FIRST (highest priority)
        // These are explicit hints from the bech32 address and should always be used
        if (!/^[0-9a-f]{64}$/i.test(bech32Id)) {
          try {
            const { type, data } = nip19.decode(bech32Id)
            
            if (type === 'nevent') {
              extractedHexEventId = data.id
              // CRITICAL: Always extract relay hints from nevent bech32
              if (data.relays && Array.isArray(data.relays)) {
                bech32HintRelays.push(...data.relays)
                logger.debug('Extracted relay hints from nevent', { 
                  bech32Id, 
                  hintCount: data.relays.length,
                  hints: data.relays 
                })
              }
              // Note: We skip fetching author relay list here to avoid infinite loops
              // The relay hints from bech32 are the most reliable source
            } else if (type === 'naddr') {
              // CRITICAL: Always extract relay hints from naddr bech32
              if (data.relays && Array.isArray(data.relays)) {
                bech32HintRelays.push(...data.relays)
                logger.debug('Extracted relay hints from naddr', { 
                  bech32Id, 
                  hintCount: data.relays.length,
                  hints: data.relays 
                })
              }
              // Note: We skip fetching author relay list here to avoid infinite loops
            } else if (type === 'note') {
              extractedHexEventId = data
            }
          } catch (err) {
            logger.error('Failed to parse bech32 ID for relay hints', { error: err, bech32Id })
          }
        } else {
          extractedHexEventId = bech32Id.toLowerCase()
        }
        
        setHexEventId(extractedHexEventId)
        
        // Get relays where this event was seen (if we have the hex ID)
        const seenOn = extractedHexEventId ? client.getSeenEventRelayUrls(extractedHexEventId) : []
        
        // Normalize bech32 hint relays (highest priority - these come from the bech32 address itself)
        const normalizedBech32Hints = bech32HintRelays
          .map(url => normalizeUrl(url))
          .filter((url): url is string => Boolean(url))
        
        // Normalize seen relays
        const normalizedSeenRelays = seenOn
          .map(url => normalizeUrl(url))
          .filter((url): url is string => Boolean(url))
        
        const normalizedSearchableRelays = SEARCHABLE_RELAY_URLS
          .map(url => normalizeUrl(url))
          .filter((url): url is string => Boolean(url))

        const normalizedFastRead = FAST_READ_RELAY_URLS
          .map(url => normalizeUrl(url))
          .filter((url): url is string => Boolean(url))

        const orderedExternalRelays = Array.from(
          new Set([
            ...normalizedBech32Hints,
            ...normalizedSeenRelays,
            ...normalizedSearchableRelays,
            ...normalizedFastRead
          ])
        )

        setExternalRelays(orderedExternalRelays)

        logger.debug('External relays calculated (NotFound)', {
          bech32Id,
          bech32HintCount: normalizedBech32Hints.length,
          seenRelayCount: normalizedSeenRelays.length,
          searchableRelaysCount: normalizedSearchableRelays.length,
          fastReadRelaysCount: normalizedFastRead.length,
          externalRelaysCount: orderedExternalRelays.length,
          bech32Hints: normalizedBech32Hints,
          externalRelays: orderedExternalRelays.slice(0, 10)
        })
      } catch (error) {
        logger.error('Error calculating external relays (NotFound)', { 
          error, 
          bech32Id,
          errorMessage: error instanceof Error ? error.message : String(error)
        })
        // Set empty array on error to prevent UI issues
        setExternalRelays([])
      }
    }

    getExternalRelays()
  }, [bech32Id])

  const handleTryExternalRelays = async () => {
    if (!bech32Id || isSearchingExternal) return

    if (externalRelays.length === 0) {
      logger.warn('No external relays to search (NotFound)', { bech32Id, hexEventId })
      setTriedExternal(true)
      return
    }

    setIsSearchingExternal(true)
    let found = false
    try {
      const idHex =
        hexEventId ??
        (/^[0-9a-f]{64}$/i.test(bech32Id) ? bech32Id.toLowerCase() : null) ??
        (() => {
          try {
            const { type, data } = nip19.decode(bech32Id)
            if (type === 'note') return data as string
            if (type === 'nevent') return data.id
          } catch {
            /* ignore */
          }
          return null
        })()

      if (idHex) {
        const fromDb = await indexedDb.getEventFromPublicationStore(idHex)
        if (fromDb) {
          client.addEventToCache(fromDb)
          onEventFound?.(fromDb)
          found = true
          logger.info('Event found in IndexedDB (NotFound try-harder)', { bech32Id })
        }
      }

      if (!found) {
        const retried = await client.fetchEventForceRetry(bech32Id)
        if (retried) {
          onEventFound?.(retried)
          found = true
          logger.info('Event found after fetchEventForceRetry (NotFound)', { bech32Id })
        }
      }

      if (!found) {
        logger.info('Searching external relays (NotFound)', {
          bech32Id,
          hexEventId: idHex ?? hexEventId,
          relayCount: externalRelays.length,
          relays: externalRelays.slice(0, 5)
        })

        const event = await client.fetchEventWithExternalRelays(bech32Id, externalRelays)

        if (event) {
          logger.info('Event found on external relay (NotFound)', { bech32Id, hexEventId })
          client.addEventToCache(event)
          onEventFound?.(event)
          found = true
        } else {
          logger.info('Event not found on external relays (NotFound)', {
            bech32Id,
            hexEventId,
            relayCount: externalRelays.length
          })
        }
      }
    } catch (error) {
      logger.error('External relay fetch failed (NotFound)', { error, bech32Id, hexEventId, externalRelays })
    } finally {
      setIsSearchingExternal(false)
      if (!found) {
        setTriedExternal(true)
      }
    }
  }

  const hasExternalRelays = externalRelays.length > 0

  return (
    <div className="text-muted-foreground w-full h-full flex flex-col items-center justify-center gap-4 p-4">
      <AlertCircle className="w-12 h-12 text-muted-foreground/50" />
      <div className="text-lg font-medium">{t('Note not found')}</div>
      
      {bech32Id && !triedExternal && hasExternalRelays && (
        <div className="flex flex-col items-center gap-3 max-w-md">
          <div className="text-sm text-center text-muted-foreground">
            {t('The note was not found on your relays or default relays.')}
          </div>
          
          <Button
            variant="default"
            onClick={handleTryExternalRelays}
            disabled={isSearchingExternal}
            className="gap-2"
          >
            {isSearchingExternal ? (
              <>
                <Search className="w-4 h-4 animate-spin" />
                {t('Searching external relays...')}
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
              {t('Show relays')} ({externalRelays.length})
            </summary>
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {externalRelays.map((relay, i) => (
                <div key={i} className="font-mono text-[10px] truncate px-2 py-1 bg-muted/50 rounded">
                  {relay}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
      
      {bech32Id && !triedExternal && !hasExternalRelays && (
        <div className="text-sm text-muted-foreground">
          {t('No external relay hints available')}
        </div>
      )}
      
      {triedExternal && (
        <div className="text-sm">{t('Note could not be found anywhere')}</div>
      )}
      
      <ClientSelect originalNoteId={bech32Id} />
    </div>
  )
}
