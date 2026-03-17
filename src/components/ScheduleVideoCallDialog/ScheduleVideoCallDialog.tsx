import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { InviteePicker } from '@/components/InviteePicker'
import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  createCalendarEventDraftEvent,
  createPublicMessageDraftEvent
} from '@/lib/draft-event'
import { MAX_CALENDAR_INVITEES } from '@/constants'
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

export function ScheduleVideoCallDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { publish } = useNostr()

  const [title, setTitle] = useState('')
  const [startDatetime, setStartDatetime] = useState('')
  const [endDatetime, setEndDatetime] = useState('')
  const [locationUrl, setLocationUrl] = useState('')
  const [summary, setSummary] = useState('')
  const [topics, setTopics] = useState('')
  const [image, setImage] = useState('')
  const [inviteePubkeys, setInviteePubkeys] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const formValid = useMemo(() => {
    if (!startDatetime.trim()) return false
    const startDate = new Date(startDatetime)
    const startUnix = Math.floor(startDate.getTime() / 1000)
    const endUnix = endDatetime.trim()
      ? Math.floor(new Date(endDatetime).getTime() / 1000)
      : undefined
    if (endUnix != null && endUnix <= startUnix) return false
    if (inviteePubkeys.length === 0 || inviteePubkeys.length > MAX_CALENDAR_INVITEES) return false
    return true
  }, [startDatetime, endDatetime, inviteePubkeys])

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
    const defaultJoinUrl = buildHiveTalkJoinUrl({ room: roomId, name: 'Guest' })
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
      participants: inviteePubkeys
    })
  }, [
    title,
    startDatetime,
    endDatetime,
    locationUrl,
    summary,
    topics,
    image,
    inviteePubkeys,
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
    if (inviteePubkeys.length === 0) {
      toast.error(t('Add at least one invitee'))
      return
    }
    if (inviteePubkeys.length > MAX_CALENDAR_INVITEES) {
      toast.error(t('Maximum {{max}} invitees allowed', { max: MAX_CALENDAR_INVITEES }))
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
        name: 'Guest'
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
        participants: inviteePubkeys
      })

      const calendarEvent = await publish(calendarDraft)
      const naddr = getNoteBech32Id(calendarEvent)
      const messageContent = `${t("You're invited to a scheduled video call.")} nostr:${naddr}`

      const pmDraft = await createPublicMessageDraftEvent(
        messageContent,
        inviteePubkeys,
        { addClientTag: true }
      )
      await publish(pmDraft)

      toast.success(
        t('Scheduled call created and {{count}} invite(s) sent', {
          count: inviteePubkeys.length
        })
      )
      onOpenChange(false)
      setTitle('')
      setStartDatetime('')
      setEndDatetime('')
      setLocationUrl('')
      setSummary('')
      setTopics('')
      setImage('')
      setInviteePubkeys([])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Failed to schedule call'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="size-5" />
            {t('Schedule a video call')}
          </DialogTitle>
          <DialogDescription>
            {t('Required: start time, invitees. Join link defaults to HiveTalk. Optional: title, end, summary, topics, image.')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="own-call-title">
              {t('Title')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="own-call-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('Video call')}
              className="mt-1"
            />
          </div>
          <DateTimePicker
            id="own-call-start"
            value={startDatetime}
            onChange={setStartDatetime}
            label={t('Start')}
            labelSuffix="*"
            required
          />
          <DateTimePicker
            id="own-call-end"
            value={endDatetime}
            onChange={setEndDatetime}
            label={t('End')}
            labelSuffix={
              <span className="text-muted-foreground font-normal">({t('optional')})</span>
            }
          />
          <div>
            <Label htmlFor="own-call-location">
              {t('Join link')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="own-call-location"
              type="url"
              value={locationUrl}
              onChange={(e) => setLocationUrl(e.target.value)}
              placeholder={t('Leave empty for HiveTalk, or paste Zoom / Teams / other link')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="own-call-summary">
              {t('Summary')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Textarea
              id="own-call-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t('Brief description of the event')}
              className="mt-1 min-h-[60px]"
            />
          </div>
          <div>
            <Label htmlFor="own-call-topics">
              {t('Topics')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="own-call-topics"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              placeholder={t('e.g. meetup, conference')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="own-call-image">
              {t('Image URL')} <span className="text-muted-foreground font-normal">({t('optional')})</span>
            </Label>
            <Input
              id="own-call-image"
              type="url"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder={t('Optional image for the event')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="own-call-invitees">{t('Invitees')} *</Label>
            <InviteePicker
              labelId="own-call-invitees"
              value={inviteePubkeys}
              onChange={setInviteePubkeys}
              placeholder={t('Search by name or npub…')}
              className="mt-1"
              max={MAX_CALENDAR_INVITEES}
            />
          </div>
          {formValid && previewDraft && (
            <div>
              <Label className="mb-1 block">{t('Preview')}</Label>
              <CalendarEventPreview draft={previewDraft} />
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !formValid}>
              {submitting ? t('Scheduling…') : t('Schedule and send invites')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
