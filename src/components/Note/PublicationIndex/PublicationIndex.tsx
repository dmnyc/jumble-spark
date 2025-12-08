import { ExtendedKind } from '@/constants'
import { Event, nip19 } from 'nostr-tools'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { normalizeUrl } from '@/lib/url'
import AsciidocArticle from '../AsciidocArticle/AsciidocArticle'
import MarkdownArticle from '../MarkdownArticle/MarkdownArticle'
import { generateBech32IdFromATag } from '@/lib/tag'
import client from '@/services/client.service'
import logger from '@/lib/logger'
import { Button } from '@/components/ui/button'
import { MoreVertical, RefreshCw, ArrowUp } from 'lucide-react'
import indexedDb from '@/services/indexed-db.service'
import { isReplaceableEvent } from '@/lib/event'
import { useSecondaryPage } from '@/PageManager'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { dTagToTitleCase } from '@/lib/event-metadata'
import Image from '@/components/Image'

interface PublicationReference {
  coordinate?: string
  eventId?: string
  event?: Event
  kind?: number
  pubkey?: string
  identifier?: string
  relay?: string
  type: 'a' | 'e' // 'a' for addressable (coordinate), 'e' for event ID
  nestedRefs?: PublicationReference[] // Discovered nested references
}

interface ToCItem {
  title: string
  coordinate: string
  event?: Event
  kind: number
  children?: ToCItem[]
}

interface PublicationMetadata {
  title?: string
  summary?: string
  image?: string
  author?: string
  version?: string
  type?: string
  tags: string[]
}

export default function PublicationIndex({
  event,
  className,
  isNested = false,
  parentImageUrl
}: {
  event: Event
  className?: string
  isNested?: boolean
  parentImageUrl?: string
}) {
  const { push } = useSecondaryPage()
  // Parse publication metadata from event tags
  const metadata = useMemo<PublicationMetadata>(() => {
    const meta: PublicationMetadata = { tags: [] }
    
    for (const [tagName, tagValue] of event.tags) {
      if (tagName === 'title') {
        meta.title = tagValue
      } else if (tagName === 'summary') {
        meta.summary = tagValue
      } else if (tagName === 'image') {
        meta.image = tagValue
      } else if (tagName === 'author') {
        meta.author = tagValue
      } else if (tagName === 'version') {
        meta.version = tagValue
      } else if (tagName === 'type') {
        meta.type = tagValue
      } else if (tagName === 't' && tagValue) {
        meta.tags.push(tagValue.toLowerCase())
      }
    }
    
    // Fallback title from d-tag if no title (convert to title case)
    if (!meta.title) {
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1]
      if (dTag) {
        meta.title = dTagToTitleCase(dTag)
      }
    }
    
    return meta
  }, [event])
  const bookMetadata = useMemo(() => extractBookMetadata(event), [event])
  const isBookstrEvent = (event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata.book
  const [references, setReferences] = useState<PublicationReference[]>([])
  const [visitedIndices, setVisitedIndices] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [retryCount, setRetryCount] = useState(0)
  const [isRetrying, setIsRetrying] = useState(false)
  const [failedReferences, setFailedReferences] = useState<PublicationReference[]>([])
  const maxRetries = 5

  // Extract references from 'a' tags (addressable events) and 'e' tags (event IDs)
  const referencesData = useMemo(() => {
    const refs: PublicationReference[] = []
    for (const tag of event.tags) {
      if (tag[0] === 'a' && tag[1]) {
        // Addressable event (kind:pubkey:identifier)
        const [kindStr, pubkey, identifier] = tag[1].split(':')
        const kind = parseInt(kindStr)
        if (!isNaN(kind)) {
          refs.push({
            type: 'a',
            coordinate: tag[1],
            kind,
            pubkey,
            identifier: identifier || '',
            relay: tag[2],
            eventId: tag[3] // Optional event ID for version tracking
          })
        }
      } else if (tag[0] === 'e' && tag[1]) {
        // Event ID reference
        refs.push({
          type: 'e',
          eventId: tag[1],
          relay: tag[2]
        })
      }
    }
    return refs
  }, [event])

  // Helper function to format bookstr titles (remove hyphens, title case)
  const formatBookstrTitle = useCallback((title: string, event?: Event): string => {
    if (!event) return title
    
    // Check if this is a bookstr event
    const bookMetadata = extractBookMetadata(event)
    const isBookstr = (event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata.book
    
    if (isBookstr) {
      // Remove hyphens and convert to title case
      return title
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    }
    
    return title
  }, [])

  // Recursive helper function to build ToC item from a reference
  const buildToCItemFromRef = useCallback((ref: PublicationReference, allReferences: PublicationReference[], visitedCoords: Set<string> = new Set()): ToCItem | null => {
    if (!ref.event) {
      // If no event but we have a coordinate/eventId, create placeholder
      if (ref.coordinate || ref.eventId) {
        return {
          title: 'Loading...',
          coordinate: ref.coordinate || ref.eventId || '',
          kind: ref.kind || 0
        }
      }
      return null
    }
    
    // Extract title from the event - prioritize 'title' tag, only use 'd' tag as fallback
    const titleTag = ref.event.tags.find(tag => tag[0] === 'title')?.[1]
    const dTag = ref.event.tags.find(tag => tag[0] === 'd')?.[1]
    
    // Use title tag if available, otherwise format d-tag for bookstr events
    let rawTitle: string
    if (titleTag) {
      rawTitle = titleTag
    } else if (dTag) {
      // Only use d-tag as fallback, and format it for bookstr events
      rawTitle = dTag
    } else {
      rawTitle = 'Untitled'
    }
    
    // Format title for bookstr events (only if we're using d-tag, title tag should already be formatted)
    const title = titleTag ? rawTitle : formatBookstrTitle(rawTitle, ref.event)
    
    const coordinate = ref.coordinate || ref.eventId || ''
    const coordKey = ref.coordinate || ref.eventId || ''
    
    // Prevent infinite recursion
    if (visitedCoords.has(coordKey)) {
      return null
    }
    visitedCoords.add(coordKey)
    
    const tocItem: ToCItem = {
      title,
      coordinate,
      event: ref.event,
      kind: ref.kind || ref.event?.kind || 0
    }
    
    // Build children recursively - check both nestedRefs and event tags
    const children: ToCItem[] = []
    const processedCoords = new Set<string>()
    
    // First, process discovered nestedRefs if they exist
    if (ref.nestedRefs && ref.nestedRefs.length > 0) {
      for (const nestedRef of ref.nestedRefs) {
        const nestedCoord = nestedRef.coordinate || nestedRef.eventId || ''
        if (nestedCoord && !processedCoords.has(nestedCoord)) {
          processedCoords.add(nestedCoord)
          
          // Look up the full reference (with fetched event) from allReferences
          const fullNestedRef = allReferences.find(r => 
            (r.coordinate && nestedRef.coordinate && r.coordinate === nestedRef.coordinate) ||
            (r.eventId && nestedRef.eventId && r.eventId === nestedRef.eventId) ||
            (r.event && nestedRef.event && r.event.id === nestedRef.event.id)
          ) || nestedRef
          
          const nestedToCItem = buildToCItemFromRef(fullNestedRef, allReferences, new Set(visitedCoords))
          if (nestedToCItem) {
            children.push(nestedToCItem)
          }
        }
      }
    }
    
    // Also process tags from publication events (for publications that reference other publications)
    if ((ref.kind === ExtendedKind.PUBLICATION || ref.event?.kind === ExtendedKind.PUBLICATION) && ref.event) {
      for (const tag of ref.event.tags) {
        if (tag[0] === 'a' && tag[1]) {
          const [kindStr, , identifier] = tag[1].split(':')
          const kind = parseInt(kindStr)
          
          if (!isNaN(kind) && (kind === ExtendedKind.PUBLICATION_CONTENT || 
                kind === ExtendedKind.WIKI_ARTICLE || 
                kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN ||
                kind === ExtendedKind.PUBLICATION)) {
            const tagCoord = tag[1]
            if (!processedCoords.has(tagCoord)) {
              processedCoords.add(tagCoord)
              
              // Look up the fetched event from allReferences
              const fetchedNestedEvent = allReferences.find(r => 
                r.coordinate === tagCoord || 
                (r.type === 'a' && r.coordinate === tagCoord) ||
                (r.event && r.event.kind === kind && r.event.pubkey && tagCoord.includes(r.event.pubkey))
              )
              
              if (fetchedNestedEvent) {
                const nestedToCItem = buildToCItemFromRef(fetchedNestedEvent, allReferences, new Set(visitedCoords))
                if (nestedToCItem) {
                  children.push(nestedToCItem)
                }
              } else {
                // Event not fetched yet, create placeholder
                // Format identifier for bookstr events (if it looks like a bookstr identifier)
                const formattedIdentifier = identifier
                  ? identifier
                      .split('-')
                      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                      .join(' ')
                  : 'Untitled'
                children.push({
                  title: formattedIdentifier,
                  coordinate: tagCoord,
                  kind
                })
              }
            }
          }
        } else if (tag[0] === 'e' && tag[1]) {
          const eventId = tag[1]
          if (!processedCoords.has(eventId)) {
            processedCoords.add(eventId)
            
            // Look up the fetched event from allReferences
            const fetchedNestedEvent = allReferences.find(r => 
              (r.type === 'e' && r.eventId === eventId) || 
              (r.event && r.event.id === eventId) ||
              (r.coordinate === eventId) ||
              (r.eventId === eventId)
            )
            
            if (fetchedNestedEvent) {
              const nestedToCItem = buildToCItemFromRef(fetchedNestedEvent, allReferences, new Set(visitedCoords))
              if (nestedToCItem) {
                children.push(nestedToCItem)
              }
            } else {
              // Event not fetched yet, create placeholder
              children.push({
                title: 'Loading...',
                coordinate: eventId,
                kind: 0
              })
            }
          }
        }
      }
    }
    
    if (children.length > 0) {
      tocItem.children = children
    }
    
    return tocItem
  }, [formatBookstrTitle])

  // Build table of contents from references
  const tableOfContents = useMemo<ToCItem[]>(() => {
    const toc: ToCItem[] = []
    
    for (const ref of references) {
      if (!ref.event) continue
      
      // Extract title from the event - prioritize 'title' tag, only use 'd' tag as fallback
      const titleTag = ref.event.tags.find(tag => tag[0] === 'title')?.[1]
      const dTag = ref.event.tags.find(tag => tag[0] === 'd')?.[1]
      
      // Use title tag if available, otherwise format d-tag for bookstr events
      let rawTitle: string
      if (titleTag) {
        rawTitle = titleTag
      } else if (dTag) {
        // Only use d-tag as fallback, and format it for bookstr events
        rawTitle = dTag
      } else {
        rawTitle = 'Untitled'
      }
      
      // Format title for bookstr events (only if we're using d-tag, title tag should already be formatted)
      const title = titleTag ? rawTitle : formatBookstrTitle(rawTitle, ref.event)
      
      const tocItem: ToCItem = {
        title,
        coordinate: ref.coordinate || ref.eventId || '',
        event: ref.event,
        kind: ref.kind || ref.event.kind || 0
      }
      
      // For nested 30040 publications, recursively get their ToC
      if (ref.kind === ExtendedKind.PUBLICATION && ref.event) {
        const nestedRefs: ToCItem[] = []
        
        // Parse nested references from this publication
        for (const tag of ref.event.tags) {
          if (tag[0] === 'a' && tag[1]) {
            const [kindStr, , identifier] = tag[1].split(':')
            const kind = parseInt(kindStr)
            
            if (!isNaN(kind) && (kind === ExtendedKind.PUBLICATION_CONTENT || 
                  kind === ExtendedKind.WIKI_ARTICLE || 
                  kind === ExtendedKind.PUBLICATION)) {
              // For this simplified version, we'll just extract the title from the coordinate
              const rawNestedTitle = identifier || 'Untitled'
              // Format for bookstr events (check if kind is bookstr-related)
              const nestedTitle = (kind === ExtendedKind.PUBLICATION || kind === ExtendedKind.PUBLICATION_CONTENT)
                ? rawNestedTitle
                    .split('-')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(' ')
                : rawNestedTitle
              
              nestedRefs.push({
                title: nestedTitle,
                coordinate: tag[1],
                kind
              })
            }
          }
        }
        
        if (nestedRefs.length > 0) {
          tocItem.children = nestedRefs
        }
      }
      
      toc.push(tocItem)
    }
    
    return toc
  }, [references, formatBookstrTitle])

  // Scroll to ToC
  const scrollToToc = useCallback(() => {
    const tocElement = document.getElementById('publication-toc')
    if (tocElement) {
      const rect = tocElement.getBoundingClientRect()
      const elementTop = rect.top + window.scrollY
      const offset = 96
      const scrollPosition = Math.max(0, elementTop - offset)
      window.scrollTo({ top: scrollPosition, behavior: 'smooth' })
    }
  }, [])

  // Scroll to section
  const scrollToSection = (coordinate: string) => {
    const element = document.getElementById(`section-${coordinate.replace(/:/g, '-')}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // Export publication as AsciiDoc
  const exportPublication = async () => {
    try {
      // Collect all content from references
      const contentParts: string[] = []
      
      for (const ref of references) {
        if (!ref.event) continue
        
        // Extract title
        const title = ref.event.tags.find(tag => tag[0] === 'title')?.[1] || 'Untitled'
        
        // For AsciiDoc, output the raw content with title
        contentParts.push(`= ${title}\n\n${ref.event.content}\n\n`)
      }
      
      const fullContent = contentParts.join('\n')
      const filename = `${metadata.title || 'publication'}.adoc`
      
      // Export as AsciiDoc
      const blob = new Blob([fullContent], { type: 'text/plain' })
      
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      logger.info('[PublicationIndex] Exported publication as .adoc')
    } catch (error) {
      logger.error('[PublicationIndex] Error exporting publication:', error)
      alert('Failed to export publication. Please try again.')
    }
  }

  // Add current event to visited set
  const currentCoordinate = useMemo(() => {
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || ''
    return `${event.kind}:${event.pubkey}:${dTag}`
  }, [event])

  useEffect(() => {
    setVisitedIndices(prev => new Set([...prev, currentCoordinate]))
    
    // Cache the current publication index event as replaceable event
    indexedDb.putReplaceableEvent(event).catch(err => {
      logger.error('[PublicationIndex] Error caching publication event:', err)
    })
  }, [currentCoordinate, event])

  // Helper function to build comprehensive relay list
  const buildComprehensiveRelayList = useCallback(async (
    additionalRelays: string[] = []
  ): Promise<string[]> => {
    const { FAST_READ_RELAY_URLS, BIG_RELAY_URLS, SEARCHABLE_RELAY_URLS } = await import('@/constants')
    const relayUrls = new Set<string>()
    
    // Add FAST_READ_RELAY_URLS
    FAST_READ_RELAY_URLS.forEach(url => {
      const normalized = normalizeUrl(url)
      if (normalized) relayUrls.add(normalized)
    })
    
    // Add additional relays (from tag relay hints)
    additionalRelays.forEach(url => {
      const normalized = normalizeUrl(url)
      if (normalized) relayUrls.add(normalized)
    })
    
    // Add user's favorite relays (kind 10012) and relay list (kind 10002) if logged in
    try {
      const userPubkey = (client as any).pubkey
      if (userPubkey) {
        // Fetch user's relay list (includes cache relays)
        const userRelayList = await client.fetchRelayList(userPubkey)
        if (userRelayList?.read) {
          userRelayList.read.forEach((url: string) => {
            const normalized = normalizeUrl(url)
            if (normalized) relayUrls.add(normalized)
          })
        }
        
        // Fetch user's favorite relays (kind 10012)
        try {
          const { ExtendedKind } = await import('@/constants')
          const favoriteRelaysEvent = await (client as any).fetchReplaceableEvent?.(userPubkey, ExtendedKind.FAVORITE_RELAYS)
          if (favoriteRelaysEvent) {
            favoriteRelaysEvent.tags.forEach(([tagName, tagValue]: [string, string]) => {
              if (tagName === 'relay' && tagValue) {
                const normalized = normalizeUrl(tagValue)
                if (normalized) relayUrls.add(normalized)
              }
            })
          }
        } catch (error) {
          // Ignore if favorite relays can't be fetched
        }
      }
    } catch (error) {
      // Ignore if user relay list can't be fetched
    }
    
    // Add BIG_RELAY_URLS as fallback
    BIG_RELAY_URLS.forEach(url => {
      const normalized = normalizeUrl(url)
      if (normalized) relayUrls.add(normalized)
    })
    
    // Add SEARCHABLE_RELAY_URLS
    SEARCHABLE_RELAY_URLS.forEach(url => {
      const normalized = normalizeUrl(url)
      if (normalized) relayUrls.add(normalized)
    })
    
    return Array.from(relayUrls)
  }, [])

  // Helper function to fetch event using subscription-style query with comprehensive relay list
  const fetchEventWithSubscription = useCallback(async (
    filter: any,
    relayUrls: string[],
    logPrefix: string
  ): Promise<Event | undefined> => {
    try {
      let foundEvent: Event | undefined = undefined
      let hasEosed = false
      let subscriptionClosed = false
      
      const { closer } = await client.subscribeTimeline(
        [{ urls: relayUrls, filter }],
        {
          onEvents: (events, eosed) => {
            if (events.length > 0 && !foundEvent) {
              foundEvent = events[0]
              logger.debug(`[PublicationIndex] Found event via ${logPrefix} subscription`)
            }
            if (eosed) {
              hasEosed = true
            }
            // Close subscription once we have an event and eosed
            if ((foundEvent || hasEosed) && !subscriptionClosed) {
              subscriptionClosed = true
              closer()
            }
          },
          onNew: () => {} // Not needed for one-time fetch
        },
        { needSort: false }
      )
      
      // Wait for up to 10 seconds for events to arrive or eosed
      const startTime = Date.now()
      while (!foundEvent && !hasEosed && Date.now() - startTime < 10000) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      // Close subscription if still open
      if (!subscriptionClosed) {
        closer()
      }
      
      if (foundEvent) {
        return foundEvent
      }
    } catch (subError) {
      logger.warn(`[PublicationIndex] Subscription error for ${logPrefix}, falling back to fetchEvents:`, subError)
      // Fallback to regular fetchEvents if subscription fails
      const events = await client.fetchEvents(relayUrls, [filter])
      if (events.length > 0) {
        logger.debug(`[PublicationIndex] Found event via ${logPrefix} fetchEvents fallback`)
        return events[0]
      }
    }
    
    return undefined
  }, [])

  // Unified method to fetch event for both a and e tags
  const fetchEventFromRelay = useCallback(async (
    filter: any,
    additionalRelays: string[],
    logPrefix: string
  ): Promise<Event | undefined> => {
    // Build comprehensive relay list
    const finalRelayUrls = await buildComprehensiveRelayList(additionalRelays)
    logger.debug(`[PublicationIndex] Using ${finalRelayUrls.length} relays for ${logPrefix} query`)
    
    // Fetch using subscription-style query with comprehensive relay list
    return await fetchEventWithSubscription(filter, finalRelayUrls, logPrefix)
  }, [buildComprehensiveRelayList, fetchEventWithSubscription])

  // Fetch a single reference with retry logic
  const fetchSingleReference = useCallback(async (
    ref: PublicationReference,
    currentVisited: Set<string>,
    isRetry = false
  ): Promise<PublicationReference | null> => {
    // Skip if this is a 30040 event we've already visited (prevent circular references)
    if (ref.type === 'a' && ref.kind === ExtendedKind.PUBLICATION && ref.coordinate) {
      if (currentVisited.has(ref.coordinate)) {
        logger.debug('[PublicationIndex] Skipping visited 30040 index:', ref.coordinate)
        return { ...ref, event: undefined }
      }
    }

    try {
      let fetchedEvent: Event | undefined = undefined
      
      if (ref.type === 'a' && ref.coordinate) {
        // Handle addressable event (a tag)
        const aTag = ['a', ref.coordinate, ref.relay || '', ref.eventId || '']
        const bech32Id = generateBech32IdFromATag(aTag)
        
        if (bech32Id) {
          // Try to get by coordinate (replaceable event)
          fetchedEvent = await indexedDb.getPublicationEvent(ref.coordinate)
          
          // If not found, try to fetch from relay
          if (!fetchedEvent) {
            // For naddr, always use subscription-style query with comprehensive relay list (more reliable)
            if (bech32Id.startsWith('naddr1')) {
              try {
                const { nip19 } = await import('nostr-tools')
                const decoded = nip19.decode(bech32Id)
                if (decoded.type === 'naddr') {
                  const filter: any = {
                    authors: [decoded.data.pubkey],
                    kinds: [decoded.data.kind],
                    limit: 1
                  }
                  if (decoded.data.identifier) {
                    filter['#d'] = [decoded.data.identifier]
                  }
                  
                  // Build comprehensive relay list and fetch using unified method
                  const additionalRelays = decoded.data.relays || []
                  fetchedEvent = await fetchEventFromRelay(filter, additionalRelays, 'naddr')
                }
              } catch (error) {
                logger.warn('[PublicationIndex] Error trying naddr filter query:', error)
              }
            } else {
              // For non-naddr (nevent/note), try fetchEvent first, then force retry
              if (isRetry) {
                fetchedEvent = await client.fetchEventForceRetry(bech32Id)
              } else {
                fetchedEvent = await client.fetchEvent(bech32Id)
              }
            }
            
            // Save to cache as replaceable event if we fetched it
            if (fetchedEvent) {
              await indexedDb.putReplaceableEvent(fetchedEvent)
              logger.debug('[PublicationIndex] Cached event with coordinate:', ref.coordinate)
            }
          } else {
            logger.debug('[PublicationIndex] Loaded from cache by coordinate:', ref.coordinate)
          }
        } else {
          logger.warn('[PublicationIndex] Could not generate bech32 ID for:', ref.coordinate)
        }
      } else if (ref.type === 'e' && ref.eventId) {
        // Handle event ID reference (e tag) - same as a tags
        // First check indexedDb PUBLICATION_EVENTS store (events cached as part of publications)
        const hexId = ref.eventId.length === 64 ? ref.eventId : undefined
        if (hexId) {
          try {
            // Check PUBLICATION_EVENTS store first (for non-replaceable events stored with master)
            fetchedEvent = await indexedDb.getEventFromPublicationStore(hexId)
            if (fetchedEvent) {
              logger.debug('[PublicationIndex] Loaded from indexedDb PUBLICATION_EVENTS store by event ID:', ref.eventId)
            }
          } catch (error) {
            logger.debug('[PublicationIndex] PUBLICATION_EVENTS store lookup failed:', error)
          }
          
          // Also check if it's a replaceable event (check by pubkey and kind if we have them)
          if (!fetchedEvent && ref.kind && ref.pubkey && isReplaceableEvent(ref.kind)) {
            try {
              const replaceableEvent = await indexedDb.getReplaceableEvent(ref.pubkey, ref.kind)
              if (replaceableEvent && replaceableEvent.id === hexId) {
                fetchedEvent = replaceableEvent
                logger.debug('[PublicationIndex] Loaded from indexedDb replaceable cache by event ID:', ref.eventId)
              }
            } catch (error) {
              logger.debug('[PublicationIndex] Replaceable cache lookup failed:', error)
            }
          }
        }
        
        // If not found in indexedDb cache, try to fetch from relay using unified method
        if (!fetchedEvent) {
          // Build comprehensive relay list and fetch using unified method
          const additionalRelays = ref.relay ? [ref.relay] : []
          const filter = { ids: [hexId || ref.eventId], limit: 1 }
          fetchedEvent = await fetchEventFromRelay(filter, additionalRelays, 'e tag')
          
          // Cache the fetched event if found
          if (fetchedEvent) {
            // Check if this is a replaceable event kind
            if (isReplaceableEvent(fetchedEvent.kind)) {
              // Save to cache as replaceable event (will be linked to master via putPublicationWithNestedEvents)
              await indexedDb.putReplaceableEvent(fetchedEvent)
              logger.debug('[PublicationIndex] Cached replaceable event with ID:', ref.eventId)
            } else {
              // For non-replaceable events, we'll link them to master later via putPublicationWithNestedEvents
              logger.debug('[PublicationIndex] Fetched non-replaceable event with ID (will link to master):', ref.eventId)
            }
          }
        }
        
        if (!fetchedEvent) {
          logger.warn('[PublicationIndex] Could not fetch event for ID:', ref.eventId)
        }
      }
      
      if (fetchedEvent) {
        // Check if this event has nested references we haven't seen yet
        const nestedRefs: PublicationReference[] = []
        for (const tag of fetchedEvent.tags) {
          if (tag[0] === 'a' && tag[1]) {
            const [kindStr, pubkey, identifier] = tag[1].split(':')
            const kind = parseInt(kindStr)
            if (!isNaN(kind)) {
              const coordinate = tag[1]
              const nestedRef: PublicationReference = {
                type: 'a',
                coordinate,
                kind,
                pubkey,
                identifier: identifier || '',
                relay: tag[2],
                eventId: tag[3]
              }
              
              // Check if we already have this reference
              const existingRef = referencesData.find(r => 
                r.coordinate === coordinate || 
                (r.type === 'a' && r.coordinate === coordinate)
              )
              
              if (!existingRef && !currentVisited.has(coordinate)) {
                nestedRefs.push(nestedRef)
              }
            }
          } else if (tag[0] === 'e' && tag[1]) {
            const eventId = tag[1]
            const nestedRef: PublicationReference = {
              type: 'e',
              eventId,
              relay: tag[2]
            }
            
            // Check if we already have this reference
            const existingRef = referencesData.find(r => 
              r.eventId === eventId || 
              (r.type === 'e' && r.eventId === eventId)
            )
            
            if (!existingRef) {
              nestedRefs.push(nestedRef)
            }
          }
        }
        
        // For e-tags, ensure coordinate is set to eventId if not already set
        const updatedRef = { ...ref, event: fetchedEvent, nestedRefs }
        if (ref.type === 'e' && ref.eventId && !updatedRef.coordinate) {
          updatedRef.coordinate = ref.eventId
        }
        return updatedRef
      } else {
        // For e-tags, ensure coordinate is set to eventId even if fetch failed
        const updatedRef = { ...ref, event: undefined }
        if (ref.type === 'e' && ref.eventId && !updatedRef.coordinate) {
          updatedRef.coordinate = ref.eventId
        }
        return updatedRef
      }
    } catch (error) {
      logger.error('[PublicationIndex] Error fetching reference:', error)
      // For e-tags, ensure coordinate is set to eventId even on error
      const updatedRef = { ...ref, event: undefined }
      if (ref.type === 'e' && ref.eventId && !updatedRef.coordinate) {
        updatedRef.coordinate = ref.eventId
      }
      return updatedRef
    }
  }, [referencesData])

  // Helper function to extract nested references from an event
  const extractNestedReferences = useCallback((
    event: Event,
    existingRefs: Map<string, PublicationReference>,
    visited: Set<string>
  ): PublicationReference[] => {
    const nestedRefs: PublicationReference[] = []
    
    for (const tag of event.tags) {
      if (tag[0] === 'a' && tag[1]) {
        const [kindStr, pubkey, identifier] = tag[1].split(':')
        const kind = parseInt(kindStr)
        if (!isNaN(kind)) {
          const coordinate = tag[1]
          // Skip if already visited (prevent circular references)
          if (kind === ExtendedKind.PUBLICATION && visited.has(coordinate)) {
            continue
          }
          
          const key = coordinate
          if (!existingRefs.has(key)) {
            nestedRefs.push({
              type: 'a',
              coordinate,
              kind,
              pubkey,
              identifier: identifier || '',
              relay: tag[2],
              eventId: tag[3]
            })
          }
        }
      } else if (tag[0] === 'e' && tag[1]) {
        const eventId = tag[1]
        if (!existingRefs.has(eventId)) {
          nestedRefs.push({
            type: 'e',
            eventId,
            relay: tag[2]
          })
        }
      }
    }
    
    return nestedRefs
  }, [])

  // Batch fetch all references efficiently
  const batchFetchReferences = useCallback(async (
    initialRefs: PublicationReference[],
    currentVisited: Set<string>,
    isRetry: boolean,
    onProgress?: (fetchedRefs: PublicationReference[]) => void
  ): Promise<{ fetched: PublicationReference[]; failed: PublicationReference[] }> => {
    const CONCURRENCY_LIMIT = 10 // Limit concurrent fetches
    const BATCH_SIZE = 50 // Process in batches
    
    // Step 1: Collect ALL references (including nested ones) by traversing the tree
    const allRefs = new Map<string, PublicationReference>()
    const refsToProcess = [...initialRefs]
    
    logger.info('[PublicationIndex] Starting batch fetch, collecting all references...')
    
    // First pass: collect all top-level references
    for (const ref of initialRefs) {
      const key = ref.coordinate || ref.eventId || ''
      if (key && !allRefs.has(key)) {
        allRefs.set(key, ref)
      }
    }
    
    // Step 2: Check cache in bulk for all collected references
    logger.info('[PublicationIndex] Checking cache for', allRefs.size, 'references...')
    const cachedEvents = new Map<string, Event>()
    const refsToFetch: PublicationReference[] = []
    
    for (const [key, ref] of allRefs) {
      let cached: Event | undefined = undefined
      
      // Check cache based on reference type
      if (ref.type === 'a' && ref.coordinate) {
        cached = await indexedDb.getPublicationEvent(ref.coordinate)
      } else if (ref.type === 'e' && ref.eventId) {
        const hexId = ref.eventId.length === 64 ? ref.eventId : undefined
        if (hexId) {
          cached = await indexedDb.getEventFromPublicationStore(hexId)
          if (!cached && ref.kind && ref.pubkey && isReplaceableEvent(ref.kind)) {
            const replaceable = await indexedDb.getReplaceableEvent(ref.pubkey, ref.kind)
            if (replaceable && replaceable.id === hexId) {
              cached = replaceable
            }
          }
        }
      }
      
      if (cached) {
        cachedEvents.set(key, cached)
        // Extract nested references from cached event
        const nestedRefs = extractNestedReferences(cached, allRefs, currentVisited)
        for (const nestedRef of nestedRefs) {
          const nestedKey = nestedRef.coordinate || nestedRef.eventId || ''
          if (nestedKey && !allRefs.has(nestedKey)) {
            allRefs.set(nestedKey, nestedRef)
            refsToProcess.push(nestedRef)
            // Check if nested ref is cached, if not add to fetch queue
            // (We'll check cache for it in the next iteration)
          }
        }
      } else {
        refsToFetch.push(ref)
      }
    }
    
    // Continue processing nested references discovered from cached events
    while (refsToProcess.length > 0) {
      const ref = refsToProcess.shift()!
      const key = ref.coordinate || ref.eventId || ''
      if (!key || allRefs.has(key)) continue
      
      allRefs.set(key, ref)
      
      // Check cache for this nested reference
      let cached: Event | undefined = undefined
      if (ref.type === 'a' && ref.coordinate) {
        cached = await indexedDb.getPublicationEvent(ref.coordinate)
      } else if (ref.type === 'e' && ref.eventId) {
        const hexId = ref.eventId.length === 64 ? ref.eventId : undefined
        if (hexId) {
          cached = await indexedDb.getEventFromPublicationStore(hexId)
          if (!cached && ref.kind && ref.pubkey && isReplaceableEvent(ref.kind)) {
            const replaceable = await indexedDb.getReplaceableEvent(ref.pubkey, ref.kind)
            if (replaceable && replaceable.id === hexId) {
              cached = replaceable
            }
          }
        }
      }
      
      if (cached) {
        cachedEvents.set(key, cached)
        // Extract nested references from this cached event
        const nestedRefs = extractNestedReferences(cached, allRefs, currentVisited)
        for (const nestedRef of nestedRefs) {
          const nestedKey = nestedRef.coordinate || nestedRef.eventId || ''
          if (nestedKey && !allRefs.has(nestedKey)) {
            allRefs.set(nestedKey, nestedRef)
            refsToProcess.push(nestedRef)
          }
        }
      } else {
        refsToFetch.push(ref)
      }
    }
    
    logger.info('[PublicationIndex] Cache check complete:', {
      cached: cachedEvents.size,
      toFetch: refsToFetch.length,
      total: allRefs.size
    })
    
    // Step 3: Fetch missing events in parallel batches with concurrency control
    const fetchedRefs: PublicationReference[] = []
    const failedRefs: PublicationReference[] = []
    const pendingRefs = [...refsToFetch] // Queue of references to fetch
    
    // Process in batches to avoid overwhelming relays
    while (pendingRefs.length > 0) {
      const batch = pendingRefs.splice(0, BATCH_SIZE)
      logger.info('[PublicationIndex] Processing batch', '(', batch.length, 'references,', pendingRefs.length, 'remaining)')
      
      // Process batch with concurrency limit
      const batchPromises: Promise<void>[] = []
      let activeCount = 0
      
      for (const ref of batch) {
        // Wait if we've hit concurrency limit
        while (activeCount >= CONCURRENCY_LIMIT) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        
        activeCount++
        const promise = (async () => {
          try {
            const result = await fetchSingleReference(ref, currentVisited, isRetry)
          if (result) {
            if (result.event) {
              fetchedRefs.push(result)
                // Extract and add nested references
                const nestedRefs = extractNestedReferences(result.event, allRefs, currentVisited)
                for (const nestedRef of nestedRefs) {
                  const nestedKey = nestedRef.coordinate || nestedRef.eventId || ''
                  if (nestedKey && !allRefs.has(nestedKey)) {
                    allRefs.set(nestedKey, nestedRef)
                    // Check if nested ref is cached
                    let nestedCached: Event | undefined = undefined
                    if (nestedRef.type === 'a' && nestedRef.coordinate) {
                      nestedCached = await indexedDb.getPublicationEvent(nestedRef.coordinate)
                    } else if (nestedRef.type === 'e' && nestedRef.eventId) {
                      const hexId = nestedRef.eventId.length === 64 ? nestedRef.eventId : undefined
                      if (hexId) {
                        nestedCached = await indexedDb.getEventFromPublicationStore(hexId)
                        if (!nestedCached && nestedRef.kind && nestedRef.pubkey && isReplaceableEvent(nestedRef.kind)) {
                          const replaceable = await indexedDb.getReplaceableEvent(nestedRef.pubkey, nestedRef.kind)
                          if (replaceable && replaceable.id === hexId) {
                            nestedCached = replaceable
                          }
                        }
                      }
                    }
                    
                    if (nestedCached) {
                      cachedEvents.set(nestedKey, nestedCached)
                      // Extract nested references from this cached event
                      const deeperNestedRefs = extractNestedReferences(nestedCached, allRefs, currentVisited)
                      for (const deeperRef of deeperNestedRefs) {
                        const deeperKey = deeperRef.coordinate || deeperRef.eventId || ''
                        if (deeperKey && !allRefs.has(deeperKey)) {
                          allRefs.set(deeperKey, deeperRef)
                          // Will be checked in next iteration
                        }
                      }
                    } else {
                      // Add to queue for fetching
                      pendingRefs.push(nestedRef)
                  }
                }
              }
            } else {
              failedRefs.push(result)
              }
            }
          } catch (error) {
            logger.error('[PublicationIndex] Error fetching reference in batch:', error)
            failedRefs.push({ ...ref, event: undefined })
          } finally {
            activeCount--
          }
        })()
        
        batchPromises.push(promise)
      }
      
      await Promise.all(batchPromises)
      
      // Update progress after each batch
      if (onProgress) {
        const currentFetched: PublicationReference[] = []
        for (const [key, ref] of allRefs) {
          const cached = cachedEvents.get(key)
          if (cached) {
            currentFetched.push({ ...ref, event: cached })
          } else {
            const fetched = fetchedRefs.find(r => (r.coordinate || r.eventId) === key)
            if (fetched) {
              currentFetched.push(fetched)
            }
          }
        }
        onProgress(currentFetched)
      }
    }
    
    // Combine cached and fetched references
    const allFetchedRefs: PublicationReference[] = []
    for (const [key, ref] of allRefs) {
      const cached = cachedEvents.get(key)
      if (cached) {
        allFetchedRefs.push({ ...ref, event: cached })
              } else {
        const fetched = fetchedRefs.find(r => (r.coordinate || r.eventId) === key)
        if (fetched) {
          allFetchedRefs.push(fetched)
        } else {
          const failed = failedRefs.find(r => (r.coordinate || r.eventId) === key)
          if (failed) {
            allFetchedRefs.push(failed)
          } else {
            allFetchedRefs.push({ ...ref, event: undefined })
          }
        }
      }
    }
    
    logger.info('[PublicationIndex] Batch fetch complete:', {
      total: allFetchedRefs.length,
      fetched: fetchedRefs.length,
      cached: cachedEvents.size,
      failed: failedRefs.length
    })
    
    return {
      fetched: allFetchedRefs,
      failed: allFetchedRefs.filter(ref => !ref.event)
              }
  }, [fetchSingleReference, extractNestedReferences])

  // Fetch referenced events
  useEffect(() => {
    let isMounted = true
    
    const fetchReferences = async (isManualRetry = false) => {
      if (isManualRetry) {
        setIsRetrying(true)
      } else {
        setIsLoading(true)
      }
      
      // Capture current visitedIndices at the start of the fetch
      const currentVisited = visitedIndices
      
      // Add a timeout to prevent infinite loading on mobile
      const timeout = setTimeout(() => {
        if (isMounted) {
          logger.warn('[PublicationIndex] Fetch timeout reached, setting loaded state')
          setIsLoading(false)
          setIsRetrying(false)
        }
      }, 60000) // 60 second timeout for large publications
      
      try {
        // Combine original references with failed references if this is a retry
        const refsToFetch = isManualRetry && failedReferences.length > 0 
          ? [...referencesData, ...failedReferences]
          : referencesData
        
        if (refsToFetch.length === 0) {
          setIsLoading(false)
          setIsRetrying(false)
          return
        }
        
        // Use batch fetching
        const { fetched, failed } = await batchFetchReferences(
          refsToFetch,
          currentVisited,
          isManualRetry,
          (fetchedRefs) => {
            if (isMounted) {
              // Update state progressively as events are fetched
          setReferences(fetchedRefs)
            }
          }
        )
        
        if (isMounted) {
          setReferences(fetched)
          setFailedReferences(failed)
          setIsLoading(false)
          setIsRetrying(false)
          
          // Store master publication with all nested events
          const nestedEvents = fetched.filter(ref => ref.event).map(ref => ref.event!).filter((e): e is Event => e !== undefined)
          if (nestedEvents.length > 0) {
            indexedDb.putPublicationWithNestedEvents(event, nestedEvents).catch(err => {
              logger.error('[PublicationIndex] Error caching publication with nested events:', err)
            })
          }
        }
      } catch (error) {
        logger.error('[PublicationIndex] Error in fetchReferences:', error)
        if (isMounted) {
          setIsLoading(false)
          setIsRetrying(false)
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    if (referencesData.length > 0) {
      fetchReferences(false).then(() => {
        // Auto-retry failed references after initial load
        setFailedReferences(prevFailed => {
          if (prevFailed.length > 0 && retryCount < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, retryCount), 10000) // Exponential backoff, max 10s
            setTimeout(() => {
              setRetryCount(prev => prev + 1)
              fetchReferences(true)
            }, delay)
          }
          return prevFailed
        })
      })
    } else {
      setIsLoading(false)
    }
    
    return () => {
      isMounted = false
    }
  }, [referencesData, visitedIndices, fetchSingleReference]) // Include fetchSingleReference in dependencies

  // Manual retry function
  const handleManualRetry = useCallback(async () => {
    setRetryCount(0)
    setIsRetrying(true)
    
    const fetchReferences = async () => {
      const updatedRefs: Map<string, PublicationReference> = new Map()
      const newRefs: PublicationReference[] = []
      const failedRefs: PublicationReference[] = []
      const discoveredRefs: PublicationReference[] = []
      const currentVisited = visitedIndices
      
      // Create a map of existing references for quick lookup
      references.forEach(ref => {
        const id = ref.coordinate || ref.eventId || ''
        if (id) {
          updatedRefs.set(id, ref)
        }
      })
      
      // Only retry failed references, not all references
      const refsToRetry = failedReferences.length > 0 ? failedReferences : references.filter(ref => !ref.event)
      
      if (refsToRetry.length === 0) {
        setIsRetrying(false)
        return
      }
      
      logger.info('[PublicationIndex] Retrying', refsToRetry.length, 'failed references')
      
      for (const ref of refsToRetry) {
        const result = await fetchSingleReference(ref, currentVisited, true)
        
        if (result) {
          const id = result.coordinate || result.eventId || ''
          
          if (result.event) {
            // Successfully fetched - update existing reference or add new one
            if (id) {
              updatedRefs.set(id, result)
            } else {
              newRefs.push(result)
            }
            
            // Collect discovered nested references
            if ((result as any).nestedRefs && (result as any).nestedRefs.length > 0) {
              for (const nestedRef of (result as any).nestedRefs) {
                const nestedId = nestedRef.coordinate || nestedRef.eventId || ''
                if (!nestedId) continue
                
                // Check if we already have this reference
                const existingInMap = updatedRefs.has(nestedId)
                const existingInNew = newRefs.find(r => {
                  const rid = r.coordinate || r.eventId || ''
                  return rid === nestedId
                })
                const existingInDiscovered = discoveredRefs.find(r => {
                  const rid = r.coordinate || r.eventId || ''
                  return rid === nestedId
                })
                
                if (!existingInMap && !existingInNew && !existingInDiscovered) {
                  discoveredRefs.push(nestedRef)
                }
              }
            }
          } else {
            // Still failed
            if (id) {
              updatedRefs.set(id, result)
            } else {
              failedRefs.push(result)
            }
          }
        }
      }
      
      // Fetch discovered nested references
      if (discoveredRefs.length > 0) {
        logger.info('[PublicationIndex] Found', discoveredRefs.length, 'new nested references on retry')
        for (const nestedRef of discoveredRefs) {
          const result = await fetchSingleReference(nestedRef, currentVisited, true)
          
          if (result) {
            const id = result.coordinate || result.eventId || ''
            if (result.event) {
              if (id) {
                updatedRefs.set(id, result)
              } else {
                newRefs.push(result)
              }
            } else {
              if (id) {
                updatedRefs.set(id, result)
              } else {
                failedRefs.push(result)
              }
            }
          }
        }
      }
      
      // Update state with merged results
      const finalRefs = Array.from(updatedRefs.values()).concat(newRefs)
      const stillFailed = finalRefs.filter(ref => !ref.event)
      
      setReferences(finalRefs)
      setFailedReferences(stillFailed)
      setIsRetrying(false)
      
      // Store master publication with all nested events
      const nestedEvents = finalRefs.filter(ref => ref.event).map(ref => ref.event!).filter((e): e is Event => e !== undefined)
      if (nestedEvents.length > 0) {
        indexedDb.putPublicationWithNestedEvents(event, nestedEvents).catch(err => {
          logger.error('[PublicationIndex] Error caching publication with nested events:', err)
        })
      }
    }
    
    await fetchReferences()
  }, [failedReferences, visitedIndices, fetchSingleReference, references, event])

  return (
    <div className={cn('space-y-6', className)}>
      {/* Publication Metadata - only show for top-level publications */}
      {!isNested && (
        <div className="prose prose-zinc max-w-none dark:prose-invert">
          <header className="mb-8 border-b pb-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              {metadata.title && <h1 className="text-4xl font-bold leading-tight break-words flex-1">{metadata.title}</h1>}
              {!metadata.title && isBookstrEvent && (
                <div className="flex-1">
                  <h1 className="text-4xl font-bold leading-tight break-words">
                    {bookMetadata.book
                      ? bookMetadata.book
                          .split('-')
                          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                          .join(' ')
                      : 'Bookstr Publication'}
                  </h1>
                </div>
              )}
              <Button 
                variant="ghost" 
                size="icon" 
                className="shrink-0"
                onClick={exportPublication}
                title="Export as AsciiDoc"
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </div>
            {metadata.summary && (
              <blockquote className="border-l-4 border-primary pl-6 italic text-muted-foreground mb-4 text-lg leading-relaxed">
                <p className="break-words">{metadata.summary}</p>
              </blockquote>
            )}
            {/* Display image for top-level 30040 publication */}
            {metadata.image && (
              <div className="mb-4">
                <Image
                  image={{ url: metadata.image, pubkey: event.pubkey }}
                  className="max-w-[400px] w-full h-auto rounded-lg"
                  classNames={{
                    wrapper: 'rounded-lg',
                    errorPlaceholder: 'aspect-square h-[30vh]'
                  }}
                />
              </div>
            )}
            <div className="text-sm text-muted-foreground space-y-1">
              {metadata.author && (
                <div>
                  <span className="font-semibold">Author:</span> {metadata.author}
                </div>
              )}
              {metadata.version && !isBookstrEvent && (
                <div>
                  <span className="font-semibold">Version:</span> {metadata.version}
                </div>
              )}
              {metadata.type && !isBookstrEvent && (
                <div>
                  <span className="font-semibold">Type:</span> {metadata.type}
                </div>
              )}
              {isBookstrEvent && (
                <>
                  {bookMetadata.type && (
                    <div>
                      <span className="font-semibold">Type:</span> {bookMetadata.type}
                    </div>
                  )}
                  {bookMetadata.book && (
                    <div>
                      <span className="font-semibold">Book:</span> {bookMetadata.book
                        .split('-')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                        .join(' ')}
                    </div>
                  )}
                  {bookMetadata.chapter && (
                    <div>
                      <span className="font-semibold">Chapter:</span> {bookMetadata.chapter}
                    </div>
                  )}
                  {bookMetadata.verse && (
                    <div>
                      <span className="font-semibold">Verse:</span> {bookMetadata.verse}
                    </div>
                  )}
                  {bookMetadata.version && (
                    <div>
                      <span className="font-semibold">Version:</span> {bookMetadata.version.toUpperCase()}
                    </div>
                  )}
                </>
              )}
            </div>
          </header>
        </div>
      )}

      {/* Table of Contents - only show for top-level publications */}
      {!isNested && !isLoading && tableOfContents.length > 0 && (
        <div id="publication-toc" className="border rounded-lg p-6 bg-muted/30 scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">Table of Contents</h2>
          <nav>
            <ul className="space-y-2">
              {tableOfContents.map((item, index) => (
                <ToCItemComponent 
                  key={index} 
                  item={item} 
                  onItemClick={scrollToSection}
                  level={0}
                />
              ))}
            </ul>
          </nav>
        </div>
      )}

      {/* Failed References Banner - only show for top-level publications */}
      {!isNested && !isLoading && failedReferences.length > 0 && references.length > 0 && (
        <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-yellow-800 dark:text-yellow-200">
              {failedReferences.length} reference{failedReferences.length !== 1 ? 's' : ''} failed to load. Click retry to attempt loading again.
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRetry}
              disabled={isRetrying}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", isRetrying && "animate-spin")} />
              Retry All
            </Button>
          </div>
        </div>
      )}

      {/* Content - render referenced events */}
      {isLoading ? (
        <div className="text-muted-foreground">
          <div>Loading publication content...</div>
          <div className="text-xs mt-2">If this takes too long, the content may not be available.</div>
        </div>
      ) : references.length === 0 ? (
        <div className="p-6 border rounded-lg bg-muted/30 text-center">
          <div className="text-lg font-semibold mb-2">No content loaded</div>
          <div className="text-sm text-muted-foreground mb-4">
            Unable to load publication content. The referenced events may not be available on the current relays.
          </div>
          <Button
            variant="outline"
            onClick={handleManualRetry}
            disabled={isRetrying}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isRetrying && "animate-spin")} />
            Retry Loading
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {references.map((ref, index) => {
            if (!ref.event) {
              // Generate naddr from coordinate or eventId for link
              let notesLink: string | null = null
              if (ref.coordinate) {
                const aTag = ['a', ref.coordinate, ref.relay || '', ref.eventId || '']
                const bech32Id = generateBech32IdFromATag(aTag)
                if (bech32Id) {
                  // Construct URL as /notes?events=naddr1...
                  notesLink = `/notes?events=${encodeURIComponent(bech32Id)}`
                }
              } else if (ref.eventId) {
                // For event IDs, try to construct a note/nevent, otherwise use as-is
                if (ref.eventId.startsWith('note1') || ref.eventId.startsWith('nevent1') || ref.eventId.startsWith('naddr1')) {
                  notesLink = `/notes?events=${encodeURIComponent(ref.eventId)}`
                } else if (/^[0-9a-f]{64}$/i.test(ref.eventId)) {
                  // Hex event ID - try to create nevent
                  try {
                    const nevent = nip19.neventEncode({ id: ref.eventId })
                    notesLink = `/notes?events=${encodeURIComponent(nevent)}`
                  } catch {
                    // Fallback to hex ID
                    notesLink = `/notes?events=${encodeURIComponent(ref.eventId)}`
                  }
                }
              }
              
              return (
                <div key={index} className="p-4 border rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-muted-foreground">
                      Reference {index + 1}: Unable to load event{' '}
                      {notesLink ? (
                        <a
                          href={notesLink}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            push(notesLink!)
                          }}
                          className="text-primary hover:underline cursor-pointer"
                        >
                          {ref.coordinate || ref.eventId || 'unknown'}
                        </a>
                      ) : (
                        <span>{ref.coordinate || ref.eventId || 'unknown'}</span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleManualRetry}
                      disabled={isRetrying}
                      className="shrink-0"
                    >
                      <RefreshCw className={cn("h-4 w-4", isRetrying && "animate-spin")} />
                      Retry
                    </Button>
                  </div>
                </div>
              )
            }

            // Render based on event kind
            // Use the same coordinate logic as ToC: coordinate || eventId
            // For e-tags, coordinate might be empty, so use eventId
            // For a-tags, coordinate is set (kind:pubkey:identifier)
            const coordinate = ref.coordinate || ref.eventId || ''
            const sectionId = `section-${coordinate.replace(/:/g, '-')}`
            const eventKind = ref.kind || ref.event.kind
            
            // Debug: log section ID generation
            logger.debug('[PublicationIndex] Rendering section:', { 
              coordinate, 
              sectionId, 
              hasCoordinate: !!ref.coordinate, 
              hasEventId: !!ref.eventId,
              eventId: ref.eventId?.substring(0, 16) + '...'
            })
            
            if (eventKind === ExtendedKind.PUBLICATION) {
              // Recursively render nested 30040 publication index
              // Use the top-level publication's image as parent for nested publications
              const effectiveParentImageUrl = !isNested ? metadata.image : parentImageUrl
              return (
                <div key={index} id={sectionId} className="border-l-4 border-primary pl-6 scroll-mt-24 pt-6 relative">
                  {!isNested && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-0 right-0 opacity-70 hover:opacity-100"
                      onClick={scrollToToc}
                      title="Back to Table of Contents"
                    >
                      <ArrowUp className="h-4 w-4 mr-2" />
                      ToC
                    </Button>
                  )}
                  <PublicationIndex event={ref.event} isNested={true} parentImageUrl={effectiveParentImageUrl} />
                </div>
              )
            } else if (eventKind === ExtendedKind.PUBLICATION_CONTENT || eventKind === ExtendedKind.WIKI_ARTICLE) {
              // Render 30041 or 30818 content as AsciidocArticle
              // Pass parent image URL to avoid showing duplicate cover images
              // Use the top-level publication's image as parent, or the passed parentImageUrl for nested publications
              const effectiveParentImageUrl = !isNested ? metadata.image : parentImageUrl
              return (
                <div key={index} id={sectionId} className="scroll-mt-24 pt-6 relative">
                  {!isNested && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-0 right-0 opacity-70 hover:opacity-100"
                      onClick={scrollToToc}
                      title="Back to Table of Contents"
                    >
                      <ArrowUp className="h-4 w-4 mr-2" />
                      ToC
                    </Button>
                  )}
                  <AsciidocArticle event={ref.event} hideImagesAndInfo={true} parentImageUrl={effectiveParentImageUrl} />
                </div>
              )
            } else if (eventKind === ExtendedKind.WIKI_ARTICLE_MARKDOWN) {
              // Render 30817 content as MarkdownArticle
              // Pass parent image URL to avoid showing duplicate cover images
              // Use the top-level publication's image as parent, or the passed parentImageUrl for nested publications
              const effectiveParentImageUrl = !isNested ? metadata.image : parentImageUrl
              return (
                <div key={index} id={sectionId} className="scroll-mt-24 pt-6 relative">
                  {!isNested && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-0 right-0 opacity-70 hover:opacity-100"
                      onClick={scrollToToc}
                      title="Back to Table of Contents"
                    >
                      <ArrowUp className="h-4 w-4 mr-2" />
                      ToC
                    </Button>
                  )}
                  <MarkdownArticle event={ref.event} hideMetadata={true} parentImageUrl={effectiveParentImageUrl} />
                </div>
              )
            } else {
              // Fallback for other kinds - just show a placeholder
              return (
                <div key={index} className="p-4 border rounded-lg">
                  <div className="text-sm text-muted-foreground">
                    Reference {index + 1}: Unsupported kind {eventKind}
                  </div>
                </div>
              )
            }
          })}
        </div>
      )}
    </div>
  )
}

// ToC Item Component - renders nested table of contents items
function ToCItemComponent({
  item,
  onItemClick,
  level
}: {
  item: ToCItem
  onItemClick: (coordinate: string) => void
  level: number
}) {
  const indentClass = level > 0 ? `ml-${level * 4}` : ''
  
  return (
    <li className={cn('list-none', indentClass)}>
      <button
        onClick={() => onItemClick(item.coordinate)}
        className="text-left text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline cursor-pointer"
      >
        {item.title}
      </button>
      {item.children && item.children.length > 0 && (
        <ul className="mt-2 space-y-1">
          {item.children.map((child, childIndex) => (
            <ToCItemComponent
              key={childIndex}
              item={child}
              onItemClick={onItemClick}
              level={level + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

