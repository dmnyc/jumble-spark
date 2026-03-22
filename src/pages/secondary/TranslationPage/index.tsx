import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/PageManager'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const TranslationPage = forwardRef(
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
        title={hideTitlebar ? undefined : t('Translation')}
        controls={hideTitlebar ? undefined : <RefreshButton onClick={bump} />}
      >
        <div key={contentKey} className="px-4 pt-3 space-y-4">
          <p className="text-muted-foreground">
            {t(
              'To translate notes and other content, use your browser’s built-in translation. For example: right-click the page and choose “Translate to…”, or use the translate icon in the address bar.'
            )}
          </p>
        </div>
      </SecondaryPageLayout>
    )
  }
)
TranslationPage.displayName = 'TranslationPage'
export default TranslationPage
