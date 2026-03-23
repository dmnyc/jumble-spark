import * as React from 'react'
import { getNoteBech32Id } from '@/lib/event'
import client from '@/services/client.service'
import {
  searchEventsForPicker,
  type PickerSearchMode
} from '@/services/mention-event-search.service'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SimpleUsername } from '@/components/Username'
import { nip19, type Event as NEvent } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { Search } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { OPEN_NEVENT_PICKER_EVENT, extendMentionRangeToEndOfWord } from './suggestion'

type NeventNaddrPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (nostrLink: string) => void
  /** When provided, the dialog opens with this tab selected (e.g. from @naddr vs @nevent). */
  initialMode?: PickerSearchMode
}

export function NeventNaddrPickerDialog({
  open,
  onOpenChange,
  onSelect,
  initialMode
}: NeventNaddrPickerDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PickerSearchMode>(initialMode ?? 'nevent')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [events, setEvents] = useState<NEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setDebouncedQuery('')
    setEvents([])
    if (initialMode !== undefined) setMode(initialMode)
  }, [open, initialMode])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(t)
  }, [open, query])

  useEffect(() => {
    if (!open || !debouncedQuery) {
      setEvents([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    searchEventsForPicker(debouncedQuery, 20, mode)
      .then((list) => {
        if (cancelled) return
        setEvents(list.slice(0, 15) as NEvent[])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, debouncedQuery, mode])

  const handleSelect = useCallback(
    (event: NEvent) => {
      client.addEventToCache(event)
      try {
        const bech32 = getNoteBech32Id(event)
        onSelect(`nostr:${bech32}`)
        onOpenChange(false)
      } catch {
        onSelect(`nostr:${nip19.noteEncode(event.id)}`)
        onOpenChange(false)
      }
    },
    [onSelect, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[80vh] flex flex-col gap-4 z-[99999]"
        overlayClassName="z-[99999]"
      >
        <DialogHeader>
          <DialogTitle>{t('Search for event or address…')}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'nevent' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('nevent')}
          >
            {t('nevent')}
          </Button>
          <Button
            type="button"
            variant={mode === 'naddr' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('naddr')}
          >
            {t('naddr')}
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={
              mode === 'nevent'
                ? t('Search notes, threads, long-form…')
                : t('Search calendar, publications, wiki…')
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="min-h-[200px] max-h-[50vh] border rounded-md overflow-y-auto overflow-x-hidden">
          <div className="p-2 space-y-1">
            {loading && (
              <div className="space-y-2 p-2" role="status" aria-busy="true" aria-live="polite">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            )}
            {!loading && debouncedQuery && events.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                {t('No events found')}
              </p>
            )}
            {!loading &&
              events.map((ev: NEvent) => (
                <Button
                  key={ev.id}
                  variant="ghost"
                  className="w-full justify-start text-left h-auto py-2 px-3 font-normal"
                  onClick={() => handleSelect(ev)}
                >
                  <div className="flex flex-col gap-0.5 min-w-0 w-full">
                    <SimpleUsername userId={ev.pubkey} className="text-xs text-muted-foreground truncate" />
                    <span className="text-sm line-clamp-2 break-words">{ev.content || t('(empty)')}</span>
                  </div>
                </Button>
              ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type NeventPickerContextValue = {
  openNeventPicker: (onSelected: (nostrLink: string) => void, initialMode?: PickerSearchMode) => void
}

export const NeventPickerContext = React.createContext<NeventPickerContextValue | null>(null)

export function NeventPickerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [onSelectedRef, setOnSelectedRef] = useState<((link: string) => void) | null>(null)
  const [initialMode, setInitialMode] = useState<PickerSearchMode>('nevent')

  useEffect(() => {
    const handler = (e: Event) => {
      const { editor, range, initialMode: detailMode } = (e as CustomEvent<{
        editor: Editor
        range: { from: number; to: number }
        initialMode?: PickerSearchMode
      }>).detail
      const to = extendMentionRangeToEndOfWord(editor, range)
      setOnSelectedRef(() => (link: string) => {
        editor.chain().focus().insertContentAt({ from: range.from, to }, link + ' ').run()
      })
      setInitialMode(detailMode ?? 'nevent')
      setOpen(true)
    }
    window.addEventListener(OPEN_NEVENT_PICKER_EVENT, handler)
    return () => window.removeEventListener(OPEN_NEVENT_PICKER_EVENT, handler)
  }, [])

  const openNeventPicker = useCallback((onSelected: (nostrLink: string) => void, mode?: PickerSearchMode) => {
    setOnSelectedRef(() => onSelected)
    setInitialMode(mode ?? 'nevent')
    setOpen(true)
  }, [])

  const handleSelect = useCallback(
    (link: string) => {
      onSelectedRef?.(link)
      setOnSelectedRef(null)
    },
    [onSelectedRef]
  )

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) {
      setOnSelectedRef(null)
      setInitialMode('nevent')
    }
    setOpen(next)
  }, [])

  const value = React.useMemo(() => ({ openNeventPicker }), [openNeventPicker])

  return (
    <NeventPickerContext.Provider value={value}>
      {children}
      <NeventNaddrPickerDialog
        open={open}
        onOpenChange={handleOpenChange}
        onSelect={handleSelect}
        initialMode={initialMode}
      />
    </NeventPickerContext.Provider>
  )
}

