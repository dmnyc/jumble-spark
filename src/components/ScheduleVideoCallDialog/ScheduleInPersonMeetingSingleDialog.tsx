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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import {
  createInPersonCalendarEventDraftEvent,
  createInPersonDateBasedCalendarEventDraftEvent,
  createPublicMessageDraftEvent
} from '@/lib/draft-event'
import { getNoteBech32Id } from '@/lib/event'
import { randomString } from '@/lib/random'
import { useNostr } from '@/providers/NostrProvider'
import { MapPin } from 'lucide-react'
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

export function ScheduleInPersonMeetingSingleDialog({
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

  const [eventType, setEventType] = useState<'time' | 'date'>('time')
  const [title, setTitle] = useState('')
  const [startDatetime, setStartDatetime] = useState('')
  const [endDatetime, setEndDatetime] = useState('')
  const [startDateStr, setStartDateStr] = useState('')
  const [endDateStr, setEndDateStr] = useState('')
  const [location, setLocation] = useState('')
  const [summary, setSummary] = useState('')
  const [topics, setTopics] = useState('')
  const [image, setImage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const formValid = useMemo(() => {
    if (eventType === 'date') {
      if (!startDateStr.trim()) return false
      if (endDateStr.trim() && endDateStr <= startDateStr) return false
      return true
    }
    if (!startDatetime.trim()) return false
    const startUnix = Math.floor(new Date(startDatetime).getTime() / 1000)
    const endUnix = endDatetime.trim()
      ? Math.floor(new Date(endDatetime).getTime() / 1000)
      : undefined
    if (endUnix != null && endUnix <= startUnix) return false
    return true
  }, [eventType, startDatetime, endDatetime, startDateStr, endDateStr])

  const previewDraft = useMemo(() => {
    if (!formValid) return null
    const d = 'preview'
    if (eventType === 'date') {
      if (!startDateStr.trim()) return null
      if (endDateStr.trim() && endDateStr <= startDateStr) return null
      return createInPersonDateBasedCalendarEventDraftEvent({
        d,
        title: title.trim() || t('In-person meeting'),
        start: startDateStr,
        end: endDateStr.trim() || undefined,
        location: location.trim() || undefined,
        summary: summary.trim() || undefined,
        image: image.trim() || undefined,
        topics: parseTopicTags(topics),
        participants: [inviteePubkey]
      })
    }
    if (!startDatetime.trim()) return null
    const startDate = new Date(startDatetime)
    const startUnix = Math.floor(startDate.getTime() / 1000)
    const endUnix = endDatetime.trim()
      ? Math.floor(new Date(endDatetime).getTime() / 1000)
      : undefined
    if (endUnix != null && endUnix <= startUnix) return null
    return createInPersonCalendarEventDraftEvent({
      d,
      title: title.trim() || t('In-person meeting'),
      start: startUnix,
      end: endUnix,
      location: location.trim() || undefined,
      summary: summary.trim() || undefined,
      image: image.trim() || undefined,
      topics: parseTopicTags(topics),
      participants: [inviteePubkey]
    })
  }, [
    eventType,
    title,
    startDatetime,
    endDatetime,
    startDateStr,
    endDateStr,
    location,
    summary,
    topics,
    image,
    inviteePubkey,
    t,
    formValid
  ])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formValid) return
    if (eventType === 'date') {
      if (!startDateStr.trim()) {
        toast.error(t('Please set a start date'))
        return
      }
      if (endDateStr.trim() && endDateStr <= startDateStr) {
        toast.error(t('End date must be after start date'))
        return
      }
    } else {
      if (!startDatetime.trim()) {
        toast.error(t('Please set a start time'))
        return
      }
      const startDate = new Date(startDatetime)
      const startUnix = Math.floor(startDate.getTime() / 1000)
      const endUnix = endDatetime.trim()
        ? Math.floor(new Date(endDatetime).getTime() / 1000)
        : undefined
      if (endUnix != null && endUnix <= startUnix) {
        toast.error(t('End time must be after start time'))
        return
      }
    }

    setSubmitting(true)
    try {
      const d = `jumble-inperson-${randomString(12)}`
      const calendarDraft =
        eventType === 'date'
          ? createInPersonDateBasedCalendarEventDraftEvent({
              d,
              title: title.trim() || t('In-person meeting'),
              start: startDateStr,
              end: endDateStr.trim() || undefined,
              location: location.trim() || undefined,
              summary: summary.trim() || undefined,
              image: image.trim() || undefined,
              topics: parseTopicTags(topics),
              participants: [inviteePubkey]
            })
          : createInPersonCalendarEventDraftEvent({
              d,
              title: title.trim() || t('In-person meeting'),
              start: Math.floor(new Date(startDatetime).getTime() / 1000),
              end: endDatetime.trim()
                ? Math.floor(new Date(endDatetime).getTime() / 1000)
                : undefined,
              location: location.trim() || undefined,
              summary: summary.trim() || undefined,
              image: image.trim() || undefined,
              topics: parseTopicTags(topics),
              participants: [inviteePubkey]
            })

      const calendarEvent = await publish(calendarDraft)
      const naddr = getNoteBech32Id(calendarEvent)
      const messageContent = `${t("You're invited to an in-person meeting.")} nostr:${naddr}`

      const pmDraft = await createPublicMessageDraftEvent(
        messageContent,
        [inviteePubkey],
        { addClientTag: true }
      )
      await publish(pmDraft)

      toast.success(t('Meeting created and invite sent'))
      onOpenChange(false)
      setEventType('time')
      setTitle('')
      setStartDatetime('')
      setEndDatetime('')
      setStartDateStr('')
      setEndDateStr('')
      setLocation('')
      setSummary('')
      setTopics('')
      setImage('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Failed to create meeting'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="size-5" />
            {t('Schedule in-person meeting')}
          </DialogTitle>
          <DialogDescription>
            {t('Required: start time or start date. Optional: title, end, location, summary, topics, image.')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          <div>
            <Label>{t('Event type')}</Label>
            <RadioGroup
              value={eventType}
              onValueChange={(v) => setEventType(v as 'time' | 'date')}
              className="mt-2 flex gap-4"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="time" id="inperson-type-time" />
                <span className="text-sm">{t('Time-based')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="date" id="inperson-type-date" />
                <span className="text-sm">{t('Date-based (all-day)')}</span>
              </label>
            </RadioGroup>
          </div>
          <div>
            <Label htmlFor="inperson-title">
              {t('Title')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="inperson-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('In-person meeting')}
              className="mt-1"
            />
          </div>
          {eventType === 'date' ? (
            <>
              <div>
                <Label htmlFor="inperson-start-date">{t('Start date')} *</Label>
                <Input
                  id="inperson-start-date"
                  type="date"
                  value={startDateStr}
                  onChange={(e) => setStartDateStr(e.target.value)}
                  className="mt-1"
                  required={eventType === 'date'}
                />
              </div>
              <div>
                <Label htmlFor="inperson-end-date">
                  {t('End date')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
                </Label>
                <Input
                  id="inperson-end-date"
                  type="date"
                  value={endDateStr}
                  onChange={(e) => setEndDateStr(e.target.value)}
                  className="mt-1"
                />
              </div>
            </>
          ) : (
            <>
              <DateTimePicker
                id="inperson-start"
                value={startDatetime}
                onChange={setStartDatetime}
                label={t('Start')}
                labelSuffix="*"
                required={eventType === 'time'}
              />
              <DateTimePicker
                id="inperson-end"
                value={endDatetime}
                onChange={setEndDatetime}
                label={t('End')}
                labelSuffix={
                  <span className="text-muted-foreground font-normal">({t('optional')})</span>
                }
              />
            </>
          )}
          <div>
            <Label htmlFor="inperson-location">
              {t('Location')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="inperson-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('Address, venue, or place')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="inperson-summary">
              {t('Summary')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Textarea
              id="inperson-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t('Brief description of the event')}
              className="mt-1 min-h-[60px]"
            />
          </div>
          <div>
            <Label htmlFor="inperson-topics">
              {t('Topics')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="inperson-topics"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              placeholder={t('e.g. meetup, conference')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="inperson-image">
              {t('Image URL')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="inperson-image"
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
              {submitting ? t('Creating…') : t('Create and send invite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
