import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { StorageKey } from '@/constants'
import { Dispatch, SetStateAction, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function PostOptions({
  posting,
  show,
  addClientTag,
  setAddClientTag,
  isNsfw,
  setIsNsfw,
  minPow,
  setMinPow,
  useCacheOnlyForPrivateNotes,
  setUseCacheOnlyForPrivateNotes,
  hasCacheRelaysAvailable
}: {
  posting: boolean
  show: boolean
  addClientTag: boolean
  setAddClientTag: Dispatch<SetStateAction<boolean>>
  isNsfw: boolean
  setIsNsfw: Dispatch<SetStateAction<boolean>>
  minPow: number
  setMinPow: Dispatch<SetStateAction<number>>
  useCacheOnlyForPrivateNotes?: boolean
  setUseCacheOnlyForPrivateNotes?: Dispatch<SetStateAction<boolean>>
  hasCacheRelaysAvailable?: boolean
}) {
  const { t } = useTranslation()

  useEffect(() => {
    const stored = window.localStorage.getItem(StorageKey.ADD_CLIENT_TAG)
    setAddClientTag(stored === null ? true : stored === 'true') // Default to true if not set
  }, [])

  if (!show) return null

  const onAddClientTagChange = (checked: boolean) => {
    setAddClientTag(checked)
    window.localStorage.setItem(StorageKey.ADD_CLIENT_TAG, checked.toString())
  }

  const onNsfwChange = (checked: boolean) => {
    setIsNsfw(checked)
  }

  const onUseCacheOnlyChange = (checked: boolean) => {
    if (setUseCacheOnlyForPrivateNotes) {
      setUseCacheOnlyForPrivateNotes(checked)
      window.localStorage.setItem(StorageKey.USE_CACHE_ONLY_FOR_PRIVATE_NOTES, checked.toString())
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Label htmlFor="add-client-tag">{t('Add client tag')}</Label>
          <Switch
            id="add-client-tag"
            checked={addClientTag}
            onCheckedChange={onAddClientTagChange}
            disabled={posting}
          />
        </div>
        <div className="text-muted-foreground text-xs">
          {t('Show others this was sent via Jumble')}
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Label htmlFor="add-nsfw-tag">{t('NSFW')}</Label>
        <Switch
          id="add-nsfw-tag"
          checked={isNsfw}
          onCheckedChange={onNsfwChange}
          disabled={posting}
        />
      </div>

      {hasCacheRelaysAvailable && useCacheOnlyForPrivateNotes !== undefined && setUseCacheOnlyForPrivateNotes && (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Label htmlFor="use-cache-only">{t('Use cache relay only for citations and publication content')}</Label>
            <Switch
              id="use-cache-only"
              checked={useCacheOnlyForPrivateNotes}
              onCheckedChange={onUseCacheOnlyChange}
              disabled={posting}
            />
          </div>
          <div className="text-muted-foreground text-xs">
            {t('When enabled, citations and publication content (kind 30041) will only be published to your cache relay, not to outbox relays')}
          </div>
        </div>
      )}

      <div className="grid gap-4 pb-4">
        <Label>{t('Proof of Work (difficulty {{minPow}})', { minPow })}</Label>
        <Slider
          defaultValue={[0]}
          value={[minPow]}
          onValueChange={([pow]) => setMinPow(pow)}
          max={28}
          step={1}
          disabled={posting}
        />
      </div>
    </div>
  )
}
