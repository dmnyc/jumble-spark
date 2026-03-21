import LoginDialog from '@/components/LoginDialog'
import LogoutDialog from '@/components/LogoutDialog'
import { KeyboardShortcutsHelpButton } from '@/components/KeyboardShortcutsHelp'
import KeyboardShortcutsHelpSidebarButton from '@/components/Sidebar/KeyboardShortcutsHelpSidebarButton'
import SidebarItem from '@/components/Sidebar/SidebarItem'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPubkey, formatNpub, generateImageByPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { ArrowDownUp, LogIn, LogOut, Settings, User, UserRound } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type HelpAndAccountMenuVariant = 'sidebar' | 'titlebar'

function AccountDropdownItems({
  onSwitchAccount,
  onLogoutClick
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
}) {
  const { t } = useTranslation()
  const { navigate } = usePrimaryPage()

  return (
    <>
      <DropdownMenuItem onClick={() => navigate('profile')}>
        <User className="size-4" />
        {t('Profile')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => navigate('settings')}>
        <Settings className="size-4" />
        {t('Settings')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onSwitchAccount}>
        <ArrowDownUp className="size-4" />
        {t('Switch account')}
      </DropdownMenuItem>
      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onLogoutClick}>
        <LogOut className="size-4" />
        {t('Logout')}
      </DropdownMenuItem>
    </>
  )
}

function SidebarAccountMenu({
  onSwitchAccount,
  onLogoutClick
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
}) {
  const { t } = useTranslation()
  const { account, profile } = useNostr()
  const { current, display } = usePrimaryPage()
  const pubkey = account?.pubkey
  const active = useMemo(() => current === 'profile' && display, [display, current])

  if (!pubkey) return null

  const defaultAvatar = generateImageByPubkey(pubkey)
  const npub = pubkeyToNpub(pubkey)
  const fallbackUsername = npub ? formatNpub(npub) : formatPubkey(pubkey)
  const { username, avatar } = profile || { username: fallbackUsername, avatar: defaultAvatar }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          title={t('Account menu')}
          aria-label={t('Account menu')}
          className={cn(
            'clickable h-12 min-w-0 justify-start gap-2 rounded-lg bg-transparent p-2 text-lg font-semibold text-foreground shadow-none hover:text-accent-foreground',
            'w-12 xl:w-full xl:px-2 xl:py-2',
            active && 'bg-accent/50'
          )}
        >
          <Avatar className="size-8 shrink-0">
            <AvatarImage src={avatar} />
            <AvatarFallback>
              <img src={defaultAvatar} alt="" />
            </AvatarFallback>
          </Avatar>
          <span className="truncate max-xl:hidden">{username}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="z-[220]">
        <AccountDropdownItems onSwitchAccount={onSwitchAccount} onLogoutClick={onLogoutClick} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TitlebarAccountMenu({
  onSwitchAccount,
  onLogoutClick
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
}) {
  const { t } = useTranslation()
  const { profile } = useNostr()
  const { current, display } = usePrimaryPage()
  const defaultAvatar = useMemo(
    () => (profile?.pubkey ? generateImageByPubkey(profile.pubkey) : ''),
    [profile]
  )
  const active = useMemo(() => current === 'profile' && display, [display, current])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="titlebar-icon"
          className={cn(active ? 'bg-accent/50' : '')}
          title={t('Account menu')}
          aria-label={t('Account menu')}
        >
          {profile ? (
            <Avatar className={cn('w-6 h-6', active ? 'ring-primary ring-1' : '')}>
              <AvatarImage src={profile.avatar} className="object-cover object-center" />
              <AvatarFallback>
                <img src={defaultAvatar} alt="" />
              </AvatarFallback>
            </Avatar>
          ) : (
            <Skeleton className={cn('w-6 h-6 rounded-full', active ? 'ring-primary ring-1' : '')} />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="z-[220]">
        <AccountDropdownItems onSwitchAccount={onSwitchAccount} onLogoutClick={onLogoutClick} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Help (?) + account avatar with the same dropdown on sidebar (desktop) and titlebar (mobile).
 */
export default function HelpAndAccountMenu({ variant }: { variant: HelpAndAccountMenuVariant }) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)

  const help =
    variant === 'sidebar' ? <KeyboardShortcutsHelpSidebarButton /> : <KeyboardShortcutsHelpButton />

  let account: ReactNode
  if (pubkey) {
    account =
      variant === 'sidebar' ? (
        <SidebarAccountMenu
          onSwitchAccount={() => setLoginDialogOpen(true)}
          onLogoutClick={() => setLogoutDialogOpen(true)}
        />
      ) : (
        <TitlebarAccountMenu
          onSwitchAccount={() => setLoginDialogOpen(true)}
          onLogoutClick={() => setLogoutDialogOpen(true)}
        />
      )
  } else if (variant === 'sidebar') {
    account = (
      <SidebarItem onClick={() => checkLogin()} title="Login">
        <LogIn strokeWidth={3} />
      </SidebarItem>
    )
  } else {
    account = (
      <Button variant="ghost" size="titlebar-icon" onClick={() => checkLogin()} title={t('Login')}>
        <UserRound />
      </Button>
    )
  }

  const wrapClass =
    variant === 'titlebar' ? 'flex shrink-0 items-center gap-1' : 'flex flex-col space-y-2'

  return (
    <>
      <div className={wrapClass}>
        {help}
        {account}
      </div>
      <LoginDialog open={loginDialogOpen} setOpen={setLoginDialogOpen} />
      <LogoutDialog open={logoutDialogOpen} setOpen={setLogoutDialogOpen} />
    </>
  )
}
