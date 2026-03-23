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
import { normalizeUrl } from '@/lib/url'
import { useMuteList } from '@/contexts/mute-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import client from '@/services/client.service'
import { replaceableEventService } from '@/services/client.service'
import { nip66Service } from '@/services/nip66.service'
import RawEventDialog from '@/components/NoteOptions/RawEventDialog'
import { Bell, BellOff, Copy, Ellipsis, MessageCircle, Send, Video, SatelliteDish, Code } from 'lucide-react'
import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Event } from 'nostr-tools'

export default function ProfileOptions({
  pubkey,
  profileEvent,
  onSendPublicMessage,
  onSendCallInvite
}: {
  pubkey: string
  /** Optional profile event (kind 0) for republishing and viewing JSON */
  profileEvent?: Event
  /** Opens the post editor in public message mode with this profile's pubkey in the mention list. */
  onSendPublicMessage?: () => void
  /** Opens the post editor to send the call invite URL as a public message to this profile. */
  onSendCallInvite?: (url: string) => void
}) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, profile } = useNostr()
  const { mutePubkeySet, mutePubkeyPrivately, mutePubkeyPublicly, unmutePubkey } = useMuteList()
  const { relayUrls: currentBrowsingRelayUrls } = useCurrentRelays()
  const { relaySets, favoriteRelays } = useFavoriteRelays()
  const [isRawEventDialogOpen, setIsRawEventDialogOpen] = useState(false)
  const [monitoringListRelayCount, setMonitoringListRelayCount] = useState<number | null>(null)
  const [localProfileEvent, setLocalProfileEvent] = useState<Event | undefined>(profileEvent)
  
  // Fetch profile event if not provided
  useEffect(() => {
    if (profileEvent) {
      setLocalProfileEvent(profileEvent)
      return
    }
    
    // If profileEvent is not provided, try to fetch it using comprehensive search
    const fetchEvent = async () => {
      try {
        // Use fetchProfileEvent which includes comprehensive relay search
        const event = await replaceableEventService.fetchProfileEvent(pubkey, false)
        if (event) {
          setLocalProfileEvent(event)
        }
      } catch (error) {
        // Silently fail - menu items just won't show
      }
    }
    
    fetchEvent()
  }, [pubkey, profileEvent])
  
  const isMuted = useMemo(() => mutePubkeySet.has(pubkey), [mutePubkeySet, pubkey])
  const displayName = profile?.username ?? (accountPubkey ? formatPubkey(accountPubkey) : 'jumble')

  /** All available relays: current feed, favorites, relay sets, defaults (FAST_READ, FAST_WRITE). */
  const allAvailableRelayUrls = useMemo(() => {
    const urls = [
      ...currentBrowsingRelayUrls.map(url => normalizeUrl(url) || url),
      ...favoriteRelays.map(url => normalizeUrl(url) || url),
      ...relaySets.flatMap(set => set.relayUrls.map(url => normalizeUrl(url) || url)),
      ...FAST_READ_RELAY_URLS.map(url => normalizeUrl(url) || url),
      ...FAST_WRITE_RELAY_URLS.map(url => normalizeUrl(url) || url)
    ].filter(Boolean) as string[]
    return Array.from(new Set(urls))
  }, [currentBrowsingRelayUrls, favoriteRelays, relaySets])

  useEffect(() => {
    nip66Service.getPublicLivelyRelayUrls().then((urls) => {
      setMonitoringListRelayCount(urls?.length ?? 0)
    })
  }, [])

  const handleRepublishToAllAvailable = async () => {
    const eventToPublish = localProfileEvent || profileEvent
    if (!eventToPublish) {
      toast.error(t('Profile event not available'))
      return
    }
    const promise = client.publishEvent(allAvailableRelayUrls, eventToPublish).then((result) => {
      if (result.successCount < 1) {
        throw new Error(t('No relay accepted the event'))
      }
      return result
    })
    toast.promise(promise, {
      loading: t('Republishing...'),
      success: () => t('Successfully republish to all available relays'),
      error: (err) => t('Failed to republish to all available relays: {{error}}', { error: err.message })
    })
  }

  const handleRepublishToAllActive = async () => {
    const eventToPublish = localProfileEvent || profileEvent
    if (!eventToPublish) {
      toast.error(t('Profile event not available'))
      return
    }
    const promise = (async () => {
      let relays = await nip66Service.getPublicLivelyRelayUrls()
      const usedMonitoringList = !!relays?.length
      if (!relays?.length) {
        relays = allAvailableRelayUrls
      }
      if (!relays?.length) {
        throw new Error(t('No relays available'))
      }
      const result = await client.publishEvent(relays, eventToPublish)
      const minRequired = usedMonitoringList ? 5 : 1
      if (result.successCount < minRequired) {
        throw new Error(
          usedMonitoringList
            ? t('Only {{count}} relay(s) accepted the event; at least 5 required for "all active relays".', { count: result.successCount })
            : t('No relay accepted the event')
        )
      }
      return result
    })()
    toast.promise(promise, {
      loading: t('Republishing...'),
      success: () => t('Successfully republish to all active relays'),
      error: (err) => t('Failed to republish to all active relays: {{error}}', { error: err.message })
    })
  }

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
        {(localProfileEvent || profileEvent) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleRepublishToAllAvailable}>
              <SatelliteDish />
              {t('Republish to all available relays')} ({allAvailableRelayUrls.length})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRepublishToAllActive}>
              <SatelliteDish />
              {t('Republish to all active relays')}
              {monitoringListRelayCount !== null && ` (${monitoringListRelayCount > 0 ? monitoringListRelayCount : allAvailableRelayUrls.length})`}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsRawEventDialogOpen(true)}>
              <Code />
              {t('View JSON')}
            </DropdownMenuItem>
          </>
        )}
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
      {(localProfileEvent || profileEvent) && (
        <RawEventDialog
          event={(localProfileEvent || profileEvent)!}
          isOpen={isRawEventDialogOpen}
          onClose={() => setIsRawEventDialogOpen(false)}
        />
      )}
    </DropdownMenu>
  )
}
