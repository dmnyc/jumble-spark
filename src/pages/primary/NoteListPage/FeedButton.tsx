import FeedSwitcher from '@/components/FeedSwitcher'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { simplifyUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { BookmarkIcon, ChevronDown, Server, UsersRound } from 'lucide-react'
import { forwardRef, ButtonHTMLAttributes, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function FeedButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)

  if (isSmallScreen) {
    return (
      <>
        <FeedSwitcherTrigger className={className} onClick={() => setOpen(true)} />
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[80vh]">
            <DrawerHeader className="sr-only">
              <DrawerTitle>{t('Choose feed')}</DrawerTitle>
            </DrawerHeader>
            <div
              className="overflow-y-auto overscroll-contain py-2 px-4"
              style={{ touchAction: 'pan-y' }}
            >
              <FeedSwitcher close={() => setOpen(false)} />
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FeedSwitcherTrigger className={className} />
      </PopoverTrigger>
      <PopoverContent
        sideOffset={0}
        side="bottom"
        className="w-96 p-4 max-h-[80vh] overflow-auto scrollbar-hide"
      >
        <FeedSwitcher close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

const FeedSwitcherTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation()
    const { feedInfo, relayUrls } = useFeed()
    const { relaySets } = useFavoriteRelays()
    const activeRelaySet = useMemo(() => {
      return feedInfo.feedType === 'relays' && feedInfo.id
        ? relaySets.find((set) => set.id === feedInfo.id)
        : undefined
    }, [feedInfo, relaySets])
    const title = useMemo(() => {
      if (feedInfo.feedType === 'following') {
        return t('Following')
      }
      if (feedInfo.feedType === 'bookmarks') {
        return t('Bookmarks')
      }
      if (feedInfo.feedType === 'all-favorites') {
        return t('All favorite relays')
      }
      if (relayUrls.length === 0) {
        return t('Choose a relay')
      }
      if (feedInfo.feedType === 'relay') {
        return simplifyUrl(feedInfo.id ?? '')
      }
      if (feedInfo.feedType === 'relays') {
        return activeRelaySet?.name ?? activeRelaySet?.id
      }
    }, [feedInfo, activeRelaySet])

    return (
      <button
        type="button"
        className={cn('flex items-center gap-2 clickable px-3 h-full rounded-lg bg-transparent border-0 text-left', className)}
        ref={ref}
        {...props}
      >
        {feedInfo.feedType === 'following' ? (
          <UsersRound />
        ) : feedInfo.feedType === 'bookmarks' ? (
          <BookmarkIcon />
        ) : feedInfo.feedType === 'all-favorites' ? (
          <Server />
        ) : (
          <Server />
        )}
        <span className="text-lg font-semibold truncate">{title}</span>
        <ChevronDown />
      </button>
    )
  }
)
