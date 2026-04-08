import { useFetchProfile } from '@/hooks/useFetchProfile'
import { LIVE_ACTIVITIES_SLIDE_INTERVAL_MS } from '@/lib/live-activities'
import { cn } from '@/lib/utils'
import { useLiveActivitiesOptional } from '@/providers/LiveActivitiesProvider'
import { useUserPreferencesOptional } from '@/providers/UserPreferencesProvider'
import storage from '@/services/local-storage.service'
import { ExternalLink, Radio } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

function FollowedHostName({ pubkey }: { pubkey: string }) {
  const { profile } = useFetchProfile(pubkey)
  const name = profile?.username
  if (!name) return null
  return (
    <p className="mt-1 text-[10px] text-green-600 dark:text-green-500">
      {name}
    </p>
  )
}

type TPlacement = 'sidebar' | 'mobile'

export default function LiveActivitiesStrip({ placement }: { placement: TPlacement }) {
  const { t } = useTranslation()
  const userPrefs = useUserPreferencesOptional()
  const showLiveActivitiesBanner =
    userPrefs?.showLiveActivitiesBanner ?? storage.getShowLiveActivitiesBanner()
  const live = useLiveActivitiesOptional()
  const items = live?.items ?? []

  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduceMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const [slide, setSlide] = useState(0)
  const [blink, setBlink] = useState(false)

  useEffect(() => {
    setSlide(0)
  }, [items])

  useEffect(() => {
    if (items.length <= 1) return
    setBlink(true)
    const id = setTimeout(() => setBlink(false), 600)
    return () => clearTimeout(id)
  }, [slide, items.length])

  useEffect(() => {
    if (items.length <= 1 || reduceMotion) return
    const id = window.setInterval(() => {
      setSlide((s) => (s + 1) % items.length)
    }, LIVE_ACTIVITIES_SLIDE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [items.length, reduceMotion])

  useLayoutEffect(() => {
    if (items.length === 0) return
    setSlide((s) => Math.min(s, items.length - 1))
  }, [items.length])

  const goNext = useCallback(() => {
    setSlide((s) => (s + 1) % items.length)
  }, [items.length])

  const goPrev = useCallback(() => {
    setSlide((s) => (s - 1 + items.length) % items.length)
  }, [items.length])

  // Swipe support
  const touchStartX = useRef<number | null>(null)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }, [])
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return
      const delta = e.changedTouches[0].clientX - touchStartX.current
      touchStartX.current = null
      if (Math.abs(delta) < 30) return
      if (delta < 0) goNext()
      else goPrev()
    },
    [goNext, goPrev]
  )

  if (!showLiveActivitiesBanner) {
    return null
  }

  const loading = live?.loading ?? false
  // `items` can shrink without a new array identity; `slide` may then be out of range until effects run.
  const displayIndex = Math.min(slide, items.length - 1)
  const current = items.length > 0 ? items[displayIndex] : null

  return (
    <div
      className={cn(
        placement === 'sidebar' &&
          'mb-2 rounded-lg border border-border/80 bg-muted/50 p-2 shadow-sm dark:bg-muted/30',
        placement === 'mobile' && 'w-full shrink-0 border-b border-border/80 bg-muted/50 px-2 py-2 dark:bg-muted/30'
      )}
      role="region"
      aria-label={t('liveActivities.regionLabel')}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground xl:text-xs">
        <span className={cn(
          'inline-block size-2 rounded-full transition-opacity duration-300',
          current ? 'bg-red-500' : 'bg-muted-foreground/40',
          blink && current ? 'opacity-30' : 'opacity-100'
        )} />
        {t('liveActivities.heading')}
      </div>
      {items.length > 1 ? (
        <>
          <div className="mb-1.5 flex items-center justify-center gap-2">
            <button
              type="button"
              aria-label={t('liveActivities.previousSlide')}
              className="p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              onClick={(e) => {
                e.preventDefault()
                goPrev()
              }}
            >
              <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor"><path d="M8 0L0 5l8 5z" /></svg>
            </button>
            {items.length <= 7 ? (
              items.map((item, i) => (
                <button
                  key={item.address}
                  type="button"
                  aria-label={t('liveActivities.goToSlide', { n: i + 1 })}
                  className={cn(
                    'size-2.5 rounded-full transition-colors',
                    i === displayIndex ? 'bg-primary' : 'bg-muted-foreground/40 hover:bg-muted-foreground/60'
                  )}
                  onClick={(e) => {
                    e.preventDefault()
                    setSlide(i)
                  }}
                />
              ))
            ) : (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {displayIndex + 1} / {items.length}
              </span>
            )}
            <button
              type="button"
              aria-label={t('liveActivities.nextSlide')}
              className="p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              onClick={(e) => {
                e.preventDefault()
                goNext()
              }}
            >
              <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor"><path d="M0 0l8 5-8 5z" /></svg>
            </button>
          </div>
          <hr className="mb-1.5 border-border/40" />
        </>
      ) : null}
      {current ? (
        <a
          href={current.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex min-w-0 gap-2 rounded-md transition-colors hover:bg-muted/80',
            placement === 'sidebar' && 'flex-col xl:flex-row xl:items-start',
            placement === 'mobile' && 'items-center'
          )}
        >
          {current.imageUrl ? (
            <img
              src={current.imageUrl}
              alt=""
              className={cn(
                'shrink-0 rounded object-cover',
                placement === 'sidebar' ? 'h-14 w-full xl:h-12 xl:w-12' : 'h-12 w-12'
              )}
            />
          ) : (
            <div className={cn(
              'flex shrink-0 items-center justify-center rounded bg-muted text-muted-foreground/50',
              placement === 'sidebar' ? 'h-14 w-full xl:h-12 xl:w-12' : 'h-12 w-12'
            )}>
              <Radio className="size-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1">
              <span className="line-clamp-2 min-w-0 flex-1 text-xs font-medium leading-snug xl:text-sm">
                {current.title}
              </span>
              <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </div>
            {current.summary ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground xl:text-xs">{current.summary}</p>
            ) : null}
            {current.fromFollowedHost ? (
              <FollowedHostName pubkey={current.pubkey} />
            ) : null}
          </div>
        </a>
      ) : (
        <p className="py-1 text-center text-xs text-muted-foreground">
          {loading ? t('liveActivities.loading') : t('liveActivities.noEvents')}
        </p>
      )}
    </div>
  )
}
