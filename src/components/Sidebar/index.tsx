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
import SpellsButton from './SpellsButton'
import PaneModeToggle from './PaneModeToggle'

export default function PrimaryPageSidebar() {
  const { isSmallScreen } = useScreenSize()
  if (isSmallScreen) return null

  return (
    <div className="w-[4.8rem] xl:w-[15.6rem] flex flex-col pb-2 pt-4 px-2 xl:pl-4 xl:pr-6 justify-between h-full shrink-0">
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
        <FeedButton />
        <DiscussionsButton />
        <NotificationButton />
        <SearchButton />
        <SpellsButton />
        <RssButton />
        <PostButton />
      </div>
      <div className="space-y-2">
        <HelpAndAccountMenu variant="sidebar" />
        <PaneModeToggle />
      </div>
    </div>
  )
}
