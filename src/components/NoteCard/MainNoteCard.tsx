import { ExtendedKind } from '@/constants'
import { Separator } from '@/components/ui/separator'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { toNote } from '@/lib/link'
import { useSmartNoteNavigationOptional } from '@/PageManager'
import client from '@/services/client.service'
import { Pin } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import Collapsible from '../Collapsible'
import Note from '../Note'
import NoteStats from '../NoteStats'
import RepostDescription from './RepostDescription'

export default function MainNoteCard({
  event,
  className,
  reposter,
  embedded,
  originalNoteId,
  pinned = false,
  hideParentNotePreview = false,
  zapPollVoteHighlightOption,
  bottomNoteLabel,
  showFull = false
}: {
  event: Event
  className?: string
  reposter?: string
  embedded?: boolean
  originalNoteId?: string
  /** Profile (or other) pinned highlight */
  pinned?: boolean
  /** Hide the parent note preview (e.g. when showing quotes of current note). */
  hideParentNotePreview?: boolean
  zapPollVoteHighlightOption?: number
  bottomNoteLabel?: string
  showFull?: boolean
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const isZapFeedCard =
    event.kind === ExtendedKind.ZAP_RECEIPT || event.kind === ExtendedKind.ZAP_REQUEST
  const showNoteStatsRow = !embedded || isZapFeedCard

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
        if (
          target.closest('button') ||
          target.closest('[role="button"]') ||
          target.closest('a') ||
          target.closest('[data-parent-note-preview]') ||
          target.closest('[data-user-avatar]') ||
          target.closest('[data-username]') ||
          target.closest('[data-note-stats]')
        ) {
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
        navigateToNote(noteUrl, event, getCachedThreadContextEvents(event))
      }}
    >
      <div className={`clickable ${embedded ? 'p-2 sm:p-3 border rounded-lg' : 'py-3'}`} style={embedded ? { position: 'relative', isolation: 'isolate', overflow: 'visible' } : undefined}>
        {pinned && !embedded && (
          <div
            className="flex items-center gap-1.5 px-4 pb-1 text-muted-foreground"
            role="img"
            aria-label={t('Pinned note')}
          >
            <Pin className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
          </div>
        )}
        <Collapsible alwaysExpand={embedded}>
          <RepostDescription className={embedded ? '' : 'px-4'} reposter={reposter} />
          <Note
            className={embedded ? '' : 'px-4'}
            size={embedded ? 'small' : 'normal'}
            event={event}
            originalNoteId={originalNoteId}
            disableClick={true}
            hideParentNotePreview={hideParentNotePreview}
            zapPollVoteHighlightOption={zapPollVoteHighlightOption}
            showFull={showFull}
          />
        </Collapsible>
        {showNoteStatsRow ? (
          <NoteStats
            className={embedded ? 'mt-2 px-2 sm:px-3' : 'mt-3 px-4'}
            event={event}
            fetchIfNotExisting={true}
            displayTopZapsAndLikes={isZapFeedCard}
          />
        ) : null}
        {!embedded && bottomNoteLabel ? (
          <div className="px-4 pt-1 text-xs text-muted-foreground">{bottomNoteLabel}</div>
        ) : null}
      </div>
      {!embedded && <Separator />}
    </div>
  )
}
