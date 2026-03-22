import LatestFromFollowsSection from '@/components/LatestFromFollowsSection'
import { RefreshButton } from '@/components/RefreshButton'
import SearchBar, { TSearchBarRef } from '@/components/SearchBar'
import SearchResult from '@/components/SearchResult'
import PrimaryPageLayout, { TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { usePrimaryPage } from '@/PageManager'
import { TPageRef, TSearchParams } from '@/types'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

const SearchPage = forwardRef<TPageRef>((_, ref) => {
  const { current, display } = usePrimaryPage()
  const [input, setInput] = useState('')
  const [searchParams, setSearchParams] = useState<TSearchParams | null>(null)
  const [resultRefreshKey, setResultRefreshKey] = useState(0)
  const isActive = useMemo(() => current === 'search' && display, [current, display])
  const searchBarRef = useRef<TSearchBarRef>(null)
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)

  const bumpResults = useCallback(() => setResultRefreshKey((k) => k + 1), [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior: ScrollBehavior = 'smooth') => layoutRef.current?.scrollToTop(behavior),
      refresh: bumpResults
    }),
    [bumpResults]
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

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="search"
      titlebar={null}
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-4 px-4 pb-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="text-2xl font-bold">Search Nostr</div>
          <RefreshButton onClick={bumpResults} />
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4 relative z-40">
          <div className="flex-1 relative order-2 sm:order-1">
            <SearchBar ref={searchBarRef} onSearch={onSearch} input={input} setInput={setInput} />
          </div>
          <div className="flex-shrink-0 relative z-50 w-full sm:w-auto order-1 sm:order-2">
            <Button
              variant="ghost"
              className="h-9 shrink-0 text-muted-foreground hover:text-foreground border border-border/50 hover:border-border rounded-md px-3 gap-2 w-full sm:w-auto"
              asChild
            >
              <a
                href="https://next-alexandria.gitcitadel.eu/events"
                target="_blank"
                rel="noopener noreferrer"
              >
                <BookOpen className="h-4 w-4" />
                <span className="text-sm">Search on Alexandria</span>
              </a>
            </Button>
          </div>
        </div>
        <div className="h-4"></div>
        <div key={resultRefreshKey} className="min-w-0">
          {searchParams ? (
            <SearchResult searchParams={searchParams} />
          ) : (
            <div className="mb-4 min-w-0 space-y-2">
              <LatestFromFollowsSection />
              <SearchResult searchParams={null} />
            </div>
          )}
        </div>
      </div>
    </PrimaryPageLayout>
  )
})
SearchPage.displayName = 'SearchPage'
export default SearchPage
