import { useFetchEvent } from '@/hooks'
import CitationCard from '@/components/CitationCard'
import { Skeleton } from '@/components/ui/skeleton'
import { nip19 } from 'nostr-tools'

interface EmbeddedCitationProps {
  citationId: string // nevent or note ID
  displayType?: 'end' | 'foot' | 'foot-end' | 'inline' | 'quote' | 'prompt-end' | 'prompt-inline'
  className?: string
}

export default function EmbeddedCitation({ citationId, displayType = 'end', className }: EmbeddedCitationProps) {
  // Try to decode as bech32 first
  let eventId: string | null = null
  
  try {
    const decoded = nip19.decode(citationId)
    if (decoded.type === 'nevent') {
      const data = decoded.data as any
      eventId = data.id || citationId
    } else if (decoded.type === 'note') {
      eventId = decoded.data as string
    } else {
      // If it's not a note/nevent, use the original ID
      eventId = citationId
    }
  } catch {
    // If decoding fails, assume it's already a hex ID
    eventId = citationId
  }

  const { event, isLoading } = useFetchEvent(eventId || '')

  if (isLoading) {
    return (
      <div className={className}>
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className={className}>
        <div className="text-sm text-muted-foreground p-2 border rounded">
          Citation not found: {citationId.slice(0, 20)}...
        </div>
      </div>
    )
  }

  return <CitationCard event={event} displayType={displayType} className={className} />
}

