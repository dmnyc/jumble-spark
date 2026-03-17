import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { buildHiveTalkJoinUrl, roomIdForPubkeys } from '@/lib/hivetalk'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Bell, BellOff, Copy, Ellipsis, MessageCircle, Send, Video } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function ProfileOptions({
  pubkey,
  onSendPublicMessage,
  onSendCallInvite
}: {
  pubkey: string
  /** Opens the post editor in public message mode with this profile's pubkey in the mention list. */
  onSendPublicMessage?: () => void
  /** Opens the post editor to send the call invite URL as a public message to this profile. */
  onSendCallInvite?: (url: string) => void
}) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, profile } = useNostr()
  const { mutePubkeySet, mutePubkeyPrivately, mutePubkeyPublicly, unmutePubkey } = useMuteList()
  const isMuted = useMemo(() => mutePubkeySet.has(pubkey), [mutePubkeySet, pubkey])
  const displayName = profile?.username ?? (accountPubkey ? formatPubkey(accountPubkey) : 'jumble')

  if (pubkey === accountPubkey) return null

  const callInviteUrl =
    accountPubkey &&
    buildHiveTalkJoinUrl({
      room: roomIdForPubkeys(accountPubkey, pubkey),
      name: displayName
    })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="rounded-full">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {onSendPublicMessage && (
          <DropdownMenuItem onClick={onSendPublicMessage}>
            <MessageCircle />
            {t('Send public message')}
          </DropdownMenuItem>
        )}
        {callInviteUrl && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => window.open(callInviteUrl, '_blank', 'noopener,noreferrer')}
            >
              <Video />
              {t('Start video call')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard.writeText(callInviteUrl)
                toast.success(t('Copied to clipboard'))
              }}
            >
              <Copy />
              {t('Copy call invite link')}
            </DropdownMenuItem>
            {onSendCallInvite && (
              <DropdownMenuItem onClick={() => onSendCallInvite(callInviteUrl)}>
                <Send />
                {t('Send call invite')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() => navigator.clipboard.writeText('nostr:' + pubkeyToNpub(pubkey))}
        >
          <Copy />
          {t('Copy user ID')}
        </DropdownMenuItem>
        {isMuted ? (
          <DropdownMenuItem
            onClick={() => unmutePubkey(pubkey)}
            className="text-destructive focus:text-destructive"
          >
            <Bell />
            {t('Unmute user')}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem
              onClick={() => mutePubkeyPrivately(pubkey)}
              className="text-destructive focus:text-destructive"
            >
              <BellOff />
              {t('Mute user privately')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => mutePubkeyPublicly(pubkey)}
              className="text-destructive focus:text-destructive"
            >
              <BellOff />
              {t('Mute user publicly')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
