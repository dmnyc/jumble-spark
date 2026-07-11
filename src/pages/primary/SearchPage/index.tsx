import Explore from '@/components/Explore'
import FollowingFavoriteRelayList from '@/components/FollowingFavoriteRelayList'
import MobileMeDrawerButton from '@/components/MobileMeDrawerButton'
import NoteList from '@/components/NoteList'
import SearchBar, { TSearchBarRef } from '@/components/SearchBar'
import SearchHistory from '@/components/SearchHistory'
import SearchResult from '@/components/SearchResult'
import Tabs from '@/components/Tabs'
import TrendingNotes from '@/components/TrendingNotes'
import { ExtendedKind } from '@/constants'
import PrimaryPageLayout, { TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { getReplaceableEventIdentifier } from '@/lib/event'
import { getDefaultRelayUrls } from '@/lib/relay'
import { isLocalNetworkUrl, isOnionUrl, isWebsocketUrl } from '@/lib/url'
import { usePrimaryPage } from '@/PageManager'
import storage from '@/services/local-storage.service'
import { TPageRef, TSearchParams } from '@/types'
import { NostrEvent } from 'nostr-tools'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'

type TSearchTab = 'discover' | 'explore' | 'reviews' | 'following'

const SEARCH_TABS = [
  { value: 'discover', label: 'Discover' },
  { value: 'explore', label: 'Explore Relays' },
  { value: 'reviews', label: 'Relay Reviews' },
  { value: 'following', label: "Following's Favorites" }
]

const SearchPage = forwardRef<TPageRef>((_, ref) => {
  const { current } = usePrimaryPage()
  const [input, setInput] = useState('')
  const [searchParams, setSearchParams] = useState<TSearchParams | null>(null)
  const [tab, setTab] = useState<TSearchTab>('discover')
  const [searchHistory, setSearchHistory] = useState<string[]>(() => storage.getSearchHistory())
  const isActive = useMemo(() => current === 'search', [current])
  const searchBarRef = useRef<TSearchBarRef>(null)
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)
  const topRef = useRef<HTMLDivElement | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior: ScrollBehavior = 'smooth') => layoutRef.current?.scrollToTop(behavior)
    }),
    []
  )

  useEffect(() => {
    if (isActive && !searchParams) {
      searchBarRef.current?.focus()
    }
  }, [isActive, searchParams])

  const onSearch = (params: TSearchParams | null) => {
    setSearchParams(params)
    if (params?.input) {
      setInput(params.input)
    }
    layoutRef.current?.scrollToTop('instant')
  }

  const addSearchHistory = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    storage.addSearchHistory(trimmed)
    setSearchHistory(storage.getSearchHistory())
  }, [])

  const removeSearchHistory = useCallback((index: number) => {
    storage.removeSearchHistory(index)
    setSearchHistory(storage.getSearchHistory())
  }, [])

  const clearSearchHistory = useCallback(() => {
    storage.clearSearchHistory()
    setSearchHistory([])
  }, [])

  const handleHistorySelect = useCallback((text: string) => {
    setInput(text)
    searchBarRef.current?.focus()
  }, [])

  const relayReviewFilterFn = useCallback((evt: NostrEvent) => {
    const d = getReplaceableEventIdentifier(evt)
    if (!d) return false
    if (!isWebsocketUrl(d)) return false
    if (isLocalNetworkUrl(d)) return false
    if (storage.getFilterOutOnionRelays() && isOnionUrl(d)) return false
    return true
  }, [])

  const tabContent = useMemo(() => {
    switch (tab) {
      case 'discover':
        return (
          <>
            <SearchHistory
              history={searchHistory}
              onSelect={handleHistorySelect}
              onRemove={removeSearchHistory}
              onClear={clearSearchHistory}
            />
            <TrendingNotes />
          </>
        )
      case 'explore':
        return <Explore />
      case 'reviews':
        return (
          <NoteList
            showKinds={[ExtendedKind.RELAY_REVIEW]}
            subRequests={[{ urls: getDefaultRelayUrls(), filter: {} }]}
            filterFn={relayReviewFilterFn}
            filterMutedNotes
            hideSpam
          />
        )
      case 'following':
        return <FollowingFavoriteRelayList />
    }
  }, [
    tab,
    relayReviewFilterFn,
    searchHistory,
    handleHistorySelect,
    removeSearchHistory,
    clearSearchHistory
  ])

  const searchBar = (
    <SearchBar
      ref={searchBarRef}
      onSearch={onSearch}
      input={input}
      setInput={setInput}
      onSaveHistory={addSearchHistory}
    />
  )

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="search"
      titlebar={searchBar}
      mobileTitlebar={
        <div className="flex h-full w-full items-center gap-1 pe-2">
          <MobileMeDrawerButton />
          <div className="h-full min-w-0 flex-1">{searchBar}</div>
        </div>
      }
      displayScrollToTopButton
    >
      {searchParams ? (
        <SearchResult searchParams={searchParams} />
      ) : (
        <>
          <Tabs
            value={tab}
            tabs={SEARCH_TABS}
            onTabChange={(t) => {
              setTab(t as TSearchTab)
              topRef.current?.scrollIntoView({ behavior: 'instant' })
            }}
          />
          <div ref={topRef} className="scroll-mt-24.25" />
          {tabContent}
        </>
      )}
    </PrimaryPageLayout>
  )
})
SearchPage.displayName = 'SearchPage'
export default SearchPage
