import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  createCalendarEventDraftEvent,
  createPublicMessageDraftEvent
} from '@/lib/draft-event'
import { getNoteBech32Id } from '@/lib/event'
import { buildHiveTalkJoinUrl, roomIdForScheduledCall } from '@/lib/hivetalk'
import { randomString } from '@/lib/random'
import { useNostr } from '@/providers/NostrProvider'
import { Calendar } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CalendarEventPreview } from './CalendarEventPreview'

function parseTopicTags(value: string): string[] {
  return [
    ...new Set(
      value
        .trim()
        .split(/[\s,]+/)
        .map((s) => s.replace(/^#+/, '').trim())
        .filter(Boolean)
    )
  ]
}

export function ScheduleVideoCallSingleDialog({
  inviteePubkey,
  open,
  onOpenChange
}: {
  inviteePubkey: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { publish } = useNostr()
  const joinAsName = 'Guest'

  const [title, setTitle] = useState('')
  const [startDatetime, setStartDatetime] = useState('')
  const [endDatetime, setEndDatetime] = useState('')
  const [locationUrl, setLocationUrl] = useState('')
  const [summary, setSummary] = useState('')
  const [topics, setTopics] = useState('')
  const [image, setImage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const formValid = useMemo(() => {
    if (!startDatetime.trim()) return false
    const startUnix = Math.floor(new Date(startDatetime).getTime() / 1000)
    const endUnix = endDatetime.trim()
      ? Math.floor(new Date(endDatetime).getTime() / 1000)
      : undefined
    if (endUnix != null && endUnix <= startUnix) return false
    return true
  }, [startDatetime, endDatetime])

  const previewDraft = useMemo(() => {
    if (!formValid) return null
    if (!startDatetime.trim()) return null
    const startDate = new Date(startDatetime)
    const startUnix = Math.floor(startDate.getTime() / 1000)
    const endUnix = endDatetime.trim()
      ? Math.floor(new Date(endDatetime).getTime() / 1000)
      : undefined
    if (endUnix != null && endUnix <= startUnix) return null
    const d = 'preview'
    const roomId = roomIdForScheduledCall(d)
    const defaultJoinUrl = buildHiveTalkJoinUrl({ room: roomId, name: joinAsName })
    const joinUrl = locationUrl.trim() || defaultJoinUrl
    return createCalendarEventDraftEvent({
      d,
      title: title.trim() || t('Video call'),
      start: startUnix,
      end: endUnix,
      locationUrl: joinUrl,
      summary: summary.trim() || undefined,
      image: image.trim() || undefined,
      topics: parseTopicTags(topics),
      participants: [inviteePubkey]
    })
  }, [
    title,
    startDatetime,
    endDatetime,
    locationUrl,
    summary,
    topics,
    image,
    inviteePubkey,
    joinAsName,
    t,
    formValid
  ])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formValid) return
    if (!startDatetime.trim()) {
      toast.error(t('Please set a start time'))
      return
    }
    setSubmitting(true)
    try {
      const startDate = new Date(startDatetime)
      const startUnix = Math.floor(startDate.getTime() / 1000)
      const endUnix = endDatetime.trim()
        ? Math.floor(new Date(endDatetime).getTime() / 1000)
        : undefined
      if (endUnix != null && endUnix <= startUnix) {
        toast.error(t('End time must be after start time'))
        setSubmitting(false)
        return
      }

      const d = `jumble-cal-${randomString(12)}`
      const roomId = roomIdForScheduledCall(d)
      const defaultJoinUrl = buildHiveTalkJoinUrl({
        room: roomId,
        name: joinAsName
      })
      const joinUrl = locationUrl.trim() || defaultJoinUrl

      const calendarDraft = createCalendarEventDraftEvent({
        d,
        title: title.trim() || t('Video call'),
        start: startUnix,
        end: endUnix,
        locationUrl: joinUrl,
        summary: summary.trim() || undefined,
        image: image.trim() || undefined,
        topics: parseTopicTags(topics),
        participants: [inviteePubkey]
      })

      const calendarEvent = await publish(calendarDraft)
      const naddr = getNoteBech32Id(calendarEvent)
      const messageContent = `${t("You're invited to a scheduled video call.")} nostr:${naddr}`

      const pmDraft = await createPublicMessageDraftEvent(
        messageContent,
        [inviteePubkey],
        { addClientTag: true }
      )
      await publish(pmDraft)

      toast.success(t('Scheduled call created and invite sent'))
      onOpenChange(false)
      setTitle('')
      setStartDatetime('')
      setEndDatetime('')
      setLocationUrl('')
      setSummary('')
      setTopics('')
      setImage('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Failed to schedule call'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="size-5" />
            {t('Schedule video call')}
          </DialogTitle>
          <DialogDescription>
            {t('Required: start time. Join link defaults to HiveTalk. Optional: title, end, summary, topics, image.')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          <div>
            <Label htmlFor="schedule-call-title">
              {t('Title')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="schedule-call-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('Video call')}
              className="mt-1"
            />
          </div>
          <DateTimePicker
            id="schedule-call-start"
            value={startDatetime}
            onChange={setStartDatetime}
            label={t('Start')}
            labelSuffix="*"
            required
          />
          <DateTimePicker
            id="schedule-call-end"
            value={endDatetime}
            onChange={setEndDatetime}
            label={t('End')}
            labelSuffix={
              <span className="text-muted-foreground font-normal">({t('optional')})</span>
            }
          />
          <div>
            <Label htmlFor="schedule-call-location">
              {t('Join link')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="schedule-call-location"
              type="url"
              value={locationUrl}
              onChange={(e) => setLocationUrl(e.target.value)}
              placeholder={t('Leave empty for HiveTalk, or paste Zoom / Teams / other link')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="schedule-call-summary">
              {t('Summary')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Textarea
              id="schedule-call-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t('Brief description of the event')}
              className="mt-1 min-h-[60px]"
            />
          </div>
          <div>
            <Label htmlFor="schedule-call-topics">
              {t('Topics')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="schedule-call-topics"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              placeholder={t('e.g. meetup, conference')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="schedule-call-image">
              {t('Image URL')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="schedule-call-image"
              type="url"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder={t('Optional image for the event')}
              className="mt-1"
            />
          </div>
          {formValid && previewDraft && (
            <div className="min-h-0 shrink-0">
              <Label className="mb-1 block">{t('Preview')}</Label>
              <CalendarEventPreview draft={previewDraft} />
            </div>
          )}
          </div>
          <DialogFooter className="shrink-0 pt-2 border-t mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !formValid}>
              {submitting ? t('Scheduling…') : t('Schedule and send invite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
