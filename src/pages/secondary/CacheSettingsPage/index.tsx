import CacheRelaysSetting from '@/components/CacheRelaysSetting'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const CacheSettingsPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('Cache & offline storage')}
      >
        <div className="px-4 py-3">
          <CacheRelaysSetting />
        </div>
      </SecondaryPageLayout>
    )
  }
)
CacheSettingsPage.displayName = 'CacheSettingsPage'
export default CacheSettingsPage
