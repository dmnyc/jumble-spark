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
        'fixed bottom-0 z-40 flex w-full items-center justify-around border-t border-[hsl(var(--sidebar-border))] bg-background [&_svg]:size-4 [&_svg]:shrink-0'
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
