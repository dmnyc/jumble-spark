import UserAvatar from '@/components/UserAvatar'
import { SimpleUsername } from '@/components/Username'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'
import { useMuteList } from '@/contexts/mute-list-context'
import { useFavoriteRelaysActivity } from '@/providers/favorite-relays-activity-context'
import { RelayPulseActiveNpubsOpenButton } from './RelayPulseActiveNpubsSheet'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MOBILE_MAX_FOLLOW = 8
const MOBILE_MAX_OTHER = 8
const SIDEBAR_MAX_FOLLOW = 5
const SIDEBAR_MAX_OTHER = 5

/** Slight overlap so faces stay recognizable */
const AVATAR_OVERLAP = '-ml-1'

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

function OverlappingAvatars({
  pubkeys,
  max,
  avatarSize,
  rowClassName,
  scrollableRow = false
}: {
  pubkeys: string[]
  max: number
  avatarSize: 'small' | 'xSmall' | 'tiny'
  rowClassName?: string
  /** Narrow screens: horizontal scroll inside the viewport instead of overflowing the page */
  scrollableRow?: boolean
}) {
  const slice = pubkeys.slice(0, max)
  const extra = pubkeys.length - slice.length

  const row = (
    <div
      className={cn(
        'flex flex-row items-center pl-0.5',
        scrollableRow && 'w-max max-w-none'
      )}
    >
      {slice.map((pk, i) => (
        <HoverCard key={pk} openDelay={180} closeDelay={80}>
          <HoverCardTrigger asChild>
            <div
              className={cn(
                'relative shrink-0 rounded-full ring-2 ring-background transition-[z-index] duration-150',
                i > 0 && AVATAR_OVERLAP
              )}
              style={{ zIndex: i + 1 }}
            >
              <UserAvatar userId={pk} size={avatarSize} />
            </div>
          </HoverCardTrigger>
          <HoverCardContent side="top" className="w-auto max-w-[min(18rem,calc(100vw-2rem))] py-2 px-3">
            <SimpleUsername userId={pk} showAt className="text-sm font-medium" />
          </HoverCardContent>
        </HoverCard>
      ))}
      {extra > 0 ? (
        <div
          className={cn(
            'relative z-[20] flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground ring-2 ring-background',
            slice.length > 0 && AVATAR_OVERLAP
          )}
          title={String(extra)}
        >
          +{extra > 99 ? '99+' : extra}
        </div>
      ) : null}
    </div>
  )

  if (scrollableRow) {
    return (
      <div
        className={cn(
          'w-full min-w-0 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]',
          rowClassName
        )}
      >
        {row}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center justify-end sm:justify-start',
        rowClassName
      )}
    >
      {row}
    </div>
  )
}

function ActiveAvatarGroups({
  followPubkeysForAvatars,
  otherPubkeysForAvatars,
  followCount,
  otherCount,
  maxFollow,
  maxOther,
  avatarSize,
  labelClassName,
  stackClassName,
  variant = 'default'
}: {
  /** Subset with kind 0 only (shown as circles); counts use full totals */
  followPubkeysForAvatars: string[]
  otherPubkeysForAvatars: string[]
  followCount: number
  otherCount: number
  maxFollow: number
  maxOther: number
  avatarSize: 'small' | 'xSmall' | 'tiny'
  labelClassName: string
  stackClassName?: string
  /** Mobile home: label above avatars + scrollable rows; sidebar/default keeps compact rows on wider mini breakpoints */
  variant?: 'default' | 'mobileBar'
}) {
  const { t } = useTranslation()
  const mobileBar = variant === 'mobileBar'
  const groupRowClass = mobileBar
    ? 'flex w-full min-w-0 flex-col gap-1.5'
    : 'flex min-w-0 flex-col gap-1 min-[380px]:flex-row min-[380px]:items-center min-[380px]:gap-2'

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', stackClassName)}>
      {followCount > 0 ? (
        <div className={groupRowClass}>
          <span className={cn('min-w-0 shrink-0 tabular-nums', labelClassName)}>
            {t('Relay pulse follows', { count: followCount })}
          </span>
          <OverlappingAvatars
            pubkeys={followPubkeysForAvatars}
            max={maxFollow}
            avatarSize={avatarSize}
            scrollableRow={mobileBar}
            rowClassName={mobileBar ? undefined : 'min-[380px]:justify-start'}
          />
        </div>
      ) : null}
      {otherCount > 0 ? (
        <div className={groupRowClass}>
          <span className={cn('min-w-0 shrink-0 tabular-nums', labelClassName)}>
            {t('Relay pulse others', { count: otherCount })}
          </span>
          <OverlappingAvatars
            pubkeys={otherPubkeysForAvatars}
            max={maxOther}
            avatarSize={avatarSize}
            scrollableRow={mobileBar}
            rowClassName={mobileBar ? undefined : 'min-[380px]:justify-start'}
          />
        </div>
      ) : null}
    </div>
  )
}

/** Home feed / mobile: full label above the page title */
export function FavoriteRelaysActiveStripMobileBar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { mutePubkeySet } = useMuteList()
  const {
    followPubkeys,
    otherPubkeys,
    followCount,
    otherCount,
    totalCount,
    loading,
    relayActivityReady,
    lastFetchedAtMs,
    profileKind0ByPubkey
  } = useFavoriteRelaysActivity()

  const followPubkeysForAvatars = useMemo(
    () =>
      followPubkeys.filter(
        (pk) => profileKind0ByPubkey[pk] && !mutePubkeySet.has(pk)
      ),
    [followPubkeys, profileKind0ByPubkey, mutePubkeySet]
  )
  const otherPubkeysForAvatars = useMemo(
    () =>
      otherPubkeys.filter(
        (pk) => profileKind0ByPubkey[pk] && !mutePubkeySet.has(pk)
      ),
    [otherPubkeys, profileKind0ByPubkey, mutePubkeySet]
  )

  const relativeLabel = useRelativePastPhrase(lastFetchedAtMs, t)

  if (!relayActivityReady && !loading) {
    return null
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
      <div className="flex w-full min-w-0 flex-col gap-3">
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
        <ActiveAvatarGroups
          variant="mobileBar"
          followPubkeysForAvatars={followPubkeysForAvatars}
          otherPubkeysForAvatars={otherPubkeysForAvatars}
          followCount={followCount}
          otherCount={otherCount}
          maxFollow={MOBILE_MAX_FOLLOW}
          maxOther={MOBILE_MAX_OTHER}
          avatarSize="small"
          labelClassName="text-[0.7rem] font-medium text-muted-foreground"
          stackClassName="w-full min-w-0 max-w-full"
        />
      </div>
    </div>
  )
}

/** Desktop sidebar: compact row under nav */
export function FavoriteRelaysActiveStripSidebar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { mutePubkeySet } = useMuteList()
  const {
    followPubkeys,
    otherPubkeys,
    followCount,
    otherCount,
    totalCount,
    loading,
    relayActivityReady,
    lastFetchedAtMs,
    profileKind0ByPubkey
  } = useFavoriteRelaysActivity()

  const followPubkeysForAvatars = useMemo(
    () =>
      followPubkeys.filter(
        (pk) => profileKind0ByPubkey[pk] && !mutePubkeySet.has(pk)
      ),
    [followPubkeys, profileKind0ByPubkey, mutePubkeySet]
  )
  const otherPubkeysForAvatars = useMemo(
    () =>
      otherPubkeys.filter(
        (pk) => profileKind0ByPubkey[pk] && !mutePubkeySet.has(pk)
      ),
    [otherPubkeys, profileKind0ByPubkey, mutePubkeySet]
  )

  const relativeLabel = useRelativePastPhrase(lastFetchedAtMs, t)

  if (!relayActivityReady && !loading) {
    return null
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
        <RelayPulseActiveNpubsOpenButton size="icon" variant="ghost" className="size-7 shrink-0" />
      </div>
      {lastFetchedAtMs != null && relativeLabel ? (
        <p className="max-xl:hidden mb-1.5 px-1 text-[0.6rem] text-muted-foreground tabular-nums">
          {t('Relay pulse updated', { relative: relativeLabel })}
        </p>
      ) : null}
      <div className="mb-1 flex justify-center xl:hidden">
        <RelayPulseActiveNpubsOpenButton size="icon" variant="ghost" className="size-8 shrink-0" />
      </div>
      <div className="max-xl:flex max-xl:justify-center">
        <ActiveAvatarGroups
          followPubkeysForAvatars={followPubkeysForAvatars}
          otherPubkeysForAvatars={otherPubkeysForAvatars}
          followCount={followCount}
          otherCount={otherCount}
          maxFollow={SIDEBAR_MAX_FOLLOW}
          maxOther={SIDEBAR_MAX_OTHER}
          avatarSize="xSmall"
          labelClassName="text-[0.6rem] font-medium text-muted-foreground xl:px-1"
          stackClassName="w-full max-xl:items-center"
        />
      </div>
    </div>
  )
}
