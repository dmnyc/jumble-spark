import { Separator } from '@/components/ui/separator'
import { toNote } from '@/lib/link'
import { useSmartNoteNavigation } from '@/PageManager'
import client from '@/services/client.service'
import { Event } from 'nostr-tools'
import Collapsible from '../Collapsible'
import Note from '../Note'
import NoteStats from '../NoteStats'
import RepostDescription from './RepostDescription'

export default function MainNoteCard({
  event,
  className,
  reposter,
  embedded,
  originalNoteId
}: {
  event: Event
  className?: string
  reposter?: string
  embedded?: boolean
  originalNoteId?: string
}) {
  const { navigateToNote } = useSmartNoteNavigation()

  return (
    <div
      className={className}
      data-event-id={event.id}
      onClick={(e) => {
        // Don't navigate when user has selected text (e.g. for creating a highlight)
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed) return
        // Don't navigate if clicking on interactive elements
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('[role="button"]') || target.closest('a') || target.closest('[data-parent-note-preview]') || target.closest('[data-user-avatar]') || target.closest('[data-username]')) {
          return
        }
        // For embedded notes, allow clicks (don't exclude [data-embedded-note])
        // as embedded notes should be clickable to navigate to their page
        if (!embedded && target.closest('[data-embedded-note]')) {
          return
        }
        e.stopPropagation()
        client.addEventToCache(event)
        const noteUrl = toNote(originalNoteId ?? event)
        navigateToNote(noteUrl, event)
      }}
    >
      <div className={`clickable ${embedded ? 'p-2 sm:p-3 border rounded-lg' : 'py-3'}`} style={embedded ? { position: 'relative', isolation: 'isolate', overflow: 'visible' } : undefined}>
        <Collapsible alwaysExpand={embedded}>
          <RepostDescription className={embedded ? '' : 'px-4'} reposter={reposter} />
          <Note
            className={embedded ? '' : 'px-4'}
            size={embedded ? 'small' : 'normal'}
            event={event}
            originalNoteId={originalNoteId}
            disableClick={true}
          />
        </Collapsible>
        {!embedded && (
          <NoteStats className="mt-3 px-4" event={event} fetchIfNotExisting={true} />
        )}
      </div>
      {!embedded && <Separator />}
    </div>
  )
}
