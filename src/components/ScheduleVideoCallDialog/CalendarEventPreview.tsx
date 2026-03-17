import { EmbeddedCalendarEvent } from '@/components/Embedded/EmbeddedCalendarEvent'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TDraftEvent } from '@/types'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * Converts a draft (no id/pubkey/sig) into an event-like object for preview rendering.
 */
function draftToPreviewEvent(draft: TDraftEvent): Event {
  return {
    id: '',
    pubkey: '',
    sig: '',
    kind: draft.kind,
    created_at: draft.created_at,
    tags: draft.tags,
    content: draft.content
  }
}

export function CalendarEventPreview({
  draft,
  className
}: {
  draft: TDraftEvent
  className?: string
}) {
  const { t } = useTranslation()
  const previewEvent = draftToPreviewEvent(draft)
  const jsonString = JSON.stringify(
    { kind: draft.kind, content: draft.content, tags: draft.tags, created_at: draft.created_at },
    null,
    2
  )

  return (
    <div className={cn('space-y-2', className)}>
      <Tabs defaultValue="rendered" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="rendered">{t('Rendered')}</TabsTrigger>
          <TabsTrigger value="json">{t('JSON')}</TabsTrigger>
        </TabsList>
        <TabsContent value="rendered" className="mt-2">
          <div className="rounded-md border bg-muted/20 p-2">
            <EmbeddedCalendarEvent event={previewEvent} />
          </div>
        </TabsContent>
        <TabsContent value="json" className="mt-2">
          <pre className="max-h-[240px] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
            {jsonString}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  )
}
