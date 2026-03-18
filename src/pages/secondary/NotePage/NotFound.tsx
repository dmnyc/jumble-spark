import ClientSelect from '@/components/ClientSelect'
import { Button } from '@/components/ui/button'
import { BIG_RELAY_URLS, FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'
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

  // Calculate which external relays would be tried (excluding already-tried relays)
  useEffect(() => {
    if (!bech32Id) return

    const getExternalRelays = async () => {
      // Get all relays that have already been tried (BIG_RELAY_URLS + FAST_READ_RELAY_URLS)
      // These are the relays used in the initial fetch
      const alreadyTriedRelaysSet = new Set<string>()
      ;[...BIG_RELAY_URLS, ...FAST_READ_RELAY_URLS].forEach(url => {
        const normalized = normalizeUrl(url)
        if (normalized) alreadyTriedRelaysSet.add(normalized)
      })
      
      let hintRelays: string[] = []
      let extractedHexEventId: string | null = null
      
      // Parse relay hints and author from bech32 ID
      if (!/^[0-9a-f]{64}$/.test(bech32Id)) {
        try {
          const { type, data } = nip19.decode(bech32Id)
          
          if (type === 'nevent') {
            extractedHexEventId = data.id
            if (data.relays) hintRelays.push(...data.relays)
            if (data.author) {
              const authorRelayList = await client.fetchRelayList(data.author).catch(() => ({ read: [] as string[], write: [] as string[] }))
              hintRelays.push(...(authorRelayList.read ?? []).slice(0, 4), ...(authorRelayList.write ?? []).slice(0, 4))
            }
          } else if (type === 'naddr') {
            if (data.relays) hintRelays.push(...data.relays)
            const authorRelayList = await client.fetchRelayList(data.pubkey).catch(() => ({ read: [] as string[], write: [] as string[] }))
            hintRelays.push(...(authorRelayList.read ?? []).slice(0, 4), ...(authorRelayList.write ?? []).slice(0, 4))
          } else if (type === 'note') {
            extractedHexEventId = data
          }
        } catch (err) {
          logger.error('Failed to parse external relays', { error: err, bech32Id })
        }
      } else {
        extractedHexEventId = bech32Id
      }
      
      setHexEventId(extractedHexEventId)
      
      // Get relays where this event was seen
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
      
      logger.debug('External relays calculated (NotFound)', {
        bech32Id,
        hintRelaysCount: normalizedHints.length,
        searchableRelaysCount: normalizedSearchableRelays.length,
        alreadyTriedCount: alreadyTriedRelaysSet.size,
        externalRelaysCount: externalRelays.length,
        externalRelays: externalRelays.slice(0, 10) // Log first 10
      })
    }

    getExternalRelays()
  }, [bech32Id])

  const handleTryExternalRelays = async () => {
    if (!hexEventId || isSearchingExternal) return
    
    if (externalRelays.length === 0) {
      logger.warn('No external relays to search (NotFound)', { bech32Id, hexEventId })
      setTriedExternal(true)
      return
    }
    
    setIsSearchingExternal(true)
    try {
      logger.info('Searching external relays (NotFound)', { 
        bech32Id, 
        hexEventId, 
        relayCount: externalRelays.length,
        relays: externalRelays.slice(0, 5) // Log first 5 relays
      })
      
      const event = await client.fetchEventWithExternalRelays(hexEventId, externalRelays)
      
      if (event) {
        logger.info('Event found on external relay (NotFound)', { bech32Id, hexEventId })
        if (onEventFound) {
          onEventFound(event)
        }
      } else {
        logger.info('Event not found on external relays (NotFound)', { 
          bech32Id, 
          hexEventId, 
          relayCount: externalRelays.length 
        })
      }
    } catch (error) {
      logger.error('External relay fetch failed (NotFound)', { error, bech32Id, hexEventId, externalRelays })
    } finally {
      setIsSearchingExternal(false)
      setTriedExternal(true)
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
                {t('Try external relays')}
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
