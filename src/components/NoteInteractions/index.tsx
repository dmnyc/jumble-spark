import { Separator } from '@/components/ui/separator'
import { ExtendedKind } from '@/constants'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import HideUntrustedContentButton from '../HideUntrustedContentButton'
import ReplyNoteList from '../ReplyNoteList'
import ReplySort, { ReplySortOption } from './ReplySort'

export default function NoteInteractions({
  pageIndex,
  event
}: {
  pageIndex?: number
  event: Event
}) {
  const { t } = useTranslation()
  const [replySort, setReplySort] = useState<ReplySortOption>('oldest')
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION

  // Hide interactions if event is in quiet mode
  if (shouldHideInteractions(event)) {
    return null
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex-1 w-0 min-w-0">
          <div className="py-2 px-2 sm:px-4 md:px-6 font-semibold text-xs sm:text-sm md:text-base text-foreground whitespace-nowrap">
            {t('Replies')}
          </div>
        </div>
        <Separator orientation="vertical" className="h-6" />
        {isDiscussion && (
          <>
            <ReplySort selectedSort={replySort} onSortChange={setReplySort} />
            <Separator orientation="vertical" className="h-6" />
          </>
        )}
        <div className="size-8 flex items-center justify-center shrink-0">
          <HideUntrustedContentButton type="interactions" size="icon" />
        </div>
      </div>
      <Separator />
      <ReplyNoteList
        index={pageIndex}
        event={event}
        sort={replySort}
        showQuotes={!isDiscussion}
      />
    </>
  )
}
