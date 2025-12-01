import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Event } from 'nostr-tools'
import { parseBookWikilink, extractBookMetadata, BookReference } from '@/lib/bookstr-parser'
import client from '@/services/client.service'
import { ExtendedKind } from '@/constants'
import { Loader2, AlertCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
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

/**
 * Build Bible Gateway URL for a passage
 */
function buildBibleGatewayUrl(reference: BookReference, version?: string): string {
  // Format passage: "Psalm 23:4-7" or "Genesis 1:4" or "1 John 3:16"
  let passage = reference.book
  if (reference.chapter !== undefined) {
    passage += ` ${reference.chapter}`
  }
  if (reference.verse) {
    passage += `:${reference.verse}`
  }
  
  // Map version codes to Bible Gateway codes
  // Common mappings: DRB -> DRA (Douay-Rheims), etc.
  const versionMap: Record<string, string> = {
    'DRB': 'DRA', // Douay-Rheims Bible -> Douay-Rheims 1899 American Edition
    'DRA': 'DRA', // Already correct
  }
  
  const bgVersion = version ? (versionMap[version.toUpperCase()] || version.toUpperCase()) : 'DRA'
  
  // URL encode the passage
  const encodedPassage = encodeURIComponent(passage)
  
  return `https://www.biblegateway.com/passage/?search=${encodedPassage}&version=${bgVersion}`
}

export function BookstrContent({ wikilink, className }: BookstrContentProps) {
  const [sections, setSections] = useState<BookSection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set())
  const [selectedVersions, setSelectedVersions] = useState<Map<number, string>>(new Map())
  const [collapsedCards, setCollapsedCards] = useState<Set<number>>(new Set())
  const [cardHeights, setCardHeights] = useState<Map<number, number>>(new Map())
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Parse the wikilink
  const parsed = useMemo(() => {
    try {
      // NKBIP-08 format: book::... (must have double colon)
      let wikilinkToParse = wikilink
      
      if (wikilink.startsWith('book::')) {
        // Already in correct format, add brackets if needed
        if (!wikilink.startsWith('[[')) {
          wikilinkToParse = `[[${wikilink}]]`
        } else {
          wikilinkToParse = wikilink
        }
      } else {
        // Invalid format - must start with book::
        return null
      }
      
      const result = parseBookWikilink(wikilinkToParse)
      if (result) {
        const inferredBookType = result.bookType || 'bible'
        logger.debug('BookstrContent: Parsed wikilink', {
          wikilink,
          wikilinkToParse,
          bookType: inferredBookType,
          referenceCount: result.references.length,
          references: result.references.map(r => ({
            book: r.book,
            chapter: r.chapter,
            verse: r.verse,
            version: r.version
          })),
          versions: result.versions
        })
        return { ...result, bookType: inferredBookType }
      }
      return null
    } catch (err) {
      logger.error('Error parsing bookstr wikilink', { error: err, wikilink })
      return null
    }
  }, [wikilink])

  // Fetch events for each reference
  useEffect(() => {
    // Early return if parsed is not ready
    if (!parsed) {
      return
    }
    
    if (!parsed.references.length) {
      setIsLoading(false)
      setError('Invalid bookstr reference')
      return
    }

    let isCancelled = false

    const fetchEvents = async () => {
      setIsLoading(true)
      setError(null)

      try {
        logger.debug('BookstrContent: Processing references', {
          totalReferences: parsed.references.length,
          references: parsed.references.map(r => ({
            book: r.book,
            chapter: r.chapter,
            verse: r.verse
          }))
        })
        
        // Step 0: Create placeholder sections immediately so links don't disappear
        const placeholderSections: BookSection[] = parsed.references.map(ref => ({
          reference: ref,
          events: [],
          versions: [],
          originalVerses: ref.verse,
          originalChapter: ref.chapter
        }))
        setSections(placeholderSections)
        setIsLoading(false) // Show placeholders immediately
        
        const newSections: BookSection[] = []
        
        // Step 1: Check cache for ALL references first (in parallel)
        const bookType = (parsed as any).bookType || 'bible'
        const cacheChecks = parsed.references.map(async (ref) => {
          const normalizedBook = ref.book.toLowerCase().replace(/\s+/g, '-')
          const versionsToFetch = parsed.versions || (ref.version ? [ref.version] : [])
          
          // Check cache for each version (or without version if none specified)
          const cachePromises = versionsToFetch.length > 0
            ? versionsToFetch.map(version => 
                client.getCachedBookstrEvents({
                  type: bookType,
                  book: normalizedBook,
                  chapter: ref.chapter,
                  verse: ref.verse,
                  version: version.toLowerCase()
                })
              )
            : [
                client.getCachedBookstrEvents({
                  type: bookType,
                  book: normalizedBook,
                  chapter: ref.chapter,
                  verse: ref.verse
                })
              ]
          
          const cachedResults = await Promise.all(cachePromises)
          const allCachedEvents = cachedResults.flat()
          
          return { ref, cachedEvents: allCachedEvents, versionsToFetch }
        })
        
        const cacheResults = await Promise.all(cacheChecks)
        
        // Step 2: Display cached results IMMEDIATELY
        for (const { ref, cachedEvents } of cacheResults) {
          if (cachedEvents.length > 0) {
            const allVersions = new Set<string>()
            cachedEvents.forEach(event => {
              const metadata = extractBookMetadata(event)
              if (metadata.version) {
                allVersions.add(metadata.version.toUpperCase())
              }
            })
            
            // Filter events based on what was requested
            let filteredEvents = cachedEvents
            
            // Filter by chapter if specified
            if (ref.chapter !== undefined) {
              filteredEvents = filteredEvents.filter(event => {
                const metadata = extractBookMetadata(event)
                const eventChapter = parseInt(metadata.chapter || '0')
                return eventChapter === ref.chapter
              })
            }
            
            // Filter by verse if specified
            if (ref.verse) {
              const verseNumbers = new Set<number>()
              const verseSpecs = ref.verse.split(',').map(v => v.trim()).filter(v => v)
              
              for (const spec of verseSpecs) {
                if (spec.includes('-')) {
                  const [startStr, endStr] = spec.split('-').map(v => v.trim())
                  const start = parseInt(startStr)
                  const end = parseInt(endStr)
                  if (!isNaN(start) && !isNaN(end) && start <= end) {
                    for (let v = start; v <= end; v++) {
                      verseNumbers.add(v)
                    }
                  }
                } else {
                  const verseNum = parseInt(spec)
                  if (!isNaN(verseNum)) {
                    verseNumbers.add(verseNum)
                  }
                }
              }
              
              filteredEvents = filteredEvents.filter(event => {
                const metadata = extractBookMetadata(event)
                const eventVerse = metadata.verse
                if (!eventVerse) return false
                const eventVerseNum = parseInt(eventVerse)
                return !isNaN(eventVerseNum) && verseNumbers.has(eventVerseNum)
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
            
            newSections.push({
              reference: ref,
              events: filteredEvents,
              versions: Array.from(allVersions),
              originalVerses: ref.verse,
              originalChapter: ref.chapter
            })
          }
        }
        
        // Display cached results immediately (merge with placeholders)
        if (!isCancelled) {
          // Create a map of sections by reference key for easy lookup
          const sectionsByRef = new Map<string, BookSection>()
          newSections.forEach(section => {
            const key = `${section.reference.book}-${section.reference.chapter}-${section.reference.verse}`
            sectionsByRef.set(key, section)
          })
          
          // Update placeholders with cached results, keep placeholders for missing ones
          const updatedSections = placeholderSections.map(placeholder => {
            const key = `${placeholder.reference.book}-${placeholder.reference.chapter}-${placeholder.reference.verse}`
            const cachedSection = sectionsByRef.get(key)
            return cachedSection || placeholder
          })
          
          setSections(updatedSections)
          
          // Set initial selected versions
          const initialVersions = new Map<number, string>()
          updatedSections.forEach((section, index) => {
            if (section.versions.length > 0) {
              initialVersions.set(index, section.versions[0])
            }
          })
          setSelectedVersions(initialVersions)
        }
        
        // Step 3: Fetch missing events from network in the background
        for (const { ref, cachedEvents, versionsToFetch } of cacheResults) {
          if (isCancelled) break
          
          // If we already have cached events for this reference, skip or do background refresh
          if (cachedEvents.length > 0) {
            // Still fetch in background to get updates
            const normalizedBook = ref.book.toLowerCase().replace(/\s+/g, '-')
            const fetchPromises = versionsToFetch.length > 0
              ? versionsToFetch.map(version => 
                  client.fetchBookstrEvents({
                    type: bookType,
                    book: normalizedBook,
                    chapter: ref.chapter,
                    verse: ref.verse,
                    version: version.toLowerCase()
                  })
                )
              : [
                  client.fetchBookstrEvents({
                    type: bookType,
                    book: normalizedBook,
                    chapter: ref.chapter,
                    verse: ref.verse
                  })
                ]
            
            Promise.all(fetchPromises).then(fetchedResults => {
              if (isCancelled) return
              
              const allFetchedEvents = fetchedResults.flat()
              if (allFetchedEvents.length > 0) {
                // Update the section with fresh data
                setSections(prevSections => {
                  const updated = [...prevSections]
                  const sectionIndex = updated.findIndex(s => 
                    s.reference.book === ref.book &&
                    s.reference.chapter === ref.chapter &&
                    s.reference.verse === ref.verse
                  )
                  
                  if (sectionIndex >= 0) {
                    // Merge with existing events (deduplicate by event id)
                    const existingIds = new Set(updated[sectionIndex].events.map(e => e.id))
                    const newEvents = allFetchedEvents.filter(e => !existingIds.has(e.id))
                    updated[sectionIndex] = {
                      ...updated[sectionIndex],
                      events: [...updated[sectionIndex].events, ...newEvents]
                    }
                  }
                  
                  return updated
                })
              }
            }).catch(err => {
              logger.warn('BookstrContent: Background fetch failed', { error: err, ref })
            })
            continue
          }
          
          // No cached events, fetch from network
          const normalizedBook = ref.book.toLowerCase().replace(/\s+/g, '-')
          
          // Determine which versions to fetch
          let versionsToFetchFinal = versionsToFetch
          if (versionsToFetchFinal.length === 0) {
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
              versionsToFetchFinal = [Array.from(availableVersions)[0]] // Use first available
            } else {
              if (allEvents.length > 0) {
                // Use events without version filter
                const allVersions = new Set<string>()
                allEvents.forEach(event => {
                  const metadata = extractBookMetadata(event)
                  if (metadata.version) {
                    allVersions.add(metadata.version.toUpperCase())
                  }
                })
                
                newSections.push({
                  reference: ref,
                  events: allEvents,
                  versions: Array.from(allVersions),
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

          for (const version of versionsToFetchFinal) {
            const events = await client.fetchBookstrEvents({
              type: bookType,
              book: normalizedBook,
              chapter: ref.chapter,
              verse: ref.verse,
              version: version.toLowerCase()
            })

            events.forEach(event => {
              allEvents.push(event)
              const metadata = extractBookMetadata(event)
              if (metadata.version) {
                allVersions.add(metadata.version.toUpperCase())
              }
            })
          }

          // Filter events based on what was requested
          let filteredEvents = allEvents
          
          // Filter by chapter if specified
          if (ref.chapter !== undefined) {
            filteredEvents = filteredEvents.filter(event => {
              const metadata = extractBookMetadata(event)
              const eventChapter = parseInt(metadata.chapter || '0')
              return eventChapter === ref.chapter
            })
          }
          
          // Filter by verse if specified
          if (ref.verse) {
            const verseNumbers = new Set<number>()
            const verseSpecs = ref.verse.split(',').map(v => v.trim()).filter(v => v)
            
            for (const spec of verseSpecs) {
              if (spec.includes('-')) {
                const [startStr, endStr] = spec.split('-').map(v => v.trim())
                const start = parseInt(startStr)
                const end = parseInt(endStr)
                if (!isNaN(start) && !isNaN(end) && start <= end) {
                  for (let v = start; v <= end; v++) {
                    verseNumbers.add(v)
                  }
                }
              } else {
                const verseNum = parseInt(spec)
                if (!isNaN(verseNum)) {
                  verseNumbers.add(verseNum)
                }
              }
            }
            
            filteredEvents = filteredEvents.filter(event => {
              const metadata = extractBookMetadata(event)
              const eventVerse = metadata.verse
              if (!eventVerse) return false
              const eventVerseNum = parseInt(eventVerse)
              return !isNaN(eventVerseNum) && verseNumbers.has(eventVerseNum)
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

          newSections.push({
            reference: ref,
            events: filteredEvents,
            versions: Array.from(allVersions),
            originalVerses: ref.verse,
            originalChapter: ref.chapter
          })
        }
        
        if (isCancelled) return
        
        // Merge network results with existing sections (replace placeholders or update with new data)
        setSections(prevSections => {
          const sectionsByRef = new Map<string, BookSection>()
          newSections.forEach(section => {
            const key = `${section.reference.book}-${section.reference.chapter}-${section.reference.verse}`
            sectionsByRef.set(key, section)
          })
          
          // Update existing sections with network results, or add new ones
          const updated = prevSections.map(section => {
            const key = `${section.reference.book}-${section.reference.chapter}-${section.reference.verse}`
            const networkSection = sectionsByRef.get(key)
            if (networkSection) {
              // Merge events (deduplicate by event id)
              const existingIds = new Set(section.events.map(e => e.id))
              const newEvents = networkSection.events.filter(e => !existingIds.has(e.id))
              return {
                ...networkSection,
                events: [...section.events, ...newEvents]
              }
            }
            return section
          })
          
          // Add any new sections that weren't in placeholders
          newSections.forEach(section => {
            const key = `${section.reference.book}-${section.reference.chapter}-${section.reference.verse}`
            if (!prevSections.some(s => 
              `${s.reference.book}-${s.reference.chapter}-${s.reference.verse}` === key
            )) {
              updated.push(section)
            }
          })
          
          return updated
        })
        
        // Update selected versions
        setSelectedVersions(prevVersions => {
          const updated = new Map(prevVersions)
          newSections.forEach((section, index) => {
            if (section.versions.length > 0 && !updated.has(index)) {
              updated.set(index, section.versions[0])
            }
          })
          return updated
        })
      } catch (err) {
        if (isCancelled) return
        logger.error('Error fetching bookstr events', { error: err, wikilink })
        setError(err instanceof Error ? err.message : 'Failed to fetch book content')
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchEvents()
    
    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikilink]) // Only depend on wikilink - parsed is derived from it via useMemo

  // Measure card heights - measure BEFORE applying collapse
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      cardRefs.current.forEach((element, index) => {
        if (element) {
          // IMPORTANT: Temporarily remove ALL constraints to get true height
          // This must happen BEFORE any collapse is applied
          const originalMaxHeight = element.style.maxHeight
          const originalOverflow = element.style.overflow
          const originalHeight = element.style.height
          
          // Remove all constraints
          element.style.maxHeight = 'none'
          element.style.overflow = 'visible'
          element.style.height = 'auto'
          
          // Force a reflow to ensure we get the true height
          void element.offsetHeight
          
          const height = element.scrollHeight
          
          // Restore original styles
          element.style.maxHeight = originalMaxHeight
          element.style.overflow = originalOverflow
          element.style.height = originalHeight
          
          // Store the TRUE height (before collapse)
          setCardHeights(prev => {
            const currentHeight = prev.get(index)
            if (currentHeight !== height && height > 0) {
              const newMap = new Map(prev)
              newMap.set(index, height)
              
              logger.debug('BookstrContent: Measured card height', {
                sectionIndex: index,
                height,
                needsCollapse: height > 500,
                wasCollapsed: collapsedCards.has(index)
              })
              
              // Only auto-collapse if height > 500px and not already manually toggled
              if (height > 500) {
                setCollapsedCards(prevCollapsed => {
                  // Only auto-collapse if user hasn't manually expanded it
                  if (!prevCollapsed.has(index)) {
                    logger.debug('BookstrContent: Auto-collapsing card', { sectionIndex: index, height })
                    return new Set(prevCollapsed).add(index)
                  }
                  return prevCollapsed
                })
              }
              
              return newMap
            }
            return prev
          })
        }
      })
    }, 500) // Wait longer for content to fully render
    
    return () => clearTimeout(timeoutId)
  }, [sections, collapsedCards])

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
    <div className={cn('my-2', className)}>
      <div className="border rounded-lg bg-muted/30 overflow-hidden">
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
          const isLast = sectionIndex === sections.length - 1

          const cardHeight = cardHeights.get(sectionIndex) || 0
          const isCardCollapsed = collapsedCards.has(sectionIndex)
          const needsCollapse = cardHeight > 500
          
          // Only show button if card is actually tall (needs collapse) or is currently collapsed
          const shouldShowButton = filteredEvents.length > 0 && (needsCollapse || isCardCollapsed)
          
          // Debug logging
          if (filteredEvents.length > 0) {
            logger.debug('BookstrContent: Card collapse check', {
              sectionIndex,
              eventCount: filteredEvents.length,
              cardHeight,
              isCardCollapsed,
              needsCollapse,
              shouldShowButton
            })
          }
          
          return (
            <React.Fragment key={sectionIndex}>
            <div 
              ref={(el) => {
                if (el) {
                  cardRefs.current.set(sectionIndex, el)
                } else {
                  cardRefs.current.delete(sectionIndex)
                }
              }}
              className={cn(
                'p-3',
                !isLast && 'border-b',
                needsCollapse && isCardCollapsed && 'overflow-hidden'
              )}
              style={needsCollapse && isCardCollapsed ? { 
                maxHeight: '500px',
                transition: 'max-height 0.3s ease-out'
              } : undefined}
            >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <h4 className="font-semibold text-sm">
                  {section.reference.book}
                  {section.reference.chapter && ` ${section.reference.chapter}`}
                  {section.reference.verse && `:${section.reference.verse}`}
                  {selectedVersion && ` (${selectedVersion})`}
                </h4>
                {filteredEvents.length === 0 && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
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
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                asChild
              >
                <a
                  href={buildBibleGatewayUrl(section.reference, selectedVersion)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on Bible Gateway"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>

            {/* Verses */}
            {filteredEvents.length > 0 && (
              <VerseContent
                events={filteredEvents}
              />
            )}
            </div>

            {/* Show more/less button for tall cards - OUTSIDE collapsed div so it's always visible */}
            {shouldShowButton ? (
              <div className="px-3 pb-3 border-t pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs w-full"
                  onClick={() => {
                    setCollapsedCards(prev => {
                      const newSet = new Set(prev)
                      if (newSet.has(sectionIndex)) {
                        newSet.delete(sectionIndex)
                      } else {
                        newSet.add(sectionIndex)
                      }
                      return newSet
                    })
                  }}
                >
                  {isCardCollapsed ? (
                    <>
                      <ChevronDown className="h-3 w-3 mr-1" />
                      Show more
                    </>
                  ) : (
                    <>
                      <ChevronUp className="h-3 w-3 mr-1" />
                      Show less
                    </>
                  )}
                </Button>
              </div>
            ) : null}

            {/* Expand/Collapse buttons - only show if events were found */}
            {hasVerses && filteredEvents.length > 0 && (
              <div className="px-3 pb-3">
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
              </div>
            )}

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-3 pb-3 mt-3 pt-3 border-t">
                {/* Fetch and display full chapter/book */}
                <ExpandedContent
                  section={section}
                  selectedVersion={selectedVersion}
                  originalChapter={section.originalChapter}
                  originalVerses={section.originalVerses}
                />
              </div>
            )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

interface ExpandedContentProps {
  section: BookSection
  selectedVersion: string
  originalChapter?: number
  originalVerses?: string
}

function ExpandedContent({ section, selectedVersion, originalChapter, originalVerses }: ExpandedContentProps) {
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

  // Parse original verses to determine which ones should have a border
  const originalVerseNumbers = new Set<number>()
  if (originalVerses) {
    const verseSpecs = originalVerses.split(',').map(v => v.trim()).filter(v => v)
    for (const spec of verseSpecs) {
      if (spec.includes('-')) {
        const [startStr, endStr] = spec.split('-').map(v => v.trim())
        const start = parseInt(startStr)
        const end = parseInt(endStr)
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let v = start; v <= end; v++) {
            originalVerseNumbers.add(v)
          }
        }
      } else {
        const verseNum = parseInt(spec)
        if (!isNaN(verseNum)) {
          originalVerseNumbers.add(verseNum)
        }
      }
    }
  }

  return (
    <VerseContent
      events={expandedEvents}
      originalVerseNumbers={originalVerseNumbers}
    />
  )
}

interface VerseContentProps {
  events: Event[]
  originalVerseNumbers?: Set<number>
}

function VerseContent({ events, originalVerseNumbers }: VerseContentProps) {
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
        const verseNumInt = verseNum ? parseInt(verseNum) : null
        const isOriginalVerse = originalVerseNumbers && verseNumInt !== null && originalVerseNumbers.has(verseNumInt)
        const content = parsedContents.get(event.id) || event.content

        return (
          <div
            key={event.id}
            className={cn(
              "flex gap-2 text-sm leading-relaxed items-baseline",
              isOriginalVerse && "border-l-2 border-muted-foreground/30 pl-2 py-1"
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

