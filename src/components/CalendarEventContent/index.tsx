import { createCalendarRsvpDraftEvent } from '@/lib/draft-event'
import {
  getCalendarEventMeta,
  formatCalendarTime,
  formatCalendarDate,
  isCalendarEventKind
} from '@/lib/calendar-event'
import { useFetchCalendarRsvps } from '@/hooks/useFetchCalendarRsvps'
import { useNostr } from '@/providers/NostrProvider'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Calendar, Video, CheckCircle, HelpCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { toast } from 'sonner'

type RsvpStatus = 'accepted' | 'tentative' | 'declined'

export default function CalendarEventContent({
  event,
  className,
  showRsvp = true
}: {
  event: Event
  className?: string
  showRsvp?: boolean
}) {
  const { t } = useTranslation()
  const { pubkey: myPubkey, publish } = useNostr()
  const { rsvps, isFetching, getRsvpStatus: getStatus } = useFetchCalendarRsvps(event)

  if (!isCalendarEventKind(event.kind)) return null

  const { title, summary, image, start, end, startDate, endDate, isDateBased, joinUrl, topics } =
    getCalendarEventMeta(event)
  const description = summary || event.content?.trim() || ''
  const myRsvp = myPubkey ? rsvps.find((r) => r.pubkey === myPubkey) : undefined
  const myStatus = myRsvp ? getStatus(myRsvp) : undefined

  const handleRsvp = async (status: RsvpStatus) => {
    if (!myPubkey) {
      toast.error(t('You need to log in to RSVP'))
      return
    }
    try {
      const draft = createCalendarRsvpDraftEvent(event, status)
      await publish(draft)
      toast.success(t('RSVP updated'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Failed to update RSVP'))
    }
  }

  return (
    <div
      className={cn('rounded-lg border bg-muted/40 p-3 text-sm min-w-0', className)}
      data-calendar-event-content
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2 mb-2">
        {image ? (
          <img
            src={image}
            alt=""
            className="size-12 shrink-0 rounded object-cover"
          />
        ) : (
          <Calendar className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <span className="font-medium text-foreground truncate block">
            {title || t('Scheduled video call')}
          </span>
          {topics.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {topics.map((topic) => (
                <span
                  key={topic}
                  className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  #{topic}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {isDateBased ? (
        (startDate || endDate) && (
          <div className="text-muted-foreground text-xs mb-2">
            {startDate ? formatCalendarDate(startDate) : ''}
            {endDate && endDate !== startDate && (
              <> – {formatCalendarDate(endDate)}</>
            )}
          </div>
        )
      ) : (
        start != null &&
        !isNaN(start) && (
          <div className="text-muted-foreground text-xs mb-2">
            {formatCalendarTime(start)}
            {end != null && !isNaN(end) && end > start && (
              <> – {formatCalendarTime(end)}</>
            )}
          </div>
        )
      )}
      {description && (
        <p className="text-muted-foreground text-xs mb-2 whitespace-pre-wrap break-words">
          {description}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {joinUrl && (
          <Button variant="secondary" size="sm" className="gap-2" asChild>
            <a href={joinUrl} target="_blank" rel="noopener noreferrer">
              <Video className="size-4" />
              {t('Join video call')}
            </a>
          </Button>
        )}
        {showRsvp && myPubkey && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isFetching}
              >
                {myStatus === 'accepted' && <CheckCircle className="size-4 text-green-600" />}
                {myStatus === 'tentative' && <HelpCircle className="size-4 text-amber-600" />}
                {myStatus === 'declined' && <XCircle className="size-4 text-muted-foreground" />}
                {myStatus
                  ? t('RSVP: {{status}}', { status: myStatus })
                  : t('RSVP')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => handleRsvp('accepted')}>
                <CheckCircle className="size-4 mr-2 text-green-600" />
                {t('Accepted')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRsvp('tentative')}>
                <HelpCircle className="size-4 mr-2 text-amber-600" />
                {t('Tentative')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRsvp('declined')}>
                <XCircle className="size-4 mr-2" />
                {t('Declined')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
