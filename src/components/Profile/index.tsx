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
import Tabs from '@/components/Tabs'
import RetroRefreshButton from '@/components/ui/RetroRefreshButton'
import ProfileSearchBar from '@/components/ui/ProfileSearchBar'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ExtendedKind } from '@/constants'
import { useFetchProfile } from '@/hooks'
import { Event, kinds } from 'nostr-tools'
import { getPaymentInfoFromEvent } from '@/lib/event-metadata'
import { toProfileEditor } from '@/lib/link'
import { generateImageByPubkey } from '@/lib/pubkey'
import { useSecondaryPage } from '@/PageManager'
import { toNoteList } from '@/lib/link'
import { parseAdvancedSearch } from '@/lib/search-parser'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { replaceableEventService } from '@/services/client.service'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { FileText, Link, Film, Copy, Ellipsis, Calendar, MapPin, Pencil } from 'lucide-react'
import { useEffect, useMemo, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import logger from '@/lib/logger'
import NotFound from '../NotFound'
import FollowedBy from './FollowedBy'
import ProfileFeed from './ProfileFeed'
import ProfileArticles from './ProfileArticles'
import ProfileBookmarksAndHashtags from './ProfileBookmarksAndHashtags'
import SmartFollowings from './SmartFollowings'
import SmartMuteLink from './SmartMuteLink'
import SmartRelays from './SmartRelays'
import ProfileMedia from './ProfileMedia'
import ProfileInteractions from './ProfileInteractions'
import ProfileNotes from './ProfileNotes'
import { toFollowPacks } from '@/lib/link'
import ZapDialog from '@/components/ZapDialog'
import PaytoLink from '@/components/PaytoLink'
import PostEditor from '@/components/PostEditor'
import {
  ScheduleVideoCallDialog,
  ScheduleInPersonMeetingDialog
} from '@/components/ScheduleVideoCallDialog'
import type { TProfile } from '@/types'

type ProfileTabValue = 'posts' | 'pins' | 'bookmarks' | 'interests' | 'articles' | 'media' | 'you' | 'notes'

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
  const { profile, isFetching } = useFetchProfile(id)
  const { pubkey: accountPubkey } = useNostr()
  const [paymentInfo, setPaymentInfo] = useState<ReturnType<typeof getPaymentInfoFromEvent> | null>(null)
  const [openZapDialog, setOpenZapDialog] = useState(false)
  const [openPublicMessageTo, setOpenPublicMessageTo] = useState<string | null>(null)
  const [openCallInviteTo, setOpenCallInviteTo] = useState<{ pubkey: string; url: string } | null>(null)
  const [openScheduleOwnCall, setOpenScheduleOwnCall] = useState(false)
  const [openScheduleInPersonMeeting, setOpenScheduleInPersonMeeting] = useState(false)

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
  const [activeTab, setActiveTab] = useState<ProfileTabValue>('posts')
  const [searchQuery, setSearchQuery] = useState('')
  const [articleKindFilter, setArticleKindFilter] = useState<string>('all')
  const [postKindFilter, setPostKindFilter] = useState<string>('all')
  const [mediaKindFilter, setMediaKindFilter] = useState<string>('all')
  const [notesKindFilter, setNotesKindFilter] = useState<string>('all')

  // Handle search in articles tab - parse advanced search parameters
  const handleArticleSearch = (query: string) => {
    if (activeTab === 'articles' && query.trim()) {
      const searchParams = parseAdvancedSearch(query)
      
      // Build kinds array from filter
      const kinds = articleKindFilter && articleKindFilter !== 'all' 
        ? [parseInt(articleKindFilter)] 
        : undefined
      
      // Note: Kind filter only available as URL parameter k=, not from search parser
      const allKinds = kinds
      
      // Build URL with search parameters
      // For now, if we have a d-tag, use that. Otherwise use advanced search
      if (searchParams.dtag) {
        // Use d-tag search if we have plain text
        const url = toNoteList({ domain: searchParams.dtag, kinds: allKinds })
        push(url)
        return
      } else if (Object.keys(searchParams).length > 0) {
        // Advanced search - we'll need to pass these as URL params
        // For now, construct URL with all parameters
        const urlParams = new URLSearchParams()
        if (searchParams.title) {
          if (Array.isArray(searchParams.title)) {
            searchParams.title.forEach(t => urlParams.append('title', t))
          } else {
            urlParams.set('title', searchParams.title)
          }
        }
        if (searchParams.subject) {
          if (Array.isArray(searchParams.subject)) {
            searchParams.subject.forEach(s => urlParams.append('subject', s))
          } else {
            urlParams.set('subject', searchParams.subject)
          }
        }
        if (searchParams.description) {
          if (Array.isArray(searchParams.description)) {
            searchParams.description.forEach(d => urlParams.append('description', d))
          } else {
            urlParams.set('description', searchParams.description)
          }
        }
        if (searchParams.author) {
          if (Array.isArray(searchParams.author)) {
            searchParams.author.forEach(a => urlParams.append('author', a))
          } else {
            urlParams.set('author', searchParams.author)
          }
        }
        if (searchParams.type) {
          if (Array.isArray(searchParams.type)) {
            searchParams.type.forEach(t => urlParams.append('type', t))
          } else {
            urlParams.set('type', searchParams.type)
          }
        }
        // Note: Date searches, pubkey filters, and event filters removed - not supported
        if (allKinds) {
          allKinds.forEach((k: number) => urlParams.append('k', k.toString()))
        }
        
        const url = `/notes?${urlParams.toString()}`
        push(url)
        return
      }
    }
    setSearchQuery(query)
  }
  
  // Refs for child components
  const profileFeedRef = useRef<{ refresh: () => void }>(null)
  const profileBookmarksRef = useRef<{ refresh: () => void }>(null)
  const profileArticlesRef = useRef<{ refresh: () => void; getEvents: () => Event[] }>(null)
  const profileMediaRef = useRef<{ refresh: () => void; getEvents: () => Event[] }>(null)
  const profileInteractionsRef = useRef<{ refresh: () => void; getEvents?: () => Event[] }>(null)
  const profileNotesRef = useRef<{ refresh: () => void; getEvents?: () => Event[] }>(null)
  const [articleEvents, setArticleEvents] = useState<Event[]>([])
  const [postEvents, setPostEvents] = useState<Event[]>([])
  const [mediaEvents, setMediaEvents] = useState<Event[]>([])
  const [_interactionEvents, setInteractionEvents] = useState<Event[]>([])
  const [notesEvents, setNotesEvents] = useState<Event[]>([])
  
  const isFollowingYou = useMemo(() => {
    // This will be handled by the FollowedBy component
    return false
  }, [profile, accountPubkey])
  const defaultImage = useMemo(
    () => (profile?.pubkey ? generateImageByPubkey(profile?.pubkey) : ''),
    [profile]
  )
  const isSelf = accountPubkey === profile?.pubkey

  // Refresh functions for each tab
  const handleRefresh = () => {
    if (activeTab === 'posts') {
      profileFeedRef.current?.refresh()
    } else if (activeTab === 'articles') {
      profileArticlesRef.current?.refresh()
    } else if (activeTab === 'media') {
      profileMediaRef.current?.refresh()
    } else if (activeTab === 'you') {
      profileInteractionsRef.current?.refresh()
    } else if (activeTab === 'notes') {
      profileNotesRef.current?.refresh()
    } else {
      profileBookmarksRef.current?.refresh()
    }
  }

  // Define tabs with refresh buttons
  const tabs = useMemo(() => {
    const baseTabs = [
      {
        value: 'posts',
        label: 'Posts'
      },
      {
        value: 'articles',
        label: 'Articles'
      },
      {
        value: 'media',
        label: 'Media'
      },
      {
        value: 'pins',
        label: 'Pins'
      },
      {
        value: 'bookmarks',
        label: 'Bookmarks'
      },
      {
        value: 'interests',
        label: 'Interests'
      }
    ]
    
    // Add "My Notes" tab if viewing own profile
    if (isSelf) {
      baseTabs.push({
        value: 'notes',
        label: 'My Notes'
      })
    }
    
    // Add "You" tab if viewing another user's profile and logged in
    if (!isSelf && accountPubkey) {
      baseTabs.push({
        value: 'you',
        label: 'You'
      })
    }
    
    return baseTabs
  }, [isSelf, accountPubkey])

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

  // Listen for tab restoration from PageManager
  useEffect(() => {
    const handleRestore = (e: CustomEvent<{ page: string, tab: string }>) => {
      if (e.detail.page === 'profile' && e.detail.tab) {
        setActiveTab(e.detail.tab as ProfileTabValue)
      }
    }
    window.addEventListener('restorePageTab', handleRestore as EventListener)
    return () => window.removeEventListener('restorePageTab', handleRestore as EventListener)
  }, [])


  if (!profile && isFetching) {
    return (
      <>
        <div>
          <div className="relative bg-cover bg-center mb-2">
            <Skeleton className="w-full aspect-[3/1] rounded-none" />
            <Skeleton className="w-24 h-24 absolute bottom-0 left-3 translate-y-1/2 border-4 border-background rounded-full" />
          </div>
        </div>
        <div className="px-4">
          <Skeleton className="h-5 w-28 mt-14 mb-1" />
          <Skeleton className="h-5 w-56 mt-2 my-1 rounded-full" />
        </div>
      </>
    )
  }
  if (!profile) return <NotFound />

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
          <Avatar className="w-24 h-24 absolute left-3 bottom-0 translate-y-1/2 border-4 border-background">
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
                  <DropdownMenuItem onClick={() => push(toFollowPacks())}>
                    <Link />
                    {t('Browse follow packs')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => push(toProfileEditor())}>
                    <Pencil />
                    {t('Edit')}
                  </DropdownMenuItem>
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
          <div className="pt-2">
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
                {websiteList.slice(1).map((url, idx) => (
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
      <div>
        <div className="space-y-2">
          <Tabs
            value={activeTab}
            tabs={tabs}
            onTabChange={(tab) => {
              setActiveTab(tab as ProfileTabValue)
              // Dispatch tab change event for PageManager
              window.dispatchEvent(new CustomEvent('pageTabChanged', { 
                detail: { page: 'profile', tab: tab } 
              }))
            }}
            threshold={800}
          />
          <div className="flex items-center gap-2 pr-2 px-1">
            <ProfileSearchBar
              onSearch={activeTab === 'articles' ? handleArticleSearch : setSearchQuery}
              placeholder={`Search ${
                activeTab === 'posts' ? 'posts' : activeTab === 'media' ? 'media' : activeTab === 'notes' ? 'notes' : activeTab
              }...`}
              className="w-64"
            />
            {activeTab === 'posts' && (() => {
              const allCount = postEvents.length
              const noteCount = postEvents.filter((event) => event.kind === kinds.ShortTextNote).length
              const repostCount = postEvents.filter((event) => event.kind === kinds.Repost).length
              const commentCount = postEvents.filter((event) => event.kind === ExtendedKind.COMMENT).length
              const discussionCount = postEvents.filter((event) => event.kind === ExtendedKind.DISCUSSION).length
              const pollCount = postEvents.filter((event) => event.kind === ExtendedKind.POLL).length
              const superzapCount = postEvents.filter((event) => event.kind === ExtendedKind.ZAP_RECEIPT).length
              const calendarEventCount = postEvents.filter(
                (event) =>
                  event.kind === ExtendedKind.CALENDAR_EVENT_TIME ||
                  event.kind === ExtendedKind.CALENDAR_EVENT_DATE
              ).length

              return (
                <Select value={postKindFilter} onValueChange={setPostKindFilter}>
                  <SelectTrigger className="w-48">
                    <FileText className="h-4 w-4 mr-2 shrink-0" />
                    <SelectValue placeholder="Filter posts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Posts ({allCount})</SelectItem>
                    <SelectItem value={String(kinds.ShortTextNote)}>Notes ({noteCount})</SelectItem>
                    <SelectItem value={String(kinds.Repost)}>Reposts ({repostCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.COMMENT)}>Comments ({commentCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.DISCUSSION)}>Discussions ({discussionCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.POLL)}>Polls ({pollCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.CALENDAR_EVENT_TIME)}>Calendar Events ({calendarEventCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.ZAP_RECEIPT)}>Superzaps ({superzapCount})</SelectItem>
                  </SelectContent>
                </Select>
              )
            })()}
            {activeTab === 'articles' && (() => {
              const allCount = articleEvents.length
              const longFormCount = articleEvents.filter((e) => e.kind === kinds.LongFormArticle).length
              const wikiMarkdownCount = articleEvents.filter((e) => e.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN).length
              const wikiAsciiDocCount = articleEvents.filter((e) => e.kind === ExtendedKind.WIKI_ARTICLE).length
              const publicationCount = articleEvents.filter((e) => e.kind === ExtendedKind.PUBLICATION).length
              const highlightsCount = articleEvents.filter((e) => e.kind === kinds.Highlights).length

              return (
                <Select value={articleKindFilter} onValueChange={setArticleKindFilter}>
                  <SelectTrigger className="w-48">
                    <FileText className="h-4 w-4 mr-2 shrink-0" />
                    <SelectValue placeholder="Filter articles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types ({allCount})</SelectItem>
                    <SelectItem value={String(kinds.LongFormArticle)}>Long Form Articles ({longFormCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.WIKI_ARTICLE_MARKDOWN)}>Wiki (Markdown) ({wikiMarkdownCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.WIKI_ARTICLE)}>Wiki (AsciiDoc) ({wikiAsciiDocCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.PUBLICATION)}>Publications ({publicationCount})</SelectItem>
                    <SelectItem value={String(kinds.Highlights)}>Highlights ({highlightsCount})</SelectItem>
                  </SelectContent>
                </Select>
              )
            })()}
            {activeTab === 'media' && (() => {
              const allCount = mediaEvents.length
              const pictureCount = mediaEvents.filter((event) => event.kind === ExtendedKind.PICTURE).length
              const videoCount = mediaEvents.filter((event) => event.kind === ExtendedKind.VIDEO).length
              const shortVideoCount = mediaEvents.filter((event) => event.kind === ExtendedKind.SHORT_VIDEO).length
              const voiceCount = mediaEvents.filter((event) => event.kind === ExtendedKind.VOICE).length
              const voiceCommentCount = mediaEvents.filter((event) => event.kind === ExtendedKind.VOICE_COMMENT).length

              return (
                <Select value={mediaKindFilter} onValueChange={setMediaKindFilter}>
                  <SelectTrigger className="w-52">
                    <Film className="h-4 w-4 mr-2 shrink-0" />
                    <SelectValue placeholder="Filter media" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Media ({allCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.PICTURE)}>Photos ({pictureCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.VIDEO)}>Videos ({videoCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.SHORT_VIDEO)}>Short Videos ({shortVideoCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.VOICE)}>Voice Posts ({voiceCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.VOICE_COMMENT)}>Voice Comments ({voiceCommentCount})</SelectItem>
                  </SelectContent>
                </Select>
              )
            })()}
            {activeTab === 'notes' && (() => {
              const allCount = notesEvents.length
              const publicationContentCount = notesEvents.filter((event) => event.kind === ExtendedKind.PUBLICATION_CONTENT).length
              const internalCitationCount = notesEvents.filter((event) => event.kind === ExtendedKind.CITATION_INTERNAL).length
              const externalCitationCount = notesEvents.filter((event) => event.kind === ExtendedKind.CITATION_EXTERNAL).length
              const hardcopyCitationCount = notesEvents.filter((event) => event.kind === ExtendedKind.CITATION_HARDCOPY).length
              const promptCitationCount = notesEvents.filter((event) => event.kind === ExtendedKind.CITATION_PROMPT).length

              return (
                <Select value={notesKindFilter} onValueChange={setNotesKindFilter}>
                  <SelectTrigger className="w-52">
                    <FileText className="h-4 w-4 mr-2 shrink-0" />
                    <SelectValue placeholder="Filter notes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Notes ({allCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.PUBLICATION_CONTENT)}>Notes ({publicationContentCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.CITATION_INTERNAL)}>Internal Citations ({internalCitationCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.CITATION_EXTERNAL)}>External Citations ({externalCitationCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.CITATION_HARDCOPY)}>Hardcopy Citations ({hardcopyCitationCount})</SelectItem>
                    <SelectItem value={String(ExtendedKind.CITATION_PROMPT)}>Prompt Citations ({promptCitationCount})</SelectItem>
                  </SelectContent>
                </Select>
              )
            })()}
            <RetroRefreshButton onClick={handleRefresh} size="sm" className="flex-shrink-0" />
          </div>
        </div>
        {activeTab === 'posts' && (
          <ProfileFeed
            ref={profileFeedRef}
            pubkey={pubkey}
            topSpace={0}
            searchQuery={searchQuery}
            kindFilter={postKindFilter}
            onEventsChange={setPostEvents}
          />
        )}
        {activeTab === 'articles' && (
          <ProfileArticles
            ref={profileArticlesRef}
            pubkey={pubkey}
            topSpace={0}
            searchQuery={searchQuery}
            kindFilter={articleKindFilter}
            onEventsChange={setArticleEvents}
          />
        )}
        {activeTab === 'media' && (
          <ProfileMedia
            ref={profileMediaRef}
            pubkey={pubkey}
            topSpace={0}
            searchQuery={searchQuery}
            kindFilter={mediaKindFilter}
            onEventsChange={setMediaEvents}
          />
        )}
        {(activeTab === 'pins' || activeTab === 'bookmarks' || activeTab === 'interests') && (
          <ProfileBookmarksAndHashtags 
            ref={profileBookmarksRef}
            pubkey={pubkey} 
            initialTab={activeTab === 'pins' ? 'pins' : activeTab === 'bookmarks' ? 'bookmarks' : 'hashtags'}
            searchQuery={searchQuery}
          />
        )}
        {activeTab === 'notes' && (
          <ProfileNotes
            ref={profileNotesRef}
            pubkey={pubkey}
            topSpace={0}
            searchQuery={searchQuery}
            kindFilter={notesKindFilter}
            onEventsChange={setNotesEvents}
          />
        )}
        {activeTab === 'you' && accountPubkey && (
          <ProfileInteractions
            ref={profileInteractionsRef}
            accountPubkey={accountPubkey}
            profilePubkey={pubkey}
            topSpace={0}
            searchQuery={searchQuery}
            onEventsChange={setInteractionEvents}
          />
        )}
      </div>
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
    </>
  )
}
