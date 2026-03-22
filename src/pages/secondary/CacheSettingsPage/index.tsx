import CacheRelaysSetting from '@/components/CacheRelaysSetting'
import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/PageManager'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const CacheSettingsPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const [contentKey, setContentKey] = useState(0)
    const bump = useCallback(() => setContentKey((k) => k + 1), [])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(bump)
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, bump])

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('Cache & offline storage')}
        controls={hideTitlebar ? undefined : <RefreshButton onClick={bump} />}
      >
        <div key={contentKey} className="px-4 py-3">
          <CacheRelaysSetting />
        </div>
      </SecondaryPageLayout>
    )
  }
)
CacheSettingsPage.displayName = 'CacheSettingsPage'
export default CacheSettingsPage
