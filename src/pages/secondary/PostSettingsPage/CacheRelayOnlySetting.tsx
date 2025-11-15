import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { StorageKey } from '@/constants'
import { hasCacheRelays } from '@/lib/private-relays'
import { useNostr } from '@/providers/NostrProvider'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function CacheRelayOnlySetting() {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const [enabled, setEnabled] = useState(true) // Default ON
  const [hasCacheRelaysAvailable, setHasCacheRelaysAvailable] = useState(false)

  useEffect(() => {
    // Load from localStorage
    const stored = window.localStorage.getItem(StorageKey.USE_CACHE_ONLY_FOR_PRIVATE_NOTES)
    setEnabled(stored === null ? true : stored === 'true') // Default to true if not set

    // Check if user has cache relays
    if (pubkey) {
      hasCacheRelays(pubkey)
        .then(setHasCacheRelaysAvailable)
        .catch(() => setHasCacheRelaysAvailable(false))
    } else {
      setHasCacheRelaysAvailable(false)
    }
  }, [pubkey])

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

