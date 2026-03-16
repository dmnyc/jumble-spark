import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const TranslationPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()

    return (
      <SecondaryPageLayout ref={ref} index={index} title={hideTitlebar ? undefined : t('Translation')}>
        <div className="px-4 pt-3 space-y-4">
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
