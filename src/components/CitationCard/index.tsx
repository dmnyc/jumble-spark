import { ExtendedKind } from '@/constants'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { nip19 } from 'nostr-tools'

function getTagValue(event: Event, tagName: string): string {
  return event.tags.find(tag => tag[0] === tagName)?.[1] || ''
}

interface CitationCardProps {
  event: Event
  className?: string
  displayType?: 'end' | 'foot' | 'foot-end' | 'inline' | 'quote' | 'prompt-end' | 'prompt-inline'
  citationId?: string // The original citation ID (nevent/naddr) for Nostr references
}

export default function CitationCard({ event, className, displayType = 'end', citationId }: CitationCardProps) {
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

  const formatYear = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      const date = new Date(dateStr)
      if (!isNaN(date.getTime())) {
        return date.getFullYear().toString()
      }
    } catch {
      // Fall through to regex extraction
    }
    // Try to extract year from string (YYYY format)
    const yearMatch = dateStr.match(/\b(19|20)\d{2}\b/)
    return yearMatch ? yearMatch[0] : ''
  }

  // Format citation in academic style (NKBIP-03 format for Nostr references)
  const formatAcademicCitation = () => {
    if (citationData.type === 'internal') {
      // NKBIP-03 format: [author]. Nostr: "[title]". [published on].\nnostr:[npub]\nnostr:[event identifier]
      const parts: string[] = []
      
      // Author
      if (citationData.author) {
        parts.push(citationData.author + '.')
      }
      
      // Nostr: "[title]"
      if (citationData.title) {
        parts.push(`Nostr: "${citationData.title}".`)
      } else if (citationData.summary) {
        // Use summary if no title
        const summaryText = citationData.summary.length > 100 
          ? citationData.summary.substring(0, 100) + '...'
          : citationData.summary
        parts.push(`Nostr: "${summaryText}".`)
      } else {
        parts.push('Nostr:')
      }
      
      // Published on date
      if (citationData.publishedOn) {
        const dateStr = formatDate(citationData.publishedOn)
        if (dateStr) {
          parts.push(dateStr + '.')
        }
      }
      
      // Nostr addresses on separate lines (NKBIP-03 format)
      const nostrLines: string[] = []
      
      // Extract npub from cTag (format: kind:pubkey:hex)
      if (citationData.cTag) {
        const cTagParts = citationData.cTag.split(':')
        if (cTagParts.length >= 2) {
          const pubkeyHex = cTagParts[1]
          // Convert hex pubkey to npub
          if (pubkeyHex && /^[0-9a-f]{64}$/i.test(pubkeyHex)) {
            try {
              const npub = nip19.npubEncode(pubkeyHex)
              nostrLines.push(`nostr:${npub}`)
            } catch (error) {
              // If encoding fails, skip npub line
            }
          } else if (pubkeyHex.startsWith('npub') || pubkeyHex.startsWith('nprofile')) {
            // Already a bech32 address
            nostrLines.push(`nostr:${pubkeyHex}`)
          }
        } else if (citationData.cTag.startsWith('npub') || citationData.cTag.startsWith('nprofile')) {
          // cTag is already a bech32 address
          nostrLines.push(`nostr:${citationData.cTag}`)
        }
      }
      
      // Add citationId (event identifier) if it's a bech32 address (nevent/naddr)
      if (citationId && (citationId.startsWith('nevent') || citationId.startsWith('naddr') || citationId.startsWith('note'))) {
        nostrLines.push(`nostr:${citationId}`)
      }
      
      // Join main parts and add nostr addresses on new lines
      const mainText = parts.join(' ')
      if (nostrLines.length > 0) {
        return mainText + '\n' + nostrLines.join('\n')
      }
      return mainText
    } else if (citationData.type === 'external') {
      // APA format: Author. (Year). Title. Publisher. URL
      const parts: string[] = []
      if (citationData.author) {
        parts.push(citationData.author)
      }
      const year = formatYear(citationData.publishedOn || '')
      if (year) {
        parts.push(`(${year})`)
      }
      if (citationData.title) {
        parts.push(citationData.title + '.')
      }
      if (citationData.publishedBy) {
        parts.push(citationData.publishedBy + '.')
      }
      if (citationData.url) {
        parts.push(citationData.url)
      }
      const accessedYear = formatYear(citationData.accessedOn)
      if (accessedYear && accessedYear !== year) {
        parts.push(`Retrieved ${formatDate(citationData.accessedOn)}`)
      }
      return parts.join(' ')
    } else if (citationData.type === 'hardcopy') {
      // APA format: Author. (Year). Title. In Editor (Ed.), Published In (Vol. X, pp. Y-Z). Publisher.
      const parts: string[] = []
      if (citationData.author) {
        parts.push(citationData.author)
      }
      const year = formatYear(citationData.publishedOn || '')
      if (year) {
        parts.push(`(${year})`)
      }
      if (citationData.chapterTitle) {
        parts.push(citationData.chapterTitle + '.')
        if (citationData.editor) {
          parts.push(`In ${citationData.editor} (Ed.),`)
        }
      } else if (citationData.title) {
        parts.push(citationData.title + '.')
      }
      if (citationData.publishedIn) {
        const publishedInText = citationData.volume 
          ? `${citationData.publishedIn} (Vol. ${citationData.volume})`
          : citationData.publishedIn
        parts.push(publishedInText + '.')
      }
      if (citationData.pageRange) {
        parts.push(`pp. ${citationData.pageRange}.`)
      }
      if (citationData.publishedBy) {
        parts.push(citationData.publishedBy + '.')
      }
      if (citationData.doi) {
        parts.push(`https://doi.org/${citationData.doi}`)
      }
      return parts.join(' ')
    } else if (citationData.type === 'prompt') {
      // APA format for AI: LLM. (Year). [Prompt interaction]. URL
      const parts: string[] = []
      if (citationData.llm) {
        parts.push(citationData.llm)
      }
      const year = formatYear(citationData.accessedOn)
      if (year) {
        parts.push(`(${year})`)
      }
      parts.push('[Prompt interaction].')
      if (citationData.url) {
        parts.push(citationData.url)
      }
      return parts.join(' ')
    }
    return ''
  }

  const renderCitationContent = () => {
    if (citationData.type === 'internal') {
      // NKBIP-03 format: [author]. Nostr: "[title]". [published on].\nnostr:[npub]\nnostr:[event identifier]
      const nostrAddresses: string[] = []
      
      // Extract npub from cTag (format: kind:pubkey:hex)
      if (citationData.cTag) {
        const cTagParts = citationData.cTag.split(':')
        if (cTagParts.length >= 2) {
          const pubkeyHex = cTagParts[1]
          // Convert hex pubkey to npub
          if (pubkeyHex && /^[0-9a-f]{64}$/i.test(pubkeyHex)) {
            try {
              const npub = nip19.npubEncode(pubkeyHex)
              nostrAddresses.push(`nostr:${npub}`)
            } catch (error) {
              // If encoding fails, skip npub line
            }
          } else if (pubkeyHex.startsWith('npub') || pubkeyHex.startsWith('nprofile')) {
            // Already a bech32 address
            nostrAddresses.push(`nostr:${pubkeyHex}`)
          }
        } else if (citationData.cTag.startsWith('npub') || citationData.cTag.startsWith('nprofile')) {
          // cTag is already a bech32 address
          nostrAddresses.push(`nostr:${citationData.cTag}`)
        }
      }
      
      // Add citationId (event identifier) if it's a bech32 address (nevent/naddr)
      if (citationId && (citationId.startsWith('nevent') || citationId.startsWith('naddr') || citationId.startsWith('note'))) {
        nostrAddresses.push(`nostr:${citationId}`)
      }
      
      return (
        <div className="space-y-1 text-sm">
          {/* Main citation line: Author. Nostr: "Title". Published on. */}
          <div>
            {citationData.author && <span className="font-semibold">{citationData.author}</span>}
            {citationData.author && '. '}
            <span>Nostr: </span>
            {citationData.title ? (
              <span className="italic">"{citationData.title}"</span>
            ) : citationData.summary ? (
              <span className="italic">"{citationData.summary.length > 100 ? citationData.summary.substring(0, 100) + '...' : citationData.summary}"</span>
            ) : null}
            {citationData.title || citationData.summary ? '. ' : ''}
            {citationData.publishedOn && (
              <span className="text-muted-foreground">{formatDate(citationData.publishedOn)}</span>
            )}
            {citationData.publishedOn && '.'}
          </div>
          
          {/* Nostr addresses on separate lines */}
          {nostrAddresses.map((addr, idx) => (
            <div key={idx} className="text-xs text-muted-foreground font-mono break-all mt-1">
              {addr}
            </div>
          ))}
          
          {/* ALL additional fields */}
          {citationData.accessedOn && (
            <div className="text-xs text-muted-foreground">
              {t('Accessed on')} {formatDate(citationData.accessedOn)}
            </div>
          )}
          {citationData.location && (
            <div className="text-xs text-muted-foreground">
              {t('Location')}: {citationData.location}
            </div>
          )}
          {citationData.geohash && (
            <div className="text-xs text-muted-foreground font-mono">
              {t('Geohash')}: {citationData.geohash}
            </div>
          )}
          {citationData.relayHint && (
            <div className="text-xs text-muted-foreground">
              {t('Relay')}: {citationData.relayHint}
            </div>
          )}
          {citationData.summary && citationData.title && (
            <div className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap">{citationData.summary}</div>
          )}
          {event.content && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-sm border-l-2 border-primary whitespace-pre-wrap">
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
          {citationData.location && (
            <div className="text-xs text-muted-foreground">
              {t('Location')}: {citationData.location}
            </div>
          )}
          {citationData.geohash && (
            <div className="text-xs text-muted-foreground font-mono">
              {t('Geohash')}: {citationData.geohash}
            </div>
          )}
          {citationData.openTimestamp && (
            <div className="text-xs text-muted-foreground font-mono">
              {t('Open Timestamp')}: {citationData.openTimestamp}
            </div>
          )}
          {citationData.summary && (
            <div className="text-muted-foreground mt-2 whitespace-pre-wrap">{citationData.summary}</div>
          )}
          {event.content && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-sm border-l-2 border-primary whitespace-pre-wrap">
              {event.content}
            </div>
          )}
        </div>
      )
    } else if (citationData.type === 'hardcopy') {
      // Display ALL hardcopy fields - show everything that exists
      // Debug: Log all fields to see what we have
      console.log('Hardcopy citation data:', {
        author: citationData.author,
        title: citationData.title,
        chapterTitle: citationData.chapterTitle,
        editor: citationData.editor,
        publishedIn: citationData.publishedIn,
        volume: citationData.volume,
        publishedBy: citationData.publishedBy,
        publishedOn: citationData.publishedOn,
        pageRange: citationData.pageRange,
        doi: citationData.doi,
        accessedOn: citationData.accessedOn,
        version: citationData.version,
        location: citationData.location,
        geohash: citationData.geohash,
        summary: citationData.summary,
        content: event.content,
        allTags: event.tags
      })
      
      return (
        <div className="space-y-1 text-sm">
          {citationData.author && citationData.author.trim() !== '' && (
            <div className="font-semibold">{citationData.author}</div>
          )}
          {citationData.title && citationData.title.trim() !== '' && (
            <div className="italic">"{citationData.title}"</div>
          )}
          {citationData.chapterTitle && citationData.chapterTitle.trim() !== '' && (
            <div className="text-muted-foreground">{t('Chapter')}: {citationData.chapterTitle}</div>
          )}
          {citationData.editor && citationData.editor.trim() !== '' && (
            <div>{t('Edited by')} {citationData.editor}</div>
          )}
          {citationData.publishedIn && citationData.publishedIn.trim() !== '' && (
            <div>
              {t('Published in')} {citationData.publishedIn}
              {citationData.volume && citationData.volume.trim() !== '' ? `, ${t('Volume')} ${citationData.volume}` : ''}
            </div>
          )}
          {citationData.publishedBy && citationData.publishedBy.trim() !== '' && (
            <div>{citationData.publishedBy}</div>
          )}
          {citationData.publishedOn && citationData.publishedOn.trim() !== '' && (
            <div className="text-muted-foreground">{t('Published on')} {formatDate(citationData.publishedOn)}</div>
          )}
          {citationData.pageRange && citationData.pageRange.trim() !== '' && (
            <div className="text-muted-foreground">{t('Pages')}: {citationData.pageRange}</div>
          )}
          {citationData.doi && citationData.doi.trim() !== '' && (
            <div className="text-xs text-muted-foreground">DOI: {citationData.doi}</div>
          )}
          {citationData.accessedOn && citationData.accessedOn.trim() !== '' && (
            <div className="text-xs text-muted-foreground">
              {t('Accessed on')} {formatDate(citationData.accessedOn)}
            </div>
          )}
          {citationData.version && citationData.version.trim() !== '' && (
            <div className="text-xs text-muted-foreground">{t('Version')}: {citationData.version}</div>
          )}
          {citationData.location && citationData.location.trim() !== '' && (
            <div className="text-xs text-muted-foreground">
              {t('Location')}: {citationData.location}
            </div>
          )}
          {citationData.geohash && citationData.geohash.trim() !== '' && (
            <div className="text-xs text-muted-foreground font-mono">
              {t('Geohash')}: {citationData.geohash}
            </div>
          )}
          {citationData.summary && citationData.summary.trim() !== '' && (
            <div className="text-muted-foreground mt-2 whitespace-pre-wrap">{citationData.summary}</div>
          )}
          {event.content && event.content.trim() !== '' && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-sm border-l-2 border-primary whitespace-pre-wrap">
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
            <div className="text-muted-foreground mt-2 whitespace-pre-wrap">{citationData.summary}</div>
          )}
          {event.content && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-sm border-l-2 border-primary whitespace-pre-wrap">
              {event.content}
            </div>
          )}
        </div>
      )
    }
    
    return null
  }


  // For inline citations, render a compact version in academic format
  if (displayType === 'inline' || displayType === 'prompt-inline') {
    // APA format: (Author, Year)
    const author = citationData.type === 'internal' || citationData.type === 'external' || citationData.type === 'hardcopy'
      ? citationData.author
      : citationData.type === 'prompt'
        ? citationData.llm
        : ''
    
    const year = formatYear(
      citationData.publishedOn || citationData.accessedOn || ''
    )
    
    const inlineText = author && year
      ? `(${author}, ${year})`
      : author
        ? `(${author})`
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

  // For footnotes (foot-end), render a brief academic reference
  if (displayType === 'foot-end') {
    const academicText = formatAcademicCitation()
    return (
      <div className={className}>
        <div className="text-sm">
          {academicText || t('See reference')}
        </div>
      </div>
    )
  }

  // For footnotes (foot), render full citation information (same as endnotes)
  if (displayType === 'foot') {
    return (
      <div className={className}>
        <div className="text-sm leading-relaxed">
          {renderCitationContent()}
        </div>
      </div>
    )
  }

  // For endnotes and prompt-end, render full citation information (no card UI)
  if (displayType === 'end' || displayType === 'prompt-end') {
    return (
      <div className={className}>
        <div className="text-sm leading-relaxed">
          {renderCitationContent()}
        </div>
      </div>
    )
  }

  // For quotes (block-level), render full citation information in block quote format
  if (displayType === 'quote') {
    return (
      <blockquote className={`${className} border-l-4 border-gray-300 dark:border-gray-600 pl-6 py-2 my-4 text-sm`}>
        <div className="leading-relaxed">
          {renderCitationContent()}
        </div>
      </blockquote>
    )
  }

  // Default: render in academic format
  const academicText = formatAcademicCitation()
  return (
    <div className={className}>
      <div className="text-sm leading-relaxed">
        {academicText || t('Citation')}
      </div>
    </div>
  )
}

