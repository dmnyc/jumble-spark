import SettingsMenuBody from '@/components/Settings/SettingsMenuBody'
import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SettingsPage = forwardRef(
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
        title={hideTitlebar ? undefined : t('Settings')}
        controls={hideTitlebar ? undefined : <RefreshButton onClick={bump} />}
      >
        <div key={contentKey} className="min-w-0">
          <SettingsMenuBody />
        </div>
      </SecondaryPageLayout>
    )
  }
)
SettingsPage.displayName = 'SettingsPage'
export default SettingsPage
