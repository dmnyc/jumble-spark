import Content from '@/components/Content'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { formatAmount } from '@/lib/lightning'
import { toNote, toProfile } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import Emoji from '@/components/Emoji'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import type { TProfileZap } from '@/hooks/useProfileInteractions'
import type { TProfileBadge } from '@/hooks/useProfileBadges'
import type { TProfileFollowPack } from '@/hooks/useProfileFollowPacks'
import { Zap, MessageCircle, ThumbsDown, ThumbsUp, Users } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from 'react-i18next'
import { Event } from 'nostr-tools'

type Props = {
  zaps: TProfileZap[]
  reactions: Event[]
  comments: Event[]
  badges: TProfileBadge[]
  followPacks: TProfileFollowPack[]
  loading: boolean
  badgesLoading: boolean
  followPacksLoading: boolean
}

const ZAPS_PER_ROW = 4
const ZAP_ROWS = 3
const MAX_ZAPS = ZAPS_PER_ROW * ZAP_ROWS
const BADGES_PER_ROW = 4
const BADGE_ROWS = 2
const MAX_BADGES = BADGES_PER_ROW * BADGE_ROWS
const MAX_FOLLOW_PACKS = 8

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

function FollowPackBadge({ pack }: { pack: TProfileFollowPack }) {
  const { push } = useSecondaryPage()
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/80 border hover:bg-muted cursor-pointer text-left min-w-0 w-full"
      onClick={() => push(toNote(pack.event.id))}
      title={pack.title}
    >
      <Users className="size-3 shrink-0 text-primary" aria-hidden />
      <span className="truncate text-xs text-foreground min-w-0">{pack.title}</span>
    </button>
  )
}

function BadgeItem({ badge }: { badge: TProfileBadge }) {
  const imageUrl = badge.thumb ?? badge.image
  const label = badge.name ?? badge.a.split(':').pop() ?? ''
  if (!imageUrl) {
    return (
      <div className="flex size-12 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground" title={label}>
        {label.slice(0, 2)}
      </div>
    )
  }
  return (
    <div className="relative size-12 shrink-0">
      <img
        src={imageUrl}
        alt={label}
        title={label}
        className="size-12 rounded-lg border object-cover bg-muted"
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
          const fallback = e.currentTarget.nextElementSibling as HTMLElement
          if (fallback) fallback.classList.remove('hidden')
        }}
      />
      <div className="hidden absolute inset-0 flex items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground" title={label}>
        {label.slice(0, 2)}
      </div>
    </div>
  )
}

export default function ProfileHeaderInteractions({
  zaps,
  reactions,
  comments,
  badges,
  followPacks,
  loading,
  badgesLoading,
  followPacksLoading
}: Props) {
  const { t } = useTranslation()
  const displayZaps = zaps.slice(0, MAX_ZAPS)
  const displayBadges = badges.slice(0, MAX_BADGES)
  const displayFollowPacks = followPacks.slice(0, MAX_FOLLOW_PACKS)

  const Section = ({ title, isEmpty, isLoading, children, skeletonCount = 6 }: {
    title: string
    isEmpty: boolean
    isLoading: boolean
    children: React.ReactNode
    skeletonCount?: number
  }) => (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground mb-1.5">{title}</div>
      {isLoading && isEmpty ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-md min-w-0" />
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 grid-rows-3 gap-1.5">
          {displayZaps.map((item) => (
            <ZapBadge key={`zap-${item.pr}`} zap={item} />
          ))}
        </div>
      </Section>
      <Section title={t('Likes')} isEmpty={reactions.length === 0} isLoading={loading}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
          {reactions.map((item) => (
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
      <Section title={t('Badges')} isEmpty={displayBadges.length === 0} isLoading={badgesLoading} skeletonCount={8}>
        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 grid-rows-2 gap-1.5">
          {displayBadges.map((badge) => (
            <BadgeItem key={`${badge.a}-${badge.awardId}`} badge={badge} />
          ))}
        </div>
      </Section>
      <Section title={t('In Follow Packs')} isEmpty={displayFollowPacks.length === 0} isLoading={followPacksLoading} skeletonCount={6}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
          {displayFollowPacks.map((pack) => (
            <FollowPackBadge key={pack.event.id} pack={pack} />
          ))}
        </div>
      </Section>
    </div>
  )
}
