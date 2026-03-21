import Collapsible from '@/components/Collapsible'
import FollowButton from '@/components/FollowButton'
import Nip05 from '@/components/Nip05'
import Nip05List from '@/components/Nip05List'
import NpubQrCode from '@/components/NpubQrCode'
import ProfileAbout from '@/components/ProfileAbout'
import ProfileBanner from '@/components/ProfileBanner'
import ProfileOptions from '@/components/ProfileOptions'
import ProfileZapButton from '@/components/ProfileZapButton'
import PubkeyCopy from '@/components/PubkeyCopy'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFetchProfile } from '@/hooks'
import { kinds, type NostrEvent } from 'nostr-tools'
import { getPaymentInfoFromEvent } from '@/lib/event-metadata'
import { toProfileEditor } from '@/lib/link'
import { generateImageByPubkey } from '@/lib/pubkey'
import { usePrimaryPage, useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { replaceableEventService } from '@/services/client.service'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Copy, Ellipsis, Calendar, MapPin, Pencil, SatelliteDish, Code, Gift, Link } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import logger from '@/lib/logger'
import NotFound from '../NotFound'
import FollowedBy from './FollowedBy'
import ProfileFeedWithPins from './ProfileFeedWithPins'
import SmartFollowings from './SmartFollowings'
import SmartMuteLink from './SmartMuteLink'
import SmartRelays from './SmartRelays'
import ZapDialog from '@/components/ZapDialog'
import PaytoLink from '@/components/PaytoLink'
import PostEditor from '@/components/PostEditor'
import {
  ScheduleVideoCallDialog,
  ScheduleInPersonMeetingDialog
} from '@/components/ScheduleVideoCallDialog'
import RawEventDialog from '@/components/NoteOptions/RawEventDialog'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import { nip66Service } from '@/services/nip66.service'
import { normalizeUrl } from '@/lib/url'
import type { TProfile } from '@/types'

/**
 * Normalize lightning/LUD-16 authority to a canonical form for deduplication.
 * Handles "user@domain" and "user.domain" (dot variant) as the same address.
 */
function normalizeLightningAuthority(authority: string): string {
  const s = authority.trim().toLowerCase()
  if (!s) return s
  if (s.includes('@')) return s
  const firstDot = s.indexOf('.')
  if (firstDot > 0) return s.slice(0, firstDot) + '@' + s.slice(firstDot + 1)
  return s
}

/** Normalize authority for deduplication (canonical key per type) */
function normalizePaymentAuthority(type: string, authority: string): string {
  const t = type.toLowerCase()
  if (t === 'lightning' && authority) return normalizeLightningAuthority(authority)
  return authority.trim().toLowerCase()
}

/** Prefer displaying lightning address in canonical "user@domain" form when we have both variants */
function preferCanonicalLightningAuthority(a: string, b: string): string {
  const hasAt = (s: string) => s.trim().includes('@')
  if (hasAt(a) && !hasAt(b)) return a
  if (hasAt(b) && !hasAt(a)) return b
  return a
}

type MergedPaymentMethod = {
  type: string
  authority: string
  payto?: string
  displayType: string
  currency?: string
  minAmount?: number
  maxAmount?: number
}

/** Merge payment methods from kind 10133 and profile (kind 0: JSON + tags), normalized and deduplicated */
function mergePaymentMethods(
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null,
  profile: TProfile | null
): MergedPaymentMethod[] {
  const seen = new Map<string, MergedPaymentMethod>()
  const out: MergedPaymentMethod[] = []

  const add = (type: string, authority: string, payto?: string, displayType?: string, extra?: { currency?: string; minAmount?: number; maxAmount?: number }) => {
    if (!authority?.trim()) return
    const normType = type.toLowerCase()
    const key = `${normType}:${normalizePaymentAuthority(normType, authority)}`
    const existing = seen.get(key)
    if (existing) {
      if (normType === 'lightning') {
        existing.authority = preferCanonicalLightningAuthority(existing.authority, authority.trim())
        existing.payto = existing.payto || payto || (normType && authority ? `payto://${normType}/${existing.authority}` : undefined)
      }
      return
    }
    const entry: MergedPaymentMethod = {
      type: normType,
      authority: authority.trim(),
      payto: payto || (normType && authority ? `payto://${normType}/${authority.trim()}` : undefined),
      displayType: displayType || (normType === 'lightning' ? 'Lightning Network' : normType === 'bitcoin' ? 'Bitcoin' : type || 'Payment'),
      ...extra
    }
    seen.set(key, entry)
    out.push(entry)
  }

  // Aggregate: profile (kind 0) first – from lightningAddressList (tags + JSON) and single lightningAddress
  const fromProfile = profile?.lightningAddressList?.length
    ? profile.lightningAddressList
    : profile?.lightningAddress
      ? [profile.lightningAddress]
      : []
  fromProfile.forEach((addr) => {
    if (addr) add('lightning', addr, `payto://lightning/${addr}`, 'Lightning Network')
  })

  // Then kind 10133 (payto tags and JSON content)
  if (paymentInfo?.methods?.length) {
    paymentInfo.methods.forEach((m) => {
      const authority = m.authority || m.address || ''
      add(
        (m.type || 'lightning').toLowerCase(),
        authority,
        m.payto,
        m.displayType,
        { currency: m.currency, minAmount: m.minAmount, maxAmount: m.maxAmount }
      )
    })
  } else if (paymentInfo?.payto) {
    const type = (paymentInfo.type || 'lightning').toLowerCase()
    const authority = paymentInfo.authority || paymentInfo.payto.replace(/^payto:\/\/[^/]+\//, '') || ''
    add(type, authority, paymentInfo.payto, type === 'lightning' ? 'Lightning Network' : paymentInfo.type || 'Payment')
  }

  return out
}

export default function Profile({ id }: { id?: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { navigate: navigatePrimary } = usePrimaryPage()
  const { profile, isFetching } = useFetchProfile(id)
  const { pubkey: accountPubkey } = useNostr()
  const [paymentInfo, setPaymentInfo] = useState<ReturnType<typeof getPaymentInfoFromEvent> | null>(null)
  const [profileEvent, setProfileEvent] = useState<NostrEvent | undefined>(undefined)
  const [openZapDialog, setOpenZapDialog] = useState(false)
  const [openPublicMessageTo, setOpenPublicMessageTo] = useState<string | null>(null)
  const [openCallInviteTo, setOpenCallInviteTo] = useState<{ pubkey: string; url: string } | null>(null)
  const [openScheduleOwnCall, setOpenScheduleOwnCall] = useState(false)
  const [openScheduleInPersonMeeting, setOpenScheduleInPersonMeeting] = useState(false)
  const [isRawEventDialogOpen, setIsRawEventDialogOpen] = useState(false)
  const { relayUrls: currentBrowsingRelayUrls } = useCurrentRelays()
  const { relaySets, favoriteRelays } = useFavoriteRelays()

  const mergedPaymentMethods = useMemo(() => {
    const list = mergePaymentMethods(paymentInfo, profile ?? null)
    return [...list].sort((a, b) => {
      const rank = (type: string) => (type === 'lightning' ? 0 : type === 'bitcoin' ? 1 : 2)
      return rank(a.type) - rank(b.type)
    })
  }, [paymentInfo, profile])

  /** Group payment methods by displayType so same-type addresses render under one heading */
  const paymentMethodsByType = useMemo(() => {
    const rank = (type: string) => (type === 'lightning' ? 0 : type === 'bitcoin' ? 1 : 2)
    const groups = new Map<string, MergedPaymentMethod[]>()
    for (const method of mergedPaymentMethods) {
      const key = method.displayType || method.type
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(method)
    }
    const order = Array.from(groups.keys()).sort((a, b) => {
      const arrA = groups.get(a)
      const arrB = groups.get(b)
      const typeA = arrA?.[0]?.type ?? ''
      const typeB = arrB?.[0]?.type ?? ''
      return rank(typeA) - rank(typeB)
    })
    return order.map((key) => ({ displayType: key, methods: groups.get(key) ?? [] }))
  }, [mergedPaymentMethods])

  // Fetch payment info (kind 10133) for this profile; uses cached replaceable events and IndexedDB
  useEffect(() => {
    if (!profile?.pubkey) {
      setPaymentInfo(null)
      return
    }

    const fetchPaymentInfo = async () => {
      try {
        const paymentEvent = await client.fetchPaymentInfoEvent(profile.pubkey)
        if (paymentEvent) {
          setPaymentInfo(getPaymentInfoFromEvent(paymentEvent))
        } else {
          setPaymentInfo(null)
        }
      } catch (error) {
        logger.error('Failed to fetch payment info', { error, pubkey: profile.pubkey })
        setPaymentInfo(null)
      }
    }

    fetchPaymentInfo()
  }, [profile?.pubkey])

  // Fetch profile event (kind 0) for republishing and viewing JSON
  // Use fetchProfileEvent which does comprehensive search, not fetchReplaceableEvent
  useEffect(() => {
    if (!profile?.pubkey) {
      setProfileEvent(undefined)
      return
    }

    const fetchProfileEventData = async () => {
      try {
        // Use fetchProfileEvent which includes comprehensive relay search
        const event = await replaceableEventService.fetchProfileEvent(profile.pubkey, false)
        if (event) {
          setProfileEvent(event)
        } else {
          setProfileEvent(undefined)
        }
      } catch (error) {
        logger.error('Failed to fetch profile event', { error, pubkey: profile.pubkey })
        setProfileEvent(undefined)
      }
    }

    fetchProfileEventData()
  }, [profile?.pubkey])

  const isFollowingYou = useMemo(() => {
    // This will be handled by the FollowedBy component
    return false
  }, [profile, accountPubkey])
  const defaultImage = useMemo(
    () => (profile?.pubkey ? generateImageByPubkey(profile?.pubkey) : ''),
    [profile]
  )
  const isSelf = accountPubkey === profile?.pubkey

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

  const handleRepublishToAllAvailable = async () => {
    if (!profileEvent) return
    const promise = client.publishEvent(allAvailableRelayUrls, profileEvent).then((result) => {
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
    if (!profileEvent) return
    const promise = (async () => {
      let relays = await nip66Service.getPublicLivelyRelayUrls()
      const usedMonitoringList = !!relays?.length
      if (!relays?.length) {
        relays = allAvailableRelayUrls
      }
      if (!relays?.length) {
        throw new Error(t('No relays available'))
      }
      const result = await client.publishEvent(relays, profileEvent)
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

  useEffect(() => {
    if (!profile?.pubkey) return

    const forceUpdateCache = async () => {
      await Promise.all([
        client.forceUpdateRelayListEvent(profile.pubkey),
        replaceableEventService.fetchReplaceableEvent(profile.pubkey, kinds.Metadata)
      ])
    }
    forceUpdateCache()
  }, [profile?.pubkey])

  if (!profile && isFetching) {
    return (
      <>
        <div>
          <div className="relative bg-cover bg-center mb-2">
            <Skeleton className="w-full aspect-[3/1] rounded-none" />
            <Skeleton className="w-24 h-24 md:w-48 md:h-48 absolute bottom-0 left-3 translate-y-1/2 border-4 border-background rounded-full" />
          </div>
        </div>
        <div className="px-4">
          <Skeleton className="h-5 w-28 mt-14 md:mt-28 mb-1 md:ml-56" />
          <Skeleton className="h-5 w-56 mt-2 my-1 rounded-full md:ml-56" />
        </div>
        <div className="px-4 pt-4 flex items-center justify-center">
          <div className="text-sm text-muted-foreground">
            {t('Searching all available relays...')}
          </div>
        </div>
      </>
    )
  }
  if (!profile && !isFetching) return <NotFound />
  
  if (!profile) return null // TypeScript guard - should never reach here but satisfies type checker

  const { banner, username, about, avatar, pubkey, website, websiteList, nip05List } = profile
  
  logger.component('Profile', 'Profile data loaded', { 
    pubkey, 
    username, 
    hasProfile: !!profile, 
    isFetching,
    id 
  })
  return (
    <>
      <div>
        <div className="relative bg-cover bg-center mb-2">
          <ProfileBanner banner={banner} pubkey={pubkey} className="w-full aspect-[3/1]" />
          <Avatar className="w-24 h-24 md:w-48 md:h-48 absolute left-3 bottom-0 translate-y-1/2 border-4 border-background">
            <AvatarImage src={avatar} className="object-cover object-center" />
            <AvatarFallback>
              <img src={defaultImage} />
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="px-4">
          <div className="flex justify-end h-8 gap-2 items-center">
            <ProfileOptions
              pubkey={pubkey}
              profileEvent={profileEvent}
              onSendPublicMessage={!isSelf ? () => setOpenPublicMessageTo(pubkey) : undefined}
              onSendCallInvite={
                !isSelf
                  ? (url) => setOpenCallInviteTo({ pubkey, url })
                  : undefined
              }
            />
            {isSelf ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" className="rounded-full">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setOpenScheduleOwnCall(true)}>
                    <Calendar />
                    {t('Schedule a video call')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOpenScheduleInPersonMeeting(true)}>
                    <MapPin />
                    {t('Schedule in-person meeting')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigatePrimary('spells', { spell: 'followPacks' })}>
                    <Gift />
                    {t('Follow Packs')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => push(toProfileEditor())}>
                    <Pencil />
                    {t('Edit')}
                  </DropdownMenuItem>
                  {profileEvent && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleRepublishToAllAvailable}>
                        <SatelliteDish />
                        {t('Republish to all available relays')} ({allAvailableRelayUrls.length})
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleRepublishToAllActive}>
                        <SatelliteDish />
                        {t('Republish to all active relays')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setIsRawEventDialogOpen(true)}>
                        <Code />
                        {t('View JSON')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                {mergedPaymentMethods.some((m) => m.type === 'lightning') && (
                  <ProfileZapButton pubkey={pubkey} openZapDialog={openZapDialog} setOpenZapDialog={setOpenZapDialog} />
                )}
                <FollowButton pubkey={pubkey} />
              </>
            )}
          </div>
          <div className="pt-2 md:pl-56">
            <div className="flex gap-2 items-center">
              <div className="text-xl font-semibold truncate select-text">{username}</div>
              {isFollowingYou && (
                <div className="text-muted-foreground rounded-full bg-muted text-xs h-fit px-2 shrink-0">
                  {t('Follows you')}
                </div>
              )}
            </div>
            <Nip05 pubkey={pubkey} />
            {/* Display multiple NIP-05 values if available, with verification */}
            {nip05List && nip05List.length > 1 && (
              <Nip05List nip05List={nip05List.slice(1)} pubkey={pubkey} />
            )}
            <div className="flex gap-1 mt-1">
              <PubkeyCopy pubkey={pubkey} />
              <NpubQrCode pubkey={pubkey} />
            </div>
            <Collapsible>
              <ProfileAbout
                about={about}
                className="text-wrap break-words whitespace-pre-wrap mt-2 select-text"
              />
            </Collapsible>
            {/* Display websites - show first one prominently, others below */}
            {website && (
              <div className="flex gap-1 items-center text-primary mt-2 truncate select-text">
                <Link size={14} className="shrink-0" />
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline truncate flex-1 max-w-fit w-0"
                >
                  {website}
                </a>
              </div>
            )}
            {websiteList && websiteList.length > 1 && (
              <div className="flex flex-col gap-1 mt-1">
                {websiteList.slice(1).map((url: string, idx: number) => (
                  <div key={idx} className="flex gap-1 items-center text-primary truncate select-text">
                    <Link size={12} className="shrink-0" />
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline truncate text-sm"
                    >
                      {url}
                    </a>
                  </div>
                ))}
              </div>
            )}
            {/* Payment methods: merged from kind 10133 + profile lightning, deduplicated – use PaytoLink for consistent behavior */}
            {paymentMethodsByType.length > 0 && (
              <div className="mt-2 p-2 border rounded-lg bg-muted/50 min-w-0 overflow-hidden">
                <div className="text-xs font-semibold text-muted-foreground mb-2">Payment Methods</div>
                <div className="space-y-3 min-w-0">
                  {paymentMethodsByType.map((group, groupIdx) => (
                    <div key={groupIdx} className="text-sm min-w-0">
                      <div className="font-medium">{group.displayType}</div>
                      <div className="space-y-1.5 mt-1">
                        {group.methods.map((method, idx) => (
                          <div key={idx} className="min-w-0">
                            {method.authority && (
                              <div className="text-muted-foreground flex items-center gap-1 min-w-0">
                                <PaytoLink
                                  type={method.type}
                                  authority={method.authority}
                                  paytoUri={method.payto}
                                  pubkey={method.type === 'lightning' ? pubkey : undefined}
                                  onOpenZap={method.type === 'lightning' ? () => setOpenZapDialog(true) : undefined}
                                  className="hover:underline break-all min-w-0 text-primary flex-1"
                                >
                                  {method.authority}
                                </PaytoLink>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    navigator.clipboard.writeText(method.authority)
                                    toast.success(t('Copied to clipboard'))
                                  }}
                                  className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                                  title={t('Copy address')}
                                >
                                  <Copy className="size-3.5" />
                                </button>
                              </div>
                            )}
                            {(method.currency || (method.minAmount !== undefined && method.maxAmount !== undefined)) && (
                              <div className="text-muted-foreground text-xs mt-0.5">
                                {method.currency && <span>({method.currency})</span>}
                                {method.minAmount !== undefined && method.maxAmount !== undefined && (
                                  <span className="ml-2">
                                    {method.minAmount}-{method.maxAmount}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ZapDialog
              open={openZapDialog}
              setOpen={setOpenZapDialog}
              pubkey={pubkey}
            />
            <div className="flex justify-between items-center mt-2 text-sm">
              <div className="flex gap-4 items-center">
                <SmartFollowings pubkey={pubkey} />
                <SmartRelays pubkey={pubkey} />
                {isSelf && <SmartMuteLink />}
              </div>
              {!isSelf && <FollowedBy pubkey={pubkey} />}
            </div>
          </div>
        </div>
      </div>
      <ProfileFeedWithPins pubkey={pubkey} />
      {openPublicMessageTo && (
        <PostEditor
          open={!!openPublicMessageTo}
          setOpen={(open) => !open && setOpenPublicMessageTo(null)}
          initialPublicMessageTo={openPublicMessageTo}
        />
      )}
      {openCallInviteTo && (
        <PostEditor
          open={!!openCallInviteTo}
          setOpen={(open) => !open && setOpenCallInviteTo(null)}
          initialPublicMessageTo={openCallInviteTo.pubkey}
          defaultContent={`${t('Join the video call')}: ${openCallInviteTo.url}`}
        />
      )}
      <ScheduleVideoCallDialog
        open={openScheduleOwnCall}
        onOpenChange={setOpenScheduleOwnCall}
      />
      <ScheduleInPersonMeetingDialog
        open={openScheduleInPersonMeeting}
        onOpenChange={setOpenScheduleInPersonMeeting}
      />
      {profileEvent && (
        <RawEventDialog
          event={profileEvent}
          isOpen={isRawEventDialogOpen}
          onClose={() => setIsRawEventDialogOpen(false)}
        />
      )}
    </>
  )
}
