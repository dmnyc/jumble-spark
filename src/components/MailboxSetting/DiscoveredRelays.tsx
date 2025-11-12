import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { normalizeUrl, isLocalNetworkUrl } from '@/lib/url'
import { getRelaysFromNip07Extension, verifyNip05 } from '@/lib/nip05'
import { useNostr } from '@/providers/NostrProvider'
import { TMailboxRelay } from '@/types'
import { Loader2, Check, AlertCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'
import logger from '@/lib/logger'

interface DiscoveredRelay {
  url: string
  source: 'nip05' | 'nip07' | 'bunker'
  selected: boolean
}

export default function DiscoveredRelays({ onAdd, localOnly = false }: { onAdd: (relays: TMailboxRelay[]) => void; localOnly?: boolean }) {
  const { t } = useTranslation()
  const { profile, account } = useNostr()
  const [discoveredRelays, setDiscoveredRelays] = useState<DiscoveredRelay[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    discoverRelays()
  }, [profile?.nip05, account?.pubkey, account?.signerType])

  const discoverRelays = async () => {
    if (!account?.pubkey) return

    setIsLoading(true)
    setErrorMsg('')
    const discovered = new Map<string, DiscoveredRelay>()

    try {
      // Try to get relays from NIP-05
      if (profile?.nip05) {
        try {
          const nip05Result = await verifyNip05(profile.nip05, account.pubkey)
          if (nip05Result.isVerified && nip05Result.relays) {
            nip05Result.relays.forEach(url => {
              const normalized = normalizeUrl(url)
              if (normalized && !discovered.has(normalized)) {
                discovered.set(normalized, {
                  url: normalized,
                  source: 'nip05',
                  selected: true
                })
              }
            })
          }
        } catch (error) {
        logger.warn('Could not fetch relays from NIP-05', error as Error)
        }
      }

      // Try to get relays from NIP-07 extension
      if (account.signerType === 'nip-07') {
        try {
          const extensionRelays = await getRelaysFromNip07Extension()
          extensionRelays.forEach(url => {
            const normalized = normalizeUrl(url)
            if (normalized && !discovered.has(normalized)) {
              discovered.set(normalized, {
                url: normalized,
                source: 'nip07',
                selected: true
              })
            }
          })
        } catch (error) {
        logger.warn('Could not fetch relays from NIP-07 extension', error as Error)
        }
      }

      // Note: Bunker relays are from the bunker connection URL itself
      // We could add logic here to extract relays from the bunker URL if needed

      // Filter to only local relays if localOnly is true
      let discoveredArray = Array.from(discovered.values())
      if (localOnly) {
        discoveredArray = discoveredArray.filter(relay => isLocalNetworkUrl(relay.url))
      }

      setDiscoveredRelays(discoveredArray)
    } catch (error) {
      logger.error('Error discovering relays', { error })
      setErrorMsg(t('Failed to discover relays'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleToggleRelay = (url: string) => {
    setDiscoveredRelays(prev =>
      prev.map(relay =>
        relay.url === url ? { ...relay, selected: !relay.selected } : relay
      )
    )
  }

  const handleSelectAll = () => {
    setDiscoveredRelays(prev => prev.map(relay => ({ ...relay, selected: true })))
  }

  const handleClearAll = () => {
    setDiscoveredRelays(prev => prev.map(relay => ({ ...relay, selected: false })))
  }

  const handleAddSelected = async () => {
    const selectedRelays = discoveredRelays.filter(r => r.selected)
    if (selectedRelays.length === 0) return

    setIsAdding(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const mailboxRelays: TMailboxRelay[] = selectedRelays.map(relay => ({
        url: relay.url,
        scope: 'both' as const
      }))

      onAdd(mailboxRelays)
      setSuccessMsg(t('Added {{count}} relay(s)', { count: selectedRelays.length }))
      setTimeout(() => setSuccessMsg(''), 3000)
      
      // Clear discovered relays after adding
      setDiscoveredRelays([])
    } catch (error) {
      logger.error('Failed to add relays', { error })
      setErrorMsg(t('Failed to add relays'))
    } finally {
      setIsAdding(false)
    }
  }

  const getSourceLabel = (source: DiscoveredRelay['source']) => {
    switch (source) {
      case 'nip05':
        return t('from NIP-05')
      case 'nip07':
        return t('from Extension')
      case 'bunker':
        return t('from Bunker')
    }
  }

  if (!profile || !account) {
    return null
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="text-muted-foreground font-semibold select-none">{t('Discovered Relays')}</div>
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          {t('Discovering relays...')}
        </div>
      </div>
    )
  }

  if (discoveredRelays.length === 0) {
    return null
  }

  const selectedCount = discoveredRelays.filter(r => r.selected).length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground font-semibold select-none">{t('Discovered Relays')}</div>
        <Button variant="ghost" size="sm" onClick={discoverRelays}>
          {t('Refresh')}
        </Button>
      </div>

      <div className="text-sm text-muted-foreground mb-2">
        {t('These relays were found from your NIP-05 identifier and signer. You can add them to your relay list.')}
      </div>

      <div className="border rounded-lg p-3 space-y-2 max-h-96 overflow-y-auto">
        {discoveredRelays.map((relay) => (
          <div key={relay.url} className="flex items-center gap-2 p-2 hover:bg-accent rounded">
            <Checkbox
              id={`discovered-${relay.url}`}
              checked={relay.selected}
              onCheckedChange={() => handleToggleRelay(relay.url)}
            />
            <label
              htmlFor={`discovered-${relay.url}`}
              className="flex items-center gap-2 flex-1 cursor-pointer"
            >
              <RelayIcon url={relay.url} className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium">{relay.url}</div>
                <div className="text-xs text-muted-foreground">{getSourceLabel(relay.source)}</div>
              </div>
            </label>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2">
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleSelectAll}>
            {t('Select All')}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClearAll}>
            {t('Clear All')}
          </Button>
        </div>
        <Button
          onClick={handleAddSelected}
          disabled={selectedCount === 0 || isAdding}
          className="text-xs px-2 py-1.5 h-auto w-full sm:w-auto"
        >
          {isAdding ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              {t('Adding...')}
            </>
          ) : (
            t('Add {{count}} Selected', { count: selectedCount })
          )}
        </Button>
      </div>

      {successMsg && (
        <div className="text-green-600 dark:text-green-400 text-sm flex items-center gap-1">
          <Check className="h-3 w-3" />
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="text-destructive text-sm flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {errorMsg}
        </div>
      )}
    </div>
  )
}

