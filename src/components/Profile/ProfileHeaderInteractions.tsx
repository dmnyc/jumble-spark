import Content from '@/components/Content'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import ProfileBadgeDetailDialog from './ProfileBadgeDetailDialog'
import { Button } from '@/components/ui/button'
import { replaceableEventDedupeKey } from '@/lib/event'
import { formatAmount } from '@/lib/lightning'
import { cn } from '@/lib/utils'
import { toNote, toProfile } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import Emoji from '@/components/Emoji'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import type { TProfileZap } from '@/hooks/useProfileInteractions'
import type { TProfileBadge } from '@/hooks/useProfileBadges'
import type { TProfileFollowPack } from '@/hooks/useProfileFollowPacks'
import { Flag, MoreHorizontal, Zap, MessageCircle, ThumbsDown, ThumbsUp, Users } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Event } from 'nostr-tools'

type Props = {
  profilePubkey: string
  badgeRelayUrls: string[]
  zaps: TProfileZap[]
  reactions: Event[]
  comments: Event[]
  badges: TProfileBadge[]
  followPacks: TProfileFollowPack[]
  reports: Event[]
  loading: boolean
  badgesLoading: boolean
  followPacksLoading: boolean
  reportsLoading: boolean
  /** When false (logged out), the Reports section is omitted — reports use the viewer’s relays only. */
  reportsEnabled: boolean
}

const ZAPS_PER_ROW = 4
const ZAP_ROWS = 3
const MAX_ZAPS = ZAPS_PER_ROW * ZAP_ROWS
const LIKES_GRID_COLS = 4
const LIKES_GRID_ROWS = 3
const MAX_LIKES = LIKES_GRID_COLS * LIKES_GRID_ROWS
const BADGES_PER_ROW = 6
const BADGE_ROWS = 2
const MAX_BADGES = BADGES_PER_ROW * BADGE_ROWS
const BADGE_TILE_PX = 96
const MAX_FOLLOW_PACKS = 8
const MAX_REPORTS = 12

function reportSummaryFromEvent(event: Event): string {
  const reportTag = event.tags.find((t) => t[0] === 'report')
  const reason = reportTag?.[1]?.trim()
  if (reason) return reason
  const text = event.content.trim().replace(/\s+/g, ' ')
  if (text) return text.length > 48 ? `${text.slice(0, 45)}…` : text
  return '—'
}

function ZapBadge({ zap }: { zap: TProfileZap }) {
  const { push } = useSecondaryPage()
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/80 border border-yellow-400/40 hover:bg-yellow-400/10 cursor-pointer text-left min-w-0 w-full"
      onClick={() => push(toProfile(zap.pubkey))}
    >
      <UserAvatar userId={zap.pubkey} size="tiny" className="shrink-0" />
      <Zap className="size-3 shrink-0 text-yellow-500 fill-yellow-500" strokeWidth={2} aria-hidden />
      <span className="font-semibold tabular-nums text-xs text-foreground truncate">{formatAmount(zap.amount)}</span>
    </button>
  )
}

function ReactionBadge({ event }: { event: Event }) {
  const { push } = useSecondaryPage()
  const emojiInfos = getEmojiInfosFromEmojiTags(event.tags)
  const displayContent = event.content.trim() || (emojiInfos[0] ? emojiInfos[0].shortcode : '+')
  const isPlus = displayContent === '+'
  const isMinus = displayContent === '-'
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/80 border hover:bg-muted cursor-pointer min-w-0 w-full"
      onClick={() => push(toProfile(event.pubkey))}
    >
      <UserAvatar userId={event.pubkey} size="tiny" className="shrink-0" />
      {isPlus ? (
        <ThumbsUp className="size-3 shrink-0 text-primary" aria-hidden />
      ) : isMinus ? (
        <ThumbsDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      ) : typeof displayContent === 'string' && !displayContent.startsWith(':') ? (
        <span className="text-xs shrink-0">{displayContent}</span>
      ) : (
        <Emoji emoji={emojiInfos[0] ?? displayContent} classNames={{ img: 'size-3' }} />
      )}
      <Username userId={event.pubkey} className="truncate text-xs text-muted-foreground min-w-0" skeletonClassName="h-3" />
    </button>
  )
}

function CommentBadge({ event }: { event: Event }) {
  const { push } = useSecondaryPage()
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/80 border cursor-pointer text-left min-w-0 w-full"
      onClick={() => push(toNote(event.id))}
    >
      <UserAvatar userId={event.pubkey} size="tiny" className="shrink-0" />
      <MessageCircle className="size-3 shrink-0 text-primary" aria-hidden />
      <span className="truncate text-xs text-muted-foreground min-w-0">
        <Content content={event.content} className="text-xs [&_p]:text-xs [&_p]:m-0 [&_p]:inline" />
      </span>
    </button>
  )
}

function ReportBadge({ event }: { event: Event }) {
  const { push } = useSecondaryPage()
  const summary = reportSummaryFromEvent(event)
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/80 border border-destructive/25 hover:bg-muted cursor-pointer text-left min-w-0 w-full"
      onClick={() => push(toNote(event.id))}
      title={summary}
    >
      <UserAvatar userId={event.pubkey} size="tiny" className="shrink-0" />
      <Flag className="size-3 shrink-0 text-destructive" strokeWidth={2} aria-hidden />
      <span className="truncate text-xs text-muted-foreground min-w-0">{summary}</span>
    </button>
  )
}

function FollowPackBadge({ pack }: { pack: TProfileFollowPack }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const authorPk = pack.event.pubkey
  return (
    <button
      type="button"
      className="flex flex-col gap-1 px-2 py-1.5 rounded-md bg-muted/80 border hover:bg-muted cursor-pointer text-left min-w-0 w-full"
      onClick={() => push(toNote(pack.event.id))}
      title={pack.title}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Users className="size-3 shrink-0 text-primary" aria-hidden />
        <span className="truncate text-xs font-medium text-foreground min-w-0">{pack.title}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 ps-4">
        <span className="shrink-0 text-xs text-muted-foreground">{t('Follow pack by')}:</span>
        <UserAvatar userId={authorPk} size="xSmall" className="shrink-0" />
        <Username
          userId={authorPk}
          className="min-w-0 truncate text-xs font-medium text-foreground"
          skeletonClassName="h-3.5"
        />
      </div>
    </button>
  )
}

function BadgeItem({
  badge,
  onOpenDetail
}: {
  badge: TProfileBadge
  onOpenDetail: (b: TProfileBadge) => void
}) {
  const { t } = useTranslation()
  const imageUrl = badge.thumb ?? badge.image
  const label = badge.name ?? badge.a.split(':').pop() ?? ''
  return (
    <div
      className="relative shrink-0 rounded-lg border bg-muted"
      style={{ width: BADGE_TILE_PX, height: BADGE_TILE_PX }}
      title={label}
    >
      {imageUrl ? (
        <>
          <img
            src={imageUrl}
            alt=""
            className="size-full rounded-lg object-cover"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden'
              const fallback = e.currentTarget.nextElementSibling as HTMLElement | null
              fallback?.classList.remove('hidden')
            }}
          />
          <div className="hidden absolute inset-0 flex items-center justify-center rounded-lg bg-muted p-1 text-center text-xs text-muted-foreground">
            {label.slice(0, 3)}
          </div>
        </>
      ) : (
        <div className="flex size-full items-center justify-center rounded-lg p-1 text-center text-xs text-muted-foreground">
          {label.slice(0, 3)}
        </div>
      )}
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="absolute right-0.5 top-0.5 h-7 w-7 shrink-0 rounded-md border border-border/80 bg-background/90 shadow-sm backdrop-blur-sm hover:bg-background"
        aria-label={t('Badge details')}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenDetail(badge)
        }}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </Button>
    </div>
  )
}

export default function ProfileHeaderInteractions({
  profilePubkey,
  badgeRelayUrls,
  zaps,
  reactions,
  comments,
  badges,
  followPacks,
  reports,
  loading,
  badgesLoading,
  followPacksLoading,
  reportsLoading,
  reportsEnabled
}: Props) {
  const { t } = useTranslation()
  const [badgeDialogOpen, setBadgeDialogOpen] = useState(false)
  const [selectedBadge, setSelectedBadge] = useState<TProfileBadge | null>(null)

  const displayZaps = zaps.slice(0, MAX_ZAPS)
  const displayReactions = reactions.slice(0, MAX_LIKES)
  const displayBadges = badges.slice(0, MAX_BADGES)
  const displayFollowPacks = followPacks.slice(0, MAX_FOLLOW_PACKS)
  const displayReports = reports.slice(0, MAX_REPORTS)

  const Section = ({
    title,
    isEmpty,
    isLoading,
    children,
    skeletonCount = 6,
    skeletonItemClassName,
    skeletonGridClassName
  }: {
    title: string
    isEmpty: boolean
    isLoading: boolean
    children: React.ReactNode
    skeletonCount?: number
    skeletonItemClassName?: string
    skeletonGridClassName?: string
  }) => (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground mb-1.5">{title}</div>
      {isLoading && isEmpty ? (
        <div
          className={cn(
            'grid gap-1.5',
            skeletonGridClassName ?? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
          )}
        >
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <Skeleton key={i} className={cn('h-8 rounded-md min-w-0', skeletonItemClassName)} />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="text-xs text-muted-foreground py-1">{t('None')}</div>
      ) : (
        children
      )}
    </div>
  )

  return (
    <div className="py-2 space-y-3 w-full min-w-0 overflow-visible">
      <Section title={t('Zaps')} isEmpty={displayZaps.length === 0} isLoading={loading}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 auto-rows-min">
          {displayZaps.map((item) => (
            <ZapBadge key={`zap-${item.pr}`} zap={item} />
          ))}
        </div>
      </Section>
      <Section title={t('Likes')} isEmpty={reactions.length === 0} isLoading={loading}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 auto-rows-min">
          {displayReactions.map((item) => (
            <ReactionBadge key={`reaction-${item.id}`} event={item} />
          ))}
        </div>
      </Section>
      <Section title={t('Comments')} isEmpty={comments.length === 0} isLoading={loading}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
          {comments.map((item) => (
            <CommentBadge key={`comment-${item.id}`} event={item} />
          ))}
        </div>
      </Section>
      <Section
        title={t('Badges')}
        isEmpty={displayBadges.length === 0}
        isLoading={badgesLoading}
        skeletonCount={12}
        skeletonGridClassName="grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-1"
        skeletonItemClassName="aspect-square h-24 w-full rounded-lg"
      >
        <div className="flex flex-wrap gap-1">
          {displayBadges.map((badge, index) => (
            <BadgeItem
              key={`${badge.a}-${badge.awardId}-${index}`}
              badge={badge}
              onOpenDetail={(b) => {
                setSelectedBadge(b)
                setBadgeDialogOpen(true)
              }}
            />
          ))}
        </div>
      </Section>
      <ProfileBadgeDetailDialog
        open={badgeDialogOpen}
        onOpenChange={(o) => {
          setBadgeDialogOpen(o)
          if (!o) setSelectedBadge(null)
        }}
        badge={selectedBadge}
        profilePubkey={profilePubkey}
        relayUrls={badgeRelayUrls}
      />
      <Section
        title={t('In Follow Packs')}
        isEmpty={displayFollowPacks.length === 0}
        isLoading={followPacksLoading}
        skeletonCount={6}
        skeletonItemClassName="h-14"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
          {displayFollowPacks.map((pack) => (
            <FollowPackBadge key={replaceableEventDedupeKey(pack.event)} pack={pack} />
          ))}
        </div>
      </Section>
      {reportsEnabled ? (
        <Section title={t('Reports')} isEmpty={displayReports.length === 0} isLoading={reportsLoading}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
            {displayReports.map((item) => (
              <ReportBadge key={`report-${item.id}`} event={item} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  )
}
