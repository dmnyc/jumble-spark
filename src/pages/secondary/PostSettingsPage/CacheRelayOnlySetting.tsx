import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { StorageKey, ExtendedKind } from '@/constants'
import { useNostr } from '@/providers/NostrProvider'
import indexedDb from '@/services/indexed-db.service'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function CacheRelayOnlySetting() {
  const { t } = useTranslation()
  const { cacheRelayListEvent, pubkey } = useNostr()
  const [hasCacheRelaysAvailable, setHasCacheRelaysAvailable] = useState(false)
  const [enabled, setEnabled] = useState(false) // Start as OFF, will be updated based on cache availability
  
  // Check if user has cache relays - check both provider state and IndexedDB as fallback
  // Note: Cache relay events use 'r' tags, not 'relay' tags
  useEffect(() => {
    const checkCacheRelays = async () => {
      let hasRelays = false
      
      // First check provider state
      if (cacheRelayListEvent) {
        hasRelays = cacheRelayListEvent.tags.some(tag => tag[0] === 'r' && tag[1])
      } else if (pubkey) {
        // Fallback: check IndexedDB directly if provider state isn't loaded yet
        try {
          const storedEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)
          if (storedEvent) {
            hasRelays = storedEvent.tags.some(tag => tag[0] === 'r' && tag[1])
          }
        } catch (error) {
          // Ignore errors
        }
      }
      
      setHasCacheRelaysAvailable(hasRelays)
      
      // Set enabled state based on cache availability
      if (hasRelays) {
        // If cache exists, default to true (ON)
        // Only respect localStorage if it's explicitly set to 'false' by the user
        const stored = window.localStorage.getItem(StorageKey.USE_CACHE_ONLY_FOR_PRIVATE_NOTES)
        // Default to ON when cache exists - only set to OFF if user explicitly set it to 'false'
        if (stored === 'false') {
          setEnabled(false)
        } else {
          // Default to ON (either null or 'true')
          setEnabled(true)
          // Save the default ON state if not already set
          if (stored === null) {
            window.localStorage.setItem(StorageKey.USE_CACHE_ONLY_FOR_PRIVATE_NOTES, 'true')
          }
        }
      } else {
        // If no cache, set to false (OFF) and save it
        setEnabled(false)
        window.localStorage.setItem(StorageKey.USE_CACHE_ONLY_FOR_PRIVATE_NOTES, 'false')
      }
    }
    
    checkCacheRelays()
  }, [cacheRelayListEvent, pubkey])

  const handleEnabledChange = (checked: boolean) => {
    setEnabled(checked)
    window.localStorage.setItem(StorageKey.USE_CACHE_ONLY_FOR_PRIVATE_NOTES, checked.toString())
  }

  if (!hasCacheRelaysAvailable) {
    return null // Don't show if user doesn't have cache relays
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">{t('Private Notes')}</h3>
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Label htmlFor="cache-relay-only">{t('Use cache relay only for citations and publication content')}</Label>
          <Switch
            id="cache-relay-only"
            checked={enabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>
        <div className="text-muted-foreground text-xs">
          {t('When enabled, citations and publication content (kind 30041) will only be published to your cache relay, not to outbox relays')}
        </div>
      </div>
    </div>
  )
}

