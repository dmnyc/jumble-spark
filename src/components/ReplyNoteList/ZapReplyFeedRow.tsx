import Content from '@/components/Content'
import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import Nip05 from '@/components/Nip05'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { formatAmount } from '@/lib/lightning'
import { toProfile } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import type { TNoteStats } from '@/services/note-stats.service'
import { Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type TZapFeedEntry = TNoteStats['zaps'][number]

export default function ZapReplyFeedRow({ zap }: { zap: TZapFeedEntry }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  return (
    <div
      className="clickable pb-3 border-b transition-colors duration-500"
      onClick={() => push(toProfile(zap.pubkey))}
    >
      <div className="flex items-start space-x-2 px-4 pt-3">
        <UserAvatar userId={zap.pubkey} size="medium" className="mt-0.5 shrink-0" />
        <div className="min-w-0 w-full overflow-hidden">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Zap className="size-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
                <Username
                  userId={zap.pubkey}
                  className="truncate text-sm font-semibold text-muted-foreground hover:text-foreground"
                  skeletonClassName="h-3"
                />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {formatAmount(zap.amount)} {t('sats')}
                </span>
                <span className="text-muted-foreground/80" aria-hidden>
                  ·
                </span>
                <Nip05 pubkey={zap.pubkey} append="·" />
                <FormattedTimestamp timestamp={zap.created_at} className="shrink-0" short={isSmallScreen} />
              </div>
            </div>
          </div>
          {zap.comment ? <Content className="mt-2 text-sm" content={zap.comment} /> : null}
        </div>
      </div>
    </div>
  )
}
