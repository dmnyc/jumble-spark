import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MediaUploadServiceSetting from './MediaUploadServiceSetting'
import ExpirationSettings from './ExpirationSettings'
import QuietSettings from './QuietSettings'

const PostSettingsPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
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
      title={hideTitlebar ? undefined : t('Post settings')}
      controls={hideTitlebar ? undefined : <RefreshButton onClick={bump} />}
    >
      <div key={contentKey} className="px-4 pt-3 space-y-6">
        <MediaUploadServiceSetting />
        <div className="space-y-4">
          <h3 className="text-lg font-medium">{t('Expiration Tags')}</h3>
          <ExpirationSettings />
        </div>
        <div className="space-y-4">
          <h3 className="text-lg font-medium">{t('Quiet Tags')}</h3>
          <QuietSettings />
        </div>
      </div>
    </SecondaryPageLayout>
  )
})
PostSettingsPage.displayName = 'PostSettingsPage'
export default PostSettingsPage
