import { useMemo } from 'react'
import { rewritePlainTextHttpUrls } from '@/lib/url'
import { Event } from 'nostr-tools'
import { logContentSpacing, reprString } from '@/lib/content-spacing-debug'
import { parseNostrContent, renderNostrContent } from '@/lib/nostr-parser.tsx'
import { cn } from '@/lib/utils'

interface SimpleContentProps {
  event?: Event
  content?: string
  className?: string
}

export default function SimpleContent({
  event,
  content,
  className
}: SimpleContentProps) {
  const processedContent = useMemo(() => {
    const rawContent = content || event?.content || ''
    
    // Clean URLs to remove tracking parameters
    const cleaned = rewritePlainTextHttpUrls(rawContent)
    
    if (rawContent.includes('nostr:')) {
      logContentSpacing('SimpleContent:processedContent', {
        rawRepr: reprString(rawContent),
        cleanedRepr: reprString(cleaned),
        same: rawContent === cleaned
      })
    }
    return cleaned
  }, [content, event?.content])

  // Parse content for nostr addresses and media
  const parsedContent = useMemo(() => {
    const parsed = parseNostrContent(processedContent, event)
    if (processedContent.includes('nostr:')) {
      logContentSpacing('SimpleContent:parsedContent', {
        elementCount: parsed.elements.length,
        tail: parsed.elements.slice(-3).map((e) =>
          e.type === 'text' ? { type: 'text', repr: reprString(e.content) } : { type: e.type }
        )
      })
    }
    return parsed
  }, [processedContent, event])

  return (
    <div className={cn('prose prose-sm prose-zinc max-w-none break-words dark:prose-invert w-full', className)}>
      {renderNostrContent(parsedContent, undefined, event)}
    </div>
  )
}