import Profile from '@/components/Profile'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { useNostr } from '@/providers/NostrProvider'
import { UserRound } from 'lucide-react'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const ProfilePage = forwardRef((_, ref) => {
  const { pubkey } = useNostr()

  return (
    <PrimaryPageLayout
      pageName="profile"
      titlebar={<ProfilePageTitlebar />}
      displayScrollToTopButton
      ref={ref}
    >
      <div className="min-w-0 pt-2">
        <Profile id={pubkey ?? undefined} />
      </div>
    </PrimaryPageLayout>
  )
})
ProfilePage.displayName = 'ProfilePage'
export default ProfilePage

function ProfilePageTitlebar() {
  const { t } = useTranslation()

  return (
    <div className="flex gap-2 items-center h-full pl-3">
      <UserRound />
      <div className="text-lg font-semibold">{t('Profile')}</div>
    </div>
  )
}
