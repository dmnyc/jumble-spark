import Icon from '@/assets/Icon'
import Logo from '@/assets/Logo'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import AccountButton from './AccountButton'
import DiscussionsButton from './DiscussionsButton'
import RelaysButton from './ExploreButton'
import HomeButton from './HomeButton'
import NotificationsButton from './NotificationButton'
import PostButton from './PostButton'
import ProfileButton from './ProfileButton'
import RssButton from './RssButton'
import SearchButton from './SearchButton'
import SettingsButton from './SettingsButton'
import PaneModeToggle from './PaneModeToggle'
import storage from '@/services/local-storage.service'

export default function PrimaryPageSidebar() {
  const { isSmallScreen } = useScreenSize()
  const showRssFeed = storage.getShowRssFeed()
  if (isSmallScreen) return null

  return (
    <div className="w-16 xl:w-52 flex flex-col pb-2 pt-4 px-2 xl:px-4 justify-between h-full shrink-0">
      <div className="space-y-2">
        <div className="px-3 xl:px-4 mb-6 w-full">
          <Icon className="xl:hidden" />
          <div className="max-xl:hidden">
            <Logo />
            <div className="text-green-600 dark:text-green-500 font-semibold text-sm mt-1 text-center">
              Im Wald
            </div>
          </div>
        </div>
        <HomeButton />
        <RelaysButton />
        <DiscussionsButton />
        <NotificationsButton />
        <SearchButton />
        <ProfileButton />
        {showRssFeed && <RssButton />}
        <SettingsButton />
        <PostButton />
      </div>
      <div className="space-y-2">
        <AccountButton />
        <PaneModeToggle />
      </div>
    </div>
  )
}
