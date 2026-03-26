import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import storage from '@/services/local-storage.service'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function PublishSuccessToastSetting() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    setEnabled(storage.getShowPublishSuccessToasts())
  }, [])

  const onChange = (checked: boolean) => {
    setEnabled(checked)
    storage.setShowPublishSuccessToasts(checked)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <Label htmlFor="publish-success-toasts">{t('Publish success toasts')}</Label>
        <Switch id="publish-success-toasts" checked={enabled} onCheckedChange={onChange} />
      </div>
      <div className="text-muted-foreground text-xs max-w-xl">
        {t(
          'Show green notifications when posts, replies, reactions, and other publishes succeed. When off, a small checkmark appears briefly at the bottom-right instead. Errors and failures still use a toast.'
        )}
      </div>
    </div>
  )
}
