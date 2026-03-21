import Explore from '@/components/Explore'
import FollowingFavoriteRelayList from '@/components/FollowingFavoriteRelayList'
import Tabs from '@/components/Tabs'
import VersionUpdateBanner from '@/components/VersionUpdateBanner'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { Compass, Plus } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TExploreTabs = 'explore' | 'following'

function normalizeHomeTab(restored: string): TExploreTabs {
  if (restored === 'following') return 'following'
  // Removed "favorites" tab — treat saved state as Explore
  return 'explore'
}

const ExplorePage = forwardRef((_, ref) => {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TExploreTabs>('explore')

  // Listen for tab restoration from PageManager
  useEffect(() => {
    const handleRestore = (e: CustomEvent<{ page: string; tab: string }>) => {
      if (e.detail.page === 'home' && e.detail.tab) {
        setTab(normalizeHomeTab(e.detail.tab))
      }
    }
    window.addEventListener('restorePageTab', handleRestore as EventListener)
    return () => window.removeEventListener('restorePageTab', handleRestore as EventListener)
  }, [])

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="home"
      titlebar={<ExplorePageTitlebar t={t} />}
      subHeader={
        <Tabs
          value={tab}
          tabs={[
            { value: 'explore', label: t('Explore') },
            { value: 'following', label: t("Following's Favorites") }
          ]}
          onTabChange={(next) => {
            setTab(next as TExploreTabs)
            window.dispatchEvent(
              new CustomEvent('pageTabChanged', {
                detail: { page: 'home', tab: next }
              })
            )
          }}
        />
      }
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-2">
        <div className="px-2">
          <VersionUpdateBanner />
        </div>
        {tab === 'explore' && <Explore />}
        {tab === 'following' && <FollowingFavoriteRelayList />}
      </div>
    </PrimaryPageLayout>
  )
})
ExplorePage.displayName = 'ExplorePage'
export default ExplorePage

function ExplorePageTitlebar({ t }: { t: (key: string) => string }) {
  return (
    <div className="flex gap-2 justify-between h-full">
      <div className="flex gap-2 items-center h-full pl-3">
        <Compass />
        <div className="text-lg font-semibold">{t('Explore')}</div>
      </div>
      <Button
        variant="ghost"
        size="titlebar-icon"
        className="relative w-fit px-3"
        onClick={() => {
          window.open(
            'https://github.com/CodyTseng/awesome-nostr-relays/issues/new?template=add-relay.md',
            '_blank'
          )
        }}
      >
        <Plus size={16} />
        {t('Submit Relay')}
      </Button>
    </div>
  )
}
