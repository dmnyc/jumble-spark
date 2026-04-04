import Icon from '@/assets/Icon'
import Logo from '@/assets/Logo'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import HelpAndAccountMenu from '@/components/HelpAndAccountMenu'
import DiscussionsButton from './DiscussionsButton'
import FeedButton from './FeedButton'
import HomeButton from './HomeButton'
import NotificationButton from './NotificationButton'
import PostButton from './PostButton'
import RssButton from './RssButton'
import SearchButton from './SearchButton'
import FollowsLatestButton from './FollowsLatestButton'
import FavoritesButton from './FavoritesButton'
import SpellsButton from './SpellsButton'
import { FavoriteRelaysActiveStripSidebar } from '@/components/FavoriteRelaysActiveStrip'
import PaneModeToggle from './PaneModeToggle'
import DownloadDesktopSidebarButton from './DownloadDesktopSidebarButton'
import LiveActivitiesStrip from '@/components/LiveActivitiesStrip'
import { ReadOnlySessionIndicator } from '@/components/ReadOnlySessionIndicator'

export default function PrimaryPageSidebar() {
  const { isSmallScreen } = useScreenSize()
  if (isSmallScreen) return null

  return (
    <div className="imwald-sidebar w-[4.8rem] xl:w-[15.6rem] flex flex-col pb-2 pt-4 px-2 xl:pl-4 xl:pr-6 justify-between h-full shrink-0">
      <div className="imwald-sidebar__atmosphere" aria-hidden />
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col justify-between">
        <div className="space-y-2">
          <div className="mb-6 w-full min-w-0">
            <Icon className="mx-auto xl:hidden" />
            {/* Full-bleed banner at xl: span entire sidebar column (undo pl-4 + pr-6) */}
            <div className="max-xl:hidden -ml-4 -mr-6 w-[calc(100%+2.5rem)] min-w-0">
              <Logo className="h-auto w-full max-h-[5.5rem] max-w-full object-contain object-center" />
            </div>
          </div>
          <ReadOnlySessionIndicator variant="sidebar" />
          <div className="max-xl:hidden w-full min-w-0 px-1">
            <LiveActivitiesStrip placement="sidebar" />
          </div>
          <HomeButton />
          <FeedButton />
          <DiscussionsButton />
          <NotificationButton />
          <SearchButton />
          <FollowsLatestButton />
          <FavoritesButton />
          <SpellsButton />
          <RssButton />
          <FavoriteRelaysActiveStripSidebar />
          <PostButton />
        </div>
        <div className="space-y-2">
          <HelpAndAccountMenu variant="sidebar" />
          <PaneModeToggle />
          <DownloadDesktopSidebarButton />
        </div>
      </div>
    </div>
  )
}
