import NoteCard from '@/components/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useRssUrlThreadQueryRelays } from '@/hooks/useRssUrlThreadQueryRelays'
import {
  buildRssArticleUrlThreadInteractionFilterGroups,
  isRssArticleUrlThreadInteraction
} from '@/lib/rss-web-feed'
import { queryService } from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'

const PREVIEW_LIMIT = 5
const FETCH_LIMIT = 24

/**
 * Compact Nostr thread rows (comments + highlights) for an article URL card in the RSS+Web feed.
 */
export default function RssUrlThreadEventsPreview({ canonicalUrl }: { canonicalUrl: string }) {
  const { relayUrls, key: relayKey } = useRssUrlThreadQueryRelays()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const { nonSocial, social } = buildRssArticleUrlThreadInteractionFilterGroups(
      canonicalUrl,
      FETCH_LIMIT
    )
    const fetchOpts = {
      eoseTimeout: 12_000,
      globalTimeout: 26_000,
      firstRelayResultGraceMs: false as const
    }
    if (relayUrls.length === 0) {
      return () => {
        cancelled = true
      }
    }
    void Promise.all([
      nonSocial.length > 0 ? queryService.fetchEvents(relayUrls, nonSocial, fetchOpts) : Promise.resolve([]),
      social.length > 0 ? queryService.fetchEvents(relayUrls, social, fetchOpts) : Promise.resolve([])
    ])
      .then(([a, b]) => {
        if (cancelled) return
        const all = [...a, ...b]
        const seen = new Set<string>()
        const merged: Event[] = []
        for (const e of [...all].sort((x, y) => y.created_at - x.created_at)) {
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
  }, [canonicalUrl, relayKey, relayUrls])

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
