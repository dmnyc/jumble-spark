import { Separator } from '@/components/ui/separator'
import { ExtendedKind } from '@/constants'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import HideUntrustedContentButton from '../HideUntrustedContentButton'
import QuoteList from '../QuoteList'
import ReactionList from '../ReactionList'
import ReplyNoteList from '../ReplyNoteList'
import RepostList from '../RepostList'
import ZapList from '../ZapList'
import { Tabs, TTabValue } from './Tabs'
import ReplySort, { ReplySortOption } from './ReplySort'

export default function NoteInteractions({
  pageIndex,
  event
}: {
  pageIndex?: number
  event: Event
}) {
  const [type, setType] = useState<TTabValue>('replies')
  const [replySort, setReplySort] = useState<ReplySortOption>('oldest')
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  
  // Hide interactions if event is in quiet mode
  if (shouldHideInteractions(event)) {
    return null
  }
  
  let list
  switch (type) {
    case 'replies':
      list = <ReplyNoteList index={pageIndex} event={event} sort={replySort} />
      break
    case 'quotes':
      if (isDiscussion) return null // Hide quotes for discussions
      list = <QuoteList event={event} />
      break
    case 'reactions':
      list = <ReactionList event={event} />
      break
    case 'reposts':
      if (isDiscussion) return null // Hide reposts for discussions
      list = <RepostList event={event} />
      break
    case 'zaps':
      list = <ZapList event={event} />
      break
    default:
      break
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex-1 w-0">
          <Tabs selectedTab={type} onTabChange={setType} hideRepostsAndQuotes={isDiscussion} />
        </div>
        <Separator orientation="vertical" className="h-6" />
        {type === 'replies' && isDiscussion && (
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
      {list}
    </>
  )
}
