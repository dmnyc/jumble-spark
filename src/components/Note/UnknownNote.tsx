import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import ClientSelect from '../ClientSelect'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { ExtendedKind } from '@/constants'
import { useMemo } from 'react'
import EventViewer from './EventViewer'

export default function UnknownNote({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const bookMetadata = useMemo(() => extractBookMetadata(event), [event])
  const isBookstrEvent = (event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata.book

  const formatBookName = (book: string) => {
    return book
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 my-4',
        className
      )}
    >
      <div className="flex flex-col gap-2 items-center text-muted-foreground font-medium">
        <div>{t('Cannot handle event of kind k', { k: event.kind })}</div>
        {isBookstrEvent && (
          <div className="text-xs text-muted-foreground space-x-2">
            {bookMetadata.type && <span>Type: {bookMetadata.type}</span>}
            {bookMetadata.book && <span>Book: {formatBookName(bookMetadata.book)}</span>}
            {bookMetadata.chapter && <span>Chapter: {bookMetadata.chapter}</span>}
            {bookMetadata.verse && <span>Verse: {bookMetadata.verse}</span>}
            {bookMetadata.version && <span>Version: {bookMetadata.version.toUpperCase()}</span>}
          </div>
        )}
        <ClientSelect event={event} />
      </div>
      <EventViewer event={event} />
    </div>
  )
}
