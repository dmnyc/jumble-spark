import OthersRelayList from '@/components/OthersRelayList'
import { useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const RelaySettingsPage = forwardRef(({ id, index, hideTitlebar = false }: { id?: string; index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { profile } = useFetchProfile(id)

  if (!id || !profile) {
    return null
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : t("username's used relays", { username: profile.username })}
      hideBackButton={hideTitlebar}
    >
      <div className="px-4 pt-3">
        <OthersRelayList userId={id} />
      </div>
    </SecondaryPageLayout>
  )
})
RelaySettingsPage.displayName = 'RelaySettingsPage'
export default RelaySettingsPage
