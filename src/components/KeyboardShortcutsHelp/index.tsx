import MarkdownArticle from '@/components/Note/MarkdownArticle/MarkdownArticle'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createFakeEvent } from '@/lib/event'
import {
  isRadixDialogOpen,
  OPEN_NEW_POST_SHORTCUT_KEY,
  shouldIgnoreKeyboardShortcutEvent
} from '@/lib/keyboard-shortcuts'
import { cn } from '@/lib/utils'
import postEditorService from '@/services/post-editor.service'
import { CircleHelp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  KeyboardShortcutsHelpContext,
  useKeyboardShortcutsHelp
} from '@/contexts/keyboard-shortcuts-help-context'
import { useTranslation } from 'react-i18next'
import readmeMarkdown from '../../../README.md?raw'

export { useKeyboardShortcutsHelp } from '@/contexts/keyboard-shortcuts-help-context'

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="pointer-events-none inline-flex h-6 min-w-[1.25rem] shrink-0 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground">
      {children}
    </kbd>
  )
}

function KbdRow({ keys, label }: { keys: ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-muted-foreground leading-snug">{label}</span>
      <div className="flex flex-wrap items-center gap-1 sm:justify-end">{keys}</div>
    </div>
  )
}

function ShortcutsPanel() {
  const { t } = useTranslation()
  return (
    <div className="space-y-4 pt-1 text-sm">
      <p className="text-sm text-muted-foreground">{t('shortcuts.intro')}</p>
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('shortcuts.sectionApp')}
        </h3>
        <div className="space-y-3">
          <KbdRow
            label={t('shortcuts.openHelp')}
            keys={
              <>
                <Kbd>?</Kbd>
                <span className="px-0.5 text-muted-foreground">{t('shortcuts.or')}</span>
                <Kbd>F1</Kbd>
              </>
            }
          />
          <KbdRow
            label={t('shortcuts.focusPrimary')}
            keys={
              <>
                <Kbd>Shift</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>Alt</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>F</Kbd>
              </>
            }
          />
          <KbdRow
            label={t('shortcuts.focusSecondary')}
            keys={
              <>
                <Kbd>Shift</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>Alt</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>S</Kbd>
              </>
            }
          />
          <KbdRow
            label={t('shortcuts.newNote')}
            keys={
              <>
                <Kbd>Shift</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>Alt</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>N</Kbd>
              </>
            }
          />
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('shortcuts.sectionSearch')}
        </h3>
        <div className="space-y-3">
          <KbdRow
            label={t('shortcuts.searchSuggest')}
            keys={
              <>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <span className="px-1 text-muted-foreground">{t('shortcuts.then')}</span>
                <Kbd>Enter</Kbd>
              </>
            }
          />
          <KbdRow label={t('shortcuts.searchDismiss')} keys={<Kbd>Esc</Kbd>} />
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('shortcuts.sectionStandard')}
        </h3>
        <div className="space-y-3">
          <KbdRow
            label={t('shortcuts.tabNavigate')}
            keys={
              <>
                <Kbd>Tab</Kbd>
                <span className="px-1 text-muted-foreground">{t('shortcuts.or')}</span>
                <Kbd>Shift</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>Tab</Kbd>
              </>
            }
          />
          <KbdRow
            label={t('shortcuts.activate')}
            keys={
              <>
                <Kbd>Enter</Kbd>
                <span className="px-1 text-muted-foreground">{t('shortcuts.or')}</span>
                <Kbd>Space</Kbd>
              </>
            }
          />
          <KbdRow label={t('shortcuts.closeOverlays')} keys={<Kbd>Esc</Kbd>} />
          <KbdRow
            label={t('shortcuts.scrollWhenFocused')}
            keys={
              <>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <Kbd>PgUp</Kbd>
                <Kbd>PgDn</Kbd>
                <Kbd>Home</Kbd>
                <Kbd>End</Kbd>
              </>
            }
          />
          <KbdRow
            label={t('shortcuts.browserBack')}
            keys={
              <>
                <Kbd>Alt</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>←</Kbd>
              </>
            }
          />
        </div>
      </section>
    </div>
  )
}

function ReadmeOverviewPanel({ className }: { className?: string }) {
  const readmeEvent = useMemo(
    () =>
      createFakeEvent({
        id: '0'.repeat(64),
        pubkey: '0'.repeat(64),
        content: readmeMarkdown,
        created_at: 0,
        kind: 1,
        tags: [],
        sig: '0'.repeat(128)
      }),
    []
  )

  return (
    <div className={cn('min-w-0 pt-1', className)}>
      <MarkdownArticle event={readmeEvent} hideMetadata className="text-sm" />
    </div>
  )
}

export function KeyboardShortcutsHelpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openHelp = useCallback(() => setOpen(true), [])
  const { t } = useTranslation()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (open) return
      if (shouldIgnoreKeyboardShortcutEvent(e.target)) return
      if (isRadixDialogOpen()) return

      const isQuestionMark =
        e.key === '?' || (e.shiftKey && e.code === 'Slash' && !e.ctrlKey && !e.metaKey && !e.altKey)

      if (isQuestionMark && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setOpen(true)
        return
      }

      if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setOpen(true)
        return
      }

      if (
        e.altKey &&
        e.shiftKey &&
        e.key.toLowerCase() === OPEN_NEW_POST_SHORTCUT_KEY &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault()
        postEditorService.requestOpenNewPost()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  const value = useMemo(() => ({ openHelp }), [openHelp])

  return (
    <KeyboardShortcutsHelpContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(88vh,40rem)] max-w-2xl flex-col gap-0 overflow-hidden p-6 sm:max-w-2xl">
          <DialogHeader className="shrink-0 space-y-1 pb-2 pr-8 text-left">
            <DialogTitle>{t('help.title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('shortcuts.intro')}</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="shortcuts" className="flex min-h-0 flex-1 flex-col gap-2">
            <TabsList className="grid w-full shrink-0 grid-cols-2">
              <TabsTrigger value="shortcuts">{t('help.tabShortcuts')}</TabsTrigger>
              <TabsTrigger value="overview">{t('help.tabOverview')}</TabsTrigger>
            </TabsList>
            <TabsContent
              value="shortcuts"
              className="mt-0 max-h-[min(62vh,32rem)] min-h-0 flex-1 overflow-y-auto overscroll-contain pr-4 [scrollbar-gutter:stable] data-[state=inactive]:hidden"
            >
              <ShortcutsPanel />
            </TabsContent>
            <TabsContent
              value="overview"
              className="mt-0 max-h-[min(62vh,32rem)] min-h-0 flex-1 overflow-y-auto overscroll-contain pr-4 [scrollbar-gutter:stable] data-[state=inactive]:hidden"
            >
              <ReadmeOverviewPanel />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </KeyboardShortcutsHelpContext.Provider>
  )
}

/** Titlebar-sized help control (e.g. home feed, next to profile). */
export function KeyboardShortcutsHelpButton() {
  const { openHelp } = useKeyboardShortcutsHelp()
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="ghost"
      size="titlebar-icon"
      onClick={() => openHelp()}
      title={t('help.title')}
      aria-label={t('help.title')}
    >
      <CircleHelp />
    </Button>
  )
}
