import SearchBar, { TSearchBarRef } from '@/components/SearchBar'
import SearchResult from '@/components/SearchResult'
import PrimaryPageLayout, { TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { usePrimaryPage } from '@/PageManager'
import { TSearchParams } from '@/types'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

const SearchPage = forwardRef((_, ref) => {
  const { current, display } = usePrimaryPage()
  const [input, setInput] = useState('')
  const [searchParams, setSearchParams] = useState<TSearchParams | null>(null)
  const isActive = useMemo(() => current === 'search' && display, [current, display])
  const searchBarRef = useRef<TSearchBarRef>(null)
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)

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

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="search"
      titlebar={null}
      displayScrollToTopButton
    >
      <div className="px-4 pt-4">
        <div className="text-2xl font-bold mb-4">Search Nostr</div>
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
        <SearchResult searchParams={searchParams} />
      </div>
    </PrimaryPageLayout>
  )
})
SearchPage.displayName = 'SearchPage'
export default SearchPage
