import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  DrawerTitle
} from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { normalizeUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TRelaySet } from '@/types'
import { Ban, Check, FolderPlus, Plus, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DrawerMenuItem from '../DrawerMenuItem'
import logger from '@/lib/logger'

export default function SaveRelayDropdownMenu({
  urls,
  bigButton = false
}: {
  urls: string[]
  bigButton?: boolean
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { favoriteRelays, relaySets } = useFavoriteRelays()
  const normalizedUrls = useMemo(() => urls.map((url) => normalizeUrl(url)).filter(Boolean), [urls])
  const alreadySaved = useMemo(() => {
    return (
      normalizedUrls.every((url) => favoriteRelays.includes(url)) ||
      relaySets.some((set) => normalizedUrls.every((url) => set.relayUrls.includes(url)))
    )
  }, [relaySets, normalizedUrls])
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const trigger = bigButton ? (
    <Button variant="ghost" size="titlebar-icon" onClick={() => setIsDrawerOpen(true)}>
      <Star className={alreadySaved ? 'fill-primary stroke-primary' : ''} />
    </Button>
  ) : (
    <button
      className="enabled:hover:text-primary [&_svg]:size-5 pr-0 pt-0.5"
      onClick={(e) => {
        e.stopPropagation()
        setIsDrawerOpen(true)
      }}
    >
      <Star className={alreadySaved ? 'fill-primary stroke-primary' : ''} />
    </button>
  )

  if (isSmallScreen) {
    return (
      <div>
        {trigger}
        <div onClick={(e) => e.stopPropagation()}>
          <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
            <DrawerOverlay onClick={() => setIsDrawerOpen(false)} />
            <DrawerContent hideOverlay>
              <DrawerHeader>
                <DrawerTitle>{t('Save to')} ...</DrawerTitle>
              </DrawerHeader>
              <div className="py-2">
                <RelayItem urls={normalizedUrls} />
                {relaySets.map((set) => (
                  <RelaySetItem key={set.id} set={set} urls={normalizedUrls} />
                ))}
                <Separator />
                <SaveToNewSet urls={normalizedUrls} />
                <Separator />
                <BlockRelayItem urls={normalizedUrls} />
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild className="px-2">
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>{t('Save to')} ...</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <RelayItem urls={normalizedUrls} />
        {relaySets.map((set) => (
          <RelaySetItem key={set.id} set={set} urls={normalizedUrls} />
        ))}
        <DropdownMenuSeparator />
        <SaveToNewSet urls={normalizedUrls} />
        <DropdownMenuSeparator />
        <BlockRelayItem urls={normalizedUrls} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RelayItem({ urls }: { urls: string[] }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { favoriteRelays, addFavoriteRelays, deleteFavoriteRelays } = useFavoriteRelays()
  const [isLoading, setIsLoading] = useState(false)
  const saved = useMemo(
    () => urls.every((url) => favoriteRelays.includes(url)),
    [favoriteRelays, urls]
  )

  const handleClick = async () => {
    if (isLoading) return
    
    setIsLoading(true)
    try {
      if (saved) {
        await deleteFavoriteRelays(urls)
      } else {
        await addFavoriteRelays(urls)
      }
    } catch (error) {
      logger.error('Failed to toggle favorite relay', { error, urls })
    } finally {
      setIsLoading(false)
    }
  }

  if (isSmallScreen) {
    return (
      <DrawerMenuItem 
        onClick={isLoading ? undefined : handleClick} 
        className={isLoading ? 'opacity-50 cursor-not-allowed' : ''}
      >
        {isLoading ? '...' : (saved ? <Check /> : <Plus />)}
        {isLoading ? t('Loading...') : (saved ? t('Unfavorite') : t('Favorite'))}
      </DrawerMenuItem>
    )
  }

  return (
    <DropdownMenuItem className="flex gap-2" onClick={handleClick} disabled={isLoading}>
      {isLoading ? '...' : (saved ? <Check /> : <Plus />)}
      {isLoading ? t('Loading...') : (saved ? t('Unfavorite') : t('Favorite'))}
    </DropdownMenuItem>
  )
}

function RelaySetItem({ set, urls }: { set: TRelaySet; urls: string[] }) {
  const { isSmallScreen } = useScreenSize()
  const { pubkey, startLogin } = useNostr()
  const { updateRelaySet } = useFavoriteRelays()
  const saved = urls.every((url) => set.relayUrls.includes(url))

  const handleClick = () => {
    if (!pubkey) {
      startLogin()
      return
    }
    if (saved) {
      updateRelaySet({
        ...set,
        relayUrls: set.relayUrls.filter((u) => !urls.includes(u))
      })
    } else {
      updateRelaySet({
        ...set,
        relayUrls: Array.from(new Set([
          ...set.relayUrls.map(url => normalizeUrl(url) || url),
          ...urls.map(url => normalizeUrl(url) || url)
        ]))
      })
    }
  }

  if (isSmallScreen) {
    return (
      <DrawerMenuItem onClick={handleClick}>
        {saved ? <Check /> : <Plus />}
        {set.name}
      </DrawerMenuItem>
    )
  }

  return (
    <DropdownMenuItem key={set.id} className="flex gap-2" onClick={handleClick}>
      {saved ? <Check /> : <Plus />}
      {set.name}
    </DropdownMenuItem>
  )
}

function SaveToNewSet({ urls }: { urls: string[] }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { pubkey, startLogin } = useNostr()
  const { createRelaySet } = useFavoriteRelays()

  const handleSave = () => {
    if (!pubkey) {
      startLogin()
      return
    }
    const newSetName = prompt(t('Enter a name for the new relay set'))
    if (newSetName) {
      createRelaySet(newSetName, urls)
    }
  }

  if (isSmallScreen) {
    return (
      <DrawerMenuItem onClick={handleSave}>
        <FolderPlus />
        {t('Save to a new relay set')}
      </DrawerMenuItem>
    )
  }

  return (
    <DropdownMenuItem onClick={handleSave}>
      <FolderPlus />
      {t('Save to a new relay set')}
    </DropdownMenuItem>
  )
}

function BlockRelayItem({ urls }: { urls: string[] }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { blockedRelays, addBlockedRelays, deleteBlockedRelays } = useFavoriteRelays()
  const [isLoading, setIsLoading] = useState(false)
  const blocked = useMemo(
    () => urls.every((url) => blockedRelays.includes(url)),
    [blockedRelays, urls]
  )

  const handleClick = async () => {
    if (isLoading) return
    
    setIsLoading(true)
    try {
      if (blocked) {
        await deleteBlockedRelays(urls)
      } else {
        await addBlockedRelays(urls)
      }
    } catch (error) {
      logger.error('Failed to toggle blocked relay', { error, urls })
    } finally {
      setIsLoading(false)
    }
  }

  if (isSmallScreen) {
    return (
      <DrawerMenuItem 
        onClick={isLoading ? undefined : handleClick} 
        className={isLoading ? 'opacity-50 cursor-not-allowed' : ''}
      >
        {isLoading ? <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden /> : <Ban />}
        {isLoading ? t('Processing...') : blocked ? t('Unblock') : t('Block')}
      </DrawerMenuItem>
    )
  }

  return (
    <DropdownMenuItem onClick={handleClick} disabled={isLoading}>
      {isLoading ? <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden /> : <Ban />}
      {isLoading ? t('Processing...') : blocked ? t('Unblock') : t('Block')}
    </DropdownMenuItem>
  )
}
