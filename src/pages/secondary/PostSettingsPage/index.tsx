import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import MediaUploadServiceSetting from './MediaUploadServiceSetting'
import ExpirationSettings from './ExpirationSettings'
import QuietSettings from './QuietSettings'

const PostSettingsPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()

  return (
    <SecondaryPageLayout ref={ref} index={index} title={hideTitlebar ? undefined : t('Post settings')}>
      <div className="px-4 pt-3 space-y-6">
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
