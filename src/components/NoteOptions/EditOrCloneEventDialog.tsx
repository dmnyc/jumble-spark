import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import Content from '@/components/Content'
import ContentPreview from '@/components/ContentPreview'
import Highlight from '@/components/Note/Highlight'
import MarkdownArticle from '@/components/Note/MarkdownArticle/MarkdownArticle'
import AsciidocArticle from '@/components/Note/AsciidocArticle/AsciidocArticle'
import ClientTag from '@/components/ClientTag'
import { ExtendedKind } from '@/constants'
import { applyImwaldAttributionTags } from '@/lib/draft-event'
import { createFakeEvent } from '@/lib/event'
import logger from '@/lib/logger'
import {
  showPublishingError,
  showPublishingFeedback,
  showSimplePublishSuccess
} from '@/lib/publishing-feedback'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import storage from '@/services/local-storage.service'
import type { TDraftEvent } from '@/types'
import dayjs from 'dayjs'
import { Plus, Trash2 } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

function normalizeTagRow(row: string[]): string[] | null {
  const trimmed = row.map((c) => c.trim())
  if (!trimmed[0]) return null
  let end = trimmed.length
  while (end > 1 && trimmed[end - 1] === '') end--
  return trimmed.slice(0, end)
}

function tagsFromRows(rows: string[][]): string[][] {
  const out: string[][] = []
  for (const row of rows) {
    const n = normalizeTagRow(row)
    if (n) out.push(n)
  }
  return out
}

const MAX_CUSTOM_EVENT_KIND = 40000

/** Integer kind in [0, 40000], or null if invalid / empty. */
function parseEventKindInput(s: string): number | null {
  const trimmed = s.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 0 || n > MAX_CUSTOM_EVENT_KIND) return null
  return n
}

function StaticEventPreview({ event, className }: { event: Event; className?: string }) {
  const k = event.kind
  const wrap = (node: ReactNode) => (
    <Card className={cn('p-3 select-text', className)}>{node}</Card>
  )
  if (k === ExtendedKind.POLL) {
    return wrap(<ContentPreview event={event} />)
  }
  if (k === kinds.Highlights) {
    return wrap(<Highlight event={event} />)
  }
  if (
    k === kinds.ShortTextNote ||
    k === ExtendedKind.COMMENT ||
    k === ExtendedKind.VOICE_COMMENT
  ) {
    return wrap(<MarkdownArticle event={event} hideMetadata />)
  }
  if (k === kinds.LongFormArticle) {
    return wrap(<MarkdownArticle event={event} hideMetadata />)
  }
  if (k === ExtendedKind.WIKI_ARTICLE) {
    return wrap(<AsciidocArticle event={event} hideImagesAndInfo={false} />)
  }
  if (k === ExtendedKind.WIKI_ARTICLE_MARKDOWN) {
    return wrap(<MarkdownArticle event={event} hideMetadata />)
  }
  if (k === ExtendedKind.PUBLICATION_CONTENT) {
    return wrap(<AsciidocArticle event={event} hideImagesAndInfo={false} />)
  }
  return wrap(<Content event={event} className="h-full" mustLoadMedia />)
}

export type TEditOrCloneMode = 'edit' | 'clone'

export type EditOrCloneEventDialogProps =
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'create'
    }
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: TEditOrCloneMode
      sourceEvent: Event
    }

export default function EditOrCloneEventDialog(props: EditOrCloneEventDialogProps) {
  const { open, onOpenChange, mode } = props
  const isCreate = mode === 'create'
  const sourceEvent = !isCreate ? props.sourceEvent : null

  const { t } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const [content, setContent] = useState(() => sourceEvent?.content ?? '')
  const [createKindInput, setCreateKindInput] = useState('1')
  const [tagRows, setTagRows] = useState<string[][]>([['', '']])
  const [activeTab, setActiveTab] = useState('edit')
  const [publishing, setPublishing] = useState(false)
  const prevOpenRef = useRef(false)

  const parsedCreateKind = useMemo(
    () => (isCreate ? parseEventKindInput(createKindInput) : null),
    [isCreate, createKindInput]
  )

  const kind = isCreate ? (parsedCreateKind ?? 0) : sourceEvent!.kind

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      if (isCreate) {
        setCreateKindInput('1')
        setContent('')
        setTagRows([['', '']])
      } else if (sourceEvent) {
        setContent(sourceEvent.content)
        setTagRows(
          sourceEvent.tags?.length
            ? sourceEvent.tags.map((row) => [...row])
            : [['', '']]
        )
      }
      setActiveTab('edit')
    }
    prevOpenRef.current = open
  }, [open, isCreate, sourceEvent])

  const normalizedTags = useMemo(() => tagsFromRows(tagRows), [tagRows])

  const previewEvent = useMemo(() => {
    if (isCreate && parsedCreateKind === null) return null
    const k = isCreate ? parsedCreateKind! : sourceEvent!.kind
    const now = Math.floor(Date.now() / 1000)
    const base: TDraftEvent = {
      kind: k,
      content,
      tags: normalizedTags,
      created_at: now
    }
    const withAttribution = applyImwaldAttributionTags(base, {
      addClientTag: storage.getAddClientTag()
    })
    return createFakeEvent({
      kind: k,
      content,
      tags: withAttribution.tags,
      pubkey: pubkey ?? '',
      created_at: now
    })
  }, [isCreate, parsedCreateKind, sourceEvent, content, normalizedTags, pubkey])

  const buildDraftJson = useCallback(() => {
    if (isCreate && parsedCreateKind === null) {
      return t('Enter a valid event kind (integer 0–40000).')
    }
    const k = isCreate ? parsedCreateKind! : sourceEvent!.kind
    const base: TDraftEvent = {
      kind: k,
      content,
      tags: normalizedTags,
      created_at: dayjs().unix()
    }
    const withAttribution = applyImwaldAttributionTags(base, {
      addClientTag: storage.getAddClientTag()
    })
    const draft = {
      pubkey: pubkey ?? t('Log in to publish'),
      kind: withAttribution.kind,
      content: withAttribution.content,
      tags: withAttribution.tags,
      created_at: t('Set when you publish'),
      _note: t('id and sig are assigned when you publish')
    }
    return JSON.stringify(draft, null, 2)
  }, [isCreate, parsedCreateKind, sourceEvent, pubkey, content, normalizedTags, t])

  const draftJson = activeTab === 'json' ? buildDraftJson() : ''

  const updateRow = (i: number, j: number, value: string) => {
    setTagRows((rows) => {
      const next = rows.map((r) => [...r])
      if (!next[i]) return rows
      next[i][j] = value
      return next
    })
  }

  const addRow = () => setTagRows((rows) => [...rows, ['', '']])

  const removeRow = (i: number) => {
    setTagRows((rows) => (rows.length <= 1 ? [['', '']] : rows.filter((_, idx) => idx !== i)))
  }

  const addCell = (i: number) => {
    setTagRows((rows) => {
      const next = rows.map((r) => [...r])
      next[i] = [...next[i], '']
      return next
    })
  }

  const removeCell = (i: number, j: number) => {
    setTagRows((rows) => {
      const next = rows.map((r) => [...r])
      if (next[i].length <= 1) return rows
      next[i] = next[i].filter((_, idx) => idx !== j)
      return next
    })
  }

  const handlePublish = async () => {
    await checkLogin(async () => {
      if (!pubkey) return
      if (isCreate) {
        const k = parseEventKindInput(createKindInput)
        if (k === null) {
          showPublishingError(t('Kind must be an integer from 0 to 40000.'))
          return
        }
      }
      setPublishing(true)
      try {
        const publishKind = isCreate ? parseEventKindInput(createKindInput)! : sourceEvent!.kind
        const draft = {
          kind: publishKind,
          content,
          tags: normalizedTags,
          created_at: dayjs().unix()
        }
        const newEvent = await publish(draft, {
          addClientTag: storage.getAddClientTag()
        })
        if ((newEvent as any)?.relayStatuses) {
          const rs = (newEvent as any).relayStatuses
          showPublishingFeedback(
            {
              success: true,
              relayStatuses: rs,
              successCount: rs.filter((s: any) => s.success).length,
              totalCount: rs.length
            },
            { message: t('Post published'), duration: 6000 }
          )
        } else {
          showSimplePublishSuccess(t('Post published'))
        }
        onOpenChange(false)
      } catch (e) {
        if (e instanceof AggregateError && (e as any).relayStatuses) {
          const relayStatuses = (e as any).relayStatuses
          const successCount = relayStatuses.filter((s: any) => s.success).length
          const totalCount = relayStatuses.length
          showPublishingFeedback(
            {
              success: successCount > 0,
              relayStatuses,
              successCount,
              totalCount
            },
            {
              message:
                successCount > 0 ? t('Published to some relays only') : t('Failed to post'),
              duration: 6000
            }
          )
          if (successCount > 0) onOpenChange(false)
        } else {
          logger.error('Edit/clone publish failed', { error: e })
          showPublishingError(e instanceof Error ? e : String(e))
        }
      } finally {
        setPublishing(false)
      }
    })
  }

  const title =
    mode === 'edit'
      ? t('Edit this event')
      : mode === 'clone'
        ? t('Clone or fork this event')
        : t('Create custom event')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2 pr-14">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {isCreate
              ? t('Set kind, content, and tags, then publish.')
              : t('Edit content and tags, then publish a new signed event.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col px-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 gap-2">
            <TabsList className="w-auto justify-start shrink-0">
              <TabsTrigger value="edit">{t('Edit')}</TabsTrigger>
              <TabsTrigger value="preview">{t('Preview')}</TabsTrigger>
              <TabsTrigger value="json">{t('Json')}</TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <ScrollArea className="h-[min(50vh,420px)] pr-3">
                <div className="space-y-4 pb-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">{t('Event kind')}</label>
                    {isCreate ? (
                      <>
                        <Input
                          type="number"
                          min={0}
                          max={MAX_CUSTOM_EVENT_KIND}
                          step={1}
                          value={createKindInput}
                          onChange={(e) => setCreateKindInput(e.target.value)}
                          className="font-mono text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('Integer from 0 to 40000')}
                        </p>
                      </>
                    ) : (
                      <Input
                        type="number"
                        value={kind}
                        disabled
                        readOnly
                        className="font-mono text-sm"
                        aria-readonly
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">{t('Note content')}</label>
                    <Textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={10}
                      className="font-mono text-sm min-h-[160px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">{t('Tags')}</div>
                    <div className="space-y-2">
                      {tagRows.map((row, i) => (
                        <div
                          key={i}
                          className="flex flex-wrap items-start gap-1 border rounded-md p-2 bg-muted/30"
                        >
                          {row.map((cell, j) => (
                            <div key={j} className="flex items-center gap-0.5 shrink-0">
                              <Input
                                value={cell}
                                onChange={(e) => updateRow(i, j, e.target.value)}
                                placeholder={j === 0 ? t('Tag name') : t('Value')}
                                className="h-8 w-[7rem] sm:w-32 font-mono text-xs"
                              />
                              {row.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0"
                                  onClick={() => removeCell(i, j)}
                                  aria-label={t('Remove value')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => addCell(i)}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            {t('Add field')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 ml-auto"
                            onClick={() => removeRow(i)}
                            aria-label={t('Remove tag')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button type="button" variant="secondary" size="sm" onClick={addRow}>
                      <Plus className="h-4 w-4 mr-1" />
                      {t('Add tag')}
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="preview" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <ScrollArea className="h-[min(50vh,420px)] pr-3">
                <div className="space-y-1.5">
                  {previewEvent ? (
                    <>
                      {storage.getAddClientTag() ? (
                        <div className="flex min-h-[1.125rem] items-center px-0.5">
                          <ClientTag event={previewEvent} />
                        </div>
                      ) : null}
                      <StaticEventPreview event={previewEvent} />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('Enter a valid event kind (integer 0–40000).')}
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="json" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <ScrollArea className="h-[min(50vh,420px)] pr-3">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words border rounded-md p-3 bg-muted/40 select-text">
                  {draftJson}
                </pre>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 px-6 py-4 border-t gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            type="button"
            onClick={handlePublish}
            disabled={publishing || !pubkey || (isCreate && parsedCreateKind === null)}
          >
            {publishing ? t('Loading...') : t('Publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
