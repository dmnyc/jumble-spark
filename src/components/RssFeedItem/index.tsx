import { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import { FormattedTimestamp } from '../FormattedTimestamp'
import { ExternalLink, Highlighter } from 'lucide-react'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useNostr } from '@/providers/NostrProvider'
import PostEditor from '@/components/PostEditor'
import { HighlightData } from '@/components/PostEditor/HighlightEditor'

export default function RssFeedItem({ item, className }: { item: TRssFeedItem; className?: string }) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const [selectedText, setSelectedText] = useState('')
  const [highlightText, setHighlightText] = useState('') // Text to use in highlight editor
  const [showHighlightButton, setShowHighlightButton] = useState(false)
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null)
  const [isPostEditorOpen, setIsPostEditorOpen] = useState(false)
  const [highlightData, setHighlightData] = useState<HighlightData | undefined>(undefined)
  const contentRef = useRef<HTMLDivElement>(null)
  const selectionTimeoutRef = useRef<NodeJS.Timeout>()

  // Handle text selection
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !contentRef.current) {
        setShowHighlightButton(false)
        setSelectedText('')
        return
      }

      // Check if selection is within this item's content
      const range = selection.getRangeAt(0)
      if (!contentRef.current.contains(range.commonAncestorContainer)) {
        setShowHighlightButton(false)
        setSelectedText('')
        return
      }

      const text = selection.toString().trim()
      if (text.length > 0) {
        setSelectedText(text)
        
        // Get selection position for button placement
        const rect = range.getBoundingClientRect()
        setSelectionPosition({
          x: rect.left + rect.width / 2,
          y: rect.top - 10
        })
        setShowHighlightButton(true)
      } else {
        setShowHighlightButton(false)
        setSelectedText('')
      }
    }

    const handleMouseUp = () => {
      // Delay to allow selection to complete
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current)
      }
      selectionTimeoutRef.current = setTimeout(handleSelection, 100)
    }

    const handleClick = (e: MouseEvent) => {
      // Hide button if clicking outside the selection area
      if (showHighlightButton && !(e.target as HTMLElement).closest('.highlight-button-container')) {
        setShowHighlightButton(false)
      }
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('click', handleClick)

    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('click', handleClick)
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current)
      }
    }
  }, [showHighlightButton])

  const handleCreateHighlight = () => {
    const currentSelection = window.getSelection()
    const text = currentSelection?.toString().trim() || selectedText
    
    if (!text) {
      return
    }

    // Store the text to highlight
    setHighlightText(text)

    if (!pubkey) {
      checkLogin(() => {
        // After login, create highlight data and open editor
        const data: HighlightData = {
          sourceType: 'url',
          sourceValue: item.link,
          context: item.description
        }
        setHighlightData(data)
        setIsPostEditorOpen(true)
        // Clear selection
        window.getSelection()?.removeAllRanges()
        setShowHighlightButton(false)
        setSelectedText('')
      })
      return
    }

    // Create highlight data
    const data: HighlightData = {
      sourceType: 'url',
      sourceValue: item.link,
      context: item.description
    }

    // Open PostEditor in highlight mode
    setHighlightData(data)
    setIsPostEditorOpen(true)
    
    // Clear selection
    window.getSelection()?.removeAllRanges()
    setShowHighlightButton(false)
    setSelectedText('')
  }

  // Format feed source name from URL
  const feedSourceName = useMemo(() => {
    try {
      const url = new URL(item.feedUrl)
      return url.hostname.replace(/^www\./, '')
    } catch {
      return item.feedTitle || 'RSS Feed'
    }
  }, [item.feedUrl, item.feedTitle])

  // Parse HTML description safely
  const descriptionHtml = item.description

  // Format publication date
  const pubDateTimestamp = item.pubDate ? Math.floor(item.pubDate.getTime() / 1000) : null

  return (
    <div className={`border rounded-lg bg-background p-4 space-y-3 ${className || ''}`}>
      {/* Feed Source and Date */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span className="font-medium">{feedSourceName}</span>
        {pubDateTimestamp && (
          <FormattedTimestamp timestamp={pubDateTimestamp} className="shrink-0" short />
        )}
      </div>

      {/* Title */}
      <div>
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-lg font-semibold hover:text-primary transition-colors inline-flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {item.title}
          <ExternalLink className="h-4 w-4 shrink-0" />
        </a>
      </div>

      {/* Description with text selection support */}
      <div className="relative">
        <div
          ref={contentRef}
          className="prose prose-sm dark:prose-invert max-w-none break-words rss-feed-content"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
          onMouseUp={(e) => {
            // Allow text selection
            e.stopPropagation()
          }}
          style={{
            userSelect: 'text',
            WebkitUserSelect: 'text',
            MozUserSelect: 'text',
            msUserSelect: 'text'
          }}
        />
        
        {/* Highlight Button */}
        {showHighlightButton && selectedText && selectionPosition && (
          <div
            className="highlight-button-container fixed z-50"
            style={{
              left: `${selectionPosition.x}px`,
              top: `${selectionPosition.y}px`,
              transform: 'translateX(-50%) translateY(-100%)'
            }}
          >
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleCreateHighlight()
              }}
              className="shadow-lg"
            >
              <Highlighter className="h-4 w-4 mr-2" />
              {t('Create Highlight')}
            </Button>
          </div>
        )}
      </div>

      {/* Link to original article */}
      <div className="flex items-center gap-2 text-sm">
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {t('Read full article')}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Post Editor for highlights */}
      <PostEditor
        open={isPostEditorOpen}
        setOpen={(open) => {
          setIsPostEditorOpen(open)
          if (!open) {
            setHighlightData(undefined)
            setHighlightText('')
          }
        }}
        defaultContent={highlightText}
        initialHighlightData={highlightData}
      />
    </div>
  )
}

