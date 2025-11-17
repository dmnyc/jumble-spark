import { useState, useEffect, useMemo } from 'react'
import { Event } from 'nostr-tools'
import { parseBookWikilink, extractBookMetadata, BookReference } from '@/lib/bookstr-parser'
import client from '@/services/client.service'
import { ExtendedKind } from '@/constants'
import { Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import { contentParserService } from '@/services/content-parser.service'

interface BookstrContentProps {
  wikilink: string
  className?: string
}

interface BookSection {
  reference: BookReference
  events: Event[]
  versions: string[]
  originalVerses?: string
  originalChapter?: number
}

export function BookstrContent({ wikilink, className }: BookstrContentProps) {
  const [sections, setSections] = useState<BookSection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set())
  const [selectedVersions, setSelectedVersions] = useState<Map<number, string>>(new Map())

  // Parse the wikilink
  const parsed = useMemo(() => {
    try {
      // Extract book type from wikilink (e.g., "book:bible:Genesis 3:1")
      let bookType = 'bible'
      let content = wikilink
      
      if (wikilink.startsWith('book:')) {
        const parts = wikilink.substring(5).split(':')
        if (parts.length >= 2) {
          bookType = parts[0]
          content = parts.slice(1).join(':')
        }
      } else if (wikilink.includes(':')) {
        // Might be "bible:Genesis 3:1" format
        const firstColon = wikilink.indexOf(':')
        const potentialType = wikilink.substring(0, firstColon)
        if (['bible', 'quran', 'catechism', 'torah'].includes(potentialType.toLowerCase())) {
          bookType = potentialType.toLowerCase()
          content = wikilink.substring(firstColon + 1)
        }
      }
      
      const result = parseBookWikilink(`[[book:${bookType}:${content}]]`, bookType)
      return result ? { ...result, bookType } : null
    } catch (err) {
      logger.error('Error parsing bookstr wikilink', { error: err, wikilink })
      return null
    }
  }, [wikilink])

  // Fetch events for each reference
  useEffect(() => {
    if (!parsed || !parsed.references.length) {
      setIsLoading(false)
      setError('Invalid bookstr reference')
      return
    }

    const fetchEvents = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const newSections: BookSection[] = []

        for (const ref of parsed.references) {
          // Normalize book name (lowercase, hyphenated)
          const normalizedBook = ref.book.toLowerCase().replace(/\s+/g, '-')
          const bookType = (parsed as any).bookType || 'bible'
          
          // Determine which versions to fetch
          const versionsToFetch = parsed.versions || (ref.version ? [ref.version] : [])

          // If no versions specified, try to find available versions
          if (versionsToFetch.length === 0) {
            // First, try to find any version for this book/chapter/verse
            const allEvents = await client.fetchBookstrEvents({
              type: bookType,
              book: normalizedBook,
              chapter: ref.chapter,
              verse: ref.verse
            })

            // Extract unique versions
            const availableVersions = new Set<string>()
            allEvents.forEach(event => {
              const metadata = extractBookMetadata(event)
              if (metadata.version) {
                availableVersions.add(metadata.version.toUpperCase())
              }
            })

            if (availableVersions.size > 0) {
              versionsToFetch.push(Array.from(availableVersions)[0]) // Use first available
            } else {
              // No versions found, try without version filter
              const eventsWithoutVersion = await client.fetchBookstrEvents({
                type: bookType,
                book: normalizedBook,
                chapter: ref.chapter,
                verse: ref.verse
              })
              
              if (eventsWithoutVersion.length > 0) {
                // Use events without version filter
                newSections.push({
                  reference: ref,
                  events: eventsWithoutVersion,
                  versions: [],
                  originalVerses: ref.verse,
                  originalChapter: ref.chapter
                })
                continue
              }
            }
          }

          // Fetch events for each version
          const allEvents: Event[] = []
          const allVersions = new Set<string>()

          for (const version of versionsToFetch) {
            // Fetch entire chapter if verse is specified, entire book if only chapter is specified
            const events = await client.fetchBookstrEvents({
              type: bookType,
              book: normalizedBook,
              chapter: ref.chapter,
              verse: ref.verse, // Pass verse for context, but we'll fetch entire chapter
              version: version.toLowerCase()
            })

            logger.debug('BookstrContent: Fetched events', {
              book: normalizedBook,
              chapter: ref.chapter,
              verse: ref.verse,
              version,
              eventCount: events.length
            })

            events.forEach(event => {
              allEvents.push(event)
              const metadata = extractBookMetadata(event)
              if (metadata.version) {
                allVersions.add(metadata.version.toUpperCase())
              }
            })
          }

          // Filter events to only show requested verses (if verse is specified)
          // We fetched the entire chapter/book, but only display the requested verses
          let filteredEvents = allEvents
          if (ref.verse) {
            const verseParts = ref.verse.split(/[,\s-]+/).map(v => v.trim()).filter(v => v)
            filteredEvents = allEvents.filter(event => {
              const metadata = extractBookMetadata(event)
              const eventVerse = metadata.verse
              if (!eventVerse) return false
              
              // Check if this verse matches any of the requested verses
              const verseNum = parseInt(eventVerse)
              return verseParts.some(part => {
                if (part.includes('-')) {
                  const [start, end] = part.split('-').map(v => parseInt(v.trim()))
                  return !isNaN(start) && !isNaN(end) && verseNum >= start && verseNum <= end
                } else {
                  const partNum = parseInt(part)
                  return !isNaN(partNum) && partNum === verseNum
                }
              })
            })
          }

          // Sort events by verse number
          filteredEvents.sort((a, b) => {
            const aMeta = extractBookMetadata(a)
            const bMeta = extractBookMetadata(b)
            const aVerse = parseInt(aMeta.verse || '0')
            const bVerse = parseInt(bMeta.verse || '0')
            return aVerse - bVerse
          })

          logger.debug('BookstrContent: Filtered events', {
            book: normalizedBook,
            chapter: ref.chapter,
            verse: ref.verse,
            totalFetched: allEvents.length,
            filteredCount: filteredEvents.length
          })

          newSections.push({
            reference: ref,
            events: filteredEvents,
            versions: Array.from(allVersions),
            originalVerses: ref.verse,
            originalChapter: ref.chapter
          })
        }

        logger.debug('BookstrContent: Setting sections', {
          sectionCount: newSections.length,
          sections: newSections.map(s => ({
            book: s.reference.book,
            chapter: s.reference.chapter,
            verse: s.reference.verse,
            eventCount: s.events.length,
            versions: s.versions
          }))
        })
        
        setSections(newSections)
        
        // Set initial selected versions
        const initialVersions = new Map<number, string>()
        newSections.forEach((section, index) => {
          if (section.versions.length > 0) {
            initialVersions.set(index, section.versions[0])
          }
        })
        setSelectedVersions(initialVersions)
      } catch (err) {
        logger.error('Error fetching bookstr events', { error: err, wikilink })
        setError(err instanceof Error ? err.message : 'Failed to fetch book content')
      } finally {
        setIsLoading(false)
      }
    }

    fetchEvents()
  }, [parsed, wikilink])

  if (isLoading) {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <span>{wikilink}</span>
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    )
  }

  if (error) {
    return (
      <span className={cn('inline-flex items-center gap-1', className)} title={error}>
        <span>{wikilink}</span>
        <AlertCircle className="h-3 w-3 text-red-500" />
      </span>
    )
  }

  if (sections.length === 0) {
    return (
      <span className={cn('inline-flex items-center gap-1', className)} title="No content found">
        <span>{wikilink}</span>
        <AlertCircle className="h-3 w-3 text-yellow-500" />
      </span>
    )
  }

  return (
    <div className={cn('my-2 space-y-4', className)}>
      {sections.map((section, sectionIndex) => {
        const selectedVersion = selectedVersions.get(sectionIndex) || section.versions[0] || ''
        const filteredEvents = selectedVersion
          ? section.events.filter(event => {
              const metadata = extractBookMetadata(event)
              return metadata.version?.toUpperCase() === selectedVersion
            })
          : section.events

        const isExpanded = expandedSections.has(sectionIndex)
        const hasVerses = section.originalVerses !== undefined && section.originalVerses.length > 0
        const hasChapter = section.originalChapter !== undefined && !hasVerses

        return (
          <div key={sectionIndex} className="border rounded-lg p-3 bg-muted/30">
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold text-sm">
                {section.reference.book}
                {section.reference.chapter && ` ${section.reference.chapter}`}
                {section.reference.verse && `:${section.reference.verse}`}
                {selectedVersion && ` (${selectedVersion})`}
              </h4>
              <VersionSelector
                section={section}
                sectionIndex={sectionIndex}
                selectedVersion={selectedVersion}
                onVersionChange={(version: string) => {
                  const newVersions = new Map(selectedVersions)
                  newVersions.set(sectionIndex, version)
                  setSelectedVersions(newVersions)
                }}
              />
            </div>

            {/* Verses */}
            <VerseContent
              events={filteredEvents}
              hasVerses={hasVerses}
              originalVerses={section.originalVerses}
              isExpanded={isExpanded}
            />

            {/* Expand/Collapse buttons - only show if events were found */}
            {hasVerses && filteredEvents.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-6 text-xs"
                onClick={() => {
                  const newExpanded = new Set(expandedSections)
                  if (newExpanded.has(sectionIndex)) {
                    newExpanded.delete(sectionIndex)
                  } else {
                    newExpanded.add(sectionIndex)
                  }
                  setExpandedSections(newExpanded)
                }}
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" />
                    Collapse chapter
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Read full chapter
                  </>
                )}
              </Button>
            )}
            {hasChapter && !hasVerses && filteredEvents.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-6 text-xs"
                onClick={() => {
                  const newExpanded = new Set(expandedSections)
                  if (newExpanded.has(sectionIndex)) {
                    newExpanded.delete(sectionIndex)
                  } else {
                    newExpanded.add(sectionIndex)
                  }
                  setExpandedSections(newExpanded)
                }}
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" />
                    Collapse book
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Read full book
                  </>
                )}
              </Button>
            )}

            {/* Expanded content */}
            {isExpanded && (
              <div className="mt-3 pt-3 border-t">
                {/* Fetch and display full chapter/book */}
                <ExpandedContent
                  section={section}
                  selectedVersion={selectedVersion}
                  originalVerses={section.originalVerses}
                  originalChapter={section.originalChapter}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface ExpandedContentProps {
  section: BookSection
  selectedVersion: string
  originalVerses?: string
  originalChapter?: number
}

function ExpandedContent({ section, selectedVersion, originalVerses, originalChapter }: ExpandedContentProps) {
  const [expandedEvents, setExpandedEvents] = useState<Event[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchExpanded = async () => {
      setIsLoading(true)
      try {
        // Determine book type (default to bible)
        const bookType = 'bible' // Could be extracted from section if we store it
        const normalizedBook = section.reference.book.toLowerCase().replace(/\s+/g, '-')
        
        // Fetch full chapter or book
        const filters: any = {
          type: bookType,
          book: normalizedBook
        }

        if (originalChapter !== undefined) {
          // Fetch full chapter
          filters.chapter = originalChapter
        }
        // If no chapter specified, fetch entire book

        if (selectedVersion) {
          filters.version = selectedVersion.toLowerCase()
        }

        const events = await client.fetchBookstrEvents(filters)
        
        // Sort by chapter and verse
        events.sort((a, b) => {
          const aMeta = extractBookMetadata(a)
          const bMeta = extractBookMetadata(b)
          const aChapter = parseInt(aMeta.chapter || '0')
          const bChapter = parseInt(bMeta.chapter || '0')
          if (aChapter !== bChapter) return aChapter - bChapter
          const aVerse = parseInt(aMeta.verse || '0')
          const bVerse = parseInt(bMeta.verse || '0')
          return aVerse - bVerse
        })

        setExpandedEvents(events)
      } catch (err) {
        logger.error('Error fetching expanded content', { error: err })
      } finally {
        setIsLoading(false)
      }
    }

    fetchExpanded()
  }, [section, selectedVersion, originalChapter])

  if (isLoading) {
    return <div className="text-xs text-muted-foreground">Loading...</div>
  }

  return (
    <VerseContent
      events={expandedEvents}
      hasVerses={!!originalVerses}
      originalVerses={originalVerses}
      isExpanded={true}
      originalChapter={originalChapter}
    />
  )
}

interface VerseContentProps {
  events: Event[]
  hasVerses: boolean
  originalVerses?: string
  isExpanded: boolean
  originalChapter?: number
}

function VerseContent({ events, hasVerses, originalVerses, isExpanded, originalChapter }: VerseContentProps) {
  const [parsedContents, setParsedContents] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const parseAll = async () => {
      const newParsed = new Map<string, string>()
      for (const event of events) {
        if (!parsedContents.has(event.id)) {
          try {
            const result = await contentParserService.parseContent(event.content, {
              eventKind: ExtendedKind.PUBLICATION_CONTENT
            })
            newParsed.set(event.id, result.html)
          } catch (err) {
            logger.warn('Error parsing verse content', { error: err, eventId: event.id.substring(0, 8) })
            newParsed.set(event.id, event.content)
          }
        } else {
          // Already parsed, copy it
          newParsed.set(event.id, parsedContents.get(event.id)!)
        }
      }
      if (newParsed.size > 0) {
        setParsedContents(newParsed)
      }
    }
    parseAll()
  }, [events])

  return (
    <div className="space-y-1">
      {events.map((event) => {
        const metadata = extractBookMetadata(event)
        const verseNum = metadata.verse
        const chapterNum = metadata.chapter
        // Check if this verse is in the original verses list
        const isOriginalVerse = hasVerses && originalVerses && verseNum && (() => {
          const verseParts = originalVerses.split(/[,\s-]+/).map(v => v.trim())
          const verseNumInt = parseInt(verseNum)
          // Check exact match or range
          for (const part of verseParts) {
            if (part.includes('-')) {
              const [start, end] = part.split('-').map(v => parseInt(v.trim()))
              if (!isNaN(start) && !isNaN(end) && verseNumInt >= start && verseNumInt <= end) {
                return true
              }
            } else {
              const partNum = parseInt(part)
              if (!isNaN(partNum) && partNum === verseNumInt) {
                return true
              }
            }
          }
          return false
        })()
        const isOriginalChapter = originalChapter !== undefined && 
          chapterNum && parseInt(chapterNum) === originalChapter

        const content = parsedContents.get(event.id) || event.content

        return (
          <div
            key={event.id}
            className={cn(
              'flex gap-2 text-sm leading-relaxed items-baseline',
              isExpanded && (isOriginalVerse || isOriginalChapter) && 'border-l-2 border-gray-400 pl-2'
            )}
          >
            {/* Verse number on the left - only show verse number, not chapter:verse */}
            <span className="font-semibold text-muted-foreground shrink-0 min-w-[2.5rem] text-right">
              {verseNum || null}
            </span>
            {/* Content on the right */}
            <span className="flex-1" dangerouslySetInnerHTML={{ __html: content }} />
          </div>
        )
      })}
    </div>
  )
}

interface VersionSelectorProps {
  section: BookSection
  sectionIndex: number
  selectedVersion: string
  onVersionChange: (version: string) => void
}

function VersionSelector({ section, selectedVersion, onVersionChange }: VersionSelectorProps) {
  const [availableVersions, setAvailableVersions] = useState<string[]>(section.versions)
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)

  // When component mounts or section changes, try to fetch more versions if needed
  useEffect(() => {
    const fetchAvailableVersions = async () => {
      if (availableVersions.length > 1) return // Already have multiple versions
      
      setIsLoadingVersions(true)
      try {
        // Query for all versions of this book/chapter/verse
        const normalizedBook = section.reference.book.toLowerCase().replace(/\s+/g, '-')
        const allEvents = await client.fetchBookstrEvents({
          type: 'bible',
          book: normalizedBook,
          chapter: section.reference.chapter,
          verse: section.reference.verse
        })

        const versions = new Set<string>()
        allEvents.forEach(event => {
          const metadata = extractBookMetadata(event)
          if (metadata.version) {
            versions.add(metadata.version.toUpperCase())
          }
        })

        if (versions.size > availableVersions.length) {
          setAvailableVersions(Array.from(versions).sort())
        }
      } catch (err) {
        logger.warn('Error fetching available versions', { error: err })
      } finally {
        setIsLoadingVersions(false)
      }
    }

    fetchAvailableVersions()
  }, [section.reference.book, section.reference.chapter, section.reference.verse, availableVersions.length])

  // Don't show selector if only one version available
  if (availableVersions.length <= 1) {
    return null
  }

  return (
    <Select
      value={selectedVersion}
      onValueChange={onVersionChange}
      disabled={isLoadingVersions}
    >
      <SelectTrigger className="h-6 w-auto px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {availableVersions.map((version) => (
          <SelectItem key={version} value={version}>
            {version}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

