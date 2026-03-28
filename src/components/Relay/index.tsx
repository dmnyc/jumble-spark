import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import RelayInfo from '@/components/RelayInfo'
import SearchInput from '@/components/SearchInput'
import { useFetchRelayInfo } from '@/hooks'
import type { TPrimaryPageName } from '@/PageManager'
import { normalizeUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NotFound from '../NotFound'

const Relay = forwardRef<
  TNoteListRef,
  { url?: string; className?: string; hostPrimaryPageName?: TPrimaryPageName }
>(function Relay({ url, className, hostPrimaryPageName }, ref) {
  const { t } = useTranslation()
  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  const normalizedUrl = useMemo(() => (url ? normalizeUrl(url) : undefined), [url])
  const { relayInfo } = useFetchRelayInfo(normalizedUrl)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedInput, setDebouncedInput] = useState(searchInput)
  const internalNoteListRef = useRef<TNoteListRef>(null)
  const noteListRef = ref ?? internalNoteListRef

  useEffect(() => {
    if (normalizedUrl) {
      addRelayUrls([normalizedUrl])
      return () => {
        removeRelayUrls([normalizedUrl])
      }
    }
  }, [normalizedUrl])

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedInput(searchInput)
    }, 1000)

    return () => {
      clearTimeout(handler)
    }
  }, [searchInput])

  // Listen for refresh events when user publishes to this relay
  useEffect(() => {
    if (!normalizedUrl) return

    const handleRelayRefresh = (event: CustomEvent) => {
      const { relayUrl } = event.detail
      if (normalizeUrl(relayUrl) === normalizedUrl) {
        if (noteListRef && typeof noteListRef !== 'function') {
          noteListRef.current?.refresh()
        }
      }
    }

    window.addEventListener('relay-refresh-needed', handleRelayRefresh as EventListener)
    
    return () => {
      window.removeEventListener('relay-refresh-needed', handleRelayRefresh as EventListener)
    }
  }, [normalizedUrl, noteListRef])

  if (!normalizedUrl) {
    return <NotFound />
  }

  return (
    <div className={className}>
      <RelayInfo url={normalizedUrl} className="pt-3" />
      {relayInfo?.supported_nips?.includes(50) && (
        <div className="px-4 py-2">
          <SearchInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('Search')}
          />
        </div>
      )}
      <NormalFeed
        ref={noteListRef}
        subRequests={[
          { urls: [normalizedUrl], filter: debouncedInput ? { search: debouncedInput } : {} }
        ]}
        useFilterAsIs
        allowKindlessRelayExplore
        showFeedClientFilter
        hostPrimaryPageName={hostPrimaryPageName}
      />
    </div>
  )
})

Relay.displayName = 'Relay'
export default Relay
