import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { toNote } from '@/lib/link'
import client from '@/services/client.service'
import { extractAllMediaFromEvent } from '@/services/media-extraction.service'
import { useSmartNoteNavigationOptional } from '@/PageManager'
import { Images, Music, Play } from 'lucide-react'
import { type Event } from 'nostr-tools'
import { useMemo } from 'react'

export default function MediaGridItem({ event }: { event: Event }) {
  const { navigateToNote } = useSmartNoteNavigationOptional()

  const media = useMemo(() => extractAllMediaFromEvent(event), [event])
  const first = media.all[0]

  const isVideo =
    first?.m?.startsWith('video/') || event.kind === 21 || event.kind === 22
  const isAudio = first?.m?.startsWith('audio/') || event.kind === 1222
  const hasMultiple = media.all.length > 1

  // For videos prefer the poster image; fall back to video URL (browser extracts frame)
  const displayUrl = isVideo
    ? (first?.image ?? first?.url)
    : (first?.thumb ?? first?.url)

  const handleClick = () => {
    client.addEventToCache(event)
    navigateToNote(toNote(event), event, getCachedThreadContextEvents(event))
  }

  return (
    <div
      className="relative aspect-square cursor-pointer overflow-hidden bg-muted"
      onClick={handleClick}
    >
      {displayUrl ? (
        isVideo && !first?.image ? (
          <video
            src={displayUrl}
            className="h-full w-full object-cover"
            muted
            preload="metadata"
          />
        ) : (
          <img
            src={displayUrl}
            alt={first?.alt ?? ''}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
          {isAudio ? <Music className="size-8" /> : <Play className="size-8" />}
        </div>
      )}

      {/* Top-right badge */}
      {isVideo && (
        <div className="absolute right-2 top-2 rounded bg-black/60 p-1">
          <Play className="size-6 fill-white text-white" />
        </div>
      )}
      {isAudio && (
        <div className="absolute right-2 top-2 rounded bg-black/60 p-1">
          <Music className="size-6 text-white" />
        </div>
      )}
      {hasMultiple && !isVideo && !isAudio && (
        <div className="absolute right-2 top-2 rounded bg-black/60 p-1">
          <Images className="size-6 text-white" />
        </div>
      )}
    </div>
  )
}
