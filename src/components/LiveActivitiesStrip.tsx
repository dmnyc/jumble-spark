import { LIVE_ACTIVITIES_SLIDE_INTERVAL_MS } from '@/lib/live-activities'
import { cn } from '@/lib/utils'
import { useLiveActivitiesOptional } from '@/providers/LiveActivitiesProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { ExternalLink } from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TPlacement = 'sidebar' | 'mobile'

export default function LiveActivitiesStrip({ placement }: { placement: TPlacement }) {
  const { t } = useTranslation()
  const { showLiveActivitiesBanner } = useUserPreferences()
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

  useEffect(() => {
    setSlide(0)
  }, [items])

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

  if (!showLiveActivitiesBanner || items.length === 0) {
    return null
  }

  // `items` can shrink without a new array identity; `slide` may then be out of range until effects run.
  const displayIndex = Math.min(slide, items.length - 1)
  const current = items[displayIndex]
  if (!current) {
    return null
  }

  return (
    <div
      className={cn(
        placement === 'sidebar' &&
          'mb-2 rounded-lg border border-border/80 bg-muted/50 p-2 shadow-sm dark:bg-muted/30',
        placement === 'mobile' && 'w-full shrink-0 border-b border-border/80 bg-muted/50 px-2 py-2 dark:bg-muted/30'
      )}
      role="region"
      aria-label={t('liveActivities.regionLabel')}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground xl:text-xs">
        {t('liveActivities.heading')}
      </div>
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
        ) : null}
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
            <p className="mt-1 text-[10px] text-green-600 dark:text-green-500">{t('liveActivities.fromFollow')}</p>
          ) : null}
        </div>
      </a>
      {items.length > 1 ? (
        <div className="mt-2 flex justify-center gap-1.5">
          {items.map((item, i) => (
            <button
              key={item.address}
              type="button"
              aria-label={t('liveActivities.goToSlide', { n: i + 1 })}
              className={cn(
                'size-1.5 rounded-full transition-colors',
                i === displayIndex ? 'bg-primary' : 'bg-muted-foreground/40 hover:bg-muted-foreground/60'
              )}
              onClick={(e) => {
                e.preventDefault()
                setSlide(i)
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
