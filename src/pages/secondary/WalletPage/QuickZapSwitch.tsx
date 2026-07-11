import { SettingsRow } from '@/components/ui/settings'
import { Switch } from '@/components/ui/switch'
import { useZap } from '@/providers/ZapProvider'
import { useTranslation } from 'react-i18next'

export default function QuickZapSwitch() {
  const { t } = useTranslation()
  const { quickZap, updateQuickZap } = useZap()

  return (
    <SettingsRow
      htmlFor="quick-zap-switch"
      title={t('Quick zap')}
      description={t(
        'If enabled, you can zap with a single click. Click and hold for custom amounts'
      )}
      control={
        <Switch id="quick-zap-switch" checked={quickZap} onCheckedChange={updateQuickZap} />
      }
    />
  )
}
