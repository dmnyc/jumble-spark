import RelaySimpleInfo, { RelaySimpleInfoSkeleton } from '@/components/RelaySimpleInfo'
import { Button } from '@/components/ui/button'
import { DEFAULT_FAVORITE_RELAYS } from '@/constants'
import { useFetchRelayInfo } from '@/hooks'
import { toRelay } from '@/lib/link'
import { normalizeUrl, simplifyUrl } from '@/lib/url'
import { usePrimaryPage, useSmartRelayNavigation } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { cn } from '@/lib/utils'
import { Newspaper } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

function FavoriteRelayCard({ url }: { url: string }) {
  const { navigateToRelay } = useSmartRelayNavigation()
  const { relayInfo, isFetching } = useFetchRelayInfo(url)

  if (isFetching) {
    return (
      <RelaySimpleInfoSkeleton className="h-full min-h-[5.5rem] rounded-lg border bg-card p-3 shadow-sm" />
    )
  }

  if (!relayInfo) {
    return (
      <button
        type="button"
        className={cn(
          'clickable flex h-full min-h-[5.5rem] min-w-[220px] max-w-[280px] shrink-0 flex-col justify-center rounded-lg border bg-card p-3 text-left shadow-sm',
          'transition-colors hover:bg-accent/40'
        )}
        onClick={() => navigateToRelay(toRelay(url))}
      >
        <div className="truncate font-mono text-sm font-semibold">{simplifyUrl(url)}</div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{url}</div>
      </button>
    )
  }

  return (
    <RelaySimpleInfo
      relayInfo={relayInfo}
      className={cn(
        'clickable h-full min-h-[5.5rem] min-w-[220px] max-w-[280px] shrink-0 rounded-lg border bg-card p-3 shadow-sm',
        'transition-colors hover:bg-accent/40'
      )}
      onClick={(e) => {
        e.stopPropagation()
        navigateToRelay(toRelay(relayInfo.url))
      }}
    />
  )
}

/**
 * Horizontal strip of favorite relays (non-blocked), or {@link DEFAULT_FAVORITE_RELAYS} when none.
 */
export default function ExploreFavoriteRelays() {
  const { t } = useTranslation()
  const { navigate } = usePrimaryPage()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()

  const blockedSet = useMemo(
    () => new Set(blockedRelays.map((b) => normalizeUrl(b) || b)),
    [blockedRelays]
  )

  const { urls, usingDefaults } = useMemo(() => {
    const visible = favoriteRelays.filter((r) => {
      const k = normalizeUrl(r) || r
      return k && !blockedSet.has(k)
    })
    if (visible.length > 0) {
      return { urls: visible, usingDefaults: false }
    }
    const defaultsFiltered = DEFAULT_FAVORITE_RELAYS.filter((r) => {
      const k = normalizeUrl(r) || r
      return k && !blockedSet.has(k)
    })
    return {
      urls: defaultsFiltered.length > 0 ? defaultsFiltered : DEFAULT_FAVORITE_RELAYS,
      usingDefaults: true
    }
  }, [favoriteRelays, blockedSet])

  if (urls.length === 0) return null

  return (
    <section className="min-w-0 px-2 pb-4 pt-1" aria-label={t('Favorite Relays')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">{t('Favorite Relays')}</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 font-medium"
            onClick={() => navigate('feed')}
          >
            <Newspaper className="size-4 shrink-0" strokeWidth={2.5} />
            <span>{t('Favorites Feed')}</span>
          </Button>
        </div>
        {usingDefaults ? (
          <span className="text-xs text-muted-foreground">{t('Using app default relays')}</span>
        ) : null}
      </div>
      <div className="flex gap-3 overflow-x-auto overflow-y-hidden pb-1 pt-0.5 [scrollbar-gutter:stable] snap-x snap-mandatory">
        {urls.map((url) => (
          <div key={url} className="snap-start">
            <FavoriteRelayCard url={url} />
          </div>
        ))}
      </div>
    </section>
  )
}
