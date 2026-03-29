import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useProfileRelayUrls } from '@/hooks/useProfileRelayUrls'
import { useProfileAccordionData } from '@/hooks/useProfileAccordionData'
import { useNostr } from '@/providers/NostrProvider'
import ProfileHeaderInteractions from './ProfileHeaderInteractions'

type Props = {
  pubkey: string | undefined
  isExpanded: boolean
  onExpandedChange: (open: boolean) => void
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
  onExpandedChange
}: Props) {
  const { t } = useTranslation()
  const { pubkey: viewerPubkey } = useNostr()
  const { relayUrls, loading: relayUrlsLoading, refresh: refreshRelayUrls } = useProfileRelayUrls(
    pubkey,
    isExpanded
  )
  const relaysReady = !relayUrlsLoading
  const urlsForFetch = relayUrls.length > 0 ? relayUrls : undefined

  const {
    zaps,
    reactions,
    comments,
    badges,
    followPacks,
    reports,
    loading: bundleLoading,
    refresh: refreshBundle
  } = useProfileAccordionData({
    pubkey,
    relayUrls: urlsForFetch,
    enabled: isExpanded && relaysReady && !!pubkey,
    viewerPubkey
  })

  const handleRefresh = () => {
    void (async () => {
      const urls = await refreshRelayUrls()
      refreshBundle(urls.length > 0 ? urls : undefined)
    })()
  }

  const hasContent = isExpanded && pubkey
  const hasAnyBundleData =
    zaps.length > 0 ||
    reactions.length > 0 ||
    comments.length > 0 ||
    badges.length > 0 ||
    followPacks.length > 0 ||
    reports.length > 0
  const showSkeleton = hasContent && (!relaysReady || (bundleLoading && !hasAnyBundleData))

  return (
    <Collapsible open={isExpanded} onOpenChange={onExpandedChange} className="min-w-0">
      <div className="flex min-w-0 items-stretch gap-1 rounded-lg border border-border/80 bg-muted/15 hover:bg-muted/25">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left">
          <span className="text-sm font-medium truncate">
            {t('Zaps')}, {t('Likes')}, {t('Comments')}, {t('Badges')}, {t('In Follow Packs')}, {t('Reports')}
          </span>
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
        </CollapsibleTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="my-1 mr-1 shrink-0 rounded-md"
          title={t('Refresh')}
          aria-label={t('Refresh')}
          disabled={!pubkey}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleRefresh()
          }}
        >
          <RefreshCw className={cn('size-4', bundleLoading && 'animate-spin')} />
        </Button>
      </div>
      <CollapsibleContent className="overflow-hidden">
        {hasContent ? (
          showSkeleton ? (
            <div className="pt-2">
              <ProfileInteractionsSkeleton />
            </div>
          ) : (
            <div className="pt-2">
              <ProfileHeaderInteractions
                profilePubkey={pubkey}
                badgeRelayUrls={relayUrls}
                zaps={zaps}
                reactions={reactions}
                comments={comments}
                badges={badges}
                followPacks={followPacks}
                reports={reports}
                loading={bundleLoading}
                badgesLoading={bundleLoading}
                followPacksLoading={bundleLoading}
                reportsLoading={bundleLoading}
                reportsEnabled={!!viewerPubkey}
              />
            </div>
          )
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
