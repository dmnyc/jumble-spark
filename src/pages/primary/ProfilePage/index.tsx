import Profile from '@/components/Profile'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { Settings, UserRound } from 'lucide-react'
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
  const { pubkey } = useNostr()
  const { navigate } = usePrimaryPage()

  return (
    <div className="flex h-full w-full items-center justify-between gap-2 pl-3 pr-1">
      <div className="flex min-w-0 items-center gap-2">
        <UserRound className="size-5 shrink-0" />
        <div className="truncate text-lg font-semibold">{t('Profile')}</div>
      </div>
      {pubkey ? (
        <Button
          type="button"
          variant="ghost"
          size="titlebar-icon"
          title={t('Settings')}
          onClick={() => navigate('settings')}
        >
          <Settings className="size-5" />
        </Button>
      ) : null}
    </div>
  )
}
