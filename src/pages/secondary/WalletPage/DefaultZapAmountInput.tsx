import { Input } from '@/components/ui/input'
import { SettingsRow } from '@/components/ui/settings'
import { useZap } from '@/providers/ZapProvider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function DefaultZapAmountInput() {
  const { t } = useTranslation()
  const { defaultZapSats, updateDefaultSats } = useZap()
  const [defaultZapAmountInput, setDefaultZapAmountInput] = useState(defaultZapSats)

  return (
    <SettingsRow
      htmlFor="default-zap-amount-input"
      title={t('Default zap amount')}
      control={
        <Input
          id="default-zap-amount-input"
          inputMode="numeric"
          className="w-32 text-end"
          value={defaultZapAmountInput}
          onChange={(e) => {
            setDefaultZapAmountInput((pre) => {
              if (e.target.value === '') {
                return 0
              }
              let num = parseInt(e.target.value, 10)
              if (isNaN(num) || num < 0) {
                num = pre
              }
              return num
            })
          }}
          onBlur={() => {
            updateDefaultSats(defaultZapAmountInput)
          }}
        />
      }
    />
  )
}
