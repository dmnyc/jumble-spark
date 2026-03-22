import Explore from '@/components/Explore'
import ExploreFavoriteRelays from '@/components/Explore/ExploreFavoriteRelays'
import ExploreRelayReviews from '@/components/Explore/ExploreRelayReviews'
import FollowingFavoriteRelayList from '@/components/FollowingFavoriteRelayList'
import Tabs from '@/components/Tabs'
import VersionUpdateBanner from '@/components/VersionUpdateBanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toRelay } from '@/lib/link'
import { cn } from '@/lib/utils'
import { isWebsocketUrl, normalizeUrl, simplifyUrl } from '@/lib/url'
import { RefreshButton } from '@/components/RefreshButton'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { useSmartRelayNavigation } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import nip66Service from '@/services/nip66.service'
import { TPageRef } from '@/types'
import { ArrowRight, Compass, Plus } from 'lucide-react'
import {
  forwardRef,
  FormEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const RELAY_SUGGESTION_LIMIT = 20

function dedupeNormalizedRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const k = normalizeUrl(u) || u
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** Lower rank = better match for ordering suggestions. */
function relaySuggestionRank(normalizedUrl: string, queryLower: string): number {
  const n = normalizedUrl.toLowerCase()
  const simple = simplifyUrl(n).toLowerCase()
  if (!queryLower) return 99
  if (n === queryLower || simple === queryLower) return 0
  if (simple.startsWith(queryLower) || n.startsWith(`wss://${queryLower}`) || n.startsWith(`ws://${queryLower}`))
    return 1
  if (simple.includes(queryLower) || n.includes(queryLower)) return 2
  return 99
}

function filterMonitoringRelaySuggestions(urls: string[], rawQuery: string): string[] {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return []
  const matches = urls.filter((url) => relaySuggestionRank(url, q) < 99)
  matches.sort((a, b) => {
    const ra = relaySuggestionRank(a, q)
    const rb = relaySuggestionRank(b, q)
    if (ra !== rb) return ra - rb
    return simplifyUrl(a).localeCompare(simplifyUrl(b), undefined, { sensitivity: 'base' })
  })
  return matches.slice(0, RELAY_SUGGESTION_LIMIT)
}

type TExploreTabs = 'explore' | 'reviews' | 'following'

function normalizeHomeTab(restored: string): TExploreTabs {
  if (restored === 'following') return 'following'
  if (restored === 'reviews') return 'reviews'
  // Removed "favorites" tab — treat saved state as Explore
  return 'explore'
}

const ExplorePage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { pubkey, relayList } = useNostr()
  const [tab, setTab] = useState<TExploreTabs>('explore')
  const layoutRef = useRef<TPageRef>(null)
  const [contentRefreshKey, setContentRefreshKey] = useState(0)

  const bumpExploreContent = useCallback(() => {
    void (async () => {
      await syncUserDeletionTombstones(pubkey, relayList)
      setContentRefreshKey((k) => k + 1)
    })()
  }, [pubkey, relayList])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: bumpExploreContent
    }),
    [bumpExploreContent]
  )

  // Listen for tab restoration from PageManager
  useEffect(() => {
    const handleRestore = (e: CustomEvent<{ page: string; tab: string }>) => {
      if (e.detail.page === 'explore' && e.detail.tab) {
        setTab(normalizeHomeTab(e.detail.tab))
      }
    }
    window.addEventListener('restorePageTab', handleRestore as EventListener)
    return () => window.removeEventListener('restorePageTab', handleRestore as EventListener)
  }, [])

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="explore"
      titlebar={<ExplorePageTitlebar onRefresh={bumpExploreContent} />}
      subHeader={
        <Tabs
          value={tab}
          tabs={[
            { value: 'explore', label: t('Explore') },
            { value: 'reviews', label: t('Relay reviews') },
            { value: 'following', label: t("Following's Favorites") }
          ]}
          onTabChange={(next) => {
            setTab(next as TExploreTabs)
            window.dispatchEvent(
              new CustomEvent('pageTabChanged', {
                detail: { page: 'explore', tab: next }
              })
            )
          }}
        />
      }
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-2">
        <div className="px-2">
          <VersionUpdateBanner />
        </div>
        {tab === 'explore' && (
          <div key={contentRefreshKey} className="min-w-0">
            <ExploreFavoriteRelays />
            <ExploreRelaySearchSection />
            <Explore />
          </div>
        )}
        {tab === 'reviews' && (
          <div key={contentRefreshKey} className="min-w-0">
            <ExploreRelayReviews />
          </div>
        )}
        {tab === 'following' && (
          <div key={contentRefreshKey} className="min-w-0">
            <FollowingFavoriteRelayList />
          </div>
        )}
      </div>
    </PrimaryPageLayout>
  )
})
ExplorePage.displayName = 'ExplorePage'
export default ExplorePage

function ExplorePageTitlebar({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-w-0 w-full items-center justify-between gap-2 px-2 py-1 sm:pl-3 sm:pr-2">
      <div className="flex shrink-0 items-center gap-2">
        <Compass className="size-5 shrink-0" />
        <div className="text-lg font-semibold">{t('Explore')}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <RefreshButton onClick={onRefresh} />
      <Button
        variant="ghost"
        size="titlebar-icon"
        className="relative w-fit shrink-0 px-3"
        onClick={() => {
          window.open(
            'https://github.com/CodyTseng/awesome-nostr-relays/issues/new?template=add-relay.md',
            '_blank'
          )
        }}
      >
        <Plus size={16} />
        {t('Submit Relay')}
      </Button>
      </div>
    </div>
  )
}

function ExploreRelaySearchSection() {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const [relayQuery, setRelayQuery] = useState('')
  const [monitoringRelays, setMonitoringRelays] = useState<string[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const blurCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    nip66Service.getPublicLivelyRelayUrls().then((urls) => {
      setMonitoringRelays(dedupeNormalizedRelayUrls(urls ?? []))
    })
  }, [])

  useEffect(() => {
    return () => {
      if (blurCloseTimer.current != null) clearTimeout(blurCloseTimer.current)
    }
  }, [])

  const relaySuggestions = useMemo(
    () => filterMonitoringRelaySuggestions(monitoringRelays, relayQuery),
    [monitoringRelays, relayQuery]
  )

  const clearBlurTimer = () => {
    if (blurCloseTimer.current != null) {
      clearTimeout(blurCloseTimer.current)
      blurCloseTimer.current = null
    }
  }

  const openRelayAndReset = (normalizedUrl: string) => {
    navigateToRelay(toRelay(normalizedUrl))
    setRelayQuery('')
    setSuggestOpen(false)
  }

  const tryOpenRelay = () => {
    const trimmed = relayQuery.trim()
    if (!trimmed) return
    const normalized = normalizeUrl(trimmed)
    if (!normalized || !isWebsocketUrl(normalized)) {
      toast.error(t('invalid relay URL'))
      return
    }
    openRelayAndReset(normalized)
  }

  const onSubmitRelay = (e: FormEvent) => {
    e.preventDefault()
    tryOpenRelay()
  }

  return (
    <section className="min-w-0 px-2 pb-4 pt-0" aria-label={t('Search for Relays')}>
      <h2 className="mb-2 px-2 text-base font-semibold tracking-tight">{t('Search for Relays')}</h2>
      <div className="max-w-xl px-2">
        <form className="flex items-center gap-1.5" onSubmit={onSubmitRelay}>
          <div className="relative min-w-0 flex-1">
            <Input
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder={t('Relay URL…')}
              className="h-9 w-full font-mono text-sm"
              value={relayQuery}
              onChange={(e) => setRelayQuery(e.target.value)}
              aria-label={t('Relay URL…')}
              aria-autocomplete="list"
              aria-expanded={suggestOpen && relaySuggestions.length > 0}
              aria-controls="explore-relay-suggestions"
              role="combobox"
              onFocus={() => {
                clearBlurTimer()
                setSuggestOpen(true)
              }}
              onBlur={() => {
                clearBlurTimer()
                blurCloseTimer.current = setTimeout(() => setSuggestOpen(false), 200)
              }}
            />
            {suggestOpen && relaySuggestions.length > 0 ? (
              <ul
                id="explore-relay-suggestions"
                role="listbox"
                className={cn(
                  'absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md'
                )}
                onMouseDown={(e) => e.preventDefault()}
              >
                {relaySuggestions.map((url) => (
                  <li key={url} role="presentation">
                    <button
                      type="button"
                      role="option"
                      className="flex w-full flex-col items-stretch gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                      onClick={() => openRelayAndReset(url)}
                    >
                      <span className="truncate font-mono">{simplifyUrl(url)}</span>
                      <span className="truncate text-xs text-muted-foreground">{url}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button
            type="submit"
            variant="secondary"
            size="icon"
            className="h-9 w-9 shrink-0"
            title={t('Open relay')}
          >
            <ArrowRight className="size-4" />
          </Button>
        </form>
      </div>
    </section>
  )
}
