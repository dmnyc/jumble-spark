import { cn } from '@/lib/utils'
import RssButton from './RssButton'
import HomeButton from './HomeButton'
import DiscussionsButton from './DiscussionsButton'
import NotificationsButton from './NotificationsButton'
import SearchButton from './SearchButton'
import SpellsButton from './SpellsButton'
import WriteButton from './WriteButton'

export default function BottomNavigationBar() {
  return (
    <div
      className={cn(
        'fixed bottom-0 w-full z-40 bg-background border-t flex items-center justify-around [&_svg]:size-4 [&_svg]:shrink-0'
      )}
      style={{
        height: 'calc(3rem + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}
    >
      <WriteButton />
      <DiscussionsButton />
      <RssButton />
      <HomeButton />
      <SpellsButton />
      <SearchButton />
      <NotificationsButton />
    </div>
  )
}
