import { Badge } from '@/components/ui/badge'
import { getLiveEventMetadataFromEvent } from '@/lib/event-metadata'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import ClientSelect from '../ClientSelect'
import Image from '../Image'

export default function LiveEvent({ event, className }: { event: Event; className?: string }) {
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const contentPolicy = useContentPolicyOptional()
  const autoLoadMedia = contentPolicy?.autoLoadMedia ?? true
  const metadata = useMemo(() => getLiveEventMetadataFromEvent(event), [event])

  const liveStatusComponent =
    metadata.status &&
    (metadata.status === 'live' ? (
      <Badge className="bg-green-400 hover:bg-green-400">live</Badge>
    ) : metadata.status === 'ended' ? (
      <Badge variant="destructive">ended</Badge>
    ) : (
      <Badge variant="secondary">{metadata.status}</Badge>
    ))

  const titleComponent = <div className="text-xl font-semibold break-words min-w-0 sm:line-clamp-1">{metadata.title}</div>

  const summaryComponent = metadata.summary && (
    <div className="text-base text-muted-foreground line-clamp-4">{metadata.summary}</div>
  )

  const tagsComponent = metadata.tags.length > 0 && (
    <div className="flex gap-1 flex-wrap">
      {metadata.tags.map((tag) => (
        <Badge key={tag} variant="secondary">
          {tag}
        </Badge>
      ))}
    </div>
  )

  if (isSmallScreen) {
    return (
      <div className={className}>
        {metadata.image && autoLoadMedia && (
          <Image
            image={{ url: metadata.image, pubkey: event.pubkey }}
            className="w-full aspect-video"
            hideIfError
          />
        )}
        <div className="space-y-1">
          {titleComponent}
          {liveStatusComponent}
          {summaryComponent}
          {tagsComponent}
          <ClientSelect className="w-full mt-2" event={event} />
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="flex gap-4">
        {metadata.image && autoLoadMedia && (
          <Image
            image={{ url: metadata.image, pubkey: event.pubkey }}
            className="aspect-[4/3] xl:aspect-video bg-foreground h-44"
            hideIfError
          />
        )}
        <div className="flex-1 w-0 space-y-1">
          {titleComponent}
          {liveStatusComponent}
          {summaryComponent}
          {tagsComponent}
        </div>
      </div>
      <ClientSelect className="w-full mt-2" event={event} />
    </div>
  )
}
