import { RssFeedItem as TRssFeedItem } from '@/services/rss-feed.service'
import { FormattedTimestamp } from '../FormattedTimestamp'
import { ExternalLink, Highlighter, ChevronDown, ChevronUp } from 'lucide-react'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useNostr } from '@/providers/NostrProvider'
import PostEditor from '@/components/PostEditor'
import { HighlightData } from '@/components/PostEditor/HighlightEditor'
import { cn } from '@/lib/utils'

/**
 * Convert HTML to plain text by extracting text content and cleaning up whitespace
 */
function htmlToPlainText(html: string): string {
  if (!html) return ''
  
  // Create a temporary DOM element to extract text content
  const temp = document.createElement('div')
  temp.innerHTML = html
  
  // Get text content and clean up whitespace
  let text = temp.textContent || temp.innerText || ''
  
  // Clean up multiple consecutive newlines and whitespace
  text = text
    .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
    .replace(/[ \t]+/g, ' ') // Replace multiple spaces/tabs with single space
    .replace(/ \n/g, '\n') // Remove spaces before newlines
    .replace(/\n /g, '\n') // Remove spaces after newlines
    .trim()
  
  return text
}

export default function RssFeedItem({ item, className }: { item: TRssFeedItem; className?: string }) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const [selectedText, setSelectedText] = useState('')
  const [highlightText, setHighlightText] = useState('') // Text to use in highlight editor
  const [showHighlightButton, setShowHighlightButton] = useState(false)
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null)
  const [isPostEditorOpen, setIsPostEditorOpen] = useState(false)
  const [highlightData, setHighlightData] = useState<HighlightData | undefined>(undefined)
  const [isExpanded, setIsExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const selectionTimeoutRef = useRef<NodeJS.Timeout>()

  // Handle text selection
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        setShowHighlightButton(false)
        setSelectedText('')
        setSelectionPosition(null)
        return
      }

      const range = selection.getRangeAt(0)
      
      // Check if selection is collapsed (no actual selection)
      if (selection.isCollapsed || range.collapsed) {
        setShowHighlightButton(false)
        setSelectedText('')
        setSelectionPosition(null)
        return
      }

      // Check if contentRef exists
      if (!contentRef.current) {
        setShowHighlightButton(false)
        setSelectedText('')
        setSelectionPosition(null)
        return
      }

      // Check if selection is within this item's content
      // Use a more reliable containment check
      const commonAncestor = range.commonAncestorContainer
      
      // Check if the common ancestor is within our content element
      // Handle both Element and Text nodes
      let isSelectionInContent = false
      
      if (contentRef.current) {
        // For Element nodes, use contains directly
        if (commonAncestor.nodeType === Node.ELEMENT_NODE) {
          isSelectionInContent = contentRef.current.contains(commonAncestor as Element)
        } else {
          // For Text nodes, check if the parent element is contained
          const parentElement = commonAncestor.parentElement
          if (parentElement) {
            isSelectionInContent = contentRef.current.contains(parentElement)
          }
        }
        
        // Also check if the range intersects with our content
        if (!isSelectionInContent) {
          try {
            const contentRect = contentRef.current.getBoundingClientRect()
            const rangeRect = range.getBoundingClientRect()
            
            // Check if ranges overlap
            isSelectionInContent = !(
              rangeRect.bottom < contentRect.top ||
              rangeRect.top > contentRect.bottom ||
              rangeRect.right < contentRect.left ||
              rangeRect.left > contentRect.right
            )
          } catch {
            // If getBoundingClientRect fails, fall back to false
            isSelectionInContent = false
          }
        }
      }

      if (!isSelectionInContent) {
        setShowHighlightButton(false)
        setSelectedText('')
        setSelectionPosition(null)
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
        setSelectionPosition(null)
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      // Don't process if clicking on the highlight button itself
      if ((e.target as HTMLElement).closest('.highlight-button-container')) {
        return
      }

      // Delay to allow selection to complete
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current)
      }
      selectionTimeoutRef.current = setTimeout(handleSelection, 50)
    }

    const handleClick = (e: MouseEvent) => {
      // Hide button if clicking outside the selection area and not on the button itself
      const target = e.target as HTMLElement
      if (showHighlightButton && !target.closest('.highlight-button-container')) {
        // Check if there's still a valid selection
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          setShowHighlightButton(false)
          setSelectedText('')
          setSelectionPosition(null)
        }
      }
    }

    // Also listen for selectionchange events which fire more reliably
    const handleSelectionChange = () => {
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current)
      }
      selectionTimeoutRef.current = setTimeout(handleSelection, 50)
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('click', handleClick, true) // Use capture phase
    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('selectionchange', handleSelectionChange)
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

    // Convert HTML description to plain text for context
    const plainTextContext = htmlToPlainText(item.description)

    if (!pubkey) {
      checkLogin(() => {
        // After login, create highlight data and open editor
        const data: HighlightData = {
          sourceType: 'url',
          sourceValue: item.link,
          context: plainTextContext
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
      context: plainTextContext
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

  // Clean and parse HTML description safely
  // Remove any XML artifacts that might have leaked through
  const descriptionHtml = useMemo(() => {
    let html = item.description || ''
    
    // Remove any trailing XML/CDATA artifacts
    html = html
      .replace(/\]\]\s*>\s*$/g, '') // Remove trailing ]]> from CDATA
      .replace(/^\s*<!\[CDATA\[/g, '') // Remove leading CDATA declaration
      .replace(/<\?xml[^>]*\?>/gi, '') // Remove XML declarations
      .replace(/<\!DOCTYPE[^>]*>/gi, '') // Remove DOCTYPE declarations
      .trim()
    
    return html
  }, [item.description])

  // Format publication date
  const pubDateTimestamp = item.pubDate ? Math.floor(item.pubDate.getTime() / 1000) : null

  // Check if content exceeds 400px height
  const [needsCollapse, setNeedsCollapse] = useState(false)

  useEffect(() => {
    if (!contentRef.current || !descriptionHtml) return

    const checkHeight = () => {
      const element = contentRef.current
      if (!element) return

      // Temporarily remove max-height to measure full content height
      const hadMaxHeight = element.classList.contains('max-h-[400px]')
      if (hadMaxHeight) {
        element.classList.remove('max-h-[400px]')
        element.style.maxHeight = 'none'
      }
      
      // Force a reflow to get accurate measurements
      void element.offsetHeight
      
      // Measure the actual content height
      const fullHeight = element.scrollHeight
      
      // Restore original state
      if (hadMaxHeight) {
        element.classList.add('max-h-[400px]')
        element.style.maxHeight = ''
      }
      
      setNeedsCollapse(fullHeight > 400)
    }

    // Check height after content is rendered (multiple checks for dynamic content)
    const timeoutId1 = setTimeout(checkHeight, 100)
    const timeoutId2 = setTimeout(checkHeight, 500)

    // Use ResizeObserver to detect when content changes
    const resizeObserver = new ResizeObserver(() => {
      // Only check if not currently expanded (to avoid unnecessary checks)
      if (!isExpanded) {
        checkHeight()
      }
    })

    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }

    return () => {
      clearTimeout(timeoutId1)
      clearTimeout(timeoutId2)
      resizeObserver.disconnect()
    }
  }, [descriptionHtml, isExpanded])

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

      {/* Description with text selection support and collapse/expand */}
      <div className="relative">
        <div
          ref={contentRef}
          className={cn(
            'prose prose-sm dark:prose-invert max-w-none break-words rss-feed-content transition-all duration-200',
            needsCollapse && !isExpanded && 'max-h-[400px] overflow-hidden'
          )}
          style={{
            userSelect: 'text',
            WebkitUserSelect: 'text',
            MozUserSelect: 'text',
            msUserSelect: 'text'
          }}
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
          onMouseUp={(e) => {
            // Allow text selection
            e.stopPropagation()
          }}
        />
        
        {/* Gradient overlay when collapsed */}
        {needsCollapse && !isExpanded && (
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-b from-transparent via-background/60 to-background pointer-events-none" />
        )}
        
        {/* Collapse/Expand Button */}
        {needsCollapse && (
          <div className="flex justify-center mt-2 relative z-10">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setIsExpanded(!isExpanded)
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  {t('Show less')}
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  {t('Show more')}
                </>
              )}
            </Button>
          </div>
        )}
        
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


