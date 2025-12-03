import { useFetchWebMetadata } from '@/hooks/useFetchWebMetadata'
import { useFetchEvent } from '@/hooks/useFetchEvent'
import { useFetchProfile } from '@/hooks/useFetchProfile'
import { ExtendedKind } from '@/constants'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ExternalLink } from 'lucide-react'
import { nip19, kinds } from 'nostr-tools'
import { useMemo, useEffect, useState } from 'react'
import Image from '../Image'
import Username from '../Username'
import { cleanUrl } from '@/lib/url'
import { tagNameEquals } from '@/lib/tag'
import client from '@/services/client.service'
import { Event } from 'nostr-tools'
import { BIG_RELAY_URLS } from '@/constants'
import { getImetaInfosFromEvent } from '@/lib/event'
import MarkdownArticle from '../Note/MarkdownArticle/MarkdownArticle'

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

export default function WebPreview({ url, className }: { url: string; className?: string }) {
  const { autoLoadMedia } = useContentPolicy()
  const { isSmallScreen } = useScreenSize()

  const cleanedUrl = useMemo(() => cleanUrl(url), [url])
  const { title, description, image } = useFetchWebMetadata(cleanedUrl)

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
        
        const events = await client.fetchEvents(BIG_RELAY_URLS, filters)
        
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

  // Early return after ALL hooks are called
  if (!autoLoadMedia) {
    return null
  }

  // Always try to fetch OG data for standalone hyperlinks (except internal jumble links)
  // Check if we have any opengraph data (title, description, or image)
  const hasOpengraphData = !isInternalJumbleLink && (title || description || image)

  // Show enhanced fallback link card if:
  // 1. No OG data available, OR
  // 2. A nostr identifier was detected (we want to show the detailed nostr card even with OG data)
  // Note: We always attempt to fetch OG data via useFetchWebMetadata hook above
  if (!hasOpengraphData || nostrIdentifier) {
    // Enhanced card for event URLs (always show if nostr identifier detected, even while loading)
    if (nostrType === 'naddr' || nostrType === 'nevent' || nostrType === 'note') {
      const eventMetadata = fetchedEvent ? getLongFormArticleMetadataFromEvent(fetchedEvent) : null
      const eventTypeName = fetchedEvent ? getEventTypeName(fetchedEvent.kind) : null
      const eventTitle = eventMetadata?.title || eventTypeName
      const eventSummary = eventMetadata?.summary || description
      const eventImage = eventMetadata?.image

      // Extract imeta info to check for thumbnails
      const imetaInfos = fetchedEvent ? getImetaInfosFromEvent(fetchedEvent) : []
      // Find thumbnail for the event image if available
      let eventImageThumbnail: string | null = null
      if (eventImage && fetchedEvent) {
        const cleanedEventImage = cleanUrl(eventImage)
        // Find imeta info that matches the event image URL
        const matchingImeta = imetaInfos.find(info => cleanUrl(info.url) === cleanedEventImage)
        // Return thumbnail if available, otherwise return original image
        eventImageThumbnail = matchingImeta?.thumb || eventImage
      }

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

      return (
        <div
          className={cn('p-3 clickable flex w-full border rounded-lg overflow-hidden gap-3 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20', className)}
          onClick={(e) => {
            e.stopPropagation()
            window.open(cleanedUrl, '_blank')
          }}
        >
          {eventImageThumbnail && fetchedEvent && (
            <Image
              image={{ url: eventImageThumbnail, pubkey: fetchedEvent.pubkey }}
              className="w-20 h-20 rounded-lg flex-shrink-0 object-cover border border-green-200 dark:border-green-800"
              hideIfError
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
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
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">{eventTypeName}</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {isFetchingEventFinal ? 'Loading event...' : 'Event'}
                </span>
              )}
              <ExternalLink className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0 ml-auto" />
            </div>
            {fetchedEvent && (
              <>
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
                {eventSummary && (
                  <div className="text-xs text-muted-foreground line-clamp-2 mb-1">{eventSummary}</div>
                )}
                {previewEvent && previewEvent.content && (
                  <div className="my-2 text-sm line-clamp-6 overflow-hidden [&_img]:hidden">
                    <MarkdownArticle 
                      event={previewEvent} 
                      className="pointer-events-none"
                      hideMetadata={true}
                    />
                  </div>
                )}
              </>
            )}
            <div className="text-xs text-muted-foreground truncate mt-2">{truncatedUrl}</div>
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
          className={cn('p-3 clickable flex w-full border rounded-lg overflow-hidden gap-3 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20', className)}
          onClick={(e) => {
            e.stopPropagation()
            window.open(cleanedUrl, '_blank')
          }}
        >
          {fetchedProfile?.avatar && (
            <Image
              image={{ url: fetchedProfile.avatar, pubkey: fetchedProfile.pubkey }}
              className="w-16 h-16 rounded-lg flex-shrink-0 object-cover border border-green-200 dark:border-green-800"
              hideIfError
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {fetchedProfile ? (
                <>
                  <Username userId={fetchedProfile.pubkey} />
                  {fetchedProfile.nip05 && (
                    <>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-green-600 dark:text-green-400">{fetchedProfile.nip05}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {isFetchingProfile ? 'Loading profile...' : 'Profile'}
                </span>
              )}
              <ExternalLink className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0 ml-auto" />
            </div>
            {fetchedProfile?.about && (
              <div className="text-xs text-muted-foreground line-clamp-2 mb-1 mt-1">{fetchedProfile.about}</div>
            )}
            <div className="text-xs text-muted-foreground truncate mt-1">{truncatedUrl}</div>
          </div>
        </div>
      )
    }

    // Basic fallback for non-nostr URLs - show site information
    return (
      <div
        className={cn('p-3 clickable flex w-full border rounded-lg overflow-hidden gap-3 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20', className)}
        onClick={(e) => {
          e.stopPropagation()
          window.open(cleanedUrl, '_blank')
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-sm font-semibold text-green-900 dark:text-green-100 truncate">{hostname}</div>
            <ExternalLink className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0" />
          </div>
          <div className="text-xs text-muted-foreground break-all line-clamp-2">{cleanedUrl}</div>
        </div>
      </div>
    )
  }

  if (isSmallScreen && image) {
    return (
      <div
        className="rounded-lg border mt-2 overflow-hidden"
        onClick={(e) => {
          e.stopPropagation()
          window.open(cleanedUrl, '_blank')
        }}
      >
        <Image image={{ url: image }} className="w-20 h-20 rounded-lg object-cover" hideIfError />
        <div className="bg-muted p-2 w-full">
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground truncate">{hostname}</div>
            <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          </div>
          {title && <div className="font-semibold line-clamp-1">{title}</div>}
          {!title && description && <div className="font-semibold line-clamp-1">{description}</div>}
          <div className="text-xs text-muted-foreground truncate mt-1">{url}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('p-2 clickable flex w-full border rounded-lg overflow-hidden gap-2', className)}
      onClick={(e) => {
        e.stopPropagation()
        window.open(cleanedUrl, '_blank')
      }}
    >
      {image && (
        <Image
          image={{ url: image }}
          className="w-20 h-20 rounded-lg flex-shrink-0 object-cover"
          hideIfError
        />
      )}
      <div className="flex-1 w-0 p-2">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-xs text-muted-foreground truncate">{hostname}</div>
          <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        </div>
        {title && <div className="font-semibold line-clamp-2 mb-1">{title}</div>}
        {description && (
          <div className={cn("line-clamp-3 mb-1", title ? "text-xs text-muted-foreground" : "text-sm font-semibold")}>
            {description}
          </div>
        )}
        <div className="text-xs text-muted-foreground truncate">{url}</div>
      </div>
    </div>
  )
}
