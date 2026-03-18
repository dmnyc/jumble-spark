import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createSpellDraftEvent, type TSpellDraftParams } from '@/lib/draft-event'
import { useNostr } from '@/providers/NostrProvider'
import { showPublishingError, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import indexedDb from '@/services/indexed-db.service'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import logger from '@/lib/logger'

const DEFAULT_PARAMS: TSpellDraftParams = {
  cmd: 'REQ',
  content: '',
  name: '',
  alt: '',
  kinds: ['1'],
  authors: ['$me', '$contacts'],
  ids: [],
  tagFilters: [],
  limit: '50',
  since: '7d',
  until: '',
  search: '',
  relays: [],
  topics: [],
  closeOnEose: false
}

export default function CreateSpellDialog({
  open,
  onOpenChange,
  onSaved
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const [form, setForm] = useState<TSpellDraftParams>(DEFAULT_PARAMS)
  const [saving, setSaving] = useState(false)

  const handleClear = () => setForm({ ...DEFAULT_PARAMS })
  const handleCancel = () => {
    handleClear()
    onOpenChange(false)
  }

  const handleSave = async () => {
    if (!pubkey) {
      checkLogin()
      return
    }
    setSaving(true)
    try {
      const draft = createSpellDraftEvent(form)
      const event = await publish(draft)
      await indexedDb.putSpellEvent(event)
      handleClear()
      onOpenChange(false)
      onSaved?.()
      showSimplePublishSuccess(t('Spell published'))
    } catch (e) {
      logger.error('[CreateSpellDialog] Publish failed', e)
      showPublishingError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setSaving(false)
    }
  }

  const kindsStr = form.kinds.length ? form.kinds.join(', ') : ''
  const setKindsStr = (s: string) =>
    setForm((f) => ({ ...f, kinds: s.split(/[\s,]+/).filter(Boolean) }))
  const authorsStr = form.authors.join(', ')
  const setAuthorsStr = (s: string) =>
    setForm((f) => ({ ...f, authors: s.split(/[\s,]+/).filter(Boolean) }))
  const idsStr = form.ids.join(', ')
  const setIdsStr = (s: string) =>
    setForm((f) => ({ ...f, ids: s.split(/[\s,]+/).filter(Boolean) }))
  const relaysStr = form.relays.join(', ')
  const setRelaysStr = (s: string) =>
    setForm((f) => ({ ...f, relays: s.split(/[\s,]+/).filter(Boolean) }))
  const topicsStr = form.topics.join(', ')
  const setTopicsStr = (s: string) =>
    setForm((f) => ({ ...f, topics: s.split(/[\s,]+/).filter(Boolean) }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-2xl" withoutClose>
        <DialogHeader className="flex flex-row items-center justify-between gap-2 pr-8">
          <DialogTitle>{t('Create a Spell')}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onOpenChange(false)}
            aria-label={t('Close')}
          >
            <X className="size-4" />
          </Button>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t('Spells are saved relay filters (NIP-A7). Fill in the filter fields below. Use $me for your pubkey and $contacts for your follow list when executing.')}
        </p>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>{t('Command')}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={form.cmd}
              onChange={(e) => setForm((f) => ({ ...f, cmd: e.target.value as 'REQ' | 'COUNT' }))}
            >
              <option value="REQ">REQ (subscribe to events)</option>
              <option value="COUNT">COUNT (count only)</option>
            </select>
            <p className="text-xs text-muted-foreground">{t('REQ returns a feed; COUNT returns a number.')}</p>
          </div>

          <div className="grid gap-2">
            <Label>{t('Name')}</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('Human-readable spell name')}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('Description (content)')}</Label>
            <Textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder={t('Plain text description of the query')}
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('Kinds')}</Label>
            <Input
              value={kindsStr}
              onChange={(e) => setKindsStr(e.target.value)}
              placeholder="e.g. 1, 6, 7"
            />
            <p className="text-xs text-muted-foreground">{t('Comma-separated kind numbers (e.g. 1 for notes).')}</p>
          </div>

          <div className="grid gap-2">
            <Label>{t('Authors')}</Label>
            <Input
              value={authorsStr}
              onChange={(e) => setAuthorsStr(e.target.value)}
              placeholder="$me, $contacts, or npub1..."
            />
            <p className="text-xs text-muted-foreground">{t('$me = your pubkey, $contacts = your follow list. Comma-separated.')}</p>
          </div>

          <div className="grid gap-2">
            <Label>{t('Event IDs (ids)')}</Label>
            <Input
              value={idsStr}
              onChange={(e) => setIdsStr(e.target.value)}
              placeholder={t('Comma-separated event ids')}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('Limit')}</Label>
            <Input
              type="number"
              value={form.limit}
              onChange={(e) => setForm((f) => ({ ...f, limit: e.target.value }))}
              placeholder="50"
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('Since')}</Label>
            <Input
              value={form.since}
              onChange={(e) => setForm((f) => ({ ...f, since: e.target.value }))}
              placeholder="7d or 1704067200 or now"
            />
            <p className="text-xs text-muted-foreground">{t('Relative: 7d, 24h, 1w, 1mo, 1y. Or Unix timestamp.')}</p>
          </div>

          <div className="grid gap-2">
            <Label>{t('Until')}</Label>
            <Input
              value={form.until}
              onChange={(e) => setForm((f) => ({ ...f, until: e.target.value }))}
              placeholder={t('Optional')}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('Search (NIP-50)')}</Label>
            <Input
              value={form.search}
              onChange={(e) => setForm((f) => ({ ...f, search: e.target.value }))}
              placeholder={t('Full-text search query')}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('Relays')}</Label>
            <Input
              value={relaysStr}
              onChange={(e) => setRelaysStr(e.target.value)}
              placeholder="wss://relay.example.com, ..."
            />
            <p className="text-xs text-muted-foreground">{t('Leave empty to use your read relays.')}</p>
          </div>

          <div className="grid gap-2">
            <Label>{t('Topics (t tags for categorization)')}</Label>
            <Input
              value={topicsStr}
              onChange={(e) => setTopicsStr(e.target.value)}
              placeholder={t('Comma-separated topics')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('Mode')}</Label>
            <div className="flex rounded-lg border border-input bg-muted p-0.5">
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${!form.closeOnEose ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setForm((f) => ({ ...f, closeOnEose: false }))}
              >
                {t('Feed')}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${form.closeOnEose ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setForm((f) => ({ ...f, closeOnEose: true }))}
              >
                {t('Fetch')}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {form.closeOnEose ? t('Fetch once, then stop.') : t('Live feed; keeps updating.')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end pt-2 border-t">
          <Button variant="outline" onClick={handleClear}>
            {t('Clear')}
          </Button>
          <Button variant="outline" onClick={handleCancel}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('Saving…') : t('Save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
