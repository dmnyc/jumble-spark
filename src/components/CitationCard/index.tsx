import { ExtendedKind } from '@/constants'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getTagValue } from '@/lib/tag'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExternalLink, Book, FileText, Bot } from 'lucide-react'

interface CitationCardProps {
  event: Event
  className?: string
  displayType?: 'end' | 'foot' | 'foot-end' | 'inline' | 'quote' | 'prompt-end' | 'prompt-inline'
}

export default function CitationCard({ event, className, displayType = 'end' }: CitationCardProps) {
  const { t } = useTranslation()

  const citationData = useMemo(() => {
    const title = getTagValue(event, 'title') || ''
    const author = getTagValue(event, 'author') || ''
    const publishedOn = getTagValue(event, 'published_on') || ''
    const accessedOn = getTagValue(event, 'accessed_on') || ''
    const summary = getTagValue(event, 'summary') || ''
    const location = getTagValue(event, 'location') || ''
    const publishedBy = getTagValue(event, 'published_by') || ''
    const version = getTagValue(event, 'version') || ''

    if (event.kind === ExtendedKind.CITATION_INTERNAL) {
      const cTag = event.tags.find(tag => tag[0] === 'c')?.[1] || ''
      const relayHint = event.tags.find(tag => tag[0] === 'c')?.[2] || ''
      const geohash = getTagValue(event, 'g') || ''
      
      return {
        type: 'internal',
        title,
        author,
        publishedOn,
        accessedOn,
        summary,
        location,
        geohash,
        cTag,
        relayHint
      }
    } else if (event.kind === ExtendedKind.CITATION_EXTERNAL) {
      const url = getTagValue(event, 'u') || ''
      const openTimestamp = getTagValue(event, 'open_timestamp') || ''
      const geohash = getTagValue(event, 'g') || ''
      
      return {
        type: 'external',
        title,
        author,
        url,
        publishedOn,
        publishedBy,
        version,
        accessedOn,
        summary,
        location,
        geohash,
        openTimestamp
      }
    } else if (event.kind === ExtendedKind.CITATION_HARDCOPY) {
      const pageRange = getTagValue(event, 'page_range') || ''
      const chapterTitle = getTagValue(event, 'chapter_title') || ''
      const editor = getTagValue(event, 'editor') || ''
      const publishedIn = event.tags.find(tag => tag[0] === 'published_in')?.[1] || ''
      const volume = event.tags.find(tag => tag[0] === 'published_in')?.[2] || ''
      const doi = getTagValue(event, 'doi') || ''
      const geohash = getTagValue(event, 'g') || ''
      
      return {
        type: 'hardcopy',
        title,
        author,
        pageRange,
        chapterTitle,
        editor,
        publishedOn,
        publishedBy,
        publishedIn,
        volume,
        doi,
        version,
        accessedOn,
        summary,
        location,
        geohash
      }
    } else if (event.kind === ExtendedKind.CITATION_PROMPT) {
      const llm = getTagValue(event, 'llm') || ''
      const url = getTagValue(event, 'u') || ''
      
      return {
        type: 'prompt',
        llm,
        accessedOn,
        version,
        summary,
        url
      }
    }
    
    return null
  }, [event])

  if (!citationData) {
    return null
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString()
    } catch {
      return dateStr
    }
  }

  const renderCitationContent = () => {
    if (citationData.type === 'internal') {
      return (
        <div className="space-y-1 text-sm">
          {citationData.author && (
            <div className="font-semibold">{citationData.author}</div>
          )}
          {citationData.title && (
            <div className="italic">"{citationData.title}"</div>
          )}
          {citationData.publishedOn && (
            <div className="text-muted-foreground">{formatDate(citationData.publishedOn)}</div>
          )}
          {citationData.cTag && (
            <div className="text-xs text-muted-foreground font-mono break-all">
              nostr:{citationData.cTag}
            </div>
          )}
          {citationData.summary && (
            <div className="text-muted-foreground mt-2">{citationData.summary}</div>
          )}
          {event.content && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-sm border-l-2 border-primary">
              {event.content}
            </div>
          )}
        </div>
      )
    } else if (citationData.type === 'external') {
      return (
        <div className="space-y-1 text-sm">
          {citationData.author && (
            <div className="font-semibold">{citationData.author}</div>
          )}
          {citationData.title && (
            <div className="italic">"{citationData.title}"</div>
          )}
          {citationData.publishedBy && (
            <div>{citationData.publishedBy}</div>
          )}
          {citationData.publishedOn && (
            <div className="text-muted-foreground">{formatDate(citationData.publishedOn)}</div>
          )}
          {citationData.url && (
            <div className="flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="w-3 h-3" />
              <a href={citationData.url} target="_blank" rel="noreferrer noopener" className="break-all">
                {citationData.url}
              </a>
            </div>
          )}
          {citationData.accessedOn && (
            <div className="text-xs text-muted-foreground">
              {t('Accessed on')} {formatDate(citationData.accessedOn)}
            </div>
          )}
          {citationData.version && (
            <div className="text-xs text-muted-foreground">{t('Version')}: {citationData.version}</div>
          )}
          {citationData.summary && (
            <div className="text-muted-foreground mt-2">{citationData.summary}</div>
          )}
          {event.content && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-sm border-l-2 border-primary">
              {event.content}
            </div>
          )}
        </div>
      )
    } else if (citationData.type === 'hardcopy') {
      return (
        <div className="space-y-1 text-sm">
          {citationData.author && (
            <div className="font-semibold">{citationData.author}</div>
          )}
          {citationData.title && (
            <div className="italic">"{citationData.title}"</div>
          )}
          {citationData.chapterTitle && (
            <div className="text-muted-foreground">{t('Chapter')}: {citationData.chapterTitle}</div>
          )}
          {citationData.editor && (
            <div>{t('Edited by')} {citationData.editor}</div>
          )}
          {citationData.publishedIn && (
            <div>
              {t('Published in')} {citationData.publishedIn}
              {citationData.volume && `, ${t('Volume')} ${citationData.volume}`}
            </div>
          )}
          {citationData.publishedBy && (
            <div>{citationData.publishedBy}</div>
          )}
          {citationData.publishedOn && (
            <div className="text-muted-foreground">{formatDate(citationData.publishedOn)}</div>
          )}
          {citationData.pageRange && (
            <div className="text-muted-foreground">{t('Pages')}: {citationData.pageRange}</div>
          )}
          {citationData.doi && (
            <div className="text-xs text-muted-foreground">DOI: {citationData.doi}</div>
          )}
          {citationData.accessedOn && (
            <div className="text-xs text-muted-foreground">
              {t('Accessed on')} {formatDate(citationData.accessedOn)}
            </div>
          )}
          {citationData.version && (
            <div className="text-xs text-muted-foreground">{t('Version')}: {citationData.version}</div>
          )}
          {citationData.summary && (
            <div className="text-muted-foreground mt-2">{citationData.summary}</div>
          )}
          {event.content && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-sm border-l-2 border-primary">
              {event.content}
            </div>
          )}
        </div>
      )
    } else if (citationData.type === 'prompt') {
      return (
        <div className="space-y-1 text-sm">
          {citationData.llm && (
            <div className="font-semibold">{citationData.llm}</div>
          )}
          {citationData.accessedOn && (
            <div className="text-muted-foreground">{t('Accessed on')} {formatDate(citationData.accessedOn)}</div>
          )}
          {citationData.version && (
            <div className="text-xs text-muted-foreground">{t('Version')}: {citationData.version}</div>
          )}
          {citationData.url && (
            <div className="flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="w-3 h-3" />
              <a href={citationData.url} target="_blank" rel="noreferrer noopener" className="break-all">
                {citationData.url}
              </a>
            </div>
          )}
          {citationData.summary && (
            <div className="text-muted-foreground mt-2">{citationData.summary}</div>
          )}
          {event.content && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-sm border-l-2 border-primary">
              {event.content}
            </div>
          )}
        </div>
      )
    }
    
    return null
  }

  const getIcon = () => {
    switch (citationData.type) {
      case 'internal':
        return <FileText className="w-4 h-4" />
      case 'external':
        return <ExternalLink className="w-4 h-4" />
      case 'hardcopy':
        return <Book className="w-4 h-4" />
      case 'prompt':
        return <Bot className="w-4 h-4" />
      default:
        return <FileText className="w-4 h-4" />
    }
  }

  const getTitle = () => {
    switch (citationData.type) {
      case 'internal':
        return t('Internal Citation')
      case 'external':
        return t('External Citation')
      case 'hardcopy':
        return t('Hardcopy Citation')
      case 'prompt':
        return t('Prompt Citation')
      default:
        return t('Citation')
    }
  }

  // For inline citations, render a compact version
  if (displayType === 'inline' || displayType === 'prompt-inline') {
    const inlineText = citationData.type === 'internal' && citationData.author && citationData.publishedOn
      ? `(${citationData.author}, ${formatDate(citationData.publishedOn)})`
      : citationData.type === 'prompt' && citationData.llm
        ? `(${citationData.llm})`
        : `[${t('Citation')}]`
    
    return (
      <span className={className}>
        <a
          href={`/notes/${event.id}`}
          className="text-primary hover:underline"
          onClick={(e) => {
            e.preventDefault()
            // Scroll to full citation in references section
            const refSection = document.getElementById('references-section')
            if (refSection) {
              refSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          }}
        >
          {inlineText}
        </a>
      </span>
    )
  }

  // For footnotes (foot-end), render a brief reference
  if (displayType === 'foot-end') {
    return (
      <div className={className}>
        <div className="text-sm text-muted-foreground">
          {citationData.type === 'internal' && citationData.author && citationData.publishedOn
            ? `${citationData.author}, ${formatDate(citationData.publishedOn)}`
            : citationData.type === 'external' && citationData.author
              ? `${citationData.author}`
              : citationData.type === 'hardcopy' && citationData.author
                ? `${citationData.author}`
                : citationData.type === 'prompt' && citationData.llm
                  ? `${citationData.llm}`
                  : t('See reference')}
        </div>
      </div>
    )
  }

  // For quotes, render with quote styling
  if (displayType === 'quote') {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {getIcon()}
            {getTitle()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renderCitationContent()}
        </CardContent>
      </Card>
    )
  }

  // For endnotes, footnotes, and prompt-end, render full citation
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {getIcon()}
          {getTitle()}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {renderCitationContent()}
      </CardContent>
    </Card>
  )
}

