import Profile from '@/components/Profile'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useNostr } from '@/providers/NostrProvider'
import { TPageRef } from '@/types'
import { Settings, UserRound } from 'lucide-react'
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const ProfilePage = forwardRef<TPageRef>((_, ref) => {
  const { pubkey } = useNostr()
  const layoutRef = useRef<TPageRef>(null)
  const feedRef = useRef<{ refresh: () => void }>(null)

  const runRefresh = useCallback(() => {
    feedRef.current?.refresh()
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: runRefresh
    }),
    [runRefresh]
  )

  return (
    <PrimaryPageLayout
      pageName="profile"
      titlebar={<ProfilePageTitlebar onFeedRefresh={runRefresh} />}
      displayScrollToTopButton
      ref={layoutRef}
    >
      <div className="min-w-0 pt-2">
        <Profile id={pubkey ?? undefined} feedRef={feedRef} />
      </div>
    </PrimaryPageLayout>
  )
})
ProfilePage.displayName = 'ProfilePage'
export default ProfilePage

function ProfilePageTitlebar({ onFeedRefresh }: { onFeedRefresh: () => void }) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { navigate } = usePrimaryPage()

  return (
    <div className="flex h-full w-full items-center justify-between gap-2 pl-3 pr-1">
      <div className="flex min-w-0 items-center gap-2">
        <UserRound className="size-5 shrink-0" />
        <div className="app-chrome-title truncate">{t('Profile')}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <RefreshButton onClick={onFeedRefresh} />
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
    </div>
  )
}
