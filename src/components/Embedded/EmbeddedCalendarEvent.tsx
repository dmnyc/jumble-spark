import {
  getCalendarEventMeta,
  formatCalendarTime,
  formatCalendarDate,
  isCalendarEventKind
} from '@/lib/calendar-event'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Calendar, Video } from 'lucide-react'

export function EmbeddedCalendarEvent({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  if (!isCalendarEventKind(event.kind)) return null
  const { title, summary, image, start, end, startDate, endDate, isDateBased, joinUrl, topics } =
    getCalendarEventMeta(event)
  const description = summary || event.content?.trim() || ''

  return (
    <div
      className={cn(
        'rounded-lg border bg-muted/40 p-3 text-sm min-w-0',
        className
      )}
      data-embedded-calendar-event
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
      {joinUrl && (
        <Button
          variant="secondary"
          size="sm"
          className="w-full gap-2 mt-1"
          asChild
        >
          <a href={joinUrl} target="_blank" rel="noopener noreferrer">
            <Video className="size-4" />
            {t('Join video call')}
          </a>
        </Button>
      )}
    </div>
  )
}
