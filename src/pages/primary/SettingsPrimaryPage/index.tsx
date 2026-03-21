import SettingsMenuBody from '@/components/Settings/SettingsMenuBody'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { Settings } from 'lucide-react'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const SettingsPrimaryPage = forwardRef<HTMLDivElement>((_, ref) => {
  const { t } = useTranslation()

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="settings"
      titlebar={
        <div className="flex h-full items-center gap-2 pl-3">
          <Settings className="size-5 shrink-0" />
          <div className="text-lg font-semibold">{t('Settings')}</div>
        </div>
      }
      displayScrollToTopButton
    >
      <div className="min-w-0 px-2 pt-2">
        <SettingsMenuBody />
      </div>
    </PrimaryPageLayout>
  )
})
SettingsPrimaryPage.displayName = 'SettingsPrimaryPage'
export default SettingsPrimaryPage
