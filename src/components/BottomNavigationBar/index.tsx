import { cn } from '@/lib/utils'
import HomeButton from './HomeButton'
import NotificationsButton from './NotificationsButton'
import DiscussionsButton from './DiscussionsButton'
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
      <HomeButton />
      <SpellsButton />
      <SearchButton />
      <NotificationsButton />
    </div>
  )
}
