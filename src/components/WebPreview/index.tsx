import { useFetchWebMetadata } from '@/hooks/useFetchWebMetadata'
import { useFetchEvent } from '@/hooks/useFetchEvent'
import { useFetchProfile } from '@/hooks/useFetchProfile'
import { ExtendedKind } from '@/constants'
import { getLongFormArticleMetadataFromEvent, dTagToTitleCase } from '@/lib/event-metadata'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Skeleton } from '@/components/ui/skeleton'
import { ExternalLink } from 'lucide-react'
import { nip19, kinds } from 'nostr-tools'
import { useMemo, useEffect, useState } from 'react'
import Image from '../Image'
import Username from '../Username'
import { cleanUrl, isSafeMediaUrl } from '@/lib/url'
import { tagNameEquals } from '@/lib/tag'
import { queryService } from '@/services/client.service'
import { Event } from 'nostr-tools'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { getImetaInfosFromEvent } from '@/lib/event'
import MarkdownArticle from '../Note/MarkdownArticle/MarkdownArticle'
import AsciidocArticle from '../Note/AsciidocArticle/AsciidocArticle'
import ProfileAbout from '@/components/ProfileAbout'

// Helper function to get event type name
function getEventTypeName(kind: number): string {
  switch (kind) {
    case kinds.ShortTextNote:
      return 'Text Post'
    case kinds.LongFormArticle:
      return 'Longform Article'
    case ExtendedKind.PICTURE:
      return 'Picture'
    case ExtendedKind.VIDEO:
      return 'Video'
    case ExtendedKind.SHORT_VIDEO:
      return 'Short Video'
    case ExtendedKind.POLL:
      return 'Poll'
    case ExtendedKind.COMMENT:
      return 'Comment'
    case ExtendedKind.VOICE:
      return 'Voice Post'
    case ExtendedKind.VOICE_COMMENT:
      return 'Voice Comment'
    case kinds.Highlights:
      return 'Highlight'
    case ExtendedKind.PUBLICATION:
      return 'Publication'
    case ExtendedKind.PUBLICATION_CONTENT:
      return 'Publication Content'
    case ExtendedKind.WIKI_ARTICLE:
      return 'Wiki Article'
    case ExtendedKind.WIKI_ARTICLE_MARKDOWN:
      return 'Wiki Article'
    case ExtendedKind.DISCUSSION:
      return 'Discussion'
    default:
      return `Event (kind ${kind})`
  }
}

// Helper function to extract first header from content
function extractFirstHeader(content: string): string | null {
  if (!content) return null
  
  // Try AsciiDoc header (= or ==)
  const asciidocHeaderMatch = content.match(/^=+\s+(.+)$/m)
  if (asciidocHeaderMatch) {
    return asciidocHeaderMatch[1].trim()
  }
  
  // Try Markdown header (#)
  const markdownHeaderMatch = content.match(/^#+\s+(.+)$/m)
  if (markdownHeaderMatch) {
    return markdownHeaderMatch[1].trim()
  }
  
  // Try setext header (underlined with === or ---)
  const setextMatch = content.match(/^(.+)\n[=]+$/m) || content.match(/^(.+)\n[-]+$/m)
  if (setextMatch) {
    return setextMatch[1].trim()
  }
  
  return null
}

// Helper function to extract first line of content
function extractFirstLine(content: string): string | null {
  if (!content) return null
  
  const firstLine = content.split('\n')[0]?.trim()
  return firstLine || null
}

// Helper function to get title with fallbacks
function getTitleWithFallbacks(event: Event | null, eventMetadata: { title?: string; summary?: string } | null): string | null {
  if (!event) return null
  
  // Get d-tag for comparison
  const dTag = event.tags.find(tag => tag[0] === 'd')?.[1]
  
  // 1. Title tag - but if it matches the d-tag, convert to title case
  if (eventMetadata?.title) {
    // If title exactly matches d-tag (case-insensitive), convert to title case
    if (dTag && eventMetadata.title.toLowerCase() === dTag.toLowerCase()) {
      return dTagToTitleCase(dTag)
    }
    return eventMetadata.title
  }
  
  // 2. d-tag in title case
  if (dTag) {
    return dTagToTitleCase(dTag)
  }
  
  // 3. First header from content
  const firstHeader = extractFirstHeader(event.content)
  if (firstHeader) {
    return firstHeader
  }
  
  // 4. First line of content
  const firstLine = extractFirstLine(event.content)
  if (firstLine) {
    return firstLine
  }
  
  return null
}

export default function WebPreview({ url, className }: { url: string; className?: string }) {
  const { autoLoadMedia } = useContentPolicy()
  const { isSmallScreen } = useScreenSize()

  const cleanedUrl = useMemo(() => cleanUrl(url), [url])
  const { title, description, image, ogLoading } = useFetchWebMetadata(cleanedUrl)

  const hostname = useMemo(() => {
    try {
      return new URL(cleanedUrl).hostname
    } catch {
      return ''
    }
  }, [cleanedUrl])

  const isInternalJumbleLink = useMemo(() => hostname === 'jumble.imwald.eu', [hostname])

  // Extract replaceable event info (d-tag and pubkey) from URL patterns
  // This is separate from nostrIdentifier to allow fetching without kind
  const replaceableEventInfo = useMemo(() => {
    try {
      // Pattern 1: d-tag*npub format
      const dtagNpubMatch = cleanedUrl.match(/([^\/\?\#\&\*]+)\*(npub1[a-z0-9]{58})/i)
      if (dtagNpubMatch) {
        const dTag = dtagNpubMatch[1].split('/').pop() || dtagNpubMatch[1]
        const npub = dtagNpubMatch[2]
        try {
          const decoded = nip19.decode(npub)
          if (decoded.type === 'npub') {
            return { dTag, pubkey: decoded.data }
          }
        } catch {}
      }
      
      // Pattern 2: d-tag*hexpubkey format
      const dtagHexMatch = cleanedUrl.match(/([^\/\?\#\&\*]+)\*([a-f0-9]{64})/i)
      if (dtagHexMatch) {
        const dTag = dtagHexMatch[1].split('/').pop() || dtagHexMatch[1]
        const hexPubkey = dtagHexMatch[2]
        return { dTag, pubkey: hexPubkey }
      }
      
      // Pattern 3: d-tag/npub format
      const dtagSlashNpubMatch = cleanedUrl.match(/([^\/\?\#\&]+)\/(npub1[a-z0-9]{58})/i)
      if (dtagSlashNpubMatch) {
        const dTag = dtagSlashNpubMatch[1].split('/').pop() || dtagSlashNpubMatch[1]
        const npub = dtagSlashNpubMatch[2]
        try {
          const decoded = nip19.decode(npub)
          if (decoded.type === 'npub') {
            return { dTag, pubkey: decoded.data }
          }
        } catch {}
      }
      
      // Pattern 4: d-tag and npub in path (e.g., https://wikifreedia.xyz/nostr-event-register/npub1...)
      // Only check if we haven't already matched a more specific pattern
      if (!dtagNpubMatch && !dtagHexMatch && !dtagSlashNpubMatch) {
        const pathNpubMatch = cleanedUrl.match(/(npub1[a-z0-9]{58})/i)
        if (pathNpubMatch) {
          const npub = pathNpubMatch[1]
          const npubIndex = cleanedUrl.indexOf(npub)
          const pathBeforeNpub = cleanedUrl.substring(0, npubIndex)
          const pathSegments = pathBeforeNpub.split('/').filter(Boolean)
          if (pathSegments.length > 0) {
            const possibleDTag = pathSegments[pathSegments.length - 1]
            try {
              const decoded = nip19.decode(npub)
              if (decoded.type === 'npub') {
                return { dTag: possibleDTag, pubkey: decoded.data }
              }
            } catch {}
          }
        }
      }
      
      // Pattern 5: d-tag only with /d/ prefix - try to find pubkey in URL
      // Only check if we haven't already matched a pattern with both d-tag and pubkey
      if (!dtagNpubMatch && !dtagHexMatch && !dtagSlashNpubMatch) {
        const dtagOnlyMatch = cleanedUrl.match(/\/d\/([^\/\?\#\&]+)/i)
        if (dtagOnlyMatch) {
          const dTag = dtagOnlyMatch[1]
          const urlParts = cleanedUrl.split('/d/')
          const pathBefore = urlParts[0].split('/').filter(Boolean)
          const pathAfter = urlParts[1] ? urlParts[1].split('/').filter(Boolean) : []
          const allPathParts = [...pathBefore, ...pathAfter]
          
          for (const part of allPathParts) {
            if (/^npub1[a-z0-9]{58}$/i.test(part)) {
              try {
                const decoded = nip19.decode(part)
                if (decoded.type === 'npub') {
                  return { dTag, pubkey: decoded.data }
                }
              } catch {}
            } else if (/^[a-f0-9]{64}$/i.test(part)) {
              return { dTag, pubkey: part }
            }
          }
          // If no pubkey found, return d-tag only (we can't fetch without pubkey, will show OG card)
          return { dTag, pubkey: null }
        }
      }
    } catch (error) {
      // Failed to parse
    }
    return null
  }, [cleanedUrl])

  // Fetch replaceable event by d-tag and pubkey (without kind)
  // If pubkey is null, fetch by d-tag only (across all authors)
  // Only use the result if exactly one event is found (to avoid ambiguous d-tags)
  const [fetchedReplaceableEvent, setFetchedReplaceableEvent] = useState<Event | null>(null)
  const [isFetchingReplaceableEvent, setIsFetchingReplaceableEvent] = useState(false)
  
  useEffect(() => {
    if (!replaceableEventInfo || !replaceableEventInfo.dTag) {
      setFetchedReplaceableEvent(null)
      setIsFetchingReplaceableEvent(false)
      return
    }
    
    setIsFetchingReplaceableEvent(true)
    
    // Fetch replaceable events by d-tag and pubkey across all replaceable kinds
    // Common replaceable event kinds
    const replaceableKinds = [30023, 30818, 30041, 30817, 30040, 30024]
    
    const fetchReplaceableEvent = async () => {
      try {
        const filters = replaceableKinds.map(kind => {
          const filter: any = {
            kinds: [kind],
            '#d': [replaceableEventInfo.dTag],
            limit: 1
          }
          // Only filter by author if we have a pubkey
          if (replaceableEventInfo.pubkey) {
            filter.authors = [replaceableEventInfo.pubkey]
          }
          return filter
        })
        
        const events = await queryService.fetchEvents(FAST_READ_RELAY_URLS, filters)
        
        // Find all events with matching d-tag
        const matchingEvents = events.filter(event => {
          const eventDTag = event.tags.find(tagNameEquals('d'))?.[1]
          return eventDTag === replaceableEventInfo.dTag
        })
        
        // Only use the result if exactly one event is found
        // If zero or multiple events, fall back to OG card (ambiguous d-tag)
        if (matchingEvents.length === 1) {
          setFetchedReplaceableEvent(matchingEvents[0])
        } else {
          setFetchedReplaceableEvent(null)
        }
      } catch (error) {
        // Failed to fetch
        setFetchedReplaceableEvent(null)
      } finally {
        setIsFetchingReplaceableEvent(false)
      }
    }
    
    fetchReplaceableEvent()
  }, [replaceableEventInfo])

  // Extract nostr identifier from URL
  // If we found a replaceable event and fetched it, create naddr from the fetched event
  // Otherwise, check for direct nostr identifiers
  const nostrIdentifier = useMemo(() => {
    // If we found a replaceable event and fetched it, create naddr from the fetched event
    if (fetchedReplaceableEvent) {
      try {
        const eventDTag = fetchedReplaceableEvent.tags.find(tagNameEquals('d'))?.[1] || ''
        const naddr = nip19.naddrEncode({
          kind: fetchedReplaceableEvent.kind,
          pubkey: fetchedReplaceableEvent.pubkey,
          identifier: eventDTag
        })
        return naddr
      } catch {
        // Failed to encode
      }
    }
    
    // Check for direct nostr identifiers in URL
    // IMPORTANT: Check for npub in specific paths (like /p/npub1...) to avoid treating as event
    const isNpubOnlyPath = /\/p\/(npub1[a-z0-9]{58})/i.test(cleanedUrl) || 
                           /\/profile\/(npub1[a-z0-9]{58})/i.test(cleanedUrl) ||
                           /\/user\/(npub1[a-z0-9]{58})/i.test(cleanedUrl)
    
    const naddrMatch = cleanedUrl.match(/(naddr1[a-z0-9]+)/i)
    const neventMatch = cleanedUrl.match(/(nevent1[a-z0-9]+)/i)
    const noteMatch = cleanedUrl.match(/(note1[a-z0-9]{58})/i)
    const npubMatch = isNpubOnlyPath ? null : cleanedUrl.match(/(npub1[a-z0-9]{58})/i)
    const nprofileMatch = cleanedUrl.match(/(nprofile1[a-z0-9]+)/i)
    
    // If npub-only path, extract npub for profile
    if (isNpubOnlyPath) {
      const npubPathMatch = cleanedUrl.match(/(npub1[a-z0-9]{58})/i)
      return npubPathMatch?.[1] || null
    }
    
    return naddrMatch?.[1] || neventMatch?.[1] || noteMatch?.[1] || npubMatch?.[1] || nprofileMatch?.[1] || null
  }, [cleanedUrl, fetchedReplaceableEvent])

  // Determine nostr type and extract details
  const nostrDetails = useMemo(() => {
    if (!nostrIdentifier) return null
    try {
      const decoded = nip19.decode(nostrIdentifier)
      const details: {
        type: string
        hexId?: string
        dTag?: string
        kind?: number
        pubkey?: string
        identifier?: string
      } = { type: decoded.type }
      
      if (decoded.type === 'note') {
        details.hexId = decoded.data
      } else if (decoded.type === 'nevent') {
        details.hexId = decoded.data.id
        details.kind = decoded.data.kind
        details.pubkey = decoded.data.author
      } else if (decoded.type === 'naddr') {
        details.kind = decoded.data.kind
        details.pubkey = decoded.data.pubkey
        details.identifier = decoded.data.identifier
        details.dTag = decoded.data.identifier
      } else if (decoded.type === 'npub') {
        details.pubkey = decoded.data
      } else if (decoded.type === 'nprofile') {
        details.pubkey = decoded.data.pubkey
      }
      
      return details
    } catch {
      return null
    }
  }, [nostrIdentifier])
  
  const nostrType = nostrDetails?.type || null

  // Fetch profile for npub/nprofile
  const profileId = nostrType === 'npub' || nostrType === 'nprofile' ? (nostrIdentifier || undefined) : undefined
  const { profile: fetchedProfile, isFetching: isFetchingProfile } = useFetchProfile(profileId)

  // Fetch event for naddr/nevent/note
  // If we already fetched a replaceable event, use that; otherwise fetch by identifier
  const eventId = (nostrType === 'naddr' || nostrType === 'nevent' || nostrType === 'note') ? (nostrIdentifier || undefined) : undefined
  const { event: fetchedEventById, isFetching: isFetchingEvent } = useFetchEvent(eventId)
  const fetchedEvent = fetchedReplaceableEvent || fetchedEventById
  const isFetchingEventFinal = isFetchingReplaceableEvent || isFetchingEvent
  
  // Fetch profile for event author (to show avatar in event cards)
  const eventAuthorProfileId = fetchedEvent?.pubkey ? nip19.npubEncode(fetchedEvent.pubkey) : undefined
  const { profile: eventAuthorProfile } = useFetchProfile(eventAuthorProfileId)
  

  // Create synthetic event for content preview rendering - ALWAYS call hooks before any returns
  const previewEvent = useMemo(() => {
    if (!fetchedEvent?.content) return null
    // Create a synthetic event with the content for MarkdownArticle rendering
    // We'll use the full content and let CSS handle truncation
    return {
      ...fetchedEvent,
      content: fetchedEvent.content
    } as Event
  }, [fetchedEvent])

  // Determine which image to use for event cards
  const eventMetadata = fetchedEvent ? getLongFormArticleMetadataFromEvent(fetchedEvent) : null
  const eventImage = eventMetadata?.image
  const imetaInfos = fetchedEvent ? getImetaInfosFromEvent(fetchedEvent) : []
  let eventImageThumbnail: string | null = null
  if (eventImage && fetchedEvent) {
    const cleanedEventImage = cleanUrl(eventImage)
    const matchingImeta = imetaInfos.find(info => cleanUrl(info.url) === cleanedEventImage)
    eventImageThumbnail = matchingImeta?.thumb || eventImage
  }
  const displayImageForDetection = eventImageThumbnail || image

  // Detect image aspect ratio to determine width - MUST be called unconditionally
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null)
  const [ogImageAspectRatio, setOgImageAspectRatio] = useState<number | null>(null)
  
  useEffect(() => {
    if (!displayImageForDetection || !isSafeMediaUrl(displayImageForDetection)) {
      setImageAspectRatio(null)
      return
    }

    const img = new window.Image()
    img.onload = () => {
      const aspectRatio = img.width / img.height
      setImageAspectRatio(aspectRatio)
    }
    img.onerror = () => {
      setImageAspectRatio(null)
    }
    img.src = displayImageForDetection
  }, [displayImageForDetection])

  // Detect OG image aspect ratio
  useEffect(() => {
    if (!image || !isSafeMediaUrl(image)) {
      setOgImageAspectRatio(null)
      return
    }

    const img = new window.Image()
    img.onload = () => {
      const aspectRatio = img.width / img.height
      setOgImageAspectRatio(aspectRatio)
    }
    img.onerror = () => {
      setOgImageAspectRatio(null)
    }
    img.src = image
  }, [image])

  // Early return after ALL hooks are called
  if (!autoLoadMedia) {
    return null
  }

  // Prefer the page's own Open Graph / meta when the fetch returns anything useful.
  const hasOpengraphData = !isInternalJumbleLink && (title || description || image)

  // While OG is loading for external URLs, avoid flashing the nostr / hostname fallback.
  if (!isInternalJumbleLink && ogLoading) {
    return (
      <div
        className={cn('p-2 flex w-full border rounded-lg overflow-hidden gap-2 max-w-full', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <Skeleton className="h-20 w-20 sm:w-40 shrink-0 rounded-l-md rounded-r-none" />
        <div className="flex-1 min-w-0 space-y-2 py-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>
    )
  }

  // Nostr-enhanced cards only when the target page did not provide usable preview metadata.
  if (!hasOpengraphData) {
    // Enhanced card for event URLs (always show if nostr identifier detected, even while loading)
    if (nostrType === 'naddr' || nostrType === 'nevent' || nostrType === 'note') {
      const eventTypeName = fetchedEvent ? getEventTypeName(fetchedEvent.kind) : null
      const eventSummary = eventMetadata?.summary || description

      // Fallback to OG image from website if event doesn't have an image
      // The OG image is already converted to absolute URL by useFetchWebMetadata
      // Prioritize: event image tag > OG image from URL metadata (not favicon)
      const displayImage = eventImageThumbnail || image

      // Extract bookstr metadata if applicable
      const bookMetadata = fetchedEvent ? extractBookMetadata(fetchedEvent) : null
      const isBookstrEvent = fetchedEvent && (fetchedEvent.kind === ExtendedKind.PUBLICATION || fetchedEvent.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata?.book

      const formatBookName = (book: string) => {
        return book
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')
      }
      
      // Truncate original URL to 150 characters
      const truncatedUrl = url.length > 150 ? url.substring(0, 150) + '...' : url

      // Determine which article component to use based on event kind
      const isAsciidocEvent = fetchedEvent && (fetchedEvent.kind === ExtendedKind.WIKI_ARTICLE || fetchedEvent.kind === ExtendedKind.PUBLICATION_CONTENT)
      const isMarkdownEvent = fetchedEvent && (fetchedEvent.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN)
      // Only show content preview if summary exists (exclude LongFormArticle - they should show summary instead)
      const showContentPreview = eventSummary && previewEvent && previewEvent.content && (isAsciidocEvent || isMarkdownEvent)
      
      // Get title with fallbacks
      const eventTitle = getTitleWithFallbacks(fetchedEvent || null, eventMetadata) || eventTypeName

      // Render all images on left side, crop wider ones
      return (
        <div
          className={cn('p-3 flex w-full border rounded-lg overflow-hidden gap-0 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20 max-w-full', className)}
        >
          {displayImage && isSafeMediaUrl(displayImage) && (
            <div className={cn(
              "flex-shrink-0 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20 -my-3 -ml-3 -mr-0 flex items-center justify-center rounded-l-lg overflow-hidden",
              imageAspectRatio !== null && imageAspectRatio > 1 ? "w-24 sm:w-32 md:w-52 lg:w-[416px] max-w-[120px] sm:max-w-[160px] md:max-w-[208px] lg:max-w-none" : "w-20 sm:w-28 md:w-40 lg:w-52 max-w-[80px] sm:max-w-[112px] md:max-w-[160px] lg:max-w-none"
            )}>
              <Image
                image={{ url: displayImage, pubkey: fetchedEvent?.pubkey }}
                className="w-full h-full object-cover"
                hideIfError
              />
            </div>
          )}
          <div className="flex-1 min-w-0 pl-3 overflow-hidden">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {fetchedEvent ? (
                  <>
                    <Username userId={fetchedEvent.pubkey} className="text-xs" />
                    {eventAuthorProfile?.avatar && (
                      <img
                        src={eventAuthorProfile.avatar}
                        alt=""
                        className="w-5 h-5 rounded-full flex-shrink-0 object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    )}
                    <span className="text-xs text-muted-foreground flex-shrink-0">•</span>
                    <span className="text-xs text-muted-foreground truncate">{eventTypeName}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground truncate">
                    {isFetchingEventFinal ? 'Loading event...' : 'Event'}
                  </span>
                )}
              </div>
              <a
                href={cleanedUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex-shrink-0"
              >
                <ExternalLink className="w-3 h-3 text-green-600 dark:text-green-400" />
              </a>
            </div>
            {fetchedEvent && (
              <>
                {/* Always show title in card header, hide it in content preview */}
                {eventTitle && (
                  <div className="font-semibold text-sm line-clamp-2 mb-1 text-green-900 dark:text-green-100">{eventTitle}</div>
                )}
                {isBookstrEvent && bookMetadata && (
                  <div className="text-xs text-muted-foreground space-x-2 mb-1">
                    {bookMetadata.type && <span>Type: {bookMetadata.type}</span>}
                    {bookMetadata.book && <span>Book: {formatBookName(bookMetadata.book)}</span>}
                    {bookMetadata.chapter && <span>Chapter: {bookMetadata.chapter}</span>}
                    {bookMetadata.verse && <span>Verse: {bookMetadata.verse}</span>}
                    {bookMetadata.version && <span>Version: {bookMetadata.version.toUpperCase()}</span>}
                  </div>
                )}
                {eventSummary && !showContentPreview && (
                  <div className="text-base text-muted-foreground line-clamp-2 mb-1">{eventSummary}</div>
                )}
                {showContentPreview && (
                  <div className="my-2 text-sm line-clamp-6 overflow-hidden [&_img]:hidden [&_h1]:hidden [&_h2]:hidden">
                    {isAsciidocEvent ? (
                      <AsciidocArticle 
                        event={previewEvent} 
                        className="pointer-events-none"
                        hideImagesAndInfo={true}
                      />
                    ) : (
                      <MarkdownArticle 
                        event={previewEvent} 
                        className="pointer-events-none"
                        hideMetadata={true}
                      />
                    )}
                  </div>
                )}
              </>
            )}
            <hr className="mt-4 mb-2 border-t border-border" />
            <a
              href={cleanedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-muted-foreground truncate block hover:underline break-all"
            >
              {truncatedUrl}
            </a>
          </div>
        </div>
      )
    }

    // Enhanced card for profile URLs (loading state)
    if (nostrType === 'npub' || nostrType === 'nprofile') {
      // Truncate original URL to 150 characters
      const truncatedUrl = url.length > 150 ? url.substring(0, 150) + '...' : url
      
      return (
        <div
          className={cn('p-3 flex w-full border rounded-lg overflow-hidden gap-0 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20 max-w-full', className)}
        >
          {fetchedProfile?.avatar && (
            <div className="w-20 sm:w-28 md:w-36 lg:w-40 max-w-[80px] sm:max-w-[112px] md:max-w-[144px] lg:max-w-none flex-shrink-0 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20 -my-3 -ml-3 -mr-0 flex items-center justify-center rounded-l-lg overflow-hidden">
              <Image
                image={{ url: fetchedProfile.avatar, pubkey: fetchedProfile.pubkey }}
                className="w-full h-full object-cover"
                hideIfError
              />
            </div>
          )}
          <div className="flex-1 min-w-0 pl-3 overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {fetchedProfile ? (
                  <>
                    <Username userId={fetchedProfile.pubkey} />
                    {fetchedProfile.nip05 && (
                      <>
                        <span className="text-xs text-muted-foreground flex-shrink-0">•</span>
                        <span className="text-xs text-green-600 dark:text-green-400 truncate">{fetchedProfile.nip05}</span>
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground truncate">
                    {isFetchingProfile ? 'Loading profile...' : 'Profile'}
                  </span>
                )}
              </div>
              <a
                href={cleanedUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex-shrink-0"
              >
                <ExternalLink className="w-3 h-3 text-green-600 dark:text-green-400" />
              </a>
            </div>
            <ProfileAbout
              about={fetchedProfile?.about}
              className="text-base text-muted-foreground line-clamp-2 mb-1 mt-1 break-words"
            />
            <hr className="mt-4 mb-2 border-t border-border" />
            <a
              href={cleanedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-muted-foreground truncate block hover:underline break-all"
            >
              {truncatedUrl}
            </a>
          </div>
        </div>
      )
    }

    // Basic fallback for non-nostr URLs - show site information
    return (
      <div
        className={cn('p-3 flex w-full border rounded-lg overflow-hidden gap-3 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20 max-w-full', className)}
      >
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-sm font-semibold text-green-900 dark:text-green-100 truncate flex-1 min-w-0">{hostname}</div>
            <a
              href={cleanedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0"
            >
              <ExternalLink className="w-3 h-3 text-green-600 dark:text-green-400" />
            </a>
          </div>
            <hr className="mt-4 mb-2 border-t border-border" />
            <a
              href={cleanedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-muted-foreground break-all line-clamp-2 block hover:underline"
            >
              {cleanedUrl}
            </a>
        </div>
      </div>
    )
  }

  // All OG images render on left with cropping

  if (isSmallScreen && image && isSafeMediaUrl(image)) {
    // Small screen: always use horizontal layout with image on left
    return (
      <div className="rounded-lg border mt-2 overflow-hidden flex w-full">
        <div className={cn(
          "flex-shrink-0 bg-muted flex items-center justify-center rounded-l-lg overflow-hidden",
          ogImageAspectRatio !== null && ogImageAspectRatio > 1 ? "w-24 max-w-[120px]" : "w-20 max-w-[80px]"
        )}>
          <Image image={{ url: image }} className="w-full h-full object-cover" hideIfError />
        </div>
        <div className="bg-muted p-2 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground truncate flex-1 min-w-0">{hostname}</div>
            <a
              href={cleanedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0"
            >
              <ExternalLink className="w-3 h-3 text-muted-foreground" />
            </a>
          </div>
          {title && <div className="font-semibold line-clamp-1 break-words">{title}</div>}
          {!title && description && <div className="font-semibold line-clamp-1 break-words">{description}</div>}
          <hr className="mt-4 mb-2 border-t border-border" />
          <a
            href={cleanedUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-muted-foreground truncate block hover:underline break-all"
          >
            {url}
          </a>
        </div>
      </div>
    )
  }

  // Render all OG images on left side, crop wider ones
  return (
    <div className={cn('p-2 flex w-full border rounded-lg overflow-hidden gap-0 max-w-full', className)}>
      {image && isSafeMediaUrl(image) && (
        <div className={cn(
          "flex-shrink-0 bg-muted flex items-center justify-center -my-2 -ml-2 -mr-0 rounded-l-lg overflow-hidden",
          ogImageAspectRatio !== null && ogImageAspectRatio > 1 ? "w-32 sm:w-52 md:w-[416px]" : "w-20 sm:w-40 md:w-52"
        )}>
          <Image
            image={{ url: image }}
            className="w-full h-full object-cover"
            hideIfError
          />
        </div>
      )}
      <div className="flex-1 min-w-0 p-2 pl-2 overflow-hidden">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-xs text-muted-foreground truncate flex-1 min-w-0">{hostname}</div>
          <a
            href={cleanedUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex-shrink-0"
          >
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
          </a>
        </div>
        {title && <div className="font-semibold line-clamp-2 mb-1 break-words">{title}</div>}
        {description && (
          <div className={cn("line-clamp-3 mb-1 break-words", title ? "text-xs text-muted-foreground" : "text-sm font-semibold")}>
            {description}
          </div>
        )}
        {!title && !description && (
          <div className="text-xs text-muted-foreground mb-1">No description available</div>
        )}
        <hr className="mt-4 mb-2 border-t border-border" />
        <a
          href={cleanedUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-muted-foreground truncate block hover:underline break-all"
        >
          {url}
        </a>
      </div>
    </div>
  )
}
