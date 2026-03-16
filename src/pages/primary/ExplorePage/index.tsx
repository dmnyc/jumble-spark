import Explore from '@/components/Explore'
import FollowingFavoriteRelayList from '@/components/FollowingFavoriteRelayList'
import Tabs from '@/components/Tabs'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { Compass, Plus } from 'lucide-react'
import { forwardRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

type TExploreTabs = 'following' | 'explore'

const ExplorePage = forwardRef((_, ref) => {
  const [tab, setTab] = useState<TExploreTabs>('explore')
  
  // Listen for tab restoration from PageManager
  useEffect(() => {
    const handleRestore = (e: CustomEvent<{ page: string, tab: string }>) => {
      if (e.detail.page === 'explore' && e.detail.tab) {
        setTab(e.detail.tab as TExploreTabs)
      }
    }
    window.addEventListener('restorePageTab', handleRestore as EventListener)
    return () => window.removeEventListener('restorePageTab', handleRestore as EventListener)
  }, [])

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="explore"
      titlebar={<ExplorePageTitlebar />}
      subHeader={
        <Tabs
          value={tab}
          tabs={[
            { value: 'explore', label: 'Explore' },
            { value: 'following', label: "Following's Favorites" }
          ]}
          onTabChange={(tab) => {
            setTab(tab as TExploreTabs)
            window.dispatchEvent(new CustomEvent('pageTabChanged', {
              detail: { page: 'explore', tab: tab }
            }))
          }}
        />
      }
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-2">
        {tab === 'following' ? <FollowingFavoriteRelayList /> : <Explore />}
      </div>
    </PrimaryPageLayout>
  )
})
ExplorePage.displayName = 'ExplorePage'
export default ExplorePage

function ExplorePageTitlebar() {
  const { t } = useTranslation()

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
