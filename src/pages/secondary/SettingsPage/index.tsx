import SettingsMenuBody from '@/components/Settings/SettingsMenuBody'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const SettingsPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()

    return (
      <SecondaryPageLayout ref={ref} index={index} title={hideTitlebar ? undefined : t('Settings')}>
        <SettingsMenuBody />
      </SecondaryPageLayout>
    )
  }
)
SettingsPage.displayName = 'SettingsPage'
export default SettingsPage
