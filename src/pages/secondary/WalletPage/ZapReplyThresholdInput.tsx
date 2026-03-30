import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useZap } from '@/providers/ZapProvider'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function ZapReplyThresholdInput() {
  const { t } = useTranslation()
  const { zapReplyThreshold, updateZapReplyThreshold } = useZap()
  const [zapReplyThresholdInput, setZapReplyThresholdInput] = useState(zapReplyThreshold)

  useEffect(() => {
    setZapReplyThresholdInput(zapReplyThreshold)
  }, [zapReplyThreshold])

  return (
    <div className="w-full space-y-1">
      <Label htmlFor="zap-reply-threshold-input">
        <div className="text-base font-medium">{t('Zap reply threshold')}</div>
        <div className="text-muted-foreground text-sm">
          {t('Zaps above this amount will appear as replies in threads')}
        </div>
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="zap-reply-threshold-input"
          className="w-20"
          value={zapReplyThresholdInput}
          onChange={(e) => {
            setZapReplyThresholdInput((pre) => {
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
            updateZapReplyThreshold(zapReplyThresholdInput)
          }}
        />
        <span className="text-sm text-muted-foreground shrink-0">{t('sats')}</span>
      </div>
    </div>
  )
}

