import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useEffect } from 'react'
import { useProfileRelayUrls } from '@/hooks/useProfileRelayUrls'
import { useProfileInteractions } from '@/hooks/useProfileInteractions'
import { useProfileBadges } from '@/hooks/useProfileBadges'
import { useProfileFollowPacks } from '@/hooks/useProfileFollowPacks'
import { useProfileReports } from '@/hooks/useProfileReports'
import { useNostr } from '@/providers/NostrProvider'
import ProfileHeaderInteractions from './ProfileHeaderInteractions'

type Props = {
  pubkey: string | undefined
  isExpanded: boolean
  onExpandedChange: (open: boolean) => void
  onRefreshReady?: (refresh: (() => void) | null) => void
}

function ProfileInteractionsContent({ pubkey, relayUrls, onRefreshReady }: {
  pubkey: string
  relayUrls: string[] | undefined
  onRefreshReady?: (refresh: (() => void) | null) => void
}) {
  const { pubkey: viewerPubkey } = useNostr()
  const { zaps, reactions, comments, loading, refresh } = useProfileInteractions(pubkey, relayUrls)
  const { badges, loading: badgesLoading, refresh: refreshBadges } = useProfileBadges(pubkey, relayUrls)
  const { packs, loading: followPacksLoading, refresh: refreshFollowPacks } = useProfileFollowPacks(pubkey, relayUrls)
  const { reports, loading: reportsLoading, refresh: refreshReports } = useProfileReports(pubkey, viewerPubkey)

  useEffect(() => {
    const doRefresh = () => {
      refresh()
      refreshBadges()
      refreshFollowPacks()
      refreshReports()
    }
    onRefreshReady?.(doRefresh)
    return () => { onRefreshReady?.(null) }
  }, [refresh, refreshBadges, refreshFollowPacks, refreshReports, onRefreshReady])

  return (
    <ProfileHeaderInteractions
      profilePubkey={pubkey}
      badgeRelayUrls={relayUrls ?? []}
      zaps={zaps}
      reactions={reactions}
      comments={comments}
      badges={badges}
      followPacks={packs}
      reports={reports}
      loading={loading}
      badgesLoading={badgesLoading}
      followPacksLoading={followPacksLoading}
      reportsLoading={reportsLoading}
      reportsEnabled={!!viewerPubkey}
    />
  )
}

function ProfileInteractionsSkeleton() {
  return (
    <div className="py-2 space-y-3">
      {[6, 4, 4, 8, 6, 6].map((count, i) => (
        <div key={i} className="min-w-0">
          <Skeleton className="h-3 w-16 mb-1.5" />
          <div
            className={
              i === 3
                ? 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-1'
                : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5'
            }
          >
            {Array.from({ length: count }).map((_, j) => (
              <Skeleton
                key={j}
                className={cn('rounded-lg min-w-0', i === 3 ? 'aspect-square h-24 w-full' : 'h-8')}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ProfileInteractionsAccordion({
  pubkey,
  isExpanded,
  onExpandedChange,
  onRefreshReady
}: Props) {
  const { t } = useTranslation()
  const { relayUrls, loading: relayUrlsLoading } = useProfileRelayUrls(pubkey, isExpanded)
  const relaysReady = !relayUrlsLoading
  const hasContent = isExpanded && pubkey

  return (
    <Collapsible open={isExpanded} onOpenChange={onExpandedChange} className="min-w-0">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/80 bg-muted/15 px-3 py-2 text-left hover:bg-muted/25 min-w-0">
        <span className="text-sm font-medium truncate">
          {t('Zaps')}, {t('Likes')}, {t('Comments')}, {t('Badges')}, {t('In Follow Packs')}, {t('Reports')}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-180')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        {hasContent ? (
          !relaysReady ? (
            <div className="pt-2">
              <ProfileInteractionsSkeleton />
            </div>
          ) : (
            <div className="pt-2">
              <ProfileInteractionsContent
                pubkey={pubkey}
                relayUrls={relayUrls.length > 0 ? relayUrls : undefined}
                onRefreshReady={onRefreshReady}
              />
            </div>
          )
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
