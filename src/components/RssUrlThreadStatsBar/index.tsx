import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useUserTrust } from '@/contexts/user-trust-context'
import { cn } from '@/lib/utils'
import noteStatsService from '@/services/note-stats.service'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { useNostr } from '@/providers/NostrProvider'
import { Bookmark, Highlighter, MessageCircle, ThumbsUp } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
/** Compact reply / reaction / bookmark / highlight counts for RSS + Web URL threads. */
export default function RssUrlThreadStatsBar({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { relays: statsRelays, key: statsRelaysKey } = useNoteStatsRelayHints()
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const noteStats = useNoteStatsById(event.id)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    noteStatsService.fetchNoteStats(event, pubkey, statsRelays).finally(() => setLoading(false))
  }, [event.id, event.kind, event.created_at, event.sig, pubkey, statsRelaysKey])

  const fmt = (n: number) => (n >= 100 ? '99+' : String(n))

  const { replyCount, reactionCount, highlightCount, bookmarkCount } = useMemo(() => {
    const replies = noteStats?.replies ?? []
    const likes = noteStats?.likes ?? []
    const highlights = noteStats?.highlights ?? []
    const trustedReplyCount = hideUntrustedInteractions
      ? replies.filter((r) => isUserTrusted(r.pubkey)).length
      : replies.length
    const trustedReactionCount = hideUntrustedInteractions
      ? likes.filter((l) => isUserTrusted(l.pubkey)).length
      : likes.length
    const trustedHighlightCount = hideUntrustedInteractions
      ? highlights.filter((h) => isUserTrusted(h.pubkey)).length
      : highlights.length
    const bookmarkCountInner = noteStats?.bookmarkPubkeySet?.size ?? 0
    return {
      replyCount: trustedReplyCount,
      reactionCount: trustedReactionCount,
      highlightCount: trustedHighlightCount,
      bookmarkCount: bookmarkCountInner
    }
  }, [noteStats, hideUntrustedInteractions, isUserTrusted])

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground',
        loading ? 'animate-pulse' : '',
        className
      )}
      data-rss-url-thread-stats
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="group"
      aria-label={t('URL thread activity')}
    >
      <span className="inline-flex items-center gap-1" title={t('Comments')}>
        <MessageCircle className="size-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
        <span className="tabular-nums">{fmt(replyCount)}</span>
      </span>
      <span className="inline-flex items-center gap-1" title={t('Reactions')}>
        <ThumbsUp className="size-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
        <span className="tabular-nums">{fmt(reactionCount)}</span>
      </span>
      <span className="inline-flex items-center gap-1" title={t('Bookmarks')}>
        <Bookmark className="size-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
        <span className="tabular-nums">{fmt(bookmarkCount)}</span>
      </span>
      <span className="inline-flex items-center gap-1" title={t('Highlights')}>
        <Highlighter className="size-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
        <span className="tabular-nums">{fmt(highlightCount)}</span>
      </span>
    </div>
  )
}
