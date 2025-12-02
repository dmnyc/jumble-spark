import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Event } from 'nostr-tools'
import { parseBookWikilink, extractBookMetadata, BookReference } from '@/lib/bookstr-parser'
import client from '@/services/client.service'
import { ExtendedKind } from '@/constants'
import { Loader2, AlertCircle } from 'lucide-react'
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
import WebPreview from '@/components/WebPreview'

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
 * Get the first verse number from a verse string (handles ranges and lists)
 */
function getFirstVerse(verse: string): number | null {
  if (!verse) return null
  
  // Split by comma to handle lists like "6,8,10"
  const firstPart = verse.split(',')[0].trim()
  
  // Handle ranges like "6-8" - take the first number
  if (firstPart.includes('-')) {
    const start = parseInt(firstPart.split('-')[0].trim(), 10)
    return isNaN(start) ? null : start
  }
  
  // Single verse number
  const verseNum = parseInt(firstPart, 10)
  return isNaN(verseNum) ? null : verseNum
}

/**
 * Normalize book name to Sefaria format (capitalize first letter of each word)
 */
function normalizeSefariaBookName(bookName: string): string {
  return bookName
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Build Sefaria URL for a torah reference
 */
function buildSefariaUrl(reference: BookReference): string | null {
  if (!reference.book) return null
  
  // Sefaria uses exact book names: Genesis, Exodus, Leviticus, Numbers, Deuteronomy
  const bookName = normalizeSefariaBookName(reference.book)
  
  if (!reference.chapter) {
    // Book only
    return `https://www.sefaria.org/${bookName}?tab=contents`
  }
  
  if (!reference.verse) {
    // Chapter only
    return `https://www.sefaria.org/${bookName}.${reference.chapter}?lang=bi`
  }
  
  // Verse - get first verse from range/list
  const firstVerse = getFirstVerse(reference.verse)
  if (firstVerse === null) {
    // Invalid verse, fall back to chapter
    return `https://www.sefaria.org/${bookName}.${reference.chapter}?lang=bi`
  }
  
  // Verse with chapter
  return `https://www.sefaria.org/${bookName}.${reference.chapter}.${firstVerse}?lang=bi&with=all&lang2=en`
}

/**
 * Mapping from Quran surah names to surah numbers (1-114)
 */
const surahNameToNumber: Record<string, number> = {
  'Al-Fatiha': 1, 'Al-Baqarah': 2, 'Ali Imran': 3, 'An-Nisa': 4, 'Al-Maidah': 5,
  'Al-Anam': 6, 'Al-Araf': 7, 'Al-Anfal': 8, 'At-Tawbah': 9, 'Yunus': 10,
  'Hud': 11, 'Yusuf': 12, 'Ar-Rad': 13, 'Ibrahim': 14, 'Al-Hijr': 15,
  'An-Nahl': 16, 'Al-Isra': 17, 'Al-Kahf': 18, 'Maryam': 19, 'Taha': 20,
  'Al-Anbiya': 21, 'Al-Hajj': 22, 'Al-Muminun': 23, 'An-Nur': 24, 'Al-Furqan': 25,
  'Ash-Shuara': 26, 'An-Naml': 27, 'Al-Qasas': 28, 'Al-Ankabut': 29, 'Ar-Rum': 30,
  'Luqman': 31, 'As-Sajdah': 32, 'Al-Ahzab': 33, 'Saba': 34, 'Fatir': 35,
  'Ya-Sin': 36, 'As-Saffat': 37, 'Sad': 38, 'Az-Zumar': 39, 'Ghafir': 40,
  'Fussilat': 41, 'Ash-Shura': 42, 'Az-Zukhruf': 43, 'Ad-Dukhan': 44, 'Al-Jathiyah': 45,
  'Al-Ahqaf': 46, 'Muhammad': 47, 'Al-Fath': 48, 'Al-Hujurat': 49, 'Qaf': 50,
  'Adh-Dhariyat': 51, 'At-Tur': 52, 'An-Najm': 53, 'Al-Qamar': 54, 'Ar-Rahman': 55,
  'Al-Waqiah': 56, 'Al-Hadid': 57, 'Al-Mujadilah': 58, 'Al-Hashr': 59, 'Al-Mumtahanah': 60,
  'As-Saff': 61, 'Al-Jumuah': 62, 'Al-Munafiqun': 63, 'At-Taghabun': 64, 'At-Talaq': 65,
  'At-Tahrim': 66, 'Al-Mulk': 67, 'Al-Qalam': 68, 'Al-Haqqah': 69, 'Al-Maarij': 70,
  'Nuh': 71, 'Al-Jinn': 72, 'Al-Muzzammil': 73, 'Al-Muddaththir': 74, 'Al-Qiyamah': 75,
  'Al-Insan': 76, 'Al-Mursalat': 77, 'An-Naba': 78, 'An-Naziat': 79, 'Abasa': 80,
  'At-Takwir': 81, 'Al-Infitar': 82, 'Al-Mutaffifin': 83, 'Al-Inshiqaq': 84, 'Al-Buruj': 85,
  'At-Tariq': 86, 'Al-Ala': 87, 'Al-Ghashiyah': 88, 'Al-Fajr': 89, 'Al-Balad': 90,
  'Ash-Shams': 91, 'Al-Layl': 92, 'Ad-Duha': 93, 'Ash-Sharh': 94, 'At-Tin': 95,
  'Al-Alaq': 96, 'Al-Qadr': 97, 'Al-Bayyinah': 98, 'Az-Zalzalah': 99, 'Al-Adiyat': 100,
  'Al-Qariah': 101, 'At-Takathur': 102, 'Al-Asr': 103, 'Al-Humazah': 104, 'Al-Fil': 105,
  'Quraysh': 106, 'Al-Maun': 107, 'Al-Kawthar': 108, 'Al-Kafirun': 109, 'An-Nasr': 110,
  'Al-Masad': 111, 'Al-Ikhlas': 112, 'Al-Falaq': 113, 'An-Nas': 114
}

/**
 * Build quran.com URL for a quran reference
 */
function buildQuranComUrl(reference: BookReference): string | null {
  if (!reference.book) return null
  
  // For Quran, "chapter" is actually the surah number
  let surahNumber: number | undefined
  if (reference.chapter && typeof reference.chapter === 'number' && reference.chapter >= 1 && reference.chapter <= 114) {
    surahNumber = reference.chapter
  } else {
    // Try book name lookup
    const bookAsNumber = parseInt(reference.book.trim(), 10)
    if (!isNaN(bookAsNumber) && bookAsNumber >= 1 && bookAsNumber <= 114) {
      surahNumber = bookAsNumber
    } else {
      // Try case-insensitive lookup
      const normalizedBook = reference.book.trim()
      const matchingKey = Object.keys(surahNameToNumber).find(
        key => key.toLowerCase() === normalizedBook.toLowerCase()
      )
      if (matchingKey) {
        surahNumber = surahNameToNumber[matchingKey]
      } else {
        // Try normalized matching (remove hyphens, spaces, etc.)
        const normalizedBookClean = normalizedBook.toLowerCase().replace(/[^a-z0-9]/g, '')
        const matchingKey2 = Object.keys(surahNameToNumber).find(key => {
          const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
          return normalizedKey === normalizedBookClean
        })
        if (matchingKey2) {
          surahNumber = surahNameToNumber[matchingKey2]
        }
      }
    }
  }
  
  if (!surahNumber) {
    return null
  }
  
  // In Quran, "verse" is the ayah
  if (reference.verse) {
    const firstAyah = getFirstVerse(reference.verse)
    if (firstAyah === null) {
      return `https://quran.com/${surahNumber}`
    }
    return `https://quran.com/${surahNumber}?startingVerse=${firstAyah}`
  }
  
  return `https://quran.com/${surahNumber}`
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
  const versionMap: Record<string, string> = {
    'DRB': 'DRA', // Douay-Rheims Bible -> Douay-Rheims 1899 American Edition
    'DRA': 'DRA', // Already correct
  }
  
  const bgVersion = version ? (versionMap[version.toUpperCase()] || version.toUpperCase()) : 'DRA'
  
  // URL encode the passage
  const encodedPassage = encodeURIComponent(passage)
  
  return `https://www.biblegateway.com/passage/?search=${encodedPassage}&version=${bgVersion}`
}

/**
 * Build external URL for a book reference based on bookType
 */
function buildExternalUrl(reference: BookReference, bookType: string, version?: string): string | null {
  if (bookType === 'torah') {
    return buildSefariaUrl(reference)
  } else if (bookType === 'quran') {
    return buildQuranComUrl(reference)
  } else {
    // Default to Bible Gateway for bible and other types
    return buildBibleGatewayUrl(reference, version)
  }
}

export function BookstrContent({ wikilink, className }: BookstrContentProps) {
  const [sections, setSections] = useState<BookSection[]>([])
  const [isLoading, setIsLoading] = useState(false) // Start as false, only set to true when actually fetching
  const [error, setError] = useState<string | null>(null)
  const [selectedVersions, setSelectedVersions] = useState<Map<number, string>>(new Map())
  // Track which sections are still loading (by reference key)
  const [loadingSections, setLoadingSections] = useState<Set<string>>(new Set())

  // Parse the wikilink - use a ref to store the last parsed result for comparison
  const parsedRef = useRef<ReturnType<typeof parseBookWikilink> & { bookType: string } | null>(null)
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
        parsedRef.current = null
        return null
      }
      
      const result = parseBookWikilink(wikilinkToParse)
      if (result) {
        const inferredBookType = result.bookType || 'bible'
        const parsedResult = { ...result, bookType: inferredBookType }
        
        // Only log if this is a new parse (not a re-render with same wikilink)
        if (parsedRef.current === null || JSON.stringify(parsedRef.current.references) !== JSON.stringify(parsedResult.references)) {
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
        }
        
        parsedRef.current = parsedResult
        return parsedResult
      }
      parsedRef.current = null
      return null
    } catch (err) {
      logger.error('Error parsing bookstr wikilink', { error: err, wikilink })
      parsedRef.current = null
      return null
    }
  }, [wikilink])

  // Track if we've already fetched to prevent infinite loops
  const hasFetchedRef = useRef<string | null>(null)
  const isFetchingRef = useRef<boolean>(false)
  const lastWikilinkRef = useRef<string | null>(null)
  const effectRunCountRef = useRef<number>(0)
  
  // Fetch events for each reference
  useEffect(() => {
    effectRunCountRef.current += 1
    const runCount = effectRunCountRef.current
    
    // Early return if parsed is not ready
    if (!parsed) {
      setIsLoading(false)
      setError('Failed to parse bookstr wikilink')
      return
    }
    
    if (!parsed.references.length) {
      setIsLoading(false)
      setError('Invalid bookstr reference')
      return
    }

    // Create a unique key for this fetch based on the parsed references
    const fetchKey = JSON.stringify(parsed.references.map(r => ({
      book: r.book,
      chapter: r.chapter,
      verse: r.verse,
      version: r.version
    })))
    
    // Reset fetch state if wikilink changed
    if (lastWikilinkRef.current !== wikilink) {
      hasFetchedRef.current = null
      lastWikilinkRef.current = wikilink
      isFetchingRef.current = false
      effectRunCountRef.current = 1
    }
    
    // AGGRESSIVE: If we've already fetched for this exact key, STOP IMMEDIATELY
    if (hasFetchedRef.current === fetchKey) {
      return
    }
    
    // AGGRESSIVE: If we're already fetching, STOP IMMEDIATELY
    if (isFetchingRef.current) {
      return
    }
    
    // AGGRESSIVE: If effect has run more than once for the same wikilink, something is wrong
    if (runCount > 2 && lastWikilinkRef.current === wikilink) {
      logger.warn('BookstrContent: Effect running too many times, blocking', { 
        wikilink, 
        runCount,
        fetchKey,
        hasFetched: hasFetchedRef.current
      })
      return
    }
    
    // Mark that we're starting a fetch for this wikilink
    logger.debug('BookstrContent: Starting fetch', { wikilink, fetchKey, runCount })
    hasFetchedRef.current = fetchKey
    isFetchingRef.current = true

    // Create placeholder sections IMMEDIATELY - before any checks or async operations
    // This ensures something is always displayed
    const placeholderSections: BookSection[] = parsed.references.map(ref => ({
      reference: ref,
      events: [],
      versions: [],
      originalVerses: ref.verse,
      originalChapter: ref.chapter
    }))
    setSections(placeholderSections)
    setIsLoading(false)

    let isCancelled = false
    let loadingTimeout: NodeJS.Timeout | null = null

    const fetchEvents = async () => {
      setError(null)

      // Create placeholder sections IMMEDIATELY before any async operations
      // This ensures something is always displayed, even if the fetch fails or is slow
      const placeholderSections: BookSection[] = parsed.references.map(ref => ({
        reference: ref,
        events: [],
        versions: [],
        originalVerses: ref.verse,
        originalChapter: ref.chapter
      }))
      setSections(placeholderSections)
      setIsLoading(false) // Ensure loading is false - we have placeholders to show
      
      // Mark all sections as loading initially (will be removed when fetch completes)
      const initialLoadingKeys = new Set(parsed.references.map(ref => 
        `${ref.book}-${ref.chapter}-${ref.verse}`
      ))
      setLoadingSections(initialLoadingKeys)
      
      // Set a timeout to clear loading state if fetch takes too long (30 seconds)
      loadingTimeout = setTimeout(() => {
        if (!isCancelled) {
          logger.warn('BookstrContent: Fetch timeout - clearing loading state', { wikilink })
          setLoadingSections(new Set())
        }
      }, 30000)

      try {
        logger.debug('BookstrContent: Processing references', {
          totalReferences: parsed.references.length,
          references: parsed.references.map(r => ({
            book: r.book,
            chapter: r.chapter,
            verse: r.verse
          }))
        })
        
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
          const refKey = `${ref.book}-${ref.chapter}-${ref.verse}`
          
          if (cachedEvents.length > 0) {
            // Mark this section as loaded (has cached data)
            setLoadingSections(prev => {
              const updated = new Set(prev)
              updated.delete(refKey)
              return updated
            })
            
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
          
          const refKey = `${ref.book}-${ref.chapter}-${ref.verse}`
          
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
              
              // Mark this section as loaded (background fetch complete)
              setLoadingSections(prev => {
                const updated = new Set(prev)
                updated.delete(refKey)
                return updated
              })
              
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
              // Mark as loaded even on error to stop spinner
              setLoadingSections(prev => {
                const updated = new Set(prev)
                updated.delete(refKey)
                return updated
              })
            })
            continue
          }
          
          // No cached events, mark as loading and fetch from network
          setLoadingSections(prev => {
            const updated = new Set(prev)
            updated.add(refKey)
            return updated
          })
          
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
                
                // Mark this section as loaded (found events)
                setLoadingSections(prev => {
                  const updated = new Set(prev)
                  updated.delete(refKey)
                  return updated
                })
                
                newSections.push({
                  reference: ref,
                  events: allEvents,
                  versions: Array.from(allVersions),
                  originalVerses: ref.verse,
                  originalChapter: ref.chapter
                })
                continue
              } else {
                // No events found, mark as loaded to stop spinner
                setLoadingSections(prev => {
                  const updated = new Set(prev)
                  updated.delete(refKey)
                  return updated
                })
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

          // Mark this section as loaded (network fetch complete)
          setLoadingSections(prev => {
            const updated = new Set(prev)
            updated.delete(refKey)
            return updated
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
        // Mark all sections as loaded on error to stop spinners
        setLoadingSections(new Set())
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
        isFetchingRef.current = false
        if (loadingTimeout) {
          clearTimeout(loadingTimeout)
        }
      }
    }

    fetchEvents()
    
    return () => {
      isCancelled = true
      isFetchingRef.current = false
      if (loadingTimeout) {
        clearTimeout(loadingTimeout)
      }
    }
  }, [wikilink]) // Depend on wikilink directly - it's a stable string, parsed is derived from it


  // Show loading spinner only if we're actively loading AND have no sections
  // Once we have sections (even empty placeholders), show them instead
  if (isLoading && sections.length === 0) {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <span>{wikilink}</span>
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    )
  }
  
  // If we have no sections and no error, show the wikilink as plain text
  // This handles the case where parsing failed or no data is available
  if (sections.length === 0 && !error && !isLoading) {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <span>{wikilink}</span>
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

          const isLast = sectionIndex === sections.length - 1
          
          // Check if this section is still loading
          const refKey = `${section.reference.book}-${section.reference.chapter}-${section.reference.verse}`
          const isSectionLoading = loadingSections.has(refKey)
          
          return (
            <React.Fragment key={sectionIndex}>
            <div 
              className={cn(
                'p-3',
                !isLast && 'border-b'
              )}
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
                {/* Only show spinner if section is still loading AND has no events */}
                {isSectionLoading && filteredEvents.length === 0 && (
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
            </div>

            {/* OG Preview Card for bible/torah/quran external URLs */}
            {(() => {
              // Get bookType from parsed wikilink (defaults to 'bible')
              const bookType = parsed?.bookType || 'bible'
              
              // Only show external link for bible, torah, or quran collections
              // Other collections (secular books) don't have external links
              if (!['bible', 'torah', 'quran'].includes(bookType)) {
                return null
              }
              
              const externalUrl = buildExternalUrl(section.reference, bookType, selectedVersion)
              
              if (!externalUrl) return null
              
              return (
                <div className="mb-3">
                  <WebPreview url={externalUrl} className="w-full" />
                </div>
              )
            })()}

            {/* Verses - render all verses together, including ranges */}
            {filteredEvents.length > 0 && (
              <VerseContent
                events={filteredEvents}
                originalVerses={section.originalVerses}
              />
            )}
            </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

interface VerseContentProps {
  events: Event[]
  originalVerses?: string
}

function VerseContent({ events, originalVerses }: VerseContentProps) {
  const [parsedContents, setParsedContents] = useState<Map<string, string>>(new Map())

  // Parse original verses to determine which ones should have a border
  const originalVerseNumbers = new Set<number>()
  if (originalVerses) {
    const verseSpecs = originalVerses.split(',').map(v => v.trim()).filter(v => v)
    for (const spec of verseSpecs) {
      if (spec.includes('-')) {
        // Expand range like "16-18" into 16, 17, 18
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
        const isOriginalVerse = originalVerseNumbers.size > 0 && verseNumInt !== null && originalVerseNumbers.has(verseNumInt)
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
  // Sync availableVersions with section.versions when section updates
  const [availableVersions, setAvailableVersions] = useState<string[]>(section.versions)

  // Update availableVersions when section.versions changes (from parent fetches)
  // Use a ref to track the last versions to avoid unnecessary updates
  const lastVersionsRef = useRef<string>('')
  useEffect(() => {
    const versionsKey = JSON.stringify([...section.versions].sort())
    if (versionsKey !== lastVersionsRef.current && section.versions.length > availableVersions.length) {
      lastVersionsRef.current = versionsKey
      setAvailableVersions(section.versions)
    }
  }, [section.versions, availableVersions.length])

  // DISABLED: Version fetching is causing loops. Use versions from parent only.
  // Just sync with parent versions
  useEffect(() => {
    // COMPLETELY DISABLE VERSION FETCHING TO PREVENT LOOPS
    // Just use the versions we already have from the parent
    if (availableVersions.length === 0 && section.versions.length > 0) {
      setAvailableVersions(section.versions)
    }
    
    /* DISABLED CODE - was causing infinite loops
    // Reset fetch state if section reference changed
    if (lastFetchKeyRef.current !== fetchKey) {
      hasFetchedRef.current = false
    }
    
    // Skip if we've already fetched for this exact section
    if (hasFetchedRef.current && lastFetchKeyRef.current === fetchKey) {
      return
    }
    
    // Skip if we already have multiple versions
    if (availableVersions.length > 1) {
      hasFetchedRef.current = true
      lastFetchKeyRef.current = fetchKey
      return
    }
    
    const fetchAvailableVersions = async () => {
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
        
        // Mark as fetched for this section
        hasFetchedRef.current = true
        lastFetchKeyRef.current = fetchKey
      } catch (err) {
        logger.warn('Error fetching available versions', { error: err })
        // Mark as fetched even on error to prevent retry loops
        hasFetchedRef.current = true
        lastFetchKeyRef.current = fetchKey
      } finally {
        setIsLoadingVersions(false)
      }
    }

    fetchAvailableVersions()
    */
  }, [section.reference.book, section.reference.chapter, section.reference.verse, section.versions, availableVersions.length])

  // Don't show selector if only one version available
  if (availableVersions.length <= 1) {
    return null
  }

  return (
    <Select
      value={selectedVersion}
      onValueChange={onVersionChange}
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

