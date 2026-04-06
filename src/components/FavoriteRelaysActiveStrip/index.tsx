import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useFavoriteRelaysActivity } from '@/providers/favorite-relays-activity-context'
import { RelayPulseActiveNpubsOpenButton } from './RelayPulseActiveNpubsSheet'
import type { TFunction } from 'i18next'
import { FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function relativePastPhrase(timestampMs: number, t: TFunction): string {
  const sec = Math.floor((Date.now() - timestampMs) / 1000)
  if (sec < 45) return t('just now')
  const min = Math.floor(sec / 60)
  if (min < 60) return t('n minutes ago', { n: min })
  const h = Math.floor(min / 60)
  if (h < 48) return t('n hours ago', { n: h })
  const d = Math.floor(h / 24)
  return t('n days ago', { n: d })
}

function useRelativePastPhrase(timestampMs: number | null, t: TFunction): string {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (timestampMs == null) return
    const id = window.setInterval(() => setTick((x) => x + 1), 30_000)
    return () => clearInterval(id)
  }, [timestampMs])
  return useMemo(() => {
    if (timestampMs == null) return ''
    return relativePastPhrase(timestampMs, t)
  }, [timestampMs, t, tick])
}

function ActiveCountGroups({
  followCount,
  otherCount,
  labelClassName,
  stackClassName,
  variant = 'default',
  onOpenFollowsNotes
}: {
  followCount: number
  otherCount: number
  labelClassName: string
  stackClassName?: string
  variant?: 'default' | 'mobileBar'
  onOpenFollowsNotes?: () => void
}) {
  const { t } = useTranslation()
  const mobileBar = variant === 'mobileBar'
  const groupRowClass = mobileBar
    ? 'flex w-full min-w-0 items-center gap-1.5'
    : 'flex min-w-0 items-center gap-1.5'

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', stackClassName)}>
      {followCount > 0 ? (
        <div className={groupRowClass}>
          <span className={cn('tabular-nums', labelClassName)}>
            {t('Relay pulse follows', { count: followCount })}
          </span>
          {onOpenFollowsNotes ? (
            <Button
              variant="ghost"
              size="icon"
              className={cn('shrink-0', mobileBar ? 'size-6' : 'size-5')}
              aria-label={t('See the newest notes from your follows')}
              title={t('See the newest notes from your follows')}
              onClick={onOpenFollowsNotes}
            >
              <FileText className={mobileBar ? 'size-3.5' : 'size-3'} />
            </Button>
          ) : null}
        </div>
      ) : null}
      {otherCount > 0 ? (
        <span className={cn('min-w-0 tabular-nums', labelClassName)}>
          {t('Relay pulse others', { count: otherCount })}
        </span>
      ) : null}
    </div>
  )
}

/** Home feed / mobile: full label above the page title */
export function FavoriteRelaysActiveStripMobileBar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { navigate } = usePrimaryPage()
  const { pubkey } = useNostr()
  const {
    followCount,
    otherCount,
    totalCount,
    loading,
    relayActivityReady,
    lastFetchedAtMs
  } = useFavoriteRelaysActivity()

  const relativeLabel = useRelativePastPhrase(lastFetchedAtMs, t)

  if (!relayActivityReady && !loading) {
    return (
      <div
        className={cn(
          'w-full min-w-0 max-w-full border-b border-border/60 bg-muted/15 px-3 py-2 sm:px-4 animate-pulse',
          className
        )}
      >
        <p className="text-xs font-medium text-foreground">{t('Relay pulse')}</p>
      </div>
    )
  }

  if (relayActivityReady && !loading && totalCount === 0) {
    return (
      <div
        className={cn(
          'w-full min-w-0 max-w-full border-b border-border/60 bg-muted/20 px-3 py-2 sm:px-4',
          className
        )}
      >
        <p className="text-xs font-medium text-foreground">{t('Relay pulse')}</p>
        {lastFetchedAtMs != null && relativeLabel ? (
          <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
            {t('Relay pulse updated', { relative: relativeLabel })}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground leading-snug">
          {t('Relay pulse empty')}
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'w-full min-w-0 max-w-full border-b border-border/60 bg-muted/15 px-3 py-2 sm:px-4',
        loading && 'animate-pulse',
        className
      )}
    >
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 max-w-full items-center justify-between gap-2">
          <div className="flex min-w-0 shrink items-center gap-2">
            <p className="text-xs font-medium leading-tight text-foreground">{t('Relay pulse')}</p>
            <RelayPulseActiveNpubsOpenButton size="sm" variant="outline" className="h-7 shrink-0" />
          </div>
          {lastFetchedAtMs != null && relativeLabel ? (
            <p className="shrink-0 text-[0.65rem] text-muted-foreground tabular-nums">
              {t('Relay pulse updated', { relative: relativeLabel })}
            </p>
          ) : null}
        </div>
        <ActiveCountGroups
          variant="mobileBar"
          followCount={followCount}
          otherCount={otherCount}
          labelClassName="text-[0.7rem] font-medium text-muted-foreground"
          stackClassName="w-full min-w-0 max-w-full"
          onOpenFollowsNotes={pubkey ? () => navigate('follows-latest') : undefined}
        />
      </div>
    </div>
  )
}

/** Desktop sidebar: compact row under nav */
export function FavoriteRelaysActiveStripSidebar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { navigate } = usePrimaryPage()
  const { pubkey } = useNostr()
  const {
    followCount,
    otherCount,
    totalCount,
    loading,
    relayActivityReady,
    lastFetchedAtMs
  } = useFavoriteRelaysActivity()

  const relativeLabel = useRelativePastPhrase(lastFetchedAtMs, t)

  if (!relayActivityReady && !loading) {
    return (
      <div
        className={cn(
          'px-1 py-2 xl:px-0 animate-pulse',
          className
        )}
      >
        <p className="text-[0.65rem] font-medium leading-snug text-foreground">
          {t('Relay pulse')}
        </p>
        <div className="mt-0.5 h-4 w-16 rounded bg-muted/50" aria-hidden />
      </div>
    )
  }

  if (relayActivityReady && !loading && totalCount === 0) {
    return (
      <div className={cn('hidden px-1 py-2 xl:block xl:px-0', className)}>
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <p className="text-[0.65rem] font-medium leading-snug text-foreground">{t('Relay pulse')}</p>
          <RelayPulseActiveNpubsOpenButton size="icon" variant="ghost" className="size-7 shrink-0" />
        </div>
        {lastFetchedAtMs != null && relativeLabel ? (
          <p className="mt-0.5 px-1 text-[0.6rem] text-muted-foreground tabular-nums">
            {t('Relay pulse updated', { relative: relativeLabel })}
          </p>
        ) : null}
        <p className="mt-1 px-1 text-[0.65rem] leading-snug text-muted-foreground">
          {t('Relay pulse empty')}
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'px-1 py-2 xl:px-0',
        loading && 'animate-pulse',
        className
      )}
    >
      <div className="max-xl:hidden mb-0.5 flex flex-wrap items-center gap-1 px-1">
        <p className="min-w-0 flex-1 text-[0.65rem] font-medium leading-snug text-foreground">
          {t('Relay pulse')}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          <RelayPulseActiveNpubsOpenButton size="icon" variant="ghost" className="size-7 shrink-0" />
          {pubkey && followCount > 0 ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={t('See the newest notes from your follows')}
              title={t('See the newest notes from your follows')}
              onClick={() => navigate('follows-latest')}
            >
              <FileText className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      {lastFetchedAtMs != null && relativeLabel ? (
        <p className="max-xl:hidden mb-1.5 px-1 text-[0.6rem] text-muted-foreground tabular-nums">
          {t('Relay pulse updated', { relative: relativeLabel })}
        </p>
      ) : null}
      <div className="mb-1 flex justify-center gap-0.5 xl:hidden">
        <RelayPulseActiveNpubsOpenButton size="icon" variant="ghost" className="size-8 shrink-0" />
        {pubkey && followCount > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={t('See the newest notes from your follows')}
            title={t('See the newest notes from your follows')}
            onClick={() => navigate('follows-latest')}
          >
            <FileText className="size-4" />
          </Button>
        ) : null}
      </div>
      <div className="max-xl:flex max-xl:justify-center">
        <ActiveCountGroups
          followCount={followCount}
          otherCount={otherCount}
          labelClassName="text-[0.6rem] font-medium text-muted-foreground xl:px-1"
          stackClassName="w-full max-xl:items-center"
          onOpenFollowsNotes={pubkey ? () => navigate('follows-latest') : undefined}
        />
      </div>
    </div>
  )
}
