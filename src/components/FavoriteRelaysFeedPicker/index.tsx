import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { toRelaySettings } from '@/lib/link'
import { normalizeUrl, simplifyUrl } from '@/lib/url'
import { buildWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { SquarePen } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const ALL_FAVORITES_VALUE = '__all_favorites__'

function relaySetToSelectValue(id: string) {
  return `rs:${encodeURIComponent(id)}`
}

function selectValueToRelaySetId(v: string) {
  if (!v.startsWith('rs:')) return null
  return decodeURIComponent(v.slice(3))
}

/** Top-of-feed control: all favorites, Wisp trending (nostrarchives), relay sets, then single relays. */
export default function FavoriteRelaysFeedPicker() {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { push } = useSecondaryPage()
  const { favoriteRelays, blockedRelays, relaySets } = useFavoriteRelays()
  const { feedInfo, switchFeed } = useFeed()

  const openFavoriteRelaySettings = () => {
    push(toRelaySettings('favorite-relays'))
  }

  const settingsLabel = t('Relay settings')

  const urls = useMemo(
    () => getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays),
    [favoriteRelays, blockedRelays]
  )

  const wispTrendingRelayUrl = useMemo(() => buildWispTrendingNotesRelayUrl(), [])
  const wispTrendingRelayKey = useMemo(
    () => normalizeUrl(wispTrendingRelayUrl) || wispTrendingRelayUrl,
    [wispTrendingRelayUrl]
  )
  const trendingUrlInFavoriteList = useMemo(
    () => urls.some((u) => (normalizeUrl(u) || u) === wispTrendingRelayKey),
    [urls, wispTrendingRelayKey]
  )

  const currentRelayKey =
    feedInfo.feedType === 'relay' && feedInfo.id ? normalizeUrl(feedInfo.id) || feedInfo.id : null

  const allActive = feedInfo.feedType === 'all-favorites'

  const trendingRelayActive =
    feedInfo.feedType === 'relay' && currentRelayKey === wispTrendingRelayKey

  const relaySetIdActive = feedInfo.feedType === 'relays' && feedInfo.id ? feedInfo.id : null

  const orphanRelaySetId =
    relaySetIdActive && !relaySets.some((s) => s.id === relaySetIdActive) ? relaySetIdActive : null

  const selectValue = allActive
    ? ALL_FAVORITES_VALUE
    : relaySetIdActive
      ? relaySetToSelectValue(relaySetIdActive)
      : currentRelayKey
        ? currentRelayKey
        : ALL_FAVORITES_VALUE

  /** Values that exist in the mobile Select (for controlled `value` validation). */
  const selectItems = useMemo(() => {
    const items: { value: string }[] = [{ value: ALL_FAVORITES_VALUE }]
    if (!trendingUrlInFavoriteList) {
      items.push({ value: wispTrendingRelayKey })
    }
    for (const set of relaySets) {
      items.push({ value: relaySetToSelectValue(set.id) })
    }
    if (orphanRelaySetId) {
      items.push({ value: relaySetToSelectValue(orphanRelaySetId) })
    }
    for (const url of urls) {
      items.push({ value: normalizeUrl(url) || url })
    }
    if (
      !allActive &&
      feedInfo.feedType === 'relay' &&
      feedInfo.id &&
      !items.some((i) => i.value === currentRelayKey)
    ) {
      items.push({ value: normalizeUrl(feedInfo.id) || feedInfo.id })
    }
    return items
  }, [
    urls,
    allActive,
    feedInfo.feedType,
    feedInfo.id,
    currentRelayKey,
    relaySets,
    orphanRelaySetId,
    trendingUrlInFavoriteList,
    wispTrendingRelayKey
  ])

  const resolvedSelectValue = selectItems.some((i) => i.value === selectValue)
    ? selectValue
    : ALL_FAVORITES_VALUE

  const resolveRelayUrl = (value: string) => {
    if (value === ALL_FAVORITES_VALUE) return null
    const fromList = urls.find((u) => (normalizeUrl(u) || u) === value)
    return fromList ?? value
  }

  const onPickValue = (v: string) => {
    if (v === ALL_FAVORITES_VALUE) {
      void switchFeed('all-favorites')
      return
    }
    if (v === wispTrendingRelayKey) {
      void switchFeed('relay', { relay: wispTrendingRelayUrl })
      return
    }
    const setId = selectValueToRelaySetId(v)
    if (setId) {
      void switchFeed('relays', { activeRelaySetId: setId })
      return
    }
    const relay = resolveRelayUrl(v)
    if (relay) void switchFeed('relay', { relay })
  }

  if (urls.length === 0 && relaySets.length === 0) return null

  const editSettingsButton = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-9 w-9 shrink-0"
      title={settingsLabel}
      aria-label={settingsLabel}
      onClick={(e) => {
        e.stopPropagation()
        openFavoriteRelaySettings()
      }}
    >
      <SquarePen className="size-4" />
    </Button>
  )

  if (isSmallScreen) {
    return (
      <div
        className="flex w-full min-w-0 items-center gap-1.5 border-b border-border/80 bg-background px-2 py-1.5"
        aria-label={t('Favorite Relays')}
      >
        <div className="min-w-0 flex-1">
          <Select value={resolvedSelectValue} onValueChange={onPickValue}>
            <SelectTrigger className="h-9 w-full font-mono text-xs">
              <SelectValue placeholder={t('Favorite Relays')} />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[120] max-h-[min(24rem,70vh)]">
              <SelectItem value={ALL_FAVORITES_VALUE} className="text-xs">
                {t('All favorite relays')}
              </SelectItem>
              {!trendingUrlInFavoriteList ? (
                <SelectItem value={wispTrendingRelayKey} className="text-xs font-sans">
                  {t('Trending on Nostr')}
                </SelectItem>
              ) : null}
              {relaySets.length > 0 || orphanRelaySetId ? (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel className="pl-2">{t('Relay sets')}</SelectLabel>
                    {relaySets.map((set) => (
                      <SelectItem
                        key={set.id}
                        value={relaySetToSelectValue(set.id)}
                        className="text-xs font-sans"
                      >
                        {set.name}
                      </SelectItem>
                    ))}
                    {orphanRelaySetId ? (
                      <SelectItem
                        value={relaySetToSelectValue(orphanRelaySetId)}
                        className="font-mono text-xs"
                      >
                        {orphanRelaySetId}
                      </SelectItem>
                    ) : null}
                  </SelectGroup>
                </>
              ) : null}
              {urls.length > 0 ? (
                <>
                  {relaySets.length > 0 || orphanRelaySetId ? <SelectSeparator /> : null}
                  {urls.map((url) => {
                    const v = normalizeUrl(url) || url
                    return (
                      <SelectItem key={v} value={v} className="font-mono text-xs" title={url}>
                        {simplifyUrl(url)}
                      </SelectItem>
                    )
                  })}
                </>
              ) : null}
            </SelectContent>
          </Select>
        </div>
        {editSettingsButton}
      </div>
    )
  }

  return (
    <div
      className="flex w-full min-w-0 items-center gap-1.5 border-b border-border/80 bg-background px-2 py-1.5"
      role="toolbar"
      aria-label={t('Favorite Relays')}
    >
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide [scrollbar-gutter:stable]">
        <button
          type="button"
          className={cn(
            'shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
            allActive
              ? 'border-primary bg-primary/15 text-foreground'
              : 'border-border bg-muted/40 text-muted-foreground hover:bg-accent'
          )}
          onClick={() => void switchFeed('all-favorites')}
        >
          {t('All favorite relays')}
        </button>
        {!trendingUrlInFavoriteList ? (
          <button
            type="button"
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
              trendingRelayActive
                ? 'border-primary bg-primary/15 text-foreground'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-accent'
            )}
            title={wispTrendingRelayUrl}
            onClick={() => void switchFeed('relay', { relay: wispTrendingRelayUrl })}
          >
            {t('Trending on Nostr')}
          </button>
        ) : null}
        {(relaySets.length > 0 || orphanRelaySetId) && (
          <div className="mx-0.5 shrink-0 self-stretch border-l border-border/80" aria-hidden />
        )}
        {relaySets.map((set) => {
          const active = feedInfo.feedType === 'relays' && feedInfo.id === set.id
          return (
            <button
              key={set.id}
              type="button"
              className={cn(
                'max-w-[10rem] shrink-0 truncate rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                active
                  ? 'border-primary bg-primary/15 text-foreground'
                  : 'border-border bg-muted/40 text-muted-foreground hover:bg-accent'
              )}
              title={set.name}
              onClick={() => void switchFeed('relays', { activeRelaySetId: set.id })}
            >
              {set.name}
            </button>
          )
        })}
        {orphanRelaySetId ? (
          <button
            type="button"
            className={cn(
              'max-w-[10rem] shrink-0 truncate rounded-full border px-3 py-1 font-mono text-xs font-semibold transition-colors',
              'border-primary bg-primary/15 text-foreground'
            )}
            title={orphanRelaySetId}
            onClick={() => void switchFeed('relays', { activeRelaySetId: orphanRelaySetId })}
          >
            {orphanRelaySetId}
          </button>
        ) : null}
        {urls.length > 0 && (relaySets.length > 0 || orphanRelaySetId) && (
          <div className="mx-0.5 shrink-0 self-stretch border-l border-border/80" aria-hidden />
        )}
        {urls.map((url) => {
          const key = normalizeUrl(url) || url
          const active = feedInfo.feedType === 'relay' && currentRelayKey === key
          return (
            <button
              key={key}
              type="button"
              className={cn(
                'max-w-[11rem] shrink-0 truncate rounded-full border px-3 py-1 font-mono text-xs font-semibold transition-colors',
                active
                  ? 'border-primary bg-primary/15 text-foreground'
                  : 'border-border bg-muted/40 text-muted-foreground hover:bg-accent'
              )}
              title={url}
              onClick={() => void switchFeed('relay', { relay: url })}
            >
              {simplifyUrl(url)}
            </button>
          )
        })}
      </div>
      {editSettingsButton}
    </div>
  )
}
