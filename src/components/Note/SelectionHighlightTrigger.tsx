import { buildHighlightDataFromEvent } from '@/lib/build-highlight-data'
import { useCreateHighlight } from './CreateHighlightContext'
import { Event } from 'nostr-tools'
import { Highlighter } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

function getParagraphContextFromRange(range: Range): string {
  let node: Node | null = range.commonAncestorContainer
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement
  let el = node as Element | null
  while (el) {
    const tag = el.tagName?.toLowerCase()
    if (tag === 'p' || (tag?.startsWith('h') && /^h[1-6]$/.test(tag))) {
      return el.textContent?.trim() || range.toString().trim()
    }
    el = el.parentElement
  }
  return range.toString().trim()
}

export default function SelectionHighlightTrigger({
  event,
  children
}: {
  event: Event
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const openHighlight = useCreateHighlight()
  const containerRef = useRef<HTMLDivElement>(null)
  const [toolbar, setToolbar] = useState<{
    selectedText: string
    paragraphContext: string
    top: number
    left: number
  } | null>(null)

  const handleMouseUp = useCallback(() => {
    if (!openHighlight || !containerRef.current) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setToolbar(null)
      return
    }
    const range = sel.getRangeAt(0)
    if (!containerRef.current.contains(range.commonAncestorContainer)) {
      setToolbar(null)
      return
    }
    const selectedText = range.toString().trim()
    if (!selectedText) {
      setToolbar(null)
      return
    }
    const rect = range.getBoundingClientRect()
    setToolbar({
      selectedText,
      paragraphContext: getParagraphContextFromRange(range),
      top: rect.top - 44,
      left: rect.left + rect.width / 2 - 80
    })
  }, [openHighlight])

  const handleCreateHighlight = useCallback(() => {
    if (!toolbar || !openHighlight) return
    const highlightData = buildHighlightDataFromEvent(event, toolbar.paragraphContext)
    openHighlight(highlightData, toolbar.selectedText)
    setToolbar(null)
    window.getSelection()?.removeAllRanges()
  }, [event, toolbar, openHighlight])

  const handleDismiss = useCallback(() => {
    setToolbar(null)
  }, [])

  if (!openHighlight) return <>{children}</>

  return (
    <div ref={containerRef} onMouseUp={handleMouseUp} className="relative">
      {children}
      {toolbar && (
        <>
          <div
            className="fixed z-[150] flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 shadow-lg"
            style={{
              top: toolbar.top,
              left: Math.max(8, Math.min(toolbar.left, typeof window !== 'undefined' ? window.innerWidth - 176 : toolbar.left))
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleCreateHighlight}
            >
              <Highlighter className="h-4 w-4" />
              {t('Create Highlight')}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={handleDismiss}>
              {t('Cancel')}
            </Button>
          </div>
          <div
            className="fixed inset-0 z-[149]"
            aria-hidden
            onClick={handleDismiss}
          />
        </>
      )}
    </div>
  )
}
