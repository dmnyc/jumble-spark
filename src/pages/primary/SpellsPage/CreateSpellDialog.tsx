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
import { Minus, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCallback, useRef, useState } from 'react'
import logger from '@/lib/logger'

/** Arrow keys should control the control, not the dialog scroll */
function keyboardTargetUsesArrowKeys(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    if (type === 'number' || type === 'range' || type === 'date' || type === 'time') return true
  }
  return target.isContentEditable
}

const SCROLL_STEP_PX = 48

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

/** One input per list item; add/remove rows. */
function DynamicStringListField({
  label,
  hint,
  values,
  onChange,
  placeholder,
  inputType = 'text'
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  inputType?: 'text' | 'number'
}) {
  const { t } = useTranslation()
  const rows = values.length > 0 ? values : ['']

  const updateAt = (i: number, v: string) => {
    const base = values.length > 0 ? [...values] : ['']
    base[i] = v
    onChange(base)
  }

  const removeAt = (i: number) => {
    const base = values.length > 0 ? [...values] : ['']
    if (base.length <= 1) {
      onChange([''])
      return
    }
    base.splice(i, 1)
    onChange(base)
  }

  const addRow = () => {
    const base = values.length > 0 ? [...values] : ['']
    onChange([...base, ''])
  }

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-col gap-2">
        {rows.map((v, i) => (
          <div key={i} className="flex gap-2">
            <Input
              type={inputType}
              value={v}
              onChange={(e) => updateAt(i, e.target.value)}
              placeholder={placeholder}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => removeAt(i)}
              title={t('Remove this row')}
              aria-label={t('Remove this row')}
            >
              <Minus className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="h-9 w-fit gap-1" onClick={addRow}>
        <Plus className="size-4" />
        {t('Add another row')}
      </Button>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
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
  const scrollBodyRef = useRef<HTMLDivElement>(null)

  const handleScrollBodyKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = scrollBodyRef.current
    if (!el) return

    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      const page = el.clientHeight * 0.85
      el.scrollBy({ top: e.key === 'PageDown' ? page : -page, behavior: 'smooth' })
      return
    }

    if (keyboardTargetUsesArrowKeys(e.target)) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      el.scrollBy({ top: SCROLL_STEP_PX, behavior: 'smooth' })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      el.scrollBy({ top: -SCROLL_STEP_PX, behavior: 'smooth' })
    }
  }, [])

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        withoutClose
      >
        {/* Fixed top: not inside overflow-y-auto so title/intro never scroll away or clip */}
        <div className="relative shrink-0 border-b px-6 pb-4 pt-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 z-10 h-8 w-8 shrink-0"
            onClick={() => onOpenChange(false)}
            aria-label={t('Close')}
          >
            <X className="size-4" />
          </Button>
          <DialogHeader className="space-y-1.5 pr-10 text-left sm:text-left">
            <DialogTitle>{t('Create a Spell')}</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(
              'Spells are saved relay filters (NIP-A7). Fill in the filter fields below. Use $me for your pubkey and $contacts for your follow list when executing.'
            )}
          </p>
        </div>

        <div
          ref={scrollBodyRef}
          tabIndex={0}
          role="region"
          aria-label={t('Spell form fields')}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          onKeyDown={handleScrollBodyKeyDown}
        >
          <div className="grid gap-4">
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

            <DynamicStringListField
              label={t('Kinds')}
              hint={t('One kind number per row (e.g. 1 for notes).')}
              placeholder="1"
              inputType="number"
              values={form.kinds}
              onChange={(kinds) => setForm((f) => ({ ...f, kinds }))}
            />

            <DynamicStringListField
              label={t('Authors')}
              hint={t('One author per row: $me, $contacts, or hex pubkey / npub.')}
              placeholder="$me"
              values={form.authors}
              onChange={(authors) => setForm((f) => ({ ...f, authors }))}
            />

            <DynamicStringListField
              label={t('Event IDs (ids)')}
              hint={t('One hex event id per row.')}
              placeholder="hex id…"
              values={form.ids}
              onChange={(ids) => setForm((f) => ({ ...f, ids }))}
            />

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
              <p className="text-xs text-muted-foreground">
                {t('Relative: 7d, 24h, 1w, 1mo, 1y. Or Unix timestamp.')}
              </p>
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

            <DynamicStringListField
              label={t('Relays')}
              hint={t('One wss:// URL per row. Leave empty to use your read relays.')}
              placeholder="wss://…"
              values={form.relays}
              onChange={(relays) => setForm((f) => ({ ...f, relays }))}
            />

            <DynamicStringListField
              label={t('Topics (t tags for categorization)')}
              hint={t('One topic per row.')}
              placeholder={t('topic')}
              values={form.topics}
              onChange={(topics) => setForm((f) => ({ ...f, topics }))}
            />

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
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-6 py-4">
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
