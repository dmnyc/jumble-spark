import BookmarkList from '@/components/BookmarkList'
import RelayInfo from '@/components/RelayInfo'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import type { TNoteListRef } from '@/components/NoteList'
import { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import { TPageRef } from '@/types'
import { Compass, Info, Star, UsersRound } from 'lucide-react'
import React, {
  Dispatch,
  forwardRef,
  SetStateAction,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { FavoriteRelaysActiveStripMobileBar } from '@/components/FavoriteRelaysActiveStrip'
import FavoriteRelaysFeedPicker from '@/components/FavoriteRelaysFeedPicker'
import HelpAndAccountMenu from '@/components/HelpAndAccountMenu'
import FollowingFeed from './FollowingFeed'
import RelaysFeed from './RelaysFeed'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
const NoteListPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  const layoutRef = useRef<TPageRef>(null)
  const feedRef = useRef<TNoteListRef>(null)
  const bookmarkRef = useRef<{ refresh: () => void }>(null)
  const { pubkey, checkLogin } = useNostr()
  const { feedInfo, relayUrls, isReady } = useFeed()
  const { isSmallScreen } = useScreenSize()
  const [showRelayDetails, setShowRelayDetails] = useState(false)
  const [homeSubHeader, setHomeSubHeader] = useState<React.ReactNode>(null)

  const usesSubHeader =
    feedInfo.feedType === 'relay' ||
    feedInfo.feedType === 'relays' ||
    feedInfo.feedType === 'all-favorites' ||
    feedInfo.feedType === 'following'

  const runFeedRefresh = useCallback(() => {
    if (feedInfo.feedType === 'bookmarks') {
      void bookmarkRef.current?.refresh()
    } else {
      feedRef.current?.refresh()
    }
  }, [feedInfo.feedType])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: runFeedRefresh
    }),
    [runFeedRefresh]
  )

  const setHomeSubHeaderStable = useCallback((node: React.ReactNode) => {
    setHomeSubHeader(node)
  }, [])

  // Clear subHeader when switching to a feed that doesn't use it (e.g. bookmarks)
  useEffect(() => {
    if (!usesSubHeader) setHomeSubHeader(null)
  }, [usesSubHeader])

  // REMOVED: Scroll-to-top logic - feed should NEVER scroll to top when drawer opens/closes
  // The feed stays mounted and maintains scroll position at all times

  useEffect(() => {
    if (relayUrls.length) {
      addRelayUrls(relayUrls)
      return () => {
        removeRelayUrls(relayUrls)
      }
    }
  }, [relayUrls])

  let content: React.ReactNode = null
  if (!isReady) {
    content = (
      <div
        className="min-h-[40vh] space-y-2 px-1 py-4"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <p className="px-3 text-sm text-muted-foreground">
          {t('feedStarting', {
            defaultValue: 'Starting feeds and relays… This can take a few seconds after login.'
          })}
        </p>
        {Array.from({ length: 5 }).map((_, i) => (
          <NoteCardLoadingSkeleton key={i} />
        ))}
      </div>
    )
  } else if (feedInfo.feedType === 'following' && !pubkey) {
    content = (
      <div className="flex justify-center w-full">
        <Button size="lg" onClick={() => checkLogin()}>
          {t('Please login to view following feed')}
        </Button>
      </div>
    )
  } else if (feedInfo.feedType === 'bookmarks') {
    if (!pubkey) {
      content = (
        <div className="flex justify-center w-full">
          <Button size="lg" onClick={() => checkLogin()}>
            {t('Please login to view bookmarks')}
          </Button>
        </div>
      )
    } else {
      content = <BookmarkList ref={bookmarkRef} />
    }
  } else if (feedInfo.feedType === 'following') {
    content = (
      <FollowingFeed
        ref={feedRef}
        setSubHeader={setHomeSubHeaderStable}
        onSubHeaderRefresh={runFeedRefresh}
      />
    )
  } else {
    content = (
      <>
        {showRelayDetails && feedInfo.feedType === 'relay' && !!feedInfo.id && (
          <RelayInfo url={feedInfo.id!} className="mb-2 pt-3" />
        )}
        <RelaysFeed
          ref={feedRef}
          setSubHeader={setHomeSubHeaderStable}
          onSubHeaderRefresh={runFeedRefresh}
        />
      </>
    )
  }

  const showFavoriteRelaysPicker =
    isReady &&
    (feedInfo.feedType === 'all-favorites' ||
      feedInfo.feedType === 'relay' ||
      feedInfo.feedType === 'relays')

  const feedPageTitle = useMemo(
    () =>
      feedInfo.feedType === 'following'
        ? t('Following')
        : feedInfo.feedType === 'bookmarks'
          ? t('Bookmarks')
          : feedInfo.feedType === 'relays'
            ? t('relayType_relay_set')
            : t('Favorite Relays'),
    [feedInfo.feedType, t]
  )

  const subHeader = (
    <>
      {isSmallScreen ? <FavoriteRelaysActiveStripMobileBar /> : null}
      <div className="w-full min-w-0 border-b border-border/80 bg-background px-3 py-2 sm:px-4">
        <h1 className="text-lg font-semibold leading-tight tracking-tight">{feedPageTitle}</h1>
      </div>
      {showFavoriteRelaysPicker ? <FavoriteRelaysFeedPicker /> : null}
      {homeSubHeader}
    </>
  )

  return (
    <PrimaryPageLayout
      pageName="feed"
      ref={layoutRef}
      titlebar={
        <NoteListPageTitlebar
          layoutRef={layoutRef}
          onFeedRefresh={runFeedRefresh}
          showTitlebarRefresh={!usesSubHeader}
          showRelayDetails={showRelayDetails}
          setShowRelayDetails={
            feedInfo.feedType === 'relay' && !!feedInfo.id ? setShowRelayDetails : undefined
          }
        />
      }
      subHeader={subHeader}
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-2">
        {content}
      </div>
    </PrimaryPageLayout>
  )
})
NoteListPage.displayName = 'NoteListPage'
export default NoteListPage

function NoteListPageTitlebar({
  layoutRef,
  onFeedRefresh,
  showTitlebarRefresh,
  showRelayDetails,
  setShowRelayDetails
}: {
  layoutRef?: React.RefObject<TPageRef>
  onFeedRefresh: () => void
  showTitlebarRefresh: boolean
  showRelayDetails?: boolean
  setShowRelayDetails?: Dispatch<SetStateAction<boolean>>
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { primaryViewType, setPrimaryNoteView } = usePrimaryNoteView()
  const { pubkey } = useNostr()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell
  const exploreActive = display && current === 'explore' && primaryViewType === null
  const followsLatestActive = display && current === 'follows-latest' && primaryViewType === null
  const favoritesActive =
    display && current === 'spells' && spell === 'favorites' && primaryViewType === null

  return (
    <div className="relative flex gap-1 items-center h-full justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-1 h-full pl-1 sm:pl-3">
        {isSmallScreen && (
          <>
            <Button
              variant="ghost"
              size="titlebar-icon"
              title={t('Explore')}
              aria-label={t('Explore')}
              className={exploreActive ? 'bg-accent/50' : ''}
              onClick={(e) => {
                e.stopPropagation()
                if (primaryViewType !== null) {
                  setPrimaryNoteView(null)
                } else {
                  navigate('explore')
                }
              }}
            >
              <Compass />
            </Button>
            {pubkey ? (
              <>
                <Button
                  variant="ghost"
                  size="titlebar-icon"
                  title={t('Follows latest nav label')}
                  aria-label={t('Follows latest nav label')}
                  className={followsLatestActive ? 'bg-accent/50' : ''}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (primaryViewType !== null) {
                      setPrimaryNoteView(null)
                    }
                    navigate('follows-latest')
                  }}
                >
                  <UsersRound />
                </Button>
                <Button
                  variant="ghost"
                  size="titlebar-icon"
                  title={t('Favorites')}
                  aria-label={t('Favorites')}
                  className={favoritesActive ? 'bg-accent/50' : ''}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (primaryViewType !== null) {
                      setPrimaryNoteView(null)
                    }
                    navigate('spells', { spell: 'favorites' })
                  }}
                >
                  <Star />
                </Button>
              </>
            ) : null}
          </>
        )}
      </div>
      {isSmallScreen && (
        <div className="absolute left-1/2 transform -translate-x-1/2 z-10">
          <button
            className="text-green-600 dark:text-green-500 font-semibold text-sm hover:text-green-700 dark:hover:text-green-400 transition-colors cursor-pointer"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setPrimaryNoteView(null)
            }}
          >
            Im Wald
          </button>
        </div>
      )}
      <div className="shrink-0 flex gap-1 items-center">
        {showTitlebarRefresh && <RefreshButton onClick={onFeedRefresh} />}
        {setShowRelayDetails && (
          <Button
            variant="ghost"
            size="titlebar-icon"
            onClick={(e) => {
              e.stopPropagation()
              setShowRelayDetails((show) => !show)

              if (!showRelayDetails) {
                layoutRef?.current?.scrollToTop('smooth')
              }
            }}
            className={showRelayDetails ? 'bg-accent/50' : ''}
          >
            <Info />
          </Button>
        )}
        {isSmallScreen && <HelpAndAccountMenu variant="titlebar" />}
      </div>
    </div>
  )
}

