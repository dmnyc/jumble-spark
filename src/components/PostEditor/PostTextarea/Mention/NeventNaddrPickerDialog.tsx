import * as React from 'react'
import { SEARCHABLE_RELAY_URLS } from '@/constants'
import { getNoteBech32Id } from '@/lib/event'
import client from '@/services/client.service'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SimpleUsername } from '@/components/Username'
import { kinds, nip19, type Event as NEvent } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Search } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { OPEN_NEVENT_PICKER_EVENT } from './suggestion'

type NeventNaddrPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (nostrLink: string) => void
}

export function NeventNaddrPickerDialog({
  open,
  onOpenChange,
  onSelect
}: NeventNaddrPickerDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [events, setEvents] = useState<NEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setDebouncedQuery('')
    setEvents([])
  }, [open])

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
    client
      .fetchEvents(SEARCHABLE_RELAY_URLS, { kinds: [kinds.ShortTextNote], search: debouncedQuery, limit: 20 }, { eoseTimeout: 5000, globalTimeout: 8000 })
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
  }, [open, debouncedQuery])

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
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t('Search for event or address…')}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('Search notes…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <ScrollArea className="flex-1 min-h-[200px] max-h-[40vh] border rounded-md">
          <div className="p-2 space-y-1">
            {loading && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
            {!loading && debouncedQuery && events.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">{t('No notes found')}</p>
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
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

type NeventPickerContextValue = {
  openNeventPicker: (onSelected: (nostrLink: string) => void) => void
}

const NeventPickerContext = React.createContext<NeventPickerContextValue | null>(null)

export function useNeventPicker(): NeventPickerContextValue | null {
  return React.useContext(NeventPickerContext)
}

export function NeventPickerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [onSelectedRef, setOnSelectedRef] = useState<((link: string) => void) | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const { editor, range } = (e as CustomEvent<{ editor: Editor; range: { from: number; to: number } }>).detail
      setOnSelectedRef(() => (link: string) => {
        editor.chain().focus().insertContentAt(range, link + ' ').run()
      })
      setOpen(true)
    }
    window.addEventListener(OPEN_NEVENT_PICKER_EVENT, handler)
    return () => window.removeEventListener(OPEN_NEVENT_PICKER_EVENT, handler)
  }, [])

  const openNeventPicker = useCallback((onSelected: (nostrLink: string) => void) => {
    setOnSelectedRef(() => onSelected)
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
    if (!next) setOnSelectedRef(null)
    setOpen(next)
  }, [])

  const value = React.useMemo(() => ({ openNeventPicker }), [openNeventPicker])

  return (
    <NeventPickerContext.Provider value={value}>
      {children}
      <NeventNaddrPickerDialog open={open} onOpenChange={handleOpenChange} onSelect={handleSelect} />
    </NeventPickerContext.Provider>
  )
}

