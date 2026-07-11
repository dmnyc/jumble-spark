import Content from '@/components/Content'
import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import Nip05 from '@/components/Nip05'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { formatAmount } from '@/lib/lightning'
import { toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/PageManager'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import lightning, { TRecentSupporter } from '@/services/lightning.service'
import { Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const FEATURED_COUNT = 10

export default function RecentSupporters({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useTranslation()
  const [supporters, setSupporters] = useState<TRecentSupporter[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const items = await lightning.fetchRecentSupporters(refreshKey > 0)
      if (!cancelled) setSupporters(items)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (!supporters.length) return null

  const featured = supporters.slice(0, FEATURED_COUNT)
  const rest = supporters.slice(FEATURED_COUNT)

  return (
    <section className="space-y-3">
      <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {t('Recent Supporters')}
      </div>

      <div className="space-y-3">
        {featured.map((item, index) => (
          <FeaturedSupporter key={item.pubkey} supporter={item} rank={index} />
        ))}
      </div>

      {rest.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-2 pt-1">
          {rest.map((item) => (
            <CompactSupporter key={item.pubkey} supporter={item} />
          ))}
        </div>
      )}
    </section>
  )
}

function FeaturedSupporter({ supporter, rank }: { supporter: TRecentSupporter; rank: number }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const isTop = rank === 0

  return (
    <div
      className={cn(
        'rounded-xl border p-3 sm:p-4',
        isTop ? 'to-card border-yellow-500/30 bg-gradient-to-br from-yellow-400/10' : 'bg-card'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <UserAvatar userId={supporter.pubkey} />
          <div className="w-0 flex-1">
            <Username
              userId={supporter.pubkey}
              className="flex w-fit truncate font-semibold"
              skeletonClassName="h-4"
            />
            <div className="text-muted-foreground flex items-center gap-1 text-sm">
              <Nip05 pubkey={supporter.pubkey} append="·" />
              <FormattedTimestamp
                timestamp={supporter.createdAt}
                className="shrink-0"
                short={isSmallScreen}
              />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-yellow-400/10 px-2.5 py-1 font-semibold text-yellow-500 ring-1 ring-yellow-500/20">
          <Zap className="size-3.5 fill-yellow-500" />
          <span className="text-sm tabular-nums">
            {formatAmount(supporter.amount)} {t('sats')}
          </span>
        </div>
      </div>
      <Content className="mt-2 break-words select-text" content={supporter.comment} />
    </div>
  )
}

function CompactSupporter({ supporter }: { supporter: TRecentSupporter }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()

  return (
    <div
      className="hover:bg-muted/40 flex cursor-pointer items-center gap-1.5 rounded-full border py-1 ps-1 pe-2 transition-colors"
      onClick={() => push(toProfile(supporter.pubkey))}
    >
      <UserAvatar userId={supporter.pubkey} size="small" />
      <Username
        userId={supporter.pubkey}
        className="max-w-32 truncate text-sm font-medium"
        skeletonClassName="h-3"
      />
      <span className="flex items-center gap-0.5 rounded-full bg-yellow-400/10 px-1.5 py-0.5 text-xs font-semibold text-yellow-500 tabular-nums ring-1 ring-yellow-500/20">
        <Zap className="size-3 fill-yellow-500" />
        {formatAmount(supporter.amount)} {t('sats')}
      </span>
    </div>
  )
}
