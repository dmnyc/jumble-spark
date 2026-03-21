import BookmarkList from '@/components/BookmarkList'
import RelayInfo from '@/components/RelayInfo'
import VersionUpdateBanner from '@/components/VersionUpdateBanner'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TPageRef } from '@/types'
import { Info } from 'lucide-react'
import React, {
  Dispatch,
  forwardRef,
  SetStateAction,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardShortcutsHelpButton } from '@/components/KeyboardShortcutsHelp'
import AccountButton from '@/components/Titlebar/AccountButton'
import FollowingFeed from './FollowingFeed'
import RelaysFeed from './RelaysFeed'
import { usePrimaryNoteView } from '@/PageManager'

const NoteListPage = forwardRef((_, ref) => {
  const { t } = useTranslation()
  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  const layoutRef = useRef<TPageRef>(null)
  const { pubkey, checkLogin } = useNostr()
  const { feedInfo, relayUrls, isReady } = useFeed()
  const [showRelayDetails, setShowRelayDetails] = useState(false)
  const [homeSubHeader, setHomeSubHeader] = useState<React.ReactNode>(null)
  useImperativeHandle(ref, () => layoutRef.current)

  const setHomeSubHeaderStable = useCallback((node: React.ReactNode) => {
    setHomeSubHeader(node)
  }, [])

  // Clear subHeader when switching to a feed that doesn't use it (e.g. bookmarks)
  useEffect(() => {
    const usesSubHeader =
      feedInfo.feedType === 'relay' ||
      feedInfo.feedType === 'relays' ||
      feedInfo.feedType === 'all-favorites' ||
      feedInfo.feedType === 'following'
    if (!usesSubHeader) setHomeSubHeader(null)
  }, [feedInfo.feedType])

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
    content = <div className="text-center text-sm text-muted-foreground">{t('loading...')}</div>
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
      content = <BookmarkList />
    }
  } else if (feedInfo.feedType === 'following') {
    content = <FollowingFeed setSubHeader={setHomeSubHeaderStable} />
  } else {
    content = (
      <>
        {showRelayDetails && feedInfo.feedType === 'relay' && !!feedInfo.id && (
          <RelayInfo url={feedInfo.id!} className="mb-2 pt-3" />
        )}
        <RelaysFeed setSubHeader={setHomeSubHeaderStable} />
      </>
    )
  }

  return (
    <PrimaryPageLayout
      pageName="feed"
      ref={layoutRef}
      titlebar={
        <NoteListPageTitlebar
          layoutRef={layoutRef}
          showRelayDetails={showRelayDetails}
          setShowRelayDetails={
            feedInfo.feedType === 'relay' && !!feedInfo.id ? setShowRelayDetails : undefined
          }
        />
      }
      subHeader={homeSubHeader ?? undefined}
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-2">
        <VersionUpdateBanner />
        {content}
      </div>
    </PrimaryPageLayout>
  )
})
NoteListPage.displayName = 'NoteListPage'
export default NoteListPage

function NoteListPageTitlebar({
  layoutRef,
  showRelayDetails,
  setShowRelayDetails
}: {
  layoutRef?: React.RefObject<TPageRef>
  showRelayDetails?: boolean
  setShowRelayDetails?: Dispatch<SetStateAction<boolean>>
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { setPrimaryNoteView } = usePrimaryNoteView()
  return (
    <div className="relative flex gap-1 items-center h-full justify-between">
      <div className="flex gap-2 items-center h-full pl-3">
        <div className="text-lg font-semibold">{t('Favorites Feed')}</div>
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
        <KeyboardShortcutsHelpButton />
        <AccountButton />
      </div>
    </div>
  )
}

