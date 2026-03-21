import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { toWallet } from '@/lib/link'
import { formatPubkey, generateImageByPubkey, pubkeyToNpub, formatNpub } from '@/lib/pubkey'
import { usePrimaryPage, useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { ArrowDownUp, LogIn, LogOut, MoreVertical, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import LoginDialog from '../LoginDialog'
import LogoutDialog from '../LogoutDialog'
import SidebarItem from './SidebarItem'

export default function AccountButton() {
  const { pubkey } = useNostr()

  if (pubkey) {
    return <ProfileButton />
  } else {
    return <LoginButton />
  }
}

function ProfileButton() {
  const { t } = useTranslation()
  const { account, profile } = useNostr()
  const pubkey = account?.pubkey
  const { navigate } = usePrimaryPage()
  const { push } = useSecondaryPage()
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)
  if (!pubkey) return null

  const defaultAvatar = generateImageByPubkey(pubkey)
  const npub = pubkeyToNpub(pubkey)
  const fallbackUsername = npub ? formatNpub(npub) : formatPubkey(pubkey)
  const { username, avatar } = profile || { username: fallbackUsername, avatar: defaultAvatar }

  return (
    <div className="flex w-full min-w-0 items-center gap-0.5 xl:gap-1">
      <Button
        type="button"
        variant="ghost"
        title={t('Profile')}
        className="clickable h-12 min-w-0 flex-1 justify-start gap-2 rounded-lg bg-transparent p-2 text-lg font-semibold text-foreground shadow-none hover:text-accent-foreground xl:px-2 xl:py-2"
        onClick={() => navigate('profile')}
      >
        <Avatar className="size-8 shrink-0">
          <AvatarImage src={avatar} />
          <AvatarFallback>
            <img src={defaultAvatar} alt="" />
          </AvatarFallback>
        </Avatar>
        <span className="truncate max-xl:hidden">{username}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 rounded-lg"
            title={t('Account menu')}
            aria-label={t('Account menu')}
          >
            <MoreVertical className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">
          <DropdownMenuItem onClick={() => push(toWallet())}>
            <Wallet />
            {t('Wallet')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLoginDialogOpen(true)}>
            <ArrowDownUp />
            {t('Switch account')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setLogoutDialogOpen(true)}
          >
            <LogOut />
            {t('Logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LoginDialog open={loginDialogOpen} setOpen={setLoginDialogOpen} />
      <LogoutDialog open={logoutDialogOpen} setOpen={setLogoutDialogOpen} />
    </div>
  )
}

function LoginButton() {
  const { checkLogin } = useNostr()

  return (
    <SidebarItem onClick={() => checkLogin()} title="Login">
      <LogIn strokeWidth={3} />
    </SidebarItem>
  )
}
