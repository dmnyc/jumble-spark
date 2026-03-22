import LatestFromFollowsSection from '@/components/LatestFromFollowsSection'
import { RefreshButton } from '@/components/RefreshButton'
import SearchBar, { TSearchBarRef } from '@/components/SearchBar'
import SearchResult from '@/components/SearchResult'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toSearch } from '@/lib/link'
import { parseAdvancedSearch } from '@/lib/search-parser'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { usePrimaryNoteView, useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { TSearchParams } from '@/types'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SearchPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { push } = useSecondaryPage()
  const { pubkey, relayList } = useNostr()
  const [resultRefreshKey, setResultRefreshKey] = useState(0)
  const bumpResults = useCallback(() => {
    void (async () => {
      await syncUserDeletionTombstones(pubkey, relayList)
      setResultRefreshKey((k) => k + 1)
    })()
  }, [pubkey, relayList])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpResults)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bumpResults])
  const [input, setInput] = useState('')
  const searchBarRef = useRef<TSearchBarRef>(null)
  const searchParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const type = params.get('t')
    if (
      type !== 'profile' &&
      type !== 'profiles' &&
      type !== 'notes' &&
      type !== 'hashtag' &&
      type !== 'relay'
    ) {
      return null
    }
    const search = params.get('q')
    if (!search) {
      return null
    }
    const input = params.get('i') ?? ''
    setInput(input || search)
    return { type, search, input } as TSearchParams
  }, [])

  useEffect(() => {
    if (!window.location.search) {
      searchBarRef.current?.focus()
    }
  }, [])

  const onSearch = (params: TSearchParams | null) => {
    if (params) {
      // Check if this is a 'notes' search that contains advanced search parameters
      if (params.type === 'notes' && params.search) {
        const searchParams = parseAdvancedSearch(params.search)
        
        // Check if we have advanced search parameters (not just plain text)
        // Exclude unsupported multi-letter tag params (title, subject, description, author, type)
        const hasAdvancedParams = Object.keys(searchParams).some(key => 
          key !== 'dtag' && 
          key !== 'title' && 
          key !== 'subject' && 
          key !== 'description' && 
          key !== 'author' && 
          key !== 'type' &&
          searchParams[key as keyof typeof searchParams]
        )
        
        // Handle hashtag search - route to hashtag page
        if (searchParams.hashtag) {
          const hashtag = Array.isArray(searchParams.hashtag) ? searchParams.hashtag[0] : searchParams.hashtag
          const urlParams = new URLSearchParams()
          urlParams.set('t', hashtag)
          // Note: Kind filter only available as URL parameter k=, not from search parser
          push(`/notes?${urlParams.toString()}`)
          return
        }
        
        if (hasAdvancedParams || searchParams.dtag) {
          // Route to NoteListPage with advanced search
          // Note: Only include parameters that Nostr relays actually support
          // (single-letter tag indexes: #d, #t, #p, #e, #a, etc.)
          const urlParams = new URLSearchParams()
          if (searchParams.dtag) {
            urlParams.set('d', searchParams.dtag)
          }
          // Skip title, subject, description, author, type - these use multi-letter tags
          // that Nostr relays don't index
          // Note: Bare event IDs are handled as standard search, not as filter params
          // Date searches and pubkey filters removed - not supported
          // Kind filter only available as URL parameter k=, not from search parser
          
          push(`/notes?${urlParams.toString()}`)
          return
        }
      }
      
      // Default behavior - route to SearchPage
      push(toSearch(params))
    }
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : "Search"}
      hideBackButton={hideTitlebar}
      controls={hideTitlebar ? undefined : <RefreshButton onClick={bumpResults} />}
      displayScrollToTopButton
    >
      <div className="px-4 pt-4">
        <div className="mb-4">
          <div className="text-2xl font-bold">Search Nostr</div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4 relative z-40">
          <div className="flex-1 relative order-2 sm:order-1">
            <SearchBar ref={searchBarRef} input={input} setInput={setInput} onSearch={onSearch} />
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
    </SecondaryPageLayout>
  )
})
SearchPage.displayName = 'SearchPage'
export default SearchPage
