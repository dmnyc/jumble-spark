import AccountManager from '@/components/AccountManager'
import LoginDialog from '@/components/LoginDialog'
import LogoutDialog from '@/components/LogoutDialog'
import PubkeyCopy from '@/components/PubkeyCopy'
import NpubQrCode from '@/components/NpubQrCode'
import { Separator } from '@/components/ui/separator'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { SimpleUsername } from '@/components/Username'
import { RefreshButton } from '@/components/RefreshButton'
import PrimaryPageLayout, { type TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { toProfile, toRelaySettings, toWallet } from '@/lib/link'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import {
  ArrowDownUp,
  ChevronRight,
  LogOut,
  Server,
  UserRound,
  Wallet
} from 'lucide-react'
import { TPageRef } from '@/types'
import {
  forwardRef,
  HTMLProps,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { useTranslation } from 'react-i18next'

const MePage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { pubkey, relayList } = useNostr()
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)
  const [contentKey, setContentKey] = useState(0)

  const bumpMe = useCallback(() => {
    void (async () => {
      await syncUserDeletionTombstones(pubkey, relayList)
      setContentKey((k) => k + 1)
    })()
  }, [pubkey, relayList])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: bumpMe
    }),
    [bumpMe]
  )

  if (!pubkey) {
    return (
      <PrimaryPageLayout
        ref={layoutRef}
        pageName="me"
        titlebar={<MePageTitlebar onRefresh={bumpMe} />}
        hideTitlebarBottomBorder
      >
        <div key={contentKey} className="min-w-0 pt-2 flex flex-col p-4 gap-4 overflow-auto">
          <AccountManager />
        </div>
      </PrimaryPageLayout>
    )
  }

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="me"
      titlebar={<MePageTitlebar onRefresh={bumpMe} />}
      hideTitlebarBottomBorder
    >
      <div key={contentKey} className="min-w-0 pt-2">
      <div className="flex gap-4 items-center p-4">
        <SimpleUserAvatar userId={pubkey} size="big" />
        <div className="space-y-1 flex-1 w-0">
          <SimpleUsername
            className="text-xl font-semibold text-wrap"
            userId={pubkey}
            skeletonClassName="h-6 w-32"
          />
          <div className="flex gap-1 mt-1">
            <PubkeyCopy pubkey={pubkey} />
            <NpubQrCode pubkey={pubkey} />
          </div>
        </div>
      </div>
      <div className="mt-4">
        <Item onClick={() => push(toProfile(pubkey))}>
          <UserRound />
          {t('Profile')}
        </Item>
        <Item onClick={() => push(toRelaySettings())}>
          <Server /> {t('Relays')}
        </Item>
        <Item onClick={() => push(toWallet())}>
          <Wallet />
          {t('Wallet')}
        </Item>
        <Item onClick={() => setLoginDialogOpen(true)}>
          <ArrowDownUp /> {t('Switch account')}
        </Item>
        <Separator className="bg-background" />
        <Item
          className="text-destructive focus:text-destructive"
          onClick={() => setLogoutDialogOpen(true)}
          hideChevron
        >
          <LogOut />
          {t('Logout')}
        </Item>
      </div>
      <LoginDialog open={loginDialogOpen} setOpen={setLoginDialogOpen} />
      <LogoutDialog open={logoutDialogOpen} setOpen={setLogoutDialogOpen} />
      </div>
    </PrimaryPageLayout>
  )
})
MePage.displayName = 'MePage'
export default MePage

function MePageTitlebar({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full items-center justify-between gap-2 pl-3 pr-1">
      <div className="app-chrome-title">{t('YouTabName')}</div>
      <RefreshButton onClick={onRefresh} />
    </div>
  )
}

function Item({
  children,
  className,
  hideChevron = false,
  onClick,
  onKeyDown,
  ...props
}: HTMLProps<HTMLDivElement> & { hideChevron?: boolean }) {
  return (
    <div
      className={cn(
        'flex clickable justify-between items-center px-4 py-2 h-[52px] rounded-lg [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e)
        if (!e.defaultPrevented && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick?.(e as unknown as MouseEvent<HTMLDivElement>)
        }
      }}
    >
      <div className="flex items-center gap-4">{children}</div>
      {!hideChevron && <ChevronRight />}
    </div>
  )
}
