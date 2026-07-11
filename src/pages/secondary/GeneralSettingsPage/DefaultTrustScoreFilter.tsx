import { SettingsRow } from '@/components/ui/settings'
import { Slider } from '@/components/ui/slider'
import { SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { useTranslation } from 'react-i18next'

export default function DefaultTrustScoreFilter() {
  const { t } = useTranslation()
  const { minTrustScore, updateMinTrustScore } = useUserTrust()

  return (
    <SettingsRow
      layout="stacked"
      title={t('Default trust score filter threshold ({{n}}%)', { n: minTrustScore })}
    >
      <Slider
        value={[minTrustScore]}
        onValueChange={([value]) =>
          updateMinTrustScore(SPECIAL_TRUST_SCORE_FILTER_ID.DEFAULT, value)
        }
        min={0}
        max={100}
        step={5}
        className="w-full"
      />
    </SettingsRow>
  )
}
