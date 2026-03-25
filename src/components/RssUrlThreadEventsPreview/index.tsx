import NoteCard from '@/components/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'
import { FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import {
  buildRssArticleUrlThreadInteractionFilters,
  isRssArticleUrlThreadInteraction
} from '@/lib/rss-web-feed'
import { queryService } from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'

const PREVIEW_LIMIT = 5
const FETCH_LIMIT = 24

/**
 * Compact Nostr thread rows (comments + highlights) for an article URL card in the RSS+Web feed.
 */
export default function RssUrlThreadEventsPreview({ canonicalUrl }: { canonicalUrl: string }) {
  const { relays, key: relayHintsKey } = useNoteStatsRelayHints()
  const relayUrls = useMemo(
    () => [...new Set([...SEARCHABLE_RELAY_URLS, ...FAST_READ_RELAY_URLS, ...relays])],
    [relays]
  )
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const filters = buildRssArticleUrlThreadInteractionFilters(canonicalUrl, FETCH_LIMIT)
    void queryService
      .fetchEvents(relayUrls, filters)
      .then((all) => {
        if (cancelled) return
        const seen = new Set<string>()
        const merged: Event[] = []
        for (const e of [...all].sort((a, b) => b.created_at - a.created_at)) {
          if (seen.has(e.id)) continue
          if (!isRssArticleUrlThreadInteraction(e, canonicalUrl)) continue
          seen.add(e.id)
          merged.push(e)
        }
        setEvents(merged.slice(0, PREVIEW_LIMIT))
      })
      .catch(() => {
        if (!cancelled) setEvents([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canonicalUrl, relayHintsKey, relayUrls])

  if (loading) {
    return (
      <div
        className="border-t border-border/50 bg-muted/10 px-3 py-2 pointer-events-auto space-y-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Skeleton className="h-14 w-full rounded-md" />
        <Skeleton className="h-14 w-full rounded-md" />
      </div>
    )
  }

  if (events.length === 0) return null

  return (
    <div
      className="border-t border-border/50 bg-muted/10 pointer-events-auto max-h-72 overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="divide-y divide-border/40">
        {events.map((evt) => (
          <div key={evt.id} className="px-2 py-1.5">
            <NoteCard event={evt} className="border-0 bg-transparent shadow-none" hideParentNotePreview />
          </div>
        ))}
      </div>
    </div>
  )
}
