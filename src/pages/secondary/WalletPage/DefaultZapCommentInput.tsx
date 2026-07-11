import { Input } from '@/components/ui/input'
import { SettingsRow } from '@/components/ui/settings'
import { useZap } from '@/providers/ZapProvider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function DefaultZapCommentInput() {
  const { t } = useTranslation()
  const { defaultZapComment, updateDefaultComment } = useZap()
  const [defaultZapCommentInput, setDefaultZapCommentInput] = useState(defaultZapComment)

  return (
    <SettingsRow
      layout="stacked"
      title={t('Default zap comment')}
      htmlFor="default-zap-comment-input"
    >
      <Input
        id="default-zap-comment-input"
        value={defaultZapCommentInput}
        onChange={(e) => setDefaultZapCommentInput(e.target.value)}
        onBlur={() => {
          updateDefaultComment(defaultZapCommentInput)
        }}
      />
    </SettingsRow>
  )
}
