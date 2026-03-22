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
import {
  createSpellDraftEvent,
  spellEventToDraftParams,
  type TSpellDraftParams
} from '@/lib/draft-event'
import {
  applyListEventToSpellDraft,
  dedupeAppendIds,
  resolveSpellListATags
} from '@/lib/spell-list-import'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { showPublishingError, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import { eventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { getRelaysForSpellCatalogSync } from '@/services/spell.service'
import { Info, Minus, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Event as NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
  inputType = 'text',
  showLabel = true
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  inputType?: 'text' | 'number'
  /** When false, only the inputs and add/remove controls are rendered (for nested editors). */
  showLabel?: boolean
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
      {showLabel && label ? <Label>{label}</Label> : null}
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

/** Bottom-of-form panel: name, description, catalog topics — not part of NIP-A7 REQ filter. */
function SpellMetadataSection({
  title,
  badge,
  hint,
  children
}: {
  title: string
  badge: string
  hint: string
  children: ReactNode
}) {
  return (
    <div
      className="rounded-xl border-2 border-dashed border-muted-foreground/35 bg-muted/25"
      role="region"
      aria-labelledby="spell-form-metadata-title"
    >
      <div className="space-y-1.5 border-b border-border/80 bg-muted/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h3 id="spell-form-metadata-title" className="text-sm font-semibold tracking-tight">
            {title}
          </h3>
          <span
            className="rounded-md border border-muted-foreground/45 bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            title={hint}
          >
            {badge}
          </span>
        </div>
        <p className="ps-6 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <div className="grid gap-4 p-4">{children}</div>
    </div>
  )
}

function TagFiltersEditor({
  tagFilters,
  onChange
}: {
  tagFilters: { letter: string; values: string[] }[]
  onChange: (next: { letter: string; values: string[] }[]) => void
}) {
  const { t } = useTranslation()
  const addRow = () => onChange([...tagFilters, { letter: '', values: [''] }])
  const removeRow = (i: number) => {
    const next = [...tagFilters]
    next.splice(i, 1)
    onChange(next)
  }
  return (
    <div className="grid gap-2">
      <Label>{t('spellFormTagFiltersLabel')}</Label>
      <p className="text-xs text-muted-foreground">{t('spellTagFiltersHint')}</p>
      {tagFilters.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('spellTagFiltersEmpty')}</p>
      ) : null}
      {tagFilters.map((row, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              className="h-9 w-16 font-mono text-sm uppercase"
              placeholder="t"
              value={row.letter}
              maxLength={8}
              onChange={(e) => {
                const next = [...tagFilters]
                next[i] = { ...next[i]!, letter: e.target.value }
                onChange(next)
              }}
              aria-label={t('Tag filter letter')}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => removeRow(i)}
              title={t('Remove this row')}
              aria-label={t('Remove this row')}
            >
              <Minus className="size-4" />
            </Button>
          </div>
          <DynamicStringListField
            label=""
            showLabel={false}
            values={row.values.length > 0 ? row.values : ['']}
            onChange={(values) => {
              const next = [...tagFilters]
              next[i] = { ...next[i]!, values }
              onChange(next)
            }}
            placeholder={t('Filter value')}
          />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-9 w-fit gap-1" onClick={addRow}>
        <Plus className="size-4" />
        {t('Add tag filter')}
      </Button>
    </div>
  )
}

function formatListImportNotice(raw: string, t: (k: string, o?: Record<string, unknown>) => string) {
  if (raw === 'listImportContentSkipped') return t('listImportContentSkipped')
  if (raw === 'listImportUnsupportedEmoji') return t('listImportUnsupportedEmoji')
  if (raw.startsWith('listImportUnsupportedTag:')) {
    const parts = raw.split(':')
    const tag = parts[1] ?? '?'
    const count = parts[2] ?? '1'
    return t('listImportUnsupportedTag', { tag, count })
  }
  if (raw.startsWith('listImportBadATag:')) {
    const preview = raw.slice('listImportBadATag:'.length)
    return t('listImportBadATag', { preview })
  }
  if (raw.startsWith('listImportATagNotFound:')) {
    const preview = raw.slice('listImportATagNotFound:'.length)
    return t('listImportATagNotFound', { preview })
  }
  if (raw.startsWith('listImportATagFailed:')) {
    const preview = raw.slice('listImportATagFailed:'.length)
    return t('listImportATagFailed', { preview })
  }
  return raw
}

export default function CreateSpellDialog({
  open,
  onOpenChange,
  onSaved,
  spellToEdit,
  spellToClone
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful publish; pass the new event so the parent can refresh selection. */
  onSaved?: (publishedEvent?: NostrEvent) => void
  /** When set, form is preloaded and save replaces this spell id in storage/favorites. */
  spellToEdit?: NostrEvent | null
  /** When set, form is preloaded from this spell but save always publishes a new event (your pubkey). */
  spellToClone?: NostrEvent | null
}) {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin, relayList } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [form, setForm] = useState<TSpellDraftParams>(DEFAULT_PARAMS)
  const [saving, setSaving] = useState(false)
  const scrollBodyRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<TSpellDraftParams>(DEFAULT_PARAMS)
  const [listImportNotices, setListImportNotices] = useState<string[]>([])
  const [manualListRef, setManualListRef] = useState('')
  const [manualListLoading, setManualListLoading] = useState(false)

  useEffect(() => {
    formRef.current = form
  }, [form])

  useEffect(() => {
    if (!open) return
    const source = spellToClone ?? spellToEdit
    if (source) {
      setForm(spellEventToDraftParams(source))
    } else {
      setForm({ ...DEFAULT_PARAMS })
    }
    setListImportNotices([])
    setManualListRef('')
  }, [open, spellToEdit, spellToClone])

  const applyListSource = useCallback(
    (ev: NostrEvent) => {
      const base = formRef.current
      const { draft, notices, pendingATags } = applyListEventToSpellDraft(base, ev)
      setForm(draft)
      setListImportNotices(notices)
      const urls = getRelaysForSpellCatalogSync(
        favoriteRelays,
        blockedRelays,
        relayList?.read ?? []
      )
      if (pendingATags.length === 0) return
      void resolveSpellListATags(pendingATags, urls).then(({ ids, notices: extra }) => {
        if (ids.length) {
          setForm((f) => ({ ...f, ids: dedupeAppendIds(f.ids, ids) }))
        }
        if (extra.length) setListImportNotices((n) => [...n, ...extra])
      })
    },
    [favoriteRelays, blockedRelays, relayList]
  )

  const handleLoadManualList = useCallback(async () => {
    const q = manualListRef.trim()
    if (!q) return
    setManualListLoading(true)
    try {
      const ev = await eventService.fetchEvent(q)
      if (!ev) {
        setListImportNotices([t('listImportEventNotFound')])
        return
      }
      applyListSource(ev)
    } catch (e) {
      logger.warn('[CreateSpellDialog] List import fetch failed', e)
      setListImportNotices([t('listImportEventNotFound')])
    } finally {
      setManualListLoading(false)
    }
  }, [manualListRef, applyListSource, t])

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

  const handleClear = () => {
    setForm({ ...DEFAULT_PARAMS })
    setListImportNotices([])
    setManualListRef('')
  }
  const handleCancel = () => {
    handleClear()
    onOpenChange(false)
  }

  const replaceSpellId = spellToEdit?.id

  const handleSave = async () => {
    if (!pubkey) {
      checkLogin()
      return
    }
    setSaving(true)
    try {
      const draft = createSpellDraftEvent(form)
      const event = await publish(draft)
      if (replaceSpellId) {
        await indexedDb.deleteSpellEvent(replaceSpellId)
        const favs = await indexedDb.getSpellFavoriteIds()
        if (favs.length) {
          await indexedDb.setSpellFavoriteIds(favs.map((id) => (id === replaceSpellId ? event.id : id)))
        }
      }
      await indexedDb.putSpellEvent(event)
      handleClear()
      onSaved?.(event)
      onOpenChange(false)
      showSimplePublishSuccess(
        replaceSpellId ? t('Spell updated') : spellToClone ? t('Spell cloned') : t('Spell published')
      )
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
            <DialogTitle>
              {replaceSpellId ? t('Edit spell') : spellToClone ? t('Clone spell') : t('Create a Spell')}
            </DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            {spellToClone
              ? t('Clone spell intro')
              : t('spellCreateIntro')}
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="spell-list-ref" className="text-sm">
                {t('listImportManualLabel')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('listImportFromEventHint')}</p>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="spell-list-ref"
                  className="min-w-[12rem] flex-1 font-mono text-sm"
                  placeholder={t('listImportManualPlaceholder')}
                  value={manualListRef}
                  onChange={(e) => setManualListRef(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleLoadManualList()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  disabled={manualListLoading || !manualListRef.trim()}
                  onClick={() => void handleLoadManualList()}
                >
                  {manualListLoading ? t('Loading...') : t('listImportLoadManual')}
                </Button>
              </div>
              {listImportNotices.length > 0 ? (
                <ul className="list-inside list-disc space-y-1 text-xs text-amber-800 dark:text-amber-200">
                  {listImportNotices.map((n, i) => (
                    <li key={`${n}-${i}`}>{formatListImportNotice(n, t)}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="space-y-4 border-t border-border pt-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">{t('spellFormSectionQueryTitle')}</h3>
                <p className="text-xs text-muted-foreground">{t('spellFormSectionQueryHint')}</p>
              </div>

              <div className="grid gap-2">
                <Label>{t('Command')}</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={form.cmd}
                  onChange={(e) => {
                    const cmd = e.target.value as 'REQ' | 'COUNT'
                    setForm((f) =>
                      cmd === 'COUNT' ? { ...f, cmd, closeOnEose: false } : { ...f, cmd }
                    )
                  }}
                >
                  <option value="REQ">REQ (subscribe to events)</option>
                  <option value="COUNT">COUNT (count only)</option>
                </select>
                <p className="text-xs text-muted-foreground">{t('REQ returns a feed; COUNT returns a number.')}</p>
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

              <TagFiltersEditor
                tagFilters={form.tagFilters}
                onChange={(tagFilters) => setForm((f) => ({ ...f, tagFilters }))}
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
                hint={t('One wss:// URL per row. Leave empty to use your write relays.')}
                placeholder="wss://…"
                values={form.relays}
                onChange={(relays) => setForm((f) => ({ ...f, relays }))}
              />

              {form.cmd === 'REQ' ? (
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
              ) : null}
            </div>

            <SpellMetadataSection
              title={t('spellFormSectionMetadataTitle')}
              badge={t('spellFormSectionMetadataBadge')}
              hint={t('spellFormSectionMetadataHint')}
            >
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
                label={t('spellFormCatalogTopicsLabel')}
                hint={t('spellTopicsMetadataHint')}
                placeholder={t('topic')}
                values={form.topics}
                onChange={(topics) => setForm((f) => ({ ...f, topics }))}
              />
            </SpellMetadataSection>
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
