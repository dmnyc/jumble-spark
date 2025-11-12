import Collapsible from '@/components/Collapsible'
import FollowButton from '@/components/FollowButton'
import Nip05 from '@/components/Nip05'
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
import { toProfileEditor } from '@/lib/link'
import { generateImageByPubkey } from '@/lib/pubkey'
import { useSecondaryPage } from '@/PageManager'
import { toNoteList } from '@/lib/link'
import { parseAdvancedSearch } from '@/lib/search-parser'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { FileText, Link, Zap, Film } from 'lucide-react'
import { useEffect, useMemo, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
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
import { toFollowPacks } from '@/lib/link'

type ProfileTabValue = 'posts' | 'pins' | 'bookmarks' | 'interests' | 'articles' | 'media' | 'you'

export default function Profile({ id }: { id?: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { profile, isFetching } = useFetchProfile(id)
  const { pubkey: accountPubkey } = useNostr()
  const [activeTab, setActiveTab] = useState<ProfileTabValue>('posts')
  const [searchQuery, setSearchQuery] = useState('')
  const [articleKindFilter, setArticleKindFilter] = useState<string>('all')
  const [postKindFilter, setPostKindFilter] = useState<string>('all')
  const [mediaKindFilter, setMediaKindFilter] = useState<string>('all')

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
  const [articleEvents, setArticleEvents] = useState<Event[]>([])
  const [postEvents, setPostEvents] = useState<Event[]>([])
  const [mediaEvents, setMediaEvents] = useState<Event[]>([])
  const [interactionEvents, setInteractionEvents] = useState<Event[]>([])
  
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
        client.fetchProfile(profile.pubkey, true)
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

  const { banner, username, about, avatar, pubkey, website, lightningAddress } = profile
  
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
            <ProfileOptions pubkey={pubkey} />
            {isSelf ? (
              <div className="flex gap-2">
                <Button
                  className="rounded-full whitespace-nowrap"
                  variant="secondary"
                  onClick={() => push(toFollowPacks())}
                >
                  {t('Browse follow packs')}
                </Button>
                <Button
                  className="w-20 min-w-20 rounded-full"
                  variant="secondary"
                  onClick={() => push(toProfileEditor())}
                >
                  {t('Edit')}
                </Button>
              </div>
            ) : (
              <>
                {!!lightningAddress && <ProfileZapButton pubkey={pubkey} />}
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
            {lightningAddress && (
              <div className="text-sm text-yellow-400 flex gap-1 items-center select-text">
                <Zap className="size-4 shrink-0" />
                <div className="flex-1 max-w-fit w-0 truncate">{lightningAddress}</div>
              </div>
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
            {website && (
              <div className="flex gap-1 items-center text-primary mt-2 truncate select-text">
                <Link size={14} className="shrink-0" />
                <a
                  href={website}
                  target="_blank"
                  className="hover:underline truncate flex-1 max-w-fit w-0"
                >
                  {website}
                </a>
              </div>
            )}
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
            onTabChange={(tab) => setActiveTab(tab as ProfileTabValue)}
            threshold={800}
          />
          <div className="flex items-center gap-2 pr-2 px-1">
            <ProfileSearchBar
              onSearch={activeTab === 'articles' ? handleArticleSearch : setSearchQuery}
              placeholder={`Search ${
                activeTab === 'posts' ? 'posts' : activeTab === 'media' ? 'media' : activeTab
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
    </>
  )
}
