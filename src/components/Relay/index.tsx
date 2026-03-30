import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import RelayInfo from '@/components/RelayInfo'
import SearchInput from '@/components/SearchInput'
import { useFetchRelayInfo } from '@/hooks'
import type { TPrimaryPageName } from '@/PageManager'
import { SINGLE_RELAY_KINDLESS_REQ_LIMIT } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import client, { JUMBLE_SESSION_RELAY_STRIKES_CHANGED } from '@/services/client.service'
import type { TFeedSubRequest } from '@/types'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

  const strikeThreshold = client.getSessionRelayFailureStrikeThreshold()
  const readStrikeCount = useCallback(() => {
    if (!normalizedUrl) return 0
    return client.getSessionRelayStrikeCountForUrl(normalizedUrl)
  }, [normalizedUrl])
  const [strikeCount, setStrikeCount] = useState(0)

  useEffect(() => {
    setStrikeCount(readStrikeCount())
  }, [readStrikeCount])

  useEffect(() => {
    const sync = () => setStrikeCount(readStrikeCount())
    window.addEventListener(JUMBLE_SESSION_RELAY_STRIKES_CHANGED, sync)
    return () => window.removeEventListener(JUMBLE_SESSION_RELAY_STRIKES_CHANGED, sync)
  }, [readStrikeCount])

  useEffect(() => {
    if (normalizedUrl) {
      addRelayUrls([normalizedUrl])
      return () => {
        removeRelayUrls([normalizedUrl])
      }
    }
  }, [normalizedUrl])

  /**
   * Session strikes skip a relay for reads until cleared. Refresh in the titlebar already clears; without this,
   * opening the panel on a striked relay subscribed too late or showed an empty feed while the banner confused users.
   * Runs after child effects so the NoteList ref is ready for {@link refresh}.
   */
  useEffect(() => {
    if (!normalizedUrl) return
    if (!client.clearSessionRelayStrikeForUrl(normalizedUrl)) return
    setStrikeCount(0)
    if (typeof noteListRef !== 'function') {
      noteListRef.current?.refresh()
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

  const relayFeedSubRequests = useMemo<TFeedSubRequest[]>(() => {
    if (!normalizedUrl) return []
    const q = debouncedInput.trim()
    return [
      {
        urls: [normalizedUrl],
        filter: q
          ? { search: q, limit: SINGLE_RELAY_KINDLESS_REQ_LIMIT }
          : { limit: SINGLE_RELAY_KINDLESS_REQ_LIMIT }
      }
    ]
  }, [normalizedUrl, debouncedInput])

  if (!normalizedUrl) {
    return <NotFound />
  }

  return (
    <div className={className}>
      <RelayInfo url={normalizedUrl} className="pt-3" />
      {strikeCount > 0 ? (
        <div
          className="mx-4 mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground dark:border-amber-400/35"
          role="status"
        >
          <p className="font-medium">
            {strikeCount >= strikeThreshold
              ? t('relaySessionStrikes.bannerSkipped', { threshold: strikeThreshold })
              : t('relaySessionStrikes.bannerWarning', {
                  count: strikeCount,
                  threshold: strikeThreshold
                })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('relaySessionStrikes.refreshHint', { refresh: t('Refresh') })}
          </p>
        </div>
      ) : null}
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
        subRequests={relayFeedSubRequests}
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
